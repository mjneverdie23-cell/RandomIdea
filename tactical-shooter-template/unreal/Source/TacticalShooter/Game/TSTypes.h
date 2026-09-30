#pragma once

#include "CoreMinimal.h"
#include "Core/TSEnums.h"
#include "Core/TSRules.h"

/**
 * Everything about a participant that outlives a single life: identity, team, money, stats
 * and loadout. The ATSCharacter only exists while alive. Mirrors PlayerRecord.cs.
 */
struct FTSPlayerRecord
{
	int32 Id = 0;
	FString Name;
	bool bIsBot = false;
	bool bIsLocal = false;
	ETSTeam Team = ETSTeam::A;
	FString AgentId;
	FString DifficultyId = TEXT("normal");
	int32 Money = 0;
	int32 Kills = 0, Deaths = 0, Assists = 0, Score = 0, Plants = 0, Defuses = 0;
	int32 UltPoints = 0;
	bool bAlive = false;
	FTSLoadout Loadout;
	/** Damage dealt to each victim id this round (for assists). */
	TMap<int32, int32> DamageDealt;

	static int32 UltCost(const FTSAgentDef* Agent)
	{
		if (Agent == nullptr) return 0;
		for (const FTSAgentAbilitySlot& S : Agent->Abilities) if (S.IsUltimate()) return S.UltPoints;
		return 0;
	}

	void AddUltPoints(const FTSAgentDef* Agent, int32 Points)
	{
		const int32 Cap = UltCost(Agent);
		if (Cap > 0) UltPoints = FMath::Min(Cap, UltPoints + Points);
	}
};

/** Choices made on the match setup screen. */
struct FTSMatchOptions
{
	FString MapId = TEXT("outpost");
	FString AgentId = TEXT("vanguard");
	ETSSide PlayerSide = ETSSide::Attack;
	FString Difficulty = TEXT("normal");
	int32 TeamSize = 5;
	int32 RoundsToWin = 13;
	FString PlayerName = TEXT("You");
	uint32 Seed = 0;

	static FTSMatchOptions FromSettings(const FTSUserSettings& S)
	{
		FTSMatchOptions O;
		O.MapId = S.MapId;
		O.AgentId = S.AgentId;
		O.PlayerSide = TSIds::ParseSide(S.PlayerSide);
		O.Difficulty = S.BotDifficulty;
		O.TeamSize = S.TeamSize;
		O.RoundsToWin = S.RoundsToWin;
		O.PlayerName = S.PlayerName.IsEmpty() ? FString(TEXT("You")) : S.PlayerName;
		return O;
	}
};

struct FTSKillEvent
{
	int32 KillerId = -1;
	int32 VictimId = -1;
	int32 AssisterId = -1;
	FString SourceId;
	FString SourceName;
	bool bHeadshot = false;
};

struct FTSDamageEvent
{
	int32 AttackerId = -1;
	int32 VictimId = -1;
	int32 HealthDamage = 0;
	int32 ArmorDamage = 0;
	ETSHitZone Zone = ETSHitZone::Body;
	bool bKilled = false;
	FVector From = FVector::ZeroVector;
};

DECLARE_MULTICAST_DELEGATE_OneParam(FTSOnKill, const FTSKillEvent&);
DECLARE_MULTICAST_DELEGATE_OneParam(FTSOnDamage, const FTSDamageEvent&);
DECLARE_MULTICAST_DELEGATE_TwoParams(FTSOnAnnounce, const FString& /*Text*/, float /*Seconds*/);

/** Basic shapes from /Engine/BasicShapes. All are 100 cm and centred on their pivot. */
enum class ETSShape : uint8 { Cube, Sphere, Cylinder };
