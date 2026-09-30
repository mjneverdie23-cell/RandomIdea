#pragma once

#include "CoreMinimal.h"
#include "TSEnums.h"
#include "TSConfigTypes.generated.h"

// USTRUCTs that mirror shared/config/*.json field for field, so FJsonObjectConverter can fill
// them directly. JSON keys match property names case-insensitively ("roundsToWin" ->
// RoundsToWin). Booleans deliberately have no "b" prefix so they match their JSON keys.
// Default values are the documented defaults, used when a key is missing.
// The Unity project mirrors these in Scripts/Core/Config/ConfigTypes.cs.

USTRUCT()
struct FTSMatchSettings
{
	GENERATED_BODY()
	UPROPERTY() int32 RoundsToWin = 13;
	UPROPERTY() int32 HalftimeAfterRound = 12;
	UPROPERTY() bool OvertimeEnabled = true;
	UPROPERTY() int32 OvertimeWinMargin = 2;
	UPROPERTY() int32 OvertimeStartMoney = 5000;
	UPROPERTY() int32 OvertimeSwapEveryRounds = 1;
	UPROPERTY() int32 MaxOvertimeRounds = 12;
	UPROPERTY() int32 TeamSize = 5;
	UPROPERTY() float FirstRoundExtraBuySeconds = 5.f;
	UPROPERTY() float HalftimeSeconds = 5.f;
};

USTRUCT()
struct FTSRoundSettings
{
	GENERATED_BODY()
	UPROPERTY() float BuyPhaseSeconds = 20.f;
	UPROPERTY() float RoundSeconds = 100.f;
	UPROPERTY() float RoundEndSeconds = 6.f;
	UPROPERTY() bool FreezeDuringBuyPhase = true;
	UPROPERTY() bool BuyOnlyInSpawnZone = true;
	UPROPERTY() float BuyGraceSeconds = 15.f;
};

USTRUCT()
struct FTSEconomySettings
{
	GENERATED_BODY()
	UPROPERTY() int32 StartMoney = 800;
	UPROPERTY() int32 MaxMoney = 9000;
	UPROPERTY() int32 WinReward = 3000;
	UPROPERTY() int32 LossBase = 1900;
	UPROPERTY() int32 LossStreakIncrement = 500;
	UPROPERTY() int32 LossMax = 2900;
	UPROPERTY() int32 PlantRewardTeam = 300;
	UPROPERTY() int32 PlantRewardPlayer = 300;
	UPROPERTY() int32 DefuseRewardPlayer = 300;
	UPROPERTY() int32 DefaultKillReward = 200;
	UPROPERTY() bool SellBackDuringBuyPhase = true;
};

USTRUCT()
struct FTSBombSettings
{
	GENERATED_BODY()
	UPROPERTY() float PlantSeconds = 4.f;
	UPROPERTY() float DefuseSeconds = 7.f;
	UPROPERTY() float DefuseKitSeconds = 4.f;
	UPROPERTY() bool HalfDefuseCheckpoint = true;
	UPROPERTY() float FuseSeconds = 45.f;
	UPROPERTY() float BlastRadius = 16.f;
	UPROPERTY() int32 BlastDamage = 500;
	UPROPERTY() float InteractRadius = 1.6f;
	UPROPERTY() float PickupRadius = 1.2f;
	UPROPERTY() float BeepIntervalStart = 1.f;
	UPROPERTY() float BeepIntervalEnd = 0.15f;
};

USTRUCT()
struct FTSMovementSettings
{
	GENERATED_BODY()
	UPROPERTY() float RunSpeed = 6.f;
	UPROPERTY() float WalkMultiplier = 0.55f;
	UPROPERTY() float CrouchMultiplier = 0.4f;
	UPROPERTY() float Acceleration = 45.f;
	UPROPERTY() float Deceleration = 40.f;
	UPROPERTY() float AirAcceleration = 8.f;
	UPROPERTY() float Gravity = 20.f;
	UPROPERTY() float JumpVelocity = 7.4f;
	UPROPERTY() float StandHeight = 1.8f;
	UPROPERTY() float CrouchHeight = 1.2f;
	UPROPERTY() float Radius = 0.35f;
	UPROPERTY() float EyeHeightStand = 1.62f;
	UPROPERTY() float EyeHeightCrouch = 1.05f;
	UPROPERTY() float CrouchTransitionSpeed = 8.f;
	UPROPERTY() float StepHeight = 0.35f;
};

