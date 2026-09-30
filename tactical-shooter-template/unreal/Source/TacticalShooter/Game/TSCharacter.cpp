#include "Game/TSCharacter.h"
#include "Game/TSGameMode.h"
#include "Game/TSGameSubsystem.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/StaticMeshComponent.h"
#include "GameFramework/CharacterMovementComponent.h"

namespace
{
	constexpr float StandHalfHeightCm = 90.f;
}

ATSCharacter::ATSCharacter()
{
	// Driven explicitly by ATSGameMode (think -> act -> world -> rules), not by its own tick.
	PrimaryActorTick.bCanEverTick = false;
	AutoPossessAI = EAutoPossessAI::Disabled;
	bUseControllerRotationYaw = false;
	bUseControllerRotationPitch = false;
	bUseControllerRotationRoll = false;

	GetCapsuleComponent()->InitCapsuleSize(35.f, StandHalfHeightCm);
	UCharacterMovementComponent* MoveComp = GetCharacterMovement();
	MoveComp->bOrientRotationToMovement = false;
	MoveComp->bUseControllerDesiredRotation = false;
	MoveComp->GetNavAgentPropertiesRef().bCanCrouch = true;
	MoveComp->SetCrouchedHalfHeight(60.f);
	MoveComp->bCanWalkOffLedgesWhenCrouching = true;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(GetCapsuleComponent());
	Camera->SetRelativeLocation(FVector(0.f, 0.f, 72.f));
	Camera->bUsePawnControlRotation = false;

	VisualRoot = CreateDefaultSubobject<USceneComponent>(TEXT("VisualRoot"));
	VisualRoot->SetupAttachment(GetCapsuleComponent());
	VisualRoot->SetRelativeLocation(FVector(0.f, 0.f, -StandHalfHeightCm));

	GunPivot = CreateDefaultSubobject<USceneComponent>(TEXT("GunPivot"));
	GunPivot->SetupAttachment(VisualRoot);
	GunPivot->SetRelativeLocation(FVector(10.f, 24.f, 132.f));
}

void ATSCharacter::Init(ATSGameMode* InMode, FTSPlayerRecord* InRecord)
{
	Mode = InMode;
	Record = InRecord;
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	const FTSGameConfig& Config = Game->Data().Game;
	Agent = Game->Data().Agent(Record->AgentId);
	Rng = FTSRng(Mode->Seed ^ (uint32)(Record->Id * 7919 + 1));
	Weapons.Owner = this;
	Abilities.Owner = this;

	const FTSMovementSettings& M = Config.Movement;
	UCharacterMovementComponent* MoveComp = GetCharacterMovement();
	// The game mode hands out intents in its tick; moving after it removes a frame of input lag.
	MoveComp->AddTickPrerequisiteActor(InMode);
	MoveComp->MaxAcceleration = M.Acceleration * 100.f;
	MoveComp->BrakingDecelerationWalking = M.Deceleration * 100.f;
	MoveComp->GravityScale = M.Gravity / 9.81f;
	MoveComp->JumpZVelocity = M.JumpVelocity * 100.f;
	MoveComp->AirControl = FMath::Clamp(M.AirAcceleration / FMath::Max(1.f, M.Acceleration) * 4.f, 0.f, 1.f);
	MoveComp->MaxStepHeight = M.StepHeight * 100.f;
	MoveComp->SetCrouchedHalfHeight(M.CrouchHeight * 50.f);
	GetCapsuleComponent()->SetCapsuleSize(M.Radius * 100.f, M.StandHeight * 50.f);
	BuildVisuals();
}

