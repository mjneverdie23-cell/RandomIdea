#include "Game/TSEffects.h"
#include "Game/TSCharacter.h"
#include "Game/TSGameMode.h"
#include "Game/TSGameSubsystem.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"

ATSShapeActor::ATSShapeActor()
{
	PrimaryActorTick.bCanEverTick = false;
	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	RootComponent = Mesh;
	Mesh->SetMobility(EComponentMobility::Movable);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Mesh->SetGenerateOverlapEvents(false);
}

void ATSShapeActor::Setup(ETSShape Shape, const FLinearColor& Color, const FVector& ScaleMetres, bool bCollision)
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	Mesh->SetStaticMesh(Game->Mesh(Shape));
	Mesh->SetMaterial(0, Game->Material(Color));
	SetActorScale3D(ScaleMetres);
	if (bCollision)
	{
		Mesh->SetCollisionObjectType(ECC_WorldDynamic);
		Mesh->SetCollisionResponseToAllChannels(ECR_Block);
		Mesh->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	}
}

void ATSShapeActor::SetColor(const FLinearColor& Color)
{
	Mesh->SetMaterial(0, UTSGameSubsystem::Get(this)->Material(Color));
}

namespace
{
	FCollisionObjectQueryParams EffectsBlockers()
	{
		FCollisionObjectQueryParams P;
		P.AddObjectTypesToQuery(ECC_WorldStatic);
		P.AddObjectTypesToQuery(ECC_WorldDynamic);
		return P;
	}

	const FTSGameData& EffectsData(const ATSGameMode* Mode) { return UTSGameSubsystem::Get(Mode)->Data(); }
}

void FTSEffectsWorld::Kill(const TWeakObjectPtr<ATSShapeActor>& Actor)
{
	if (Actor.IsValid()) Actor->Destroy();
}

ATSShapeActor* FTSEffectsWorld::SpawnShape(ETSShape Shape, const FVector& At, const FLinearColor& Color, const FVector& ScaleMetres, bool bCollision, const FRotator& Rotation)
{
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	ATSShapeActor* A = Mode->GetWorld()->SpawnActor<ATSShapeActor>(At, Rotation, Params);
	if (A != nullptr) A->Setup(Shape, Color, ScaleMetres, bCollision);
	return A;
}

void FTSEffectsWorld::ClearAll()
{
	for (const FProjectile& P : Projectiles) Kill(P.Actor);
	for (const FSmoke& S : Smokes) Kill(S.Actor);
	for (const FFire& F : Fires) Kill(F.Actor);
	for (const FBarrier& B : Barriers) Kill(B.Actor);
	for (const FPickup& P : Pickups) Kill(P.Actor);
	for (const FTemp& T : Temps) Kill(T.Actor);
	Projectiles.Reset();
	Smokes.Reset();
	Fires.Reset();
	Barriers.Reset();
	Pickups.Reset();
	Temps.Reset();
	if (Mode != nullptr) Mode->World.Nav.ClearDynamicBlocks();
}