USTRUCT()
struct FTSCombatSettings
{
	GENERATED_BODY()
	UPROPERTY() int32 MaxHealth = 100;
	UPROPERTY() int32 MaxArmor = 50;
	UPROPERTY() bool FriendlyFire = false;
	UPROPERTY() float ArmorAbsorption = 1.f;
	UPROPERTY() float HeadZoneFraction = 0.84f;
	UPROPERTY() float LegZoneFraction = 0.42f;
	UPROPERTY() int32 AssistMinDamage = 40;
	UPROPERTY() float AbilityCooldownSeconds = 0.5f;
	UPROPERTY() float ProjectileGravity = 15.f;
	UPROPERTY() float ProjectileBounce = 0.4f;
};

USTRUCT()
struct FTSUltimateSettings
{
	GENERATED_BODY()
	UPROPERTY() int32 PointsPerKill = 1;
	UPROPERTY() int32 PointsPerDeath = 1;
	UPROPERTY() int32 PointsPerPlant = 1;
	UPROPERTY() int32 PointsPerDefuse = 1;
};

USTRUCT()
struct FTSScoringSettings
{
	GENERATED_BODY()
	UPROPERTY() int32 Kill = 2;
	UPROPERTY() int32 Assist = 1;
	UPROPERTY() int32 Plant = 2;
	UPROPERTY() int32 Defuse = 2;
};

USTRUCT()
struct FTSLoadoutSettings
{
	GENERATED_BODY()
	UPROPERTY() FString DefaultMelee = TEXT("knife");
	UPROPERTY() FString DefaultSecondary = TEXT("p9");
};

USTRUCT()
struct FTSVisualSettings
{
	GENERATED_BODY()
	UPROPERTY() FString AttackColor = TEXT("#E0533D");
	UPROPERTY() FString DefenseColor = TEXT("#3D8BE0");
	UPROPERTY() FString FloorColor = TEXT("#8A8A82");
	UPROPERTY() FString WallColor = TEXT("#C9C3B6");
	UPROPERTY() FString LowCoverColor = TEXT("#9C7A4E");
	UPROPERTY() FString HighCoverColor = TEXT("#6E6A63");
	UPROPERTY() FString SiteColor = TEXT("#D9B44A");
	UPROPERTY() FString AttackSpawnColor = TEXT("#7A4A42");
	UPROPERTY() FString DefenseSpawnColor = TEXT("#42587A");
	UPROPERTY() FString SkinColor = TEXT("#E0B89A");
	UPROPERTY() FString BombColor = TEXT("#FF2D2D");
	UPROPERTY() FString SkyColor = TEXT("#9FC3E7");
};

/** shared/config/game.json */
USTRUCT()
struct FTSGameConfig
{
	GENERATED_BODY()
	UPROPERTY() FTSMatchSettings Match;
	UPROPERTY() FTSRoundSettings Round;
	UPROPERTY() FTSEconomySettings Economy;
	UPROPERTY() FTSBombSettings Bomb;
	UPROPERTY() FTSMovementSettings Movement;
	UPROPERTY() FTSCombatSettings Combat;
	UPROPERTY() FTSUltimateSettings Ultimate;
	UPROPERTY() FTSScoringSettings Scoring;
	UPROPERTY() FTSLoadoutSettings Loadout;
	UPROPERTY() FTSVisualSettings Visuals;
	UPROPERTY() TArray<FString> MapRotation;
};

USTRUCT()
struct FTSRecoilStep
{
	GENERATED_BODY()
	UPROPERTY() float Pitch = 0.f;
	UPROPERTY() float Yaw = 0.f;
};

