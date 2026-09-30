#pragma once

#include "CoreMinimal.h"
#include "Core/TSConfigTypes.h"
#include "Core/TSIntent.h"
#include "Core/TSRules.h"

class ATSCharacter;

/** A weapon in someone's hands (or on the floor): definition plus ammo. */
struct FTSWeaponInstance
{
	const FTSWeaponDef* Def = nullptr;
	int32 Mag = 0;
	int32 Reserve = 0;

	FTSWeaponInstance() {}
	explicit FTSWeaponInstance(const FTSWeaponDef* InDef) : Def(InDef), Mag(InDef ? InDef->MagazineSize : 0), Reserve(InDef ? InDef->ReserveAmmo : 0) {}
	bool IsValid() const { return Def != nullptr; }
};

/**
 * Inventory (primary, secondary, melee), switching, reloading, firing, spread and recoil
 * (GAME_RULES.md section 5). Hit resolution is FTSCombat's, shared by players and bots.
 * Mirrors WeaponHandler.cs.
 */
struct FTSWeaponHandler
{
	ATSCharacter* Owner = nullptr;
	FTSWeaponInstance Slots[3];
	int32 CurrentSlot = 1;
	float EquipTimeLeft = 0.f;
	float ReloadTimeLeft = 0.f;
	bool bAiming = false;
	float AimTime = 0.f;
	int32 ShotIndex = 0;
	int32 ShotsFired = 0;
	float CurrentSpread = 0.f;
	float LastShotTime = -99.f;
	float Cooldown = 0.f;
	bool bTriggerHeld = false;

	FTSWeaponInstance& Current() { return Slots[CurrentSlot]; }
	const FTSWeaponInstance& Current() const { return Slots[CurrentSlot]; }
	const FTSWeaponDef* CurrentDef() const { return Slots[CurrentSlot].Def; }
	bool IsReloading() const { return ReloadTimeLeft > 0.f; }
	bool IsReady() const { return EquipTimeLeft <= 0.f && !IsReloading() && Cooldown <= 0.f; }

	void SetLoadout(const FTSLoadout& Lo);
	/** Puts a weapon in its slot; returns what was there (to be dropped). */
	FTSWeaponInstance Replace(const FTSWeaponInstance& Weapon, bool bSelect = true);
	FTSWeaponInstance Remove(ETSWeaponSlot Slot);
	void Select(int32 Slot, bool bInstant = false, bool bForce = false);
	void SelectBest();
	void Tick(const FTSIntent& Intent, float Dt);
	void StartReload();

private:
	float ComputeSpread(const FTSWeaponDef& W) const;
	void Shoot();
	void Swing();
	void FinishReload();
};

/**
 * The agent's four ability slots (C, Q, E, X). Charges live in the player record's loadout so
 * they survive death; ultimates use points. Mirrors AbilityHandler.cs.
 */
struct FTSAbilityHandler
{
	ATSCharacter* Owner = nullptr;
	float Cooldown = 0.f;

	int32 SlotCount() const;
	const FTSAgentAbilitySlot* Slot(int32 Index) const;
	const FTSAbilityDef* Def(int32 Index) const;
	int32 Charges(int32 Index) const;
	bool IsReady(int32 Index) const;
	/** First ready slot whose ability has this type, or -1. */
	int32 FindReady(ETSAbilityType Type) const;
	void Tick(const FTSIntent& Intent, float Dt);
	bool TryUse(int32 Index);

private:
	void Execute(const FTSAbilityDef& A, bool bUltimate);
};