void FTSEffectsWorld::Tick(float Dt)
{
	const FTSCombatSettings& Combat = EffectsData(Mode).Game.Combat;
	UWorld* World = Mode->GetWorld();

	for (int32 i = Projectiles.Num() - 1; i >= 0; --i)
	{
		FProjectile& P = Projectiles[i];
		if (!P.bResting)
		{
			P.VelocityMps.Z -= Combat.ProjectileGravity * Dt;
			const FVector Step = P.VelocityMps * 100.f * Dt;
			FHitResult Hit;
			FCollisionQueryParams Params(SCENE_QUERY_STAT(TSProjectile), false);
			if (!Step.IsNearlyZero() && World->SweepSingleByObjectType(Hit, P.Position, P.Position + Step, FQuat::Identity, EffectsBlockers(), FCollisionShape::MakeSphere(10.f), Params))
			{
				P.Position = Hit.Location + Hit.ImpactNormal * 1.f;
				P.VelocityMps = FMath::GetReflectionVector(P.VelocityMps, Hit.ImpactNormal) * Combat.ProjectileBounce;
				if (Hit.ImpactNormal.Z > 0.7f && P.VelocityMps.Size() < 1.5f)
				{
					P.bResting = true;
					P.VelocityMps = FVector::ZeroVector;
				}
			}
			else P.Position += Step;
			if (P.Actor.IsValid()) P.Actor->SetActorLocation(P.Position);
		}
		P.Fuse -= Dt;
		if (P.Fuse <= 0.f)
		{
			const FProjectile Done = P;
			Projectiles.RemoveAt(i);
			Kill(Done.Actor);
			Detonate(Done);
		}
	}

	for (int32 i = Smokes.Num() - 1; i >= 0; --i)
	{
		FSmoke& S = Smokes[i];
		S.TimeLeft -= Dt;
		S.Radius = FMath::FInterpConstantTo(S.Radius, S.TimeLeft < 1.f ? 0.f : S.MaxRadius, Dt, S.MaxRadius * 2.f);
		if (S.Actor.IsValid()) S.Actor->SetActorScale3D(FVector(S.Radius * 2.f));
		if (S.TimeLeft <= 0.f)
		{
			Kill(S.Actor);
			Smokes.RemoveAt(i);
		}
	}

	for (int32 i = Fires.Num() - 1; i >= 0; --i)
	{
		FFire& F = Fires[i];
		F.TimeLeft -= Dt;
		F.TickTimer -= Dt;
		if (F.TickTimer <= 0.f)
		{
			F.TickTimer += 0.25f;
			for (ATSCharacter* C : Mode->AliveCharacters())
			{
				if (F.Owner != nullptr && C->Team() == F.Owner->Team() && !Combat.FriendlyFire) continue;
				const FVector D = C->Feet() - F.Center;
				if (FMath::Abs(D.Z) > 150.f || D.Size2D() > F.Radius * 100.f) continue;
				C->ApplyDamage(F.Def->Damage * 0.25f, 0.f, F.Owner, F.Def->Id, ETSHitZone::Body, F.Center);
			}
		}
		if (F.TimeLeft <= 0.f)
		{
			Kill(F.Actor);
			Fires.RemoveAt(i);
		}
	}

	for (int32 i = Barriers.Num() - 1; i >= 0; --i)
	{
		FBarrier& B = Barriers[i];
		B.TimeLeft -= Dt;
		if (B.TimeLeft > 0.f) continue;
		for (const FTSCell& C : B.Cells) Mode->World.Nav.AddDynamicBlock(C.X, C.Y, -1);
		Kill(B.Actor);
		Barriers.RemoveAt(i);
	}

	// Walking over a weapon picks it up if that slot is empty.
	for (int32 i = Pickups.Num() - 1; i >= 0; --i)
	{
		FPickup& P = Pickups[i];
		if (P.Actor.IsValid()) P.Actor->AddActorLocalRotation(FRotator(0.f, 90.f * Dt, 0.f));
		for (ATSCharacter* C : Mode->AliveCharacters())
		{
			if (C->Weapons.Slots[(int32)P.Weapon.Def->GetSlot()].IsValid()) continue;
			if (FVector::DistSquared2D(C->Feet(), P.Position) > FMath::Square(120.f)) continue;
			GiveTo(C, i);
			break;
		}
	}

	for (int32 i = Temps.Num() - 1; i >= 0; --i)
	{
		FTemp& T = Temps[i];
		T.TimeLeft -= Dt;
		if (T.TimeLeft <= 0.f || !T.Actor.IsValid())
		{
			Kill(T.Actor);
			Temps.RemoveAt(i);
			continue;
		}
		T.Actor->SetActorScale3D(FMath::Lerp(T.ToScale, T.FromScale, T.TimeLeft / T.Life));
	}
}

void FTSEffectsWorld::Throw(ATSCharacter* Owner, const FTSAbilityDef& Def, const FVector& Start, const FVector& VelocityMps)
{
	FProjectile P;
	P.Owner = Owner;
	P.Def = &Def;
	P.Position = Start;
	P.VelocityMps = VelocityMps;
	P.Fuse = Def.FuseSeconds;
	P.Actor = SpawnShape(ETSShape::Sphere, Start, UTSGameSubsystem::Color(Def.Color), FVector(0.2f));
	Projectiles.Add(P);
}

