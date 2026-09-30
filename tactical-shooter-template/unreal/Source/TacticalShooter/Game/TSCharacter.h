#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "Core/TSRng.h"
#include "Game/TSTypes.h"
#include "Game/TSWeapons.h"
#include "TSCharacter.generated.h"

class ATSGameMode;
class UCameraComponent;
class UStaticMeshComponent;

/**
 * A living participant: movement (CharacterMovementComponent), health and armour, weapons,
 * abilities and status effects. It has no input of its own - ATSGameMode hands it an Intent
 * every tick, from ATSPlayerController or an FTSBotBrain. Mirrors TacticalCharacter.cs.
 *
 * The body is made of basic shapes (see BuildVisuals, the model swap point). Hit zones come
 * from the capsule height, never from the mesh (GAME_RULES.md 4.1).
 */
UCLASS()
class TACTICALSHOOTER_API ATSCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	ATSCharacter();

	void Init(ATSGameMode* InMode, FTSPlayerRecord* InRecord);
	void Respawn(const FVector& InFeet, float InYaw);
	void TickCharacter(const FTSIntent& Intent, float Dt);

	int32 Id() const { return Record->Id; }
	ETSTeam Team() const { return Record->Team; }
	ETSSide Side() const;
	bool IsAlive() const { return bAlive; }

	float ViewYaw() const { return Yaw + RecoilYaw; }
	float ViewPitch() const { return FMath::Clamp(Pitch + RecoilPitch, -89.f, 89.f); }
	FRotator ViewRotation() const { return FRotator(ViewPitch(), ViewYaw(), 0.f); }
	FVector AimForward() const { return ViewRotation().Vector(); }

	FVector Feet() const;
	/** Current capsule height in metres. */
	float HeightMetres() const;
	FVector EyePosition() const;
	FVector ChestPosition() const { return Feet() + FVector(0.f, 0.f, HeightMetres() * 65.f); }
	FVector HeadPosition() const { return Feet() + FVector(0.f, 0.f, (HeightMetres() - 0.17f) * 100.f); }
	float HorizontalSpeedMetres() const { return (float)(GetVelocity().Size2D() / 100.0); }
	bool IsGrounded() const;
	bool IsCrouchedNow() const { return CrouchAmount > 0.5f; }

	ETSHitZone HitZoneAt(const FVector& Point) const;
	/** Armour model of GAME_RULES.md 4.3. Attacker may be null (bomb). */
	FTSDamageResult ApplyDamage(float Raw, float ArmorPenetration, ATSCharacter* Attacker, const FString& SourceId, ETSHitZone Zone, const FVector& From);

	void Blind(float Seconds);
	void StartDash(const FTSAbilityDef& A);
	void StartHeal(const FTSAbilityDef& A);
	void ApplyBuff(const FTSAbilityDef& A);
	void SetCarryingBomb(bool bValue);
	void RecordNoise(const FVector& Position);
	void SetWeaponVisual(const FTSWeaponDef* Def);
	void RefreshColors();
	/** Called every frame for whoever the local camera looks through. */
	void UpdateCamera(float Dt, bool bIsViewTarget);

	ATSGameMode* Mode = nullptr;
	FTSPlayerRecord* Record = nullptr;
	const FTSAgentDef* Agent = nullptr;
	FTSRng Rng;
	FTSWeaponHandler Weapons;
	FTSAbilityHandler Abilities;

	bool bAlive = false;
	int32 Health = 100;
	int32 Armor = 0;
	float Yaw = 0.f;
	float Pitch = 0.f;
	float RecoilPitch = 0.f;
	float RecoilYaw = 0.f;
	bool bFrozen = false;
	bool bInteractLock = false;
	FTSIntent LastIntent;

	float BlindTimeLeft = 0.f;
	float BlindDuration = 0.f;
	float RevealedUntil = 0.f;
	float LastNoiseTime = -99.f;
	FVector LastNoisePosition = FVector::ZeroVector;
	float LastDamagedTime = -99.f;
	FVector LastDamageFrom = FVector::ZeroVector;
	bool bCarryingBomb = false;
	float SpeedMultiplier = 1.f;
	float FireRateMultiplier = 1.f;
	float DamageTakenMultiplier = 1.f;
	float BuffTimeLeft = 0.f;
	float HealTimeLeft = 0.f;

	UPROPERTY(VisibleAnywhere, Category = "TacticalShooter") TObjectPtr<UCameraComponent> Camera;

private:
	void BuildVisuals();
	void UpdateStatus(float Dt);
	void Move(const FTSIntent& Intent, float Dt);
	float MaxSpeedMetres(const FTSIntent& Intent) const;
	void Die(ATSCharacter* Killer, const FString& SourceId, bool bHeadshot);

	UPROPERTY() TObjectPtr<USceneComponent> VisualRoot;
	UPROPERTY() TObjectPtr<USceneComponent> GunPivot;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> BodyMesh;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> BandMesh;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> HeadMesh;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> VisorMesh;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> GunMesh;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> PackMesh;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> ViewGun;

	float CrouchAmount = 0.f;
	float HealPerSecond = 0.f;
	float HealAccumulator = 0.f;
	float FootstepTimer = 0.f;
	bool bWasGrounded = true;
	float CameraFov = 103.f;
	float ViewKick = 0.f;
	int32 LastShotsSeen = 0;
};
