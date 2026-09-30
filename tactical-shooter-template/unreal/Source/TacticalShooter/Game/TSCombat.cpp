#include "Game/TSCombat.h"
#include "Game/TSCharacter.h"
#include "Game/TSGameMode.h"
#include "Game/TSGameSubsystem.h"
#include "Engine/World.h"
#include "CollisionQueryParams.h"
#include "WorldCollision.h"

namespace
{
	FCollisionObjectQueryParams WorldObjects()
	{
		FCollisionObjectQueryParams P;
		P.AddObjectTypesToQuery(ECC_WorldStatic);
		P.AddObjectTypesToQuery(ECC_WorldDynamic);
		return P;
	}

	FCollisionObjectQueryParams ShotObjects()
	{
		FCollisionObjectQueryParams P = WorldObjects();
		P.AddObjectTypesToQuery(ECC_Pawn);
		return P;
	}

	bool FriendlyFire(const ATSGameMode* Mode)
	{
		return UTSGameSubsystem::Get(Mode)->Data().Game.Combat.FriendlyFire;
	}
}

FVector FTSCombat::FireBullet(ATSCharacter* Shooter, const FVector& Origin, const FVector& Dir, const FTSWeaponDef& W) const
{
	UWorld* World = Mode->GetWorld();
	const FVector End = Origin + Dir * W.MaxRange * 100.f;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(TSBullet), false, Shooter);
	TArray<FHitResult> Hits;
	World->LineTraceMultiByObjectType(Hits, Origin, End, ShotObjects(), Params);
	Hits.Sort([](const FHitResult& A, const FHitResult& B) { return A.Distance < B.Distance; });
	for (const FHitResult& Hit : Hits)
	{
		ATSCharacter* Victim = Cast<ATSCharacter>(Hit.GetActor());
		if (Victim != nullptr)
		{
			if (Victim == Shooter || !Victim->IsAlive()) continue;
			if (!FriendlyFire(Mode) && Victim->Team() == Shooter->Team()) continue;
			const ETSHitZone Zone = Victim->HitZoneAt(Hit.ImpactPoint);
			const float Raw = TSDamage::RawDamage(W, Zone, Hit.Distance / 100.f);
			Victim->ApplyDamage(Raw, W.ArmorPenetration, Shooter, W.Id, Zone, Origin);
			Mode->Effects.BloodPuff(Hit.ImpactPoint);
			return Hit.ImpactPoint;
		}
		Mode->Effects.Impact(Hit.ImpactPoint, Hit.ImpactNormal);
		return Hit.ImpactPoint;
	}
	return End;
}

void FTSCombat::Melee(ATSCharacter* Attacker, const FTSWeaponDef& W) const
{
	UWorld* World = Mode->GetWorld();
	const FVector Eye = Attacker->EyePosition();
	const FVector End = Eye + Attacker->AimForward() * W.MaxRange * 100.f;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(TSMelee), false, Attacker);
	TArray<FHitResult> Hits;
	World->SweepMultiByObjectType(Hits, Eye, End, FQuat::Identity, ShotObjects(), FCollisionShape::MakeSphere(35.f), Params);
	Hits.Sort([](const FHitResult& A, const FHitResult& B) { return A.Distance < B.Distance; });
	for (const FHitResult& Hit : Hits)
	{
		ATSCharacter* Victim = Cast<ATSCharacter>(Hit.GetActor());
		if (Victim == nullptr)
		{
			if (Hit.Distance > 0.f) return; // a wall is in the way
			continue;
		}
		if (Victim == Attacker || !Victim->IsAlive() || (!FriendlyFire(Mode) && Victim->Team() == Attacker->Team())) continue;
		const FVector ToVictim = (Victim->Feet() - Attacker->Feet()).GetSafeNormal2D();
		const bool bBackstab = FVector::DotProduct(Victim->GetActorForwardVector(), ToVictim) > 0.5f;
		Victim->ApplyDamage(W.Damage * (bBackstab ? 2.f : 1.f), W.ArmorPenetration, Attacker, W.Id, ETSHitZone::Body, Eye);
		Mode->Effects.BloodPuff(Victim->ChestPosition());
		return;
	}
}

bool FTSCombat::ClearPath(const FVector& From, const FVector& To) const
{
	FCollisionQueryParams Params(SCENE_QUERY_STAT(TSSight), false);
	return !Mode->GetWorld()->LineTraceTestByObjectType(From, To, WorldObjects(), Params);
}

bool FTSCombat::LineOfSight(const FVector& From, const FVector& To) const
{
	return ClearPath(From, To) && !Mode->Effects.SmokeBlocks(From, To);
}

void FTSCombat::Explosion(const FVector& Center, float RadiusMetres, float MaxDamage, float ArmorPenetration, ATSCharacter* Owner, const FString& SourceId, bool bNeedsSight) const
{
	for (ATSCharacter* C : Mode->AliveCharacters())
	{
		const float Dist = (float)(FVector::Dist(Center, C->ChestPosition()) / 100.0);
		if (Dist > RadiusMetres) continue;
		if (Owner != nullptr && C != Owner && C->Team() == Owner->Team() && !FriendlyFire(Mode)) continue;
		if (bNeedsSight && !ClearPath(Center, C->ChestPosition())) continue;
		C->ApplyDamage(TSDamage::AreaDamage(MaxDamage, Dist, RadiusMetres), ArmorPenetration, Owner, SourceId, ETSHitZone::Body, Center);
	}
}