void FTSEffectsWorld::Detonate(const FProjectile& P)
{
	const FTSAbilityDef& A = *P.Def;
	switch (A.GetType())
	{
	case ETSAbilityType::Flash:
		Flash(P.Owner, P.Position, A);
		break;
	case ETSAbilityType::Smoke:
	{
		FSmoke S;
		S.Center = P.Position;
		S.Radius = 0.5f;
		S.MaxRadius = A.Radius;
		S.TimeLeft = A.Duration;
		S.Actor = SpawnShape(ETSShape::Sphere, P.Position, UTSGameSubsystem::Color(A.Color), FVector(1.f));
		Smokes.Add(S);
		Mode->PlaySound(TEXT("smoke_pop"), P.Position);
		break;
	}
	case ETSAbilityType::Frag:
		Mode->Combat.Explosion(P.Position, A.Radius, A.Damage, 0.f, P.Owner, A.Id, true);
		Burst(P.Position, A.Radius, FLinearColor(1.f, 0.55f, 0.1f), 0.35f);
		Mode->PlaySound(TEXT("explosion"), P.Position, 0.8f);
		break;
	case ETSAbilityType::Incendiary:
	{
		FVector Ground = P.Position;
		FHitResult Hit;
		FCollisionQueryParams Params(SCENE_QUERY_STAT(TSFire), false);
		if (Mode->GetWorld()->LineTraceSingleByObjectType(Hit, P.Position + FVector(0.f, 0.f, 20.f), P.Position - FVector(0.f, 0.f, 600.f), EffectsBlockers(), Params))
			Ground = Hit.ImpactPoint;
		FFire F;
		F.Owner = P.Owner;
		F.Def = &A;
		F.Center = Ground;
		F.Radius = A.Radius;
		F.TimeLeft = A.Duration;
		F.Actor = SpawnShape(ETSShape::Cylinder, Ground + FVector(0.f, 0.f, 3.f), UTSGameSubsystem::Color(A.Color), FVector(A.Radius * 2.f, A.Radius * 2.f, 0.03f));
		Fires.Add(F);
		Mode->PlaySound(TEXT("fire_ignite"), Ground);
		break;
	}
	default:
		break;
	}
}

void FTSEffectsWorld::Flash(ATSCharacter* Owner, const FVector& Pos, const FTSAbilityDef& A)
{
	Burst(Pos, 2.5f, FLinearColor::White, 0.15f);
	Mode->PlaySound(TEXT("flash_pop"), Pos);
	for (ATSCharacter* C : Mode->AliveCharacters())
	{
		if (C == Owner) continue; // the thrower never blinds themself
		const FVector Eye = C->EyePosition();
		const float D = (float)(FVector::Dist(Eye, Pos) / 100.0);
		if (D > A.Radius || !Mode->Combat.LineOfSight(Eye, Pos)) continue;
		const float Cos = (float)FVector::DotProduct(C->AimForward(), (Pos - Eye).GetSafeNormal());
		const float Angle = FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(Cos, -1.f, 1.f)));
		const float Facing = Angle < 30.f ? 1.f : Angle > 110.f ? 0.f : 1.f - (Angle - 30.f) / 80.f;
		const float Seconds = A.Duration * Facing * (1.f - 0.5f * D / A.Radius);
		if (Seconds > 0.2f) C->Blind(Seconds);
	}
}

void FTSEffectsWorld::SpawnBarrier(ATSCharacter* Owner, const FTSAbilityDef& A)
{
	const FRotator YawRot(0.f, Owner->Yaw, 0.f);
	const FVector Forward = YawRot.Vector();
	const FVector Right = FRotationMatrix(YawRot).GetUnitAxis(EAxis::Y);
	const FVector Center = Owner->Feet() + Forward * A.Distance * 100.f + FVector(0.f, 0.f, A.Height * 50.f);
	FBarrier B;
	B.TimeLeft = A.Duration;
	B.Actor = SpawnShape(ETSShape::Cube, Center, UTSGameSubsystem::Color(A.Color), FVector(0.4f, A.Width, A.Height), true, YawRot);
	for (float S = -A.Width / 2.f; S <= A.Width / 2.f; S += 0.5f)
	{
		const FTSCell C = Mode->World.WorldToCell(Center + Right * S * 100.f);
		if (B.Cells.Contains(C)) continue;
		B.Cells.Add(C);
		Mode->World.Nav.AddDynamicBlock(C.X, C.Y, 1);
	}
	Barriers.Add(B);
}

void FTSEffectsWorld::Recon(ATSCharacter* Owner, const FTSAbilityDef& A)
{
	Burst(Owner->Feet() + FVector(0.f, 0.f, 10.f), FMath::Min(A.Radius, 40.f), UTSGameSubsystem::Color(A.Color), 0.6f, true);
	for (ATSCharacter* C : Mode->AliveCharacters())
	{
		if (C->Team() == Owner->Team()) continue;
		if (FVector::Dist2D(C->Feet(), Owner->Feet()) > A.Radius * 100.f) continue;
		C->RevealedUntil = FMath::Max(C->RevealedUntil, Mode->MatchTime + A.Duration);
	}
}

bool FTSEffectsWorld::SmokeBlocks(const FVector& A, const FVector& B) const
{
	for (const FSmoke& S : Smokes)
	{
		if (S.Radius < 0.5f) continue;
		const FVector AB = B - A;
		const float T = FMath::Clamp((float)(FVector::DotProduct(S.Center - A, AB) / FMath::Max(1e-3, AB.SizeSquared())), 0.f, 1.f);
		if (FVector::DistSquared(A + AB * T, S.Center) < FMath::Square(S.Radius * 100.f)) return true;
	}
	return false;
}