void ATSCharacter::BuildVisuals()
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	const FTSVisualSettings& V = Game->Data().Game.Visuals;
	const FLinearColor AgentColor = UTSGameSubsystem::Color(Agent ? Agent->Color : FString(TEXT("#FFFFFF")));
	// Everything below is visual only (no collision). OwnerNoSee hides the body from whoever is
	// looking out of this character's camera; OnlyOwnerSee shows the view model only to them.
	auto Body = [&](ETSShape Shape, const FVector& Pos, const FVector& Scale, const FLinearColor& Color, USceneComponent* Parent)
	{
		UStaticMeshComponent* C = Game->AddShape(this, Parent, Shape, Pos, Scale, Color);
		C->SetOwnerNoSee(true);
		return C;
	};
	BodyMesh = Body(ETSShape::Cylinder, FVector(0.f, 0.f, 72.f), FVector(0.55f, 0.66f, 1.44f), FLinearColor::White, VisualRoot);
	BandMesh = Body(ETSShape::Cylinder, FVector(0.f, 0.f, 112.f), FVector(0.57f, 0.68f, 0.12f), AgentColor, VisualRoot);
	HeadMesh = Body(ETSShape::Sphere, FVector(0.f, 0.f, 160.f), FVector(0.36f, 0.36f, 0.38f), UTSGameSubsystem::Color(V.SkinColor), VisualRoot);
	VisorMesh = Body(ETSShape::Cube, FVector(15.f, 0.f, 163.f), FVector(0.12f, 0.3f, 0.08f), AgentColor, VisualRoot);
	GunMesh = Body(ETSShape::Cube, FVector(30.f, 0.f, 0.f), FVector(0.55f, 0.07f, 0.1f), FLinearColor::Black, GunPivot);
	PackMesh = Body(ETSShape::Cube, FVector(-32.f, 0.f, 105.f), FVector(0.16f, 0.36f, 0.42f), UTSGameSubsystem::Color(V.BombColor), VisualRoot);
	PackMesh->SetVisibility(false);

	ViewGun = Game->AddShape(this, Camera, ETSShape::Cube, FVector(32.f, 20.f, -20.f), FVector(0.4f, 0.06f, 0.08f), FLinearColor::Black);
	ViewGun->SetOnlyOwnerSee(true);
	ViewGun->SetCastShadow(false);
	RefreshColors();
}

ETSSide ATSCharacter::Side() const
{
	return Mode->Flow.SideOf(Record->Team);
}

void ATSCharacter::RefreshColors()
{
	if (BodyMesh == nullptr) return;
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	const FTSVisualSettings& V = Game->Data().Game.Visuals;
	BodyMesh->SetMaterial(0, Game->Material(UTSGameSubsystem::Color(Side() == ETSSide::Attack ? V.AttackColor : V.DefenseColor)));
}

void ATSCharacter::SetWeaponVisual(const FTSWeaponDef* Def)
{
	if (Def == nullptr || GunMesh == nullptr) return;
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	UMaterialInterface* Mat = Game->Material(UTSGameSubsystem::Color(Def->Color));
	const ETSWeaponCategory Cat = Def->GetCategory();
	const float Length = Cat == ETSWeaponCategory::Melee ? 0.25f : Cat == ETSWeaponCategory::Sidearm ? 0.28f : Cat == ETSWeaponCategory::Sniper ? 0.95f : 0.6f;
	GunMesh->SetMaterial(0, Mat);
	GunMesh->SetRelativeScale3D(FVector(Length, 0.07f, 0.1f));
	GunMesh->SetRelativeLocation(FVector(Length * 50.f, 0.f, 0.f));
	ViewGun->SetMaterial(0, Mat);
	ViewGun->SetRelativeScale3D(FVector(Length * 0.7f, 0.06f, 0.08f));
}

FVector ATSCharacter::Feet() const
{
	return GetActorLocation() - FVector(0.f, 0.f, GetCapsuleComponent()->GetScaledCapsuleHalfHeight());
}

float ATSCharacter::HeightMetres() const
{
	return GetCapsuleComponent()->GetScaledCapsuleHalfHeight() * 2.f / 100.f;
}

FVector ATSCharacter::EyePosition() const
{
	const FTSMovementSettings& M = UTSGameSubsystem::Get(this)->Data().Game.Movement;
	return Feet() + FVector(0.f, 0.f, FMath::Lerp(M.EyeHeightStand, M.EyeHeightCrouch, CrouchAmount) * 100.f);
}

bool ATSCharacter::IsGrounded() const
{
	return GetCharacterMovement()->IsMovingOnGround();
}

