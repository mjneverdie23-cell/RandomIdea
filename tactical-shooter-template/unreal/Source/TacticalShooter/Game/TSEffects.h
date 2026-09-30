#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Core/TSMapGrid.h"
#include "Game/TSTypes.h"
#include "Game/TSWeapons.h"
#include "TSEffects.generated.h"

class ATSGameMode;
class ATSCharacter;
class UStaticMeshComponent;

/** One basic shape in the world (projectiles, smoke, fire, barriers, pickups, the bomb, effects). */
UCLASS()
class TACTICALSHOOTER_API ATSShapeActor : public AActor
{
	GENERATED_BODY()

public:
	ATSShapeActor();
	/** Scale is in metres (the engine shapes are 1 m). Collision makes it block movement, bullets and sight. */
	void Setup(ETSShape Shape, const FLinearColor& Color, const FVector& ScaleMetres, bool bCollision = false);
	void SetColor(const FLinearColor& Color);

	UPROPERTY() TObjectPtr<UStaticMeshComponent> Mesh;
};

/**
 * Everything that exists for a limited time: thrown utility, smoke, fire, barriers, dropped
 * weapons and short-lived visual effects. Cleared at every round start. Positions are
 * centimetres, config values metres. Mirrors EffectsWorld.cs.
 */
struct FTSEffectsWorld
{
	struct FProjectile { ATSCharacter* Owner = nullptr; const FTSAbilityDef* Def = nullptr; FVector Position; FVector VelocityMps; float Fuse = 0.f; bool bResting = false; TWeakObjectPtr<ATSShapeActor> Actor; };
	struct FSmoke { FVector Center; float Radius = 0.f; float MaxRadius = 0.f; float TimeLeft = 0.f; TWeakObjectPtr<ATSShapeActor> Actor; };
	struct FFire { ATSCharacter* Owner = nullptr; const FTSAbilityDef* Def = nullptr; FVector Center; float Radius = 0.f; float TimeLeft = 0.f; float TickTimer = 0.f; TWeakObjectPtr<ATSShapeActor> Actor; };
	struct FBarrier { float TimeLeft = 0.f; TArray<FTSCell> Cells; TWeakObjectPtr<ATSShapeActor> Actor; };
	/** DroppedBy: who dropped it on purpose; they only pick it up by walking over it after stepping away. */
	struct FPickup { FTSWeaponInstance Weapon; FVector Position; TWeakObjectPtr<ATSShapeActor> Actor; ATSCharacter* DroppedBy = nullptr; };
	struct FTemp { float Life = 0.f; float TimeLeft = 0.f; FVector FromScale; FVector ToScale; ETSShape Shape = ETSShape::Cube; TWeakObjectPtr<ATSShapeActor> Actor; };

	ATSGameMode* Mode = nullptr;
	TArray<FProjectile> Projectiles;
	TArray<FSmoke> Smokes;
	TArray<FFire> Fires;
	TArray<FBarrier> Barriers;
	TArray<FPickup> Pickups;
	TArray<FTemp> Temps;

	void Tick(float Dt);
	void ClearAll();

	void Throw(ATSCharacter* Owner, const FTSAbilityDef& Def, const FVector& Start, const FVector& VelocityMps);
	void SpawnBarrier(ATSCharacter* Owner, const FTSAbilityDef& Def);
	void Recon(ATSCharacter* Owner, const FTSAbilityDef& Def);
	bool SmokeBlocks(const FVector& A, const FVector& B) const;
	bool InsideSmoke(const FVector& P) const;

	void SpawnPickup(const FTSWeaponInstance& Weapon, const FVector& At, ATSCharacter* DroppedBy = nullptr);
	/** Interact near a weapon: swap it with the one in the same slot. */
	bool TrySwap(ATSCharacter* C);
	int32 NearestPickup(const FVector& P, float MaxDistanceCm) const;

	void Tracer(const FVector& From, const FVector& To);
	void MuzzleFlash(const FVector& At);
	void Impact(const FVector& At, const FVector& Normal);
	void BloodPuff(const FVector& At);
	/** Expanding sphere (or flat ring) for explosions, flashes and pulses. Radius in metres. */
	void Burst(const FVector& At, float RadiusMetres, const FLinearColor& Color, float Seconds, bool bFlat = false);

private:
	ATSShapeActor* SpawnShape(ETSShape Shape, const FVector& At, const FLinearColor& Color, const FVector& ScaleMetres, bool bCollision = false, const FRotator& Rotation = FRotator::ZeroRotator);
	/** A shape that scales From -> To (metres) over Seconds, then goes back to the pool. */
	void AddTemp(ETSShape Shape, const FVector& At, const FLinearColor& Color, float Seconds, const FVector& From, const FVector& To,
		const FRotator& Rotation = FRotator::ZeroRotator);
	void ReleaseTemp(const FTemp& T);
	void Detonate(const FProjectile& P);
	void Flash(ATSCharacter* Owner, const FVector& Pos, const FTSAbilityDef& A);
	void GiveTo(ATSCharacter* C, int32 Index);
	static void Kill(const TWeakObjectPtr<ATSShapeActor>& Actor);

	/**
	 * Hidden short-lived shapes (tracers, flashes, impacts) per ETSShape, reused instead of
	 * spawning and destroying an actor for every shot.
	 */
	TArray<TWeakObjectPtr<ATSShapeActor>> TempPool[3];
};