/** One entry of shared/config/weapons.json */
USTRUCT()
struct FTSWeaponDef
{
	GENERATED_BODY()
	UPROPERTY() FString Id;
	UPROPERTY() FString DisplayName;
	UPROPERTY() FString Category = TEXT("sidearm");
	UPROPERTY() FString Slot = TEXT("secondary");
	UPROPERTY() int32 Price = 0;
	UPROPERTY() int32 KillReward = -1;
	UPROPERTY() float Damage = 20.f;
	UPROPERTY() float HeadMultiplier = 4.f;
	UPROPERTY() float LegMultiplier = 0.85f;
	UPROPERTY() float ArmorPenetration = 0.f;
	UPROPERTY() float FalloffStart = 0.f;
	UPROPERTY() float FalloffEnd = 0.f;
	UPROPERTY() float FalloffMinMultiplier = 1.f;
	UPROPERTY() float MaxRange = 200.f;
	UPROPERTY() FString FireMode = TEXT("semi");
	UPROPERTY() float FireRate = 5.f;
	UPROPERTY() int32 MagazineSize = 10;
	UPROPERTY() int32 ReserveAmmo = 30;
	UPROPERTY() float ReloadSeconds = 2.f;
	UPROPERTY() float EquipSeconds = 0.75f;
	UPROPERTY() int32 Pellets = 1;
	UPROPERTY() float BaseSpread = 0.3f;
	UPROPERTY() float MoveSpread = 4.f;
	UPROPERTY() float AirSpread = 8.f;
	UPROPERTY() float CrouchSpreadMultiplier = 0.85f;
	UPROPERTY() float AdsSpreadMultiplier = 1.f;
	UPROPERTY() float BloomPerShot = 0.3f;
	UPROPERTY() float MaxBloom = 3.f;
	UPROPERTY() TArray<FTSRecoilStep> RecoilPattern;
	UPROPERTY() float RecoilRandomYaw = 0.f;
	UPROPERTY() float RecoilRecovery = 15.f;
	UPROPERTY() float RecoilResetSeconds = 0.35f;
	UPROPERTY() float AdsFovMultiplier = 1.f;
	UPROPERTY() bool Scoped = false;
	UPROPERTY() float AdsMoveMultiplier = 1.f;
	UPROPERTY() float MoveSpeedMultiplier = 1.f;
	UPROPERTY() FString FireSound = TEXT("shot_rifle");
	UPROPERTY() FString Color = TEXT("#333333");

	ETSWeaponSlot GetSlot() const { return TSIds::ParseSlot(Slot); }
	ETSFireMode GetMode() const { return TSIds::ParseFireMode(FireMode); }
	ETSWeaponCategory GetCategory() const { return TSIds::ParseCategory(Category); }
	bool HasAds() const { return AdsFovMultiplier < 0.999f || Scoped; }
};

USTRUCT()
struct FTSWeaponList
{
	GENERATED_BODY()
	UPROPERTY() TArray<FTSWeaponDef> Weapons;
};

/** One entry of shared/config/equipment.json. Type: "armor" or "defuseKit". */
USTRUCT()
struct FTSEquipmentDef
{
	GENERATED_BODY()
	UPROPERTY() FString Id;
	UPROPERTY() FString DisplayName;
	UPROPERTY() FString Type = TEXT("armor");
	UPROPERTY() int32 Price = 0;
	UPROPERTY() int32 Amount = 0;
	UPROPERTY() FString Side = TEXT("any");
	UPROPERTY() FString Description;

	bool IsArmor() const { return Type.Equals(TEXT("armor"), ESearchCase::IgnoreCase); }
	bool IsDefuseKit() const { return Type.Equals(TEXT("defuseKit"), ESearchCase::IgnoreCase); }
};

USTRUCT()
struct FTSEquipmentList
{
	GENERATED_BODY()
	UPROPERTY() TArray<FTSEquipmentDef> Equipment;
};