void ATSCharacter::Respawn(const FVector& InFeet, float InYaw)
{
	const FTSCombatSettings& C = UTSGameSubsystem::Get(this)->Data().Game.Combat;
	SetActorHiddenInGame(false);
	SetActorEnableCollision(true);
	GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	UnCrouch();
	GetCharacterMovement()->StopMovementImmediately();
	GetCharacterMovement()->SetMovementMode(MOVE_Walking);
	const float HalfHeight = GetCapsuleComponent()->GetUnscaledCapsuleHalfHeight();
	SetActorLocationAndRotation(InFeet + FVector(0.f, 0.f, HalfHeight + 2.f), FRotator(0.f, InYaw, 0.f), false, nullptr, ETeleportType::TeleportPhysics);
	bAlive = true;
	Record->bAlive = true;
	Health = C.MaxHealth;
	Armor = Record->Loadout.Armor;
	Yaw = InYaw;
	Pitch = 0.f;
	RecoilPitch = RecoilYaw = 0.f;
	CrouchAmount = 0.f;
	SpeedMultiplier = FireRateMultiplier = DamageTakenMultiplier = 1.f;
	BuffTimeLeft = HealTimeLeft = DashTimeLeft = 0.f;
	BlindTimeLeft = BlindDuration = 0.f;
	RevealedUntil = 0.f;
	LastDamagedTime = -99.f;
	SetCarryingBomb(false);
	VisualRoot->SetRelativeRotation(FRotator::ZeroRotator);
	VisualRoot->SetRelativeLocation(FVector(0.f, 0.f, -GetCapsuleComponent()->GetUnscaledCapsuleHalfHeight()));
	GunPivot->SetVisibility(true, true);
	Weapons.SetLoadout(Record->Loadout);
	RefreshColors();
	LastIntent = FTSIntent::Idle(InYaw, 0.f);
}

void ATSCharacter::TickCharacter(const FTSIntent& Intent, float Dt)
{
	if (!bAlive) return;
	LastIntent = Intent;
	Yaw = Intent.Yaw;
	Pitch = FMath::Clamp(Intent.Pitch, -89.f, 89.f);
	SetActorRotation(FRotator(0.f, Yaw, 0.f));
	UpdateStatus(Dt);
	Move(Intent, Dt);
	Weapons.Tick(Intent, Dt);
	Abilities.Tick(Intent, Dt);
	GunPivot->SetRelativeRotation(FRotator(ViewPitch(), 0.f, 0.f));
	// Crouching squashes the body; the capsule itself is resized by ACharacter::Crouch.
	const float Squash = FMath::Lerp(1.f, UTSGameSubsystem::Get(this)->Data().Game.Movement.CrouchHeight / 1.8f, CrouchAmount);
	VisualRoot->SetRelativeScale3D(FVector(1.f, 1.f, Squash));
	VisualRoot->SetRelativeLocation(FVector(0.f, 0.f, -GetCapsuleComponent()->GetUnscaledCapsuleHalfHeight()));
}

void ATSCharacter::UpdateStatus(float Dt)
{
	const FTSCombatSettings& C = UTSGameSubsystem::Get(this)->Data().Game.Combat;
	if (BlindTimeLeft > 0.f) BlindTimeLeft = FMath::Max(0.f, BlindTimeLeft - Dt);
	if (BuffTimeLeft > 0.f)
	{
		BuffTimeLeft -= Dt;
		if (BuffTimeLeft <= 0.f) SpeedMultiplier = FireRateMultiplier = DamageTakenMultiplier = 1.f;
	}
	if (HealTimeLeft > 0.f)
	{
		HealTimeLeft -= Dt;
		HealAccumulator += HealPerSecond * Dt;
		const int32 Add = FMath::FloorToInt(HealAccumulator);
		HealAccumulator -= (float)Add;
		Health = FMath::Min(C.MaxHealth, Health + Add);
	}
}

float ATSCharacter::MaxSpeedMetres(const FTSIntent& Intent) const
{
	const FTSMovementSettings& M = UTSGameSubsystem::Get(this)->Data().Game.Movement;
	const FTSWeaponDef* W = Weapons.CurrentDef();
	float Speed = M.RunSpeed * SpeedMultiplier * (W ? W->MoveSpeedMultiplier : 1.f);
	if (Intent.bWalk) Speed *= M.WalkMultiplier;
	Speed *= FMath::Lerp(1.f, M.CrouchMultiplier, CrouchAmount);
	if (Weapons.bAiming && W) Speed *= W->AdsMoveMultiplier;
	return Speed;
}

