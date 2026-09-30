#pragma once

#include "CoreMinimal.h"

class ATSGameMode;
class ATSCharacter;
class ATSShapeActor;

enum class ETSBombState : uint8 { None, Carried, Dropped, Planted, Defused, Exploded };

/**
 * The objective (GAME_RULES.md section 9): carrier, drop, pickup, plant, defuse, fuse beeps and
 * the explosion. Reports plants and defuses to FTSMatchFlow. Mirrors BombSystem.cs.
 */
struct FTSBombSystem
{
	ATSGameMode* Mode = nullptr;
	ETSBombState State = ETSBombState::None;
	ATSCharacter* Carrier = nullptr;
	FVector Position = FVector::ZeroVector;
	int32 Site = -1;
	float PlantProgress = 0.f;
	float DefuseProgress = 0.f;
	ATSCharacter* Planter = nullptr;
	ATSCharacter* Defuser = nullptr;

	void Init(ATSGameMode* InMode);
	void Destroy();
	void Reset();
	bool IsBusy(const ATSCharacter* C) const { return (C == Planter && PlantProgress > 0.f) || (C == Defuser && DefuseProgress > 0.f); }
	void GiveTo(ATSCharacter* C);
	void Drop(const FVector& At);
	void Tick(float Dt);
	/** Called when FTSMatchFlow reports the fuse ran out. */
	void Explode();

private:
	void Plant(ATSCharacter* C, int32 InSite);
	void Defuse(float Dt);
	void Beep(float Dt);
	void Show(const FVector& At);

	TWeakObjectPtr<ATSShapeActor> BombActor;
	TWeakObjectPtr<ATSShapeActor> LightActor;
	float BeepTimer = 0.f;
	bool bLightOn = false;
};
