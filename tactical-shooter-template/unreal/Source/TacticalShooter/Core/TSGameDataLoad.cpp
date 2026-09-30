#include "TSGameData.h"
#include "JsonObjectConverter.h"

namespace
{
	template <typename T>
	bool ReadJson(TFunctionRef<bool(const FString&, FString&)> ReadText, const FString& Key, T& Out, TArray<FString>& Errors)
	{
		FString Text;
		if (!ReadText(Key, Text) || Text.IsEmpty())
		{
			Errors.Add(Key + TEXT(": file not found or empty"));
			return false;
		}
		if (!FJsonObjectConverter::JsonObjectStringToUStruct(Text, &Out, 0, 0))
		{
			Errors.Add(Key + TEXT(": invalid JSON"));
			return false;
		}
		return true;
	}
}

FTSGameData FTSGameData::Load(TFunctionRef<bool(const FString& Key, FString& OutText)> ReadText)
{
	FTSGameData D;
	ReadJson(ReadText, TEXT("Config/game"), D.Game, D.LoadErrors);

	FTSWeaponList Weapons;
	if (ReadJson(ReadText, TEXT("Config/weapons"), Weapons, D.LoadErrors)) D.Weapons = Weapons.Weapons;
	FTSEquipmentList Equipment;
	if (ReadJson(ReadText, TEXT("Config/equipment"), Equipment, D.LoadErrors)) D.Equipment = Equipment.Equipment;
	FTSAbilityList Abilities;
	if (ReadJson(ReadText, TEXT("Config/abilities"), Abilities, D.LoadErrors)) D.Abilities = Abilities.Abilities;
	FTSAgentList Agents;
	if (ReadJson(ReadText, TEXT("Config/agents"), Agents, D.LoadErrors)) D.Agents = Agents.Agents;

	ReadJson(ReadText, TEXT("Config/bots"), D.Bots, D.LoadErrors);
	ReadJson(ReadText, TEXT("Config/input"), D.Input, D.LoadErrors);
	ReadJson(ReadText, TEXT("Config/audio"), D.Audio, D.LoadErrors);
	ReadJson(ReadText, TEXT("Config/settings"), D.DefaultSettings, D.LoadErrors);

	for (const FString& MapId : D.Game.MapRotation)
	{
		FTSMapDef Map;
		if (ReadJson(ReadText, TEXT("Maps/") + MapId, Map, D.LoadErrors)) D.Maps.Add(Map);
	}
	return D;
}