void ATSCharacter::Move(const FTSIntent& Intent, float Dt)
{
	const FTSMovementSettings& M = UTSGameSubsystem::Get(this)->Data().Game.Movement;
	UCharacterMovementComponent* MoveComp = GetCharacterMovement();
	const bool bCanMove = !bFrozen && !bInteractLock;

	if (Intent.bCrouch && !bIsCrouched) Crouch();
	else if (!Intent.bCrouch && bIsCrouched) UnCrouch(); // stays crouched without headroom
	CrouchAmount = FMath::FInterpConstantTo(CrouchAmount, bIsCrouched ? 1.f : 0.f, Dt, M.CrouchTransitionSpeed);

	const float Speed = MaxSpeedMetres(Intent) * 100.f;
	MoveComp->MaxWalkSpeed = Speed;
	MoveComp->MaxWalkSpeedCrouched = Speed;

	if (DashTimeLeft > 0.f)
	{
		// Hold the dash velocity for its duration (distance / duration, like the Unity project),
		// with the speed cap raised to it, then clamp back to the normal speed.
		DashTimeLeft -= Dt;
		const float DashSpeed = (float)DashVelocity.Size();
		MoveComp->MaxWalkSpeed = MoveComp->MaxWalkSpeedCrouched = FMath::Max(Speed, DashSpeed);
		MoveComp->Velocity = FVector(DashVelocity.X, DashVelocity.Y, MoveComp->Velocity.Z);
		AddMovementInput(DashVelocity.GetSafeNormal(), 1.f);
		if (DashTimeLeft <= 0.f)
		{
			MoveComp->MaxWalkSpeed = MoveComp->MaxWalkSpeedCrouched = Speed;
			const FVector Horizontal = FVector(DashVelocity.X, DashVelocity.Y, 0.f).GetClampedToMaxSize(Speed);
			MoveComp->Velocity = FVector(Horizontal.X, Horizontal.Y, MoveComp->Velocity.Z);
		}
	}
	else if (bCanMove)
	{
		const FRotator YawRot(0.f, Yaw, 0.f);
		AddMovementInput(FRotationMatrix(YawRot).GetUnitAxis(EAxis::X), Intent.MoveForward);
		AddMovementInput(FRotationMatrix(YawRot).GetUnitAxis(EAxis::Y), Intent.MoveRight);
	}
	else if (IsGrounded())
	{
		MoveComp->Velocity = FVector(0.f, 0.f, MoveComp->Velocity.Z);
	}

	if (bCanMove && Intent.bJump && IsGrounded() && !bIsCrouched)
	{
		Jump();
		Mode->PlaySound(TEXT("jump"), Feet());
		RecordNoise(Feet());
	}
	else
	{
		StopJumping();
	}

	const bool bGrounded = IsGrounded();
	if (bGrounded && !bWasGrounded) Mode->PlaySound(TEXT("land"), Feet(), 0.8f);
	bWasGrounded = bGrounded;
	// Running is loud (bots hear it); walking and crouching are silent.
	if (bGrounded && HorizontalSpeedMetres() > M.RunSpeed * M.WalkMultiplier * 1.1f)
	{
		FootstepTimer -= Dt;
		if (FootstepTimer <= 0.f)
		{
			FootstepTimer = 0.36f;
			Mode->PlaySound(TEXT("footstep"), Feet());
			RecordNoise(Feet());
		}
	}
}

void ATSCharacter::UpdateCamera(float Dt, bool bIsViewTarget)
{
	UTSGameSubsystem* Game = UTSGameSubsystem::Get(this);
	Camera->SetWorldLocationAndRotation(EyePosition(), ViewRotation());
	if (!bIsViewTarget) return;
	const FTSWeaponDef* W = Weapons.CurrentDef();
	const bool bAds = bAlive && Weapons.bAiming && W != nullptr;
	const float Target = Game->Settings.FieldOfView * (bAds ? W->AdsFovMultiplier : 1.f);
	CameraFov = FMath::FInterpTo(CameraFov, Target, Dt, 18.f);
	Camera->SetFieldOfView(CameraFov);
	if (Weapons.ShotsFired != LastShotsSeen) ViewKick = 1.f;
	LastShotsSeen = Weapons.ShotsFired;
	ViewKick = FMath::FInterpConstantTo(ViewKick, 0.f, Dt, 8.f);
	const bool bShowViewGun = bAlive && !(bAds && W->Scoped);
	ViewGun->SetVisibility(bShowViewGun);
	const float Lower = (Weapons.EquipTimeLeft > 0.f ? 15.f : 0.f) + (Weapons.IsReloading() ? 10.f : 0.f);
	ViewGun->SetRelativeLocation(bAds ? FVector(30.f - ViewKick * 6.f, 0.f, -14.f) : FVector(32.f - ViewKick * 6.f, 20.f, -20.f - Lower));
	ViewGun->SetRelativeRotation(FRotator(ViewKick * 6.f, 0.f, 0.f));
}

ETSHitZone ATSCharacter::HitZoneAt(const FVector& Point) const
{
	const FTSCombatSettings& C = UTSGameSubsystem::Get(this)->Data().Game.Combat;
	return TSDamage::ZoneFromHeight(C, (float)((Point.Z - Feet().Z) / 100.0), HeightMetres());
}

