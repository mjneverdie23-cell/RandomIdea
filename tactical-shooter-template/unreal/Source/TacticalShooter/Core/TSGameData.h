#pragma once

#include "CoreMinimal.h"
#include "TSConfigTypes.h"
#include "Templates/Function.h"

/**
 * Every piece of tuning data, loaded once by UTSGameSubsystem. The loader takes a function
 * that returns the text of "Config/<name>" or "Maps/<id>" (without extension), so the same
 * code reads Content/Data at runtime and shared/ in tests.
 * Mirrors GameData.cs in the Unity project.
 */
struct TACTICALSHOOTER_API FTSGameData
{
	FTSGameConfig Game;
	TArray<FTSWeaponDef> Weapons;
	TArray<FTSEquipmentDef> Equipment;
	TArray<FTSAbilityDef> Abilities;
	TArray<FTSAgentDef> Agents;
	FTSBotConfig Bots;
	FTSInputConfig Input;
	FTSAudioConfig Audio;
	FTSUserSettings DefaultSettings;
	TArray<FTSMapDef> Maps;
	TArray<FString> LoadErrors;

	/** Implemented in TSGameDataLoad.cpp (uses FJsonObjectConverter). */
	static FTSGameData Load(TFunctionRef<bool(const FString& Key, FString& OutText)> ReadText);

	const FTSWeaponDef* Weapon(const FString& Id) const;
	const FTSEquipmentDef* EquipmentItem(const FString& Id) const;
	const FTSAbilityDef* Ability(const FString& Id) const;
	/** Falls back to the first agent for unknown ids. */
	const FTSAgentDef* Agent(const FString& Id) const;
	const FTSAudioCue* Cue(const FString& Id) const;
	/** Falls back to the first map for unknown ids. */
	const FTSMapDef* Map(const FString& Id) const;
	const FTSBotDifficulty& Difficulty(const FString& Id) const;
	const FTSWeaponDef* DefaultSecondary() const { return Weapon(Game.Loadout.DefaultSecondary); }
	const FTSWeaponDef* DefaultMelee() const { return Weapon(Game.Loadout.DefaultMelee); }

	/** Cross-reference checks (a subset of shared/tools/validate_shared.py). Never throws. */
	TArray<FString> Validate() const;
};
