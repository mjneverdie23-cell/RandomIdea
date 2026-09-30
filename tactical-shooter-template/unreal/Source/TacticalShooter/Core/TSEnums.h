#pragma once

#include "CoreMinimal.h"

// Plain C++ enums shared by the core rules. They mirror TacticalShooter.Core/Enums.cs in the Unity
// project one to one; config files use the lowercase string ids handled by TSIds below.

/** The two persistent teams. The human player is always on team A. */
enum class ETSTeam : uint8 { A = 0, B = 1 };
enum class ETSSide : uint8 { Attack = 0, Defense = 1 };
enum class ETSMatchPhase : uint8 { NotStarted, BuyPhase, Live, RoundEnd, Halftime, MatchOver };
enum class ETSRoundEndReason : uint8 { None, Elimination, BombDetonated, BombDefused, TimeExpired };
enum class ETSHitZone : uint8 { Head, Body, Legs };
enum class ETSWeaponSlot : uint8 { Primary = 0, Secondary = 1, Melee = 2 };
enum class ETSFireMode : uint8 { Auto, Semi, Melee };
enum class ETSWeaponCategory : uint8 { Melee, Sidearm, Smg, Shotgun, Rifle, Sniper };
enum class ETSAbilityType : uint8 { Flash, Smoke, Frag, Incendiary, Dash, Heal, Wall, Recon, Buff };
enum class ETSCellType : uint8 { Wall, Floor, LowCover, HighCover, SiteA, SiteB, AttackSpawn, DefenseSpawn };
enum class ETSItemKind : uint8 { Weapon, Armor, DefuseKit, Ability };
enum class ETSShopResult : uint8 { Ok, NotForSale, WrongSide, AlreadyOwned, MaxCharges, NotEnoughMoney, UnknownItem, NotSellable, NotAllowed };
/** What happens to money and loadouts when a round starts (GAME_RULES.md 2.3). */
enum class ETSEconomyReset : uint8 { None, StartMoney, OvertimeMoney, OvertimeMoneyAndClear };
enum class ETSWave : uint8 { Sine, Square, Saw, Triangle, Noise };

/** String <-> enum conversions for the lowercase ids used in the JSON files. */
namespace TSIds
{
	inline ETSSide Other(ETSSide S) { return S == ETSSide::Attack ? ETSSide::Defense : ETSSide::Attack; }
	inline ETSTeam Other(ETSTeam T) { return T == ETSTeam::A ? ETSTeam::B : ETSTeam::A; }
	inline int32 Index(ETSTeam T) { return T == ETSTeam::A ? 0 : 1; }

	inline ETSSide ParseSide(const FString& S) { return S.Equals(TEXT("defense"), ESearchCase::IgnoreCase) ? ETSSide::Defense : ETSSide::Attack; }
	inline FString ToId(ETSSide S) { return S == ETSSide::Attack ? TEXT("attack") : TEXT("defense"); }

	inline ETSWeaponSlot ParseSlot(const FString& S)
	{
		if (S.Equals(TEXT("primary"), ESearchCase::IgnoreCase)) return ETSWeaponSlot::Primary;
		if (S.Equals(TEXT("melee"), ESearchCase::IgnoreCase)) return ETSWeaponSlot::Melee;
		return ETSWeaponSlot::Secondary;
	}
	inline FString ToId(ETSWeaponSlot S) { return S == ETSWeaponSlot::Primary ? TEXT("primary") : S == ETSWeaponSlot::Melee ? TEXT("melee") : TEXT("secondary"); }

	inline ETSFireMode ParseFireMode(const FString& S)
	{
		if (S.Equals(TEXT("auto"), ESearchCase::IgnoreCase)) return ETSFireMode::Auto;
		if (S.Equals(TEXT("melee"), ESearchCase::IgnoreCase)) return ETSFireMode::Melee;
		return ETSFireMode::Semi;
	}

	inline ETSWeaponCategory ParseCategory(const FString& S)
	{
		if (S.Equals(TEXT("melee"), ESearchCase::IgnoreCase)) return ETSWeaponCategory::Melee;
		if (S.Equals(TEXT("smg"), ESearchCase::IgnoreCase)) return ETSWeaponCategory::Smg;
		if (S.Equals(TEXT("shotgun"), ESearchCase::IgnoreCase)) return ETSWeaponCategory::Shotgun;
		if (S.Equals(TEXT("rifle"), ESearchCase::IgnoreCase)) return ETSWeaponCategory::Rifle;
		if (S.Equals(TEXT("sniper"), ESearchCase::IgnoreCase)) return ETSWeaponCategory::Sniper;
		return ETSWeaponCategory::Sidearm;
	}

	inline bool TryParseAbilityType(const FString& S, ETSAbilityType& Out)
	{
		static const TCHAR* Names[] = { TEXT("flash"), TEXT("smoke"), TEXT("frag"), TEXT("incendiary"), TEXT("dash"), TEXT("heal"), TEXT("wall"), TEXT("recon"), TEXT("buff") };
		for (int32 i = 0; i < 9; ++i)
		{
			if (S.Equals(Names[i], ESearchCase::IgnoreCase))
			{
				Out = (ETSAbilityType)i;
				return true;
			}
		}
		Out = ETSAbilityType::Buff;
		return false;
	}

	inline ETSWave ParseWave(const FString& S)
	{
		if (S.Equals(TEXT("square"), ESearchCase::IgnoreCase)) return ETSWave::Square;
		if (S.Equals(TEXT("saw"), ESearchCase::IgnoreCase)) return ETSWave::Saw;
		if (S.Equals(TEXT("triangle"), ESearchCase::IgnoreCase)) return ETSWave::Triangle;
		if (S.Equals(TEXT("noise"), ESearchCase::IgnoreCase)) return ETSWave::Noise;
		return ETSWave::Sine;
	}

	inline FString ToId(ETSHitZone Z) { return Z == ETSHitZone::Head ? TEXT("head") : Z == ETSHitZone::Legs ? TEXT("legs") : TEXT("body"); }
	inline ETSHitZone ParseZone(const FString& S)
	{
		if (S.Equals(TEXT("head"), ESearchCase::IgnoreCase)) return ETSHitZone::Head;
		if (S.Equals(TEXT("legs"), ESearchCase::IgnoreCase)) return ETSHitZone::Legs;
		return ETSHitZone::Body;
	}

	/** camelCase id used in rules_vectors.json. */
	inline FString ToId(ETSShopResult R)
	{
		static const TCHAR* Names[] = { TEXT("ok"), TEXT("notForSale"), TEXT("wrongSide"), TEXT("alreadyOwned"), TEXT("maxCharges"), TEXT("notEnoughMoney"), TEXT("unknownItem"), TEXT("notSellable"), TEXT("notAllowed") };
		return Names[(int32)R];
	}

	inline FString ToId(ETSRoundEndReason R)
	{
		static const TCHAR* Names[] = { TEXT("None"), TEXT("Elimination"), TEXT("BombDetonated"), TEXT("BombDefused"), TEXT("TimeExpired") };
		return Names[(int32)R];
	}

	inline FString SiteName(int32 Site) { return Site == 0 ? TEXT("A") : Site == 1 ? TEXT("B") : TEXT("?"); }
}