/** One entry of shared/config/abilities.json. Which fields matter depends on Type. */
USTRUCT()
struct FTSAbilityDef
{
	GENERATED_BODY()
	UPROPERTY() FString Id;
	UPROPERTY() FString DisplayName;
	UPROPERTY() FString Type = TEXT("buff");
	UPROPERTY() FString Description;
	UPROPERTY() float ThrowSpeed = 16.f;
	UPROPERTY() float FuseSeconds = 1.5f;
	UPROPERTY() float Radius = 4.f;
	UPROPERTY() float Duration = 5.f;
	UPROPERTY() float Damage = 0.f;
	UPROPERTY() float Amount = 0.f;
	UPROPERTY() float Distance = 5.f;
	UPROPERTY() float Width = 6.f;
	UPROPERTY() float Height = 3.f;
	UPROPERTY() float SpeedMultiplier = 1.f;
	UPROPERTY() float FireRateMultiplier = 1.f;
	UPROPERTY() float DamageTakenMultiplier = 1.f;
	UPROPERTY() FString Color = TEXT("#FFFFFF");

	ETSAbilityType GetType() const { ETSAbilityType T; TSIds::TryParseAbilityType(Type, T); return T; }
	bool IsThrown() const
	{
		const ETSAbilityType T = GetType();
		return T == ETSAbilityType::Flash || T == ETSAbilityType::Smoke || T == ETSAbilityType::Frag || T == ETSAbilityType::Incendiary;
	}
};

USTRUCT()
struct FTSAbilityList
{
	GENERATED_BODY()
	UPROPERTY() TArray<FTSAbilityDef> Abilities;
};

USTRUCT()
struct FTSAgentAbilitySlot
{
	GENERATED_BODY()
	UPROPERTY() FString Slot = TEXT("C");
	UPROPERTY() FString AbilityId;
	UPROPERTY() int32 Price = 0;
	UPROPERTY() int32 MaxCharges = 1;
	UPROPERTY() int32 FreeChargesPerRound = 0;
	UPROPERTY() int32 UltPoints = 0;

	bool IsUltimate() const { return UltPoints > 0; }
	bool IsPurchasable() const { return !IsUltimate() && Price > 0; }
};

/** One entry of shared/config/agents.json. Always four ability slots: C, Q, E, X. */
USTRUCT()
struct FTSAgentDef
{
	GENERATED_BODY()
	UPROPERTY() FString Id;
	UPROPERTY() FString DisplayName;
	UPROPERTY() FString Role;
	UPROPERTY() FString Color = TEXT("#FFFFFF");
	UPROPERTY() FString Description;
	UPROPERTY() TArray<FTSAgentAbilitySlot> Abilities;
};

USTRUCT()
struct FTSAgentList
{
	GENERATED_BODY()
	UPROPERTY() TArray<FTSAgentDef> Agents;
};

USTRUCT()
struct FTSBotDifficulty
{
	GENERATED_BODY()
	UPROPERTY() FString Id = TEXT("normal");
	UPROPERTY() FString DisplayName = TEXT("Normal");
	UPROPERTY() float ReactionTime = 0.35f;
	UPROPERTY() float AimErrorDegrees = 2.5f;
	UPROPERTY() float TurnSpeed = 400.f;
	UPROPERTY() float ViewAngle = 110.f;
	UPROPERTY() float SightRange = 60.f;
	UPROPERTY() int32 BurstShots = 4;
	UPROPERTY() float BurstPause = 0.3f;
	UPROPERTY() float HeadshotBias = 0.3f;
	UPROPERTY() float RecoilControl = 0.5f;
	UPROPERTY() float AbilityUseChance = 0.4f;
};

USTRUCT()
struct FTSBotBuySettings
{
	GENERATED_BODY()
	UPROPERTY() int32 FullBuyMoney = 3900;
	UPROPERTY() int32 ForceBuyMoney = 2000;
	UPROPERTY() float SniperChance = 0.2f;
	UPROPERTY() TArray<FString> PreferredRifles;
	UPROPERTY() TArray<FString> ForceBuyWeapons;
	UPROPERTY() float AbilityBuyChance = 0.8f;
};

USTRUCT()
struct FTSBotBehaviourSettings
{
	GENERATED_BODY()
	UPROPERTY() float PerceptionInterval = 0.1f;
	UPROPERTY() float RepathSeconds = 1.5f;
	UPROPERTY() float StuckSeconds = 1.2f;
	UPROPERTY() float MemorySeconds = 3.f;
	UPROPERTY() int32 HoldRadiusCells = 5;
	UPROPERTY() float MidRouteChance = 0.35f;
	UPROPERTY() float DecisionJitterSeconds = 1.5f;
};

