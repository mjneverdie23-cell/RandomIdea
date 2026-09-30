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

	FTSWeaponList WeaponList;
	if (ReadJson(ReadText, TEXT("Config/weapons"), WeaponList, D.LoadErrors)) D.Weapons = WeaponList.Weapons;
	FTSEquipmentList EquipmentList;
	if (ReadJson(ReadText, TEXT("Config/equipment"), EquipmentList, D.LoadErrors)) D.Equipment = EquipmentList.Equipment;
	FTSAbilityList AbilityList;
	if (ReadJson(ReadText, TEXT("Config/abilities"), AbilityList, D.LoadErrors)) D.Abilities = AbilityList.Abilities;
	FTSAgentList AgentList;
	if (ReadJson(ReadText, TEXT("Config/agents"), AgentList, D.LoadErrors)) D.Agents = AgentList.Agents;

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
