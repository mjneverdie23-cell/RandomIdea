#include "TSGameData.h"
#include "TSKeyNames.h"
#include "TSMapGrid.h"

const FTSWeaponDef* FTSGameData::Weapon(const FString& Id) const
{
	for (const FTSWeaponDef& W : Weapons) if (W.Id == Id) return &W;
	return nullptr;
}

const FTSEquipmentDef* FTSGameData::EquipmentItem(const FString& Id) const
{
	for (const FTSEquipmentDef& E : Equipment) if (E.Id == Id) return &E;
	return nullptr;
}

const FTSAbilityDef* FTSGameData::Ability(const FString& Id) const
{
	for (const FTSAbilityDef& A : Abilities) if (A.Id == Id) return &A;
	return nullptr;
}

const FTSAgentDef* FTSGameData::Agent(const FString& Id) const
{
	for (const FTSAgentDef& A : Agents) if (A.Id == Id) return &A;
	return Agents.Num() > 0 ? &Agents[0] : nullptr;
}

const FTSAudioCue* FTSGameData::Cue(const FString& Id) const
{
	for (const FTSAudioCue& C : Audio.Cues) if (C.Id == Id) return &C;
	return nullptr;
}

const FTSMapDef* FTSGameData::Map(const FString& Id) const
{
	for (const FTSMapDef& M : Maps) if (M.Id == Id) return &M;
	return Maps.Num() > 0 ? &Maps[0] : nullptr;
}

const FTSBotDifficulty& FTSGameData::Difficulty(const FString& Id) const
{
	for (const FTSBotDifficulty& D : Bots.Difficulties) if (D.Id == Id) return D;
	for (const FTSBotDifficulty& D : Bots.Difficulties) if (D.Id == Bots.DefaultDifficulty) return D;
	static const FTSBotDifficulty Fallback;
	return Bots.Difficulties.Num() > 0 ? Bots.Difficulties[0] : Fallback;
}

TArray<FString> FTSGameData::Validate() const
{
	TArray<FString> Errors = LoadErrors;
	if (Weapons.Num() == 0) Errors.Add(TEXT("no weapons loaded"));
	if (Agents.Num() == 0) Errors.Add(TEXT("no agents loaded"));
	if (Maps.Num() == 0) Errors.Add(TEXT("no maps loaded"));
	for (const FTSWeaponDef& W : Weapons)
	{
		if (W.FireRate <= 0.f) Errors.Add(FString::Printf(TEXT("weapon '%s': fireRate must be > 0"), *W.Id));
		if (W.GetMode() != ETSFireMode::Melee && W.MagazineSize <= 0) Errors.Add(FString::Printf(TEXT("weapon '%s': guns need magazineSize > 0"), *W.Id));
		if (Cue(W.FireSound) == nullptr) Errors.Add(FString::Printf(TEXT("weapon '%s': unknown fireSound '%s'"), *W.Id, *W.FireSound));
	}
	for (const FTSAbilityDef& A : Abilities)
	{
		ETSAbilityType T;
		if (!TSIds::TryParseAbilityType(A.Type, T)) Errors.Add(FString::Printf(TEXT("ability '%s': unknown type '%s'"), *A.Id, *A.Type));
	}
	for (const FTSAgentDef& Ag : Agents)
	{
		if (Ag.Abilities.Num() != 4) Errors.Add(FString::Printf(TEXT("agent '%s': needs exactly 4 ability slots (C, Q, E, X)"), *Ag.Id));
		for (const FTSAgentAbilitySlot& S : Ag.Abilities)
			if (Ability(S.AbilityId) == nullptr) Errors.Add(FString::Printf(TEXT("agent '%s': unknown ability '%s'"), *Ag.Id, *S.AbilityId));
	}
	if (DefaultSecondary() == nullptr) Errors.Add(FString::Printf(TEXT("loadout.defaultSecondary '%s' is not a weapon"), *Game.Loadout.DefaultSecondary));
	if (DefaultMelee() == nullptr) Errors.Add(FString::Printf(TEXT("loadout.defaultMelee '%s' is not a weapon"), *Game.Loadout.DefaultMelee));
	for (const FTSKeyBinding& B : Input.Bindings)
	{
		if (!B.Key.IsEmpty() && !TSKeyNames::IsValid(B.Key)) Errors.Add(FString::Printf(TEXT("input '%s': unknown key '%s'"), *B.Action, *B.Key));
		if (!B.AltKey.IsEmpty() && !TSKeyNames::IsValid(B.AltKey)) Errors.Add(FString::Printf(TEXT("input '%s': unknown key '%s'"), *B.Action, *B.AltKey));
	}
	for (const FTSMapDef& M : Maps)
	{
		TArray<FString> MapErrors;
		FTSMapGrid Grid = FTSMapGrid::Parse(M, MapErrors);
		for (const FString& E : MapErrors) Errors.Add(FString::Printf(TEXT("map '%s': %s"), *M.Id, *E));
		if (Grid.IsValid())
			for (const FString& E : Grid.Validate(Game.Match.TeamSize)) Errors.Add(FString::Printf(TEXT("map '%s': %s"), *M.Id, *E));
	}
	return Errors;
}