/** shared/config/bots.json */
USTRUCT()
struct FTSBotConfig
{
	GENERATED_BODY()
	UPROPERTY() FString DefaultDifficulty = TEXT("normal");
	UPROPERTY() TArray<FTSBotDifficulty> Difficulties;
	UPROPERTY() TArray<FString> Names;
	UPROPERTY() FTSBotBuySettings Buy;
	UPROPERTY() FTSBotBehaviourSettings Behaviour;
};

USTRUCT()
struct FTSKeyBinding
{
	GENERATED_BODY()
	UPROPERTY() FString Action;
	UPROPERTY() FString Key;
	UPROPERTY() FString AltKey;
};

/** shared/config/input.json. Key names are engine-neutral; see TSKeyNames. */
USTRUCT()
struct FTSInputConfig
{
	GENERATED_BODY()
	UPROPERTY() TArray<FTSKeyBinding> Bindings;
};

USTRUCT()
struct FTSAudioCue
{
	GENERATED_BODY()
	UPROPERTY() FString Id;
	UPROPERTY() FString Wave = TEXT("sine");
	UPROPERTY() float Frequency = 440.f;
	UPROPERTY() float FrequencyEnd = 0.f;
	UPROPERTY() float Duration = 0.1f;
	UPROPERTY() float Attack = 0.003f;
	UPROPERTY() float Decay = 2.f;
	UPROPERTY() float Volume = 0.5f;
	UPROPERTY() float Noise = 0.f;
	UPROPERTY() float Range = 50.f;
	UPROPERTY() bool Spatial = true;
};

/** shared/config/audio.json */
USTRUCT()
struct FTSAudioConfig
{
	GENERATED_BODY()
	UPROPERTY() int32 SampleRate = 22050;
	UPROPERTY() TArray<FTSAudioCue> Cues;
};

/** shared/maps/<id>.json */
USTRUCT()
struct FTSMapDef
{
	GENERATED_BODY()
	UPROPERTY() FString Id;
	UPROPERTY() FString DisplayName;
	UPROPERTY() FString Description;
	UPROPERTY() float CellSize = 2.f;
	UPROPERTY() float WallHeight = 4.f;
	UPROPERTY() float LowCoverHeight = 1.1f;
	UPROPERTY() float HighCoverHeight = 2.4f;
	UPROPERTY() TArray<FString> Legend;
	UPROPERTY() TArray<FString> Rows;
};

/**
 * Player preferences. Defaults come from shared/config/settings.json; the player's copy is
 * saved to Saved/TacticalShooter/settings.json.
 */
USTRUCT()
struct FTSUserSettings
{
	GENERATED_BODY()
	UPROPERTY() FString PlayerName = TEXT("You");
	UPROPERTY() float MouseSensitivity = 0.5f;
	UPROPERTY() float AdsSensitivityMultiplier = 1.f;
	UPROPERTY() bool InvertY = false;
	UPROPERTY() float FieldOfView = 103.f;
	UPROPERTY() float MasterVolume = 0.8f;
	UPROPERTY() bool Fullscreen = true;
	UPROPERTY() bool Vsync = true;
	UPROPERTY() int32 QualityLevel = -1;
	UPROPERTY() int32 FpsLimit = 0;
	UPROPERTY() bool ShowFps = true;
	UPROPERTY() FString CrosshairColor = TEXT("#00FF7F");
	UPROPERTY() float CrosshairSize = 6.f;
	UPROPERTY() float CrosshairGap = 3.f;
	UPROPERTY() float CrosshairThickness = 2.f;
	UPROPERTY() bool CrosshairDot = false;
	UPROPERTY() bool CrosshairDynamic = true;
	UPROPERTY() FString MapId = TEXT("outpost");
	UPROPERTY() FString AgentId = TEXT("vanguard");
	UPROPERTY() FString PlayerSide = TEXT("attack");
	UPROPERTY() FString BotDifficulty = TEXT("normal");
	UPROPERTY() int32 TeamSize = 5;
	UPROPERTY() int32 RoundsToWin = 13;
	UPROPERTY() TArray<FTSKeyBinding> KeyOverrides;
};