FTSDamageResult ATSCharacter::ApplyDamage(float Raw, float ArmorPenetration, ATSCharacter* Attacker, const FString& SourceId, ETSHitZone Zone, const FVector& From)
{
	if (!bAlive || Raw <= 0.f) return FTSDamageResult();
	const FTSCombatSettings& C = UTSGameSubsystem::Get(this)->Data().Game.Combat;
	const FTSDamageResult R = TSDamage::ApplyArmor(C, Raw, Armor, ArmorPenetration, DamageTakenMultiplier);
	const int32 Dealt = FMath::Min(R.HealthDamage, Health) + R.ArmorDamage;
	Armor -= R.ArmorDamage;
	Health -= R.HealthDamage;
	const bool bKilled = Health <= 0;
	if (bKilled) Health = 0;
	LastDamagedTime = Mode->MatchTime;
	LastDamageFrom = From;
	if (Attacker != nullptr && Attacker != this)
		Attacker->Record->DamageDealt.FindOrAdd(Id()) += Dealt;

	FTSDamageEvent E;
	E.AttackerId = Attacker ? Attacker->Id() : -1;
	E.VictimId = Id();
	E.HealthDamage = R.HealthDamage;
	E.ArmorDamage = R.ArmorDamage;
	E.Zone = Zone;
	E.bKilled = bKilled;
	E.From = From;
	Mode->OnDamage.Broadcast(E);
	if (bKilled) Die(Attacker, SourceId, Zone == ETSHitZone::Head);
	return R;
}

void ATSCharacter::Die(ATSCharacter* Killer, const FString& SourceId, bool bHeadshot)
{
	bAlive = false;
	Record->bAlive = false;
	GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	GetCharacterMovement()->StopMovementImmediately();
	GetCharacterMovement()->DisableMovement();
	VisualRoot->SetRelativeRotation(FRotator(-80.f, 0.f, 0.f));
	VisualRoot->SetRelativeLocation(FVector(0.f, 0.f, -GetCapsuleComponent()->GetUnscaledCapsuleHalfHeight() + 25.f));
	GunPivot->SetVisibility(false, true);
	SetCarryingBomb(false);
	Mode->PlaySound(TEXT("death"), ChestPosition());
	Mode->OnCharacterKilled(this, Killer, SourceId, bHeadshot);
}

void ATSCharacter::SetCarryingBomb(bool bValue)
{
	bCarryingBomb = bValue;
	if (PackMesh) PackMesh->SetVisibility(bValue);
}

void ATSCharacter::RecordNoise(const FVector& Position)
{
	LastNoiseTime = Mode->MatchTime;
	LastNoisePosition = Position;
}

void ATSCharacter::Blind(float Seconds)
{
	if (Seconds <= BlindTimeLeft) return;
	BlindTimeLeft = Seconds;
	BlindDuration = Seconds;
}

void ATSCharacter::StartDash(const FTSAbilityDef& A)
{
	const FRotator YawRot(0.f, Yaw, 0.f);
	FVector Dir = FRotationMatrix(YawRot).GetUnitAxis(EAxis::X) * LastIntent.MoveForward + FRotationMatrix(YawRot).GetUnitAxis(EAxis::Y) * LastIntent.MoveRight;
	if (Dir.SizeSquared() < 0.01f) Dir = YawRot.Vector();
	const float Duration = FMath::Max(0.05f, A.Duration);
	DashVelocity = Dir.GetSafeNormal2D() * (A.Distance / Duration) * 100.f;
	DashTimeLeft = Duration;
}

void ATSCharacter::StartHeal(const FTSAbilityDef& A)
{
	const float Duration = FMath::Max(0.1f, A.Duration);
	HealPerSecond = A.Amount / Duration;
	HealTimeLeft = Duration;
	HealAccumulator = 0.f;
}

void ATSCharacter::ApplyBuff(const FTSAbilityDef& A)
{
	const FTSCombatSettings& C = UTSGameSubsystem::Get(this)->Data().Game.Combat;
	SpeedMultiplier = A.SpeedMultiplier;
	FireRateMultiplier = A.FireRateMultiplier;
	DamageTakenMultiplier = A.DamageTakenMultiplier;
	BuffTimeLeft = A.Duration;
	if (A.Amount > 0.f) Armor = FMath::Max(Armor, FMath::Min(C.MaxArmor, (int32)A.Amount));
}