bool FTSEffectsWorld::InsideSmoke(const FVector& P) const
{
	for (const FSmoke& S : Smokes)
		if (FVector::DistSquared(P, S.Center) < FMath::Square(S.Radius * 100.f)) return true;
	return false;
}

void FTSEffectsWorld::SpawnPickup(const FTSWeaponInstance& Weapon, const FVector& At)
{
	if (!Weapon.IsValid()) return;
	FPickup P;
	P.Weapon = Weapon;
	P.Position = FVector(At.X, At.Y, 10.f);
	P.Actor = SpawnShape(ETSShape::Cube, P.Position, UTSGameSubsystem::Color(Weapon.Def->Color), FVector(0.7f, 0.12f, 0.12f));
	Pickups.Add(P);
}

bool FTSEffectsWorld::TrySwap(ATSCharacter* C)
{
	int32 Best = INDEX_NONE;
	float BestDist = FMath::Square(180.f);
	for (int32 i = 0; i < Pickups.Num(); ++i)
	{
		const float D = FVector::DistSquared2D(Pickups[i].Position, C->Feet());
		if (D < BestDist) { BestDist = D; Best = i; }
	}
	if (Best == INDEX_NONE) return false;
	GiveTo(C, Best);
	return true;
}

int32 FTSEffectsWorld::NearestPickup(const FVector& P, float MaxDistanceCm) const
{
	for (int32 i = 0; i < Pickups.Num(); ++i)
		if (FVector::DistSquared2D(Pickups[i].Position, P) < FMath::Square(MaxDistanceCm)) return i;
	return INDEX_NONE;
}

void FTSEffectsWorld::GiveTo(ATSCharacter* C, int32 Index)
{
	const FPickup P = Pickups[Index];
	Pickups.RemoveAt(Index);
	Kill(P.Actor);
	const FTSWeaponInstance Old = C->Weapons.Replace(P.Weapon);
	Mode->OnWeaponChanged(C, *P.Weapon.Def);
	if (Old.IsValid() && Old.Def->Price > 0) SpawnPickup(Old, C->Feet() + C->GetActorForwardVector() * 50.f);
	Mode->PlaySound(TEXT("equip"), C->Feet());
}

void FTSEffectsWorld::AddTemp(ATSShapeActor* Actor, float Seconds, const FVector& From, const FVector& To)
{
	if (Actor == nullptr) return;
	FTemp T;
	T.Actor = Actor;
	T.Life = T.TimeLeft = Seconds;
	T.FromScale = From;
	T.ToScale = To;
	Temps.Add(T);
}

void FTSEffectsWorld::Tracer(const FVector& From, const FVector& To)
{
	const FVector D = To - From;
	const float Len = (float)(D.Size() / 100.0);
	if (Len < 0.5f) return;
	const FVector Scale(Len, 0.02f, 0.02f);
	AddTemp(SpawnShape(ETSShape::Cube, From + D * 0.5f, FLinearColor(1.f, 0.9f, 0.5f), Scale, false, D.Rotation()), 0.05f, Scale, FVector(Len, 0.005f, 0.005f));
}

void FTSEffectsWorld::MuzzleFlash(const FVector& At)
{
	AddTemp(SpawnShape(ETSShape::Sphere, At, FLinearColor(1.f, 0.85f, 0.4f), FVector(0.12f)), 0.04f, FVector(0.12f), FVector(0.02f));
}

void FTSEffectsWorld::Impact(const FVector& At, const FVector& Normal)
{
	AddTemp(SpawnShape(ETSShape::Cube, At + Normal * 2.f, FLinearColor(0.25f, 0.22f, 0.2f), FVector(0.08f)), 0.6f, FVector(0.08f), FVector(0.02f));
}

void FTSEffectsWorld::BloodPuff(const FVector& At)
{
	AddTemp(SpawnShape(ETSShape::Sphere, At, FLinearColor(0.7f, 0.05f, 0.05f), FVector(0.15f)), 0.2f, FVector(0.15f), FVector(0.35f));
}

void FTSEffectsWorld::Burst(const FVector& At, float RadiusMetres, const FLinearColor& Color, float Seconds, bool bFlat)
{
	const FVector From = bFlat ? FVector(0.2f, 0.2f, 0.02f) : FVector(0.2f);
	const FVector To = bFlat ? FVector(RadiusMetres * 2.f, RadiusMetres * 2.f, 0.02f) : FVector(RadiusMetres * 2.f);
	AddTemp(SpawnShape(bFlat ? ETSShape::Cylinder : ETSShape::Sphere, At, Color, From), Seconds, From, To);
}
