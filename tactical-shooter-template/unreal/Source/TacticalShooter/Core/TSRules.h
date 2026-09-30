#pragma once

#include "CoreMinimal.h"
#include "TSEnums.h"
#include "TSConfigTypes.h"
#include "TSRng.h"

struct FTSGameData;

// The rules of GAME_RULES.md sections 3-6 as plain functions. Mirrors EconomyRules.cs,
// DamageModel.cs, WeaponMath.cs, ShopRules.cs and BotBuyPlanner.cs in the Unity project.

namespace TSEconomy
{
	constexpr int32 MaxLossStreak = 10;
	TACTICALSHOOTER_API int32 LossBonus(const FTSEconomySettings& E, int32 Streak);
	/** Income for one player of a team at round end. LossStreak is the value after this round. */
	TACTICALSHOOTER_API int32 RoundIncome(const FTSEconomySettings& E, bool bWon, int32 LossStreak, bool bIsAttacker, bool bBombPlanted);
	TACTICALSHOOTER_API int32 NextLossStreak(int32 Streak, bool bWon);
	/** Weapon may be null for ability kills. */
	TACTICALSHOOTER_API int32 KillReward(const FTSEconomySettings& E, const FTSWeaponDef* Weapon);
	TACTICALSHOOTER_API int32 AddMoney(const FTSEconomySettings& E, int32 Current, int32 Delta);
}

struct FTSDamageResult
{
	int32 HealthDamage = 0;
	int32 ArmorDamage = 0;
	int32 Total() const { return HealthDamage + ArmorDamage; }
};

namespace TSDamage
{
	TACTICALSHOOTER_API ETSHitZone ZoneFromHeight(const FTSCombatSettings& C, float HitHeightAboveFeet, float CurrentHeight);
	TACTICALSHOOTER_API float ZoneMultiplier(const FTSWeaponDef& W, ETSHitZone Zone);
	TACTICALSHOOTER_API float Falloff(const FTSWeaponDef& W, float Distance);
	TACTICALSHOOTER_API float RawDamage(const FTSWeaponDef& W, ETSHitZone Zone, float Distance);
	TACTICALSHOOTER_API FTSDamageResult ApplyArmor(const FTSCombatSettings& C, float Raw, int32 Armor, float ArmorPenetration, float DamageTakenMultiplier = 1.f);
	/** Linear area falloff used by frags and the bomb. */
	TACTICALSHOOTER_API float AreaDamage(float MaxDamage, float Distance, float Radius);
}

struct FTSSpreadInput
{
	float HorizontalSpeed = 0.f;
	bool bAirborne = false;
	bool bCrouched = false;
	bool bAiming = false;
	int32 ShotIndex = 0;
};

namespace TSWeaponMath
{
	/** Cone half-angle in degrees (GAME_RULES.md 5.1). Speeds in metres per second. */
	TACTICALSHOOTER_API float Spread(const FTSWeaponDef& W, const FTSMovementSettings& M, const FTSSpreadInput& S);
	/** View kick after shot ShotIndex (pitch up, yaw right), without the random part. */
	TACTICALSHOOTER_API void RecoilKick(const FTSWeaponDef& W, int32 ShotIndex, float& OutPitch, float& OutYaw);
	TACTICALSHOOTER_API float FireInterval(const FTSWeaponDef& W, float FireRateMultiplier = 1.f);
	/** Uniform sample inside a cone of half-angle SpreadDegrees. Offsets in degrees. */
	TACTICALSHOOTER_API void SampleCone(FTSRng& Rng, float SpreadDegrees, float& OutPitch, float& OutYaw);
}

struct FTSPurchaseRecord
{
	ETSItemKind Kind = ETSItemKind::Weapon;
	FString ItemId;
	int32 Price = 0;
	/** "primary"/"secondary" for weapons, the ability slot index for abilities. */
	FString Slot;
	FString PreviousId;
	int32 PreviousArmor = 0;
};

/** What a player owns between rounds. Weapons are ids; ammo is refilled every round. */
struct FTSLoadout
{
	FString PrimaryId;
	FString SecondaryId;
	int32 Armor = 0;
	bool bHasDefuseKit = false;
	int32 AbilityCharges[4] = { 0, 0, 0, 0 };
	TArray<FTSPurchaseRecord> Purchases;

	FTSLoadout() {}
	explicit FTSLoadout(const FString& DefaultSecondary) : SecondaryId(DefaultSecondary) {}

	/** Death or an economy reset (GAME_RULES.md 2.3 and 7). Ability charges are kept. */
	void Clear(const FString& DefaultSecondary)
	{
		PrimaryId.Empty();
		SecondaryId = DefaultSecondary;
		Armor = 0;
		bHasDefuseKit = false;
		Purchases.Empty();
	}
};

struct FTSShopItem
{
	ETSItemKind Kind = ETSItemKind::Weapon;
	FString Id;
	FString DisplayName;
	FString Group;
	int32 Price = 0;
	int32 AbilitySlot = -1;
	int32 MaxCharges = 0;
	bool bForSale = true;
};

struct FTSShopOutcome
{
	ETSShopResult Result = ETSShopResult::Ok;
	int32 Money = 0;
	/** Weapon that must be dropped as a pickup, or empty. */
	FString DroppedWeaponId;
	bool Ok() const { return Result == ETSShopResult::Ok; }
};

namespace TSShop
{
	TACTICALSHOOTER_API const TArray<FString>& GroupOrder();
	TACTICALSHOOTER_API FString GroupOf(const FTSWeaponDef& W);
	/** Everything the buy menu shows for this agent, grouped and sorted by price. */
	TACTICALSHOOTER_API TArray<FTSShopItem> Catalog(const FTSGameData& D, const FTSAgentDef* Agent);
	TACTICALSHOOTER_API FTSShopOutcome Buy(const FTSGameData& D, const FTSAgentDef* Agent, ETSSide Side, FTSLoadout& Lo, int32 Money, const FString& ItemId);
	/** Same checks as Buy without changing anything. */
	TACTICALSHOOTER_API ETSShopResult Check(const FTSGameData& D, const FTSAgentDef* Agent, ETSSide Side, const FTSLoadout& Lo, int32 Money, const FString& ItemId);
	TACTICALSHOOTER_API bool CanSell(const FTSLoadout& Lo, const FString& ItemId);
	TACTICALSHOOTER_API FTSShopOutcome Sell(const FTSGameData& D, FTSLoadout& Lo, int32 Money, const FString& ItemId);
	/** Round start: signature abilities refill. */
	TACTICALSHOOTER_API void GrantFreeCharges(const FTSAgentDef* Agent, FTSLoadout& Lo);
	TACTICALSHOOTER_API int32 AbilitySlotOf(const FTSAgentDef* Agent, const FString& AbilityId);
}

namespace TSBotBuy
{
	/** Item ids in buy order (full buy, force buy or save). Run each through TSShop::Buy. */
	TACTICALSHOOTER_API TArray<FString> Plan(const FTSGameData& D, const FTSAgentDef* Agent, ETSSide Side, const FTSLoadout& Lo, int32 Money, FTSRng& Rng);
}
