#include "TSRules.h"
#include "TSGameData.h"

// ---------------------------------------------------------------------------------- economy

int32 TSEconomy::LossBonus(const FTSEconomySettings& E, int32 Streak)
{
	if (Streak <= 0) return E.LossBase;
	return FMath::Min(E.LossBase + (Streak - 1) * E.LossStreakIncrement, E.LossMax);
}

int32 TSEconomy::RoundIncome(const FTSEconomySettings& E, bool bWon, int32 LossStreak, bool bIsAttacker, bool bBombPlanted)
{
	const int32 Base = bWon ? E.WinReward : LossBonus(E, LossStreak);
	return Base + (bIsAttacker && bBombPlanted ? E.PlantRewardTeam : 0);
}

int32 TSEconomy::NextLossStreak(int32 Streak, bool bWon)
{
	return bWon ? 0 : FMath::Min(Streak + 1, MaxLossStreak);
}

int32 TSEconomy::KillReward(const FTSEconomySettings& E, const FTSWeaponDef* Weapon)
{
	return Weapon != nullptr && Weapon->KillReward >= 0 ? Weapon->KillReward : E.DefaultKillReward;
}

int32 TSEconomy::AddMoney(const FTSEconomySettings& E, int32 Current, int32 Delta)
{
	return FMath::Clamp(Current + Delta, 0, E.MaxMoney);
}

// ----------------------------------------------------------------------------------- damage

ETSHitZone TSDamage::ZoneFromHeight(const FTSCombatSettings& C, float HitHeightAboveFeet, float CurrentHeight)
{
	const float Frac = CurrentHeight > 0.f ? HitHeightAboveFeet / CurrentHeight : 0.5f;
	if (Frac >= C.HeadZoneFraction) return ETSHitZone::Head;
	if (Frac < C.LegZoneFraction) return ETSHitZone::Legs;
	return ETSHitZone::Body;
}

float TSDamage::ZoneMultiplier(const FTSWeaponDef& W, ETSHitZone Zone)
{
	return Zone == ETSHitZone::Head ? W.HeadMultiplier : Zone == ETSHitZone::Legs ? W.LegMultiplier : 1.f;
}

float TSDamage::Falloff(const FTSWeaponDef& W, float Distance)
{
	const float Start = W.FalloffStart, End = W.FalloffEnd, Min = W.FalloffMinMultiplier;
	if (End <= Start) return Distance <= Start ? 1.f : Min;
	if (Distance <= Start) return 1.f;
	if (Distance >= End) return Min;
	const float T = (Distance - Start) / (End - Start);
	return 1.f + (Min - 1.f) * T;
}

float TSDamage::RawDamage(const FTSWeaponDef& W, ETSHitZone Zone, float Distance)
{
	return W.Damage * ZoneMultiplier(W, Zone) * Falloff(W, Distance);
}

FTSDamageResult TSDamage::ApplyArmor(const FTSCombatSettings& C, float Raw, int32 Armor, float ArmorPenetration, float DamageTakenMultiplier)
{
	FTSDamageResult R;
	const int32 Total = (int32)FMath::FloorToDouble((double)Raw * (double)DamageTakenMultiplier + 0.5 + 0.0001);
	const double Absorb = FMath::Clamp((double)C.ArmorAbsorption * (1.0 - (double)ArmorPenetration), 0.0, 1.0);
	int32 ArmorDamage = FMath::Min(Armor, (int32)FMath::FloorToDouble((double)Total * Absorb + 0.0001));
	if (ArmorDamage < 0) ArmorDamage = 0;
	R.ArmorDamage = ArmorDamage;
	R.HealthDamage = Total - ArmorDamage;
	return R;
}

float TSDamage::AreaDamage(float MaxDamage, float Distance, float Radius)
{
	return Radius <= 0.f ? 0.f : MaxDamage * FMath::Max(0.f, 1.f - Distance / Radius);
}

// ------------------------------------------------------------------------------ weapon math

float TSWeaponMath::Spread(const FTSWeaponDef& W, const FTSMovementSettings& M, const FTSSpreadInput& S)
{
	const float Bloom = FMath::Min((float)S.ShotIndex * W.BloomPerShot, W.MaxBloom);
	float Stable = W.BaseSpread + Bloom;
	if (S.bCrouched && !S.bAirborne) Stable *= W.CrouchSpreadMultiplier;
	if (S.bAiming) Stable *= W.AdsSpreadMultiplier;
	const float Frac = M.RunSpeed > 0.f ? FMath::Clamp(S.HorizontalSpeed / M.RunSpeed, 0.f, 1.f) : 0.f;
	const float Moving = W.MoveSpread * Frac + (S.bAirborne ? W.AirSpread : 0.f);
	return Stable + Moving;
}

void TSWeaponMath::RecoilKick(const FTSWeaponDef& W, int32 ShotIndex, float& OutPitch, float& OutYaw)
{
	if (W.RecoilPattern.Num() == 0)
	{
		OutPitch = OutYaw = 0.f;
		return;
	}
	const FTSRecoilStep& Step = W.RecoilPattern[FMath::Min(ShotIndex, W.RecoilPattern.Num() - 1)];
	OutPitch = Step.Pitch;
	OutYaw = Step.Yaw;
}

float TSWeaponMath::FireInterval(const FTSWeaponDef& W, float FireRateMultiplier)
{
	return 1.f / FMath::Max(0.01f, W.FireRate * FMath::Max(0.01f, FireRateMultiplier));
}

void TSWeaponMath::SampleCone(FTSRng& Rng, float SpreadDegrees, float& OutPitch, float& OutYaw)
{
	const double Angle = 2.0 * UE_DOUBLE_PI * (double)Rng.NextFloat();
	const double Radius = (double)SpreadDegrees * FMath::Sqrt((double)Rng.NextFloat());
	OutPitch = (float)(Radius * FMath::Sin(Angle));
	OutYaw = (float)(Radius * FMath::Cos(Angle));
}

// ------------------------------------------------------------------------------------- shop

const TArray<FString>& TSShop::GroupOrder()
{
	static TArray<FString> Order;
	if (Order.Num() == 0)
	{
		const TCHAR* Names[] = { TEXT("Sidearms"), TEXT("SMGs"), TEXT("Shotguns"), TEXT("Rifles"), TEXT("Snipers"), TEXT("Gear"), TEXT("Abilities") };
		for (const TCHAR* N : Names) Order.Add(N);
	}
	return Order;
}

FString TSShop::GroupOf(const FTSWeaponDef& W)
{
	switch (W.GetCategory())
	{
	case ETSWeaponCategory::Smg: return TEXT("SMGs");
	case ETSWeaponCategory::Shotgun: return TEXT("Shotguns");
	case ETSWeaponCategory::Rifle: return TEXT("Rifles");
	case ETSWeaponCategory::Sniper: return TEXT("Snipers");
	default: return TEXT("Sidearms");
	}
}

TArray<FTSShopItem> TSShop::Catalog(const FTSGameData& D, const FTSAgentDef* Agent)
{
	TArray<FTSShopItem> Items;
	for (const FTSWeaponDef& W : D.Weapons)
	{
		if (W.GetSlot() == ETSWeaponSlot::Melee) continue;
		FTSShopItem I;
		I.Kind = ETSItemKind::Weapon;
		I.Id = W.Id;
		I.DisplayName = W.DisplayName;
		I.Group = GroupOf(W);
		I.Price = W.Price;
		Items.Add(I);
	}
	for (const FTSEquipmentDef& E : D.Equipment)
	{
		FTSShopItem I;
		I.Kind = E.IsDefuseKit() ? ETSItemKind::DefuseKit : ETSItemKind::Armor;
		I.Id = E.Id;
		I.DisplayName = E.DisplayName;
		I.Group = TEXT("Gear");
		I.Price = E.Price;
		Items.Add(I);
	}
	if (Agent != nullptr)
	{
		for (int32 i = 0; i < Agent->Abilities.Num(); ++i)
		{
			const FTSAgentAbilitySlot& S = Agent->Abilities[i];
			const FTSAbilityDef* A = D.Ability(S.AbilityId);
			FTSShopItem I;
			I.Kind = ETSItemKind::Ability;
			I.Id = S.AbilityId;
			I.DisplayName = A != nullptr ? A->DisplayName : S.AbilityId;
			I.Group = TEXT("Abilities");
			I.Price = S.Price;
			I.AbilitySlot = i;
			I.MaxCharges = S.MaxCharges;
			I.bForSale = S.IsPurchasable();
			Items.Add(I);
		}
	}
	const TArray<FString>& Order = GroupOrder();
	Items.StableSort([&Order](const FTSShopItem& X, const FTSShopItem& Y)
	{
		const int32 GX = Order.IndexOfByKey(X.Group), GY = Order.IndexOfByKey(Y.Group);
		if (GX != GY) return GX < GY;
		if (X.Kind == ETSItemKind::Ability && Y.Kind == ETSItemKind::Ability) return X.AbilitySlot < Y.AbilitySlot;
		return X.Price < Y.Price;
	});
	return Items;
}

namespace
{
	FTSShopOutcome Fail(ETSShopResult R, int32 Money)
	{
		FTSShopOutcome O;
		O.Result = R;
		O.Money = Money;
		return O;
	}

	/** First purchase of this kind; empty ItemId/Slot mean "any". */
	int32 FindPurchase(const FTSLoadout& Lo, ETSItemKind Kind, const FString& ItemId, const FString& Slot)
	{
		for (int32 i = 0; i < Lo.Purchases.Num(); ++i)
		{
			const FTSPurchaseRecord& P = Lo.Purchases[i];
			if (P.Kind != Kind) continue;
			if (!ItemId.IsEmpty() && P.ItemId != ItemId) continue;
			if (!Slot.IsEmpty() && P.Slot != Slot) continue;
			return i;
		}
		return INDEX_NONE;
	}

	int32 FindLatest(const FTSLoadout& Lo, const FString& ItemId)
	{
		for (int32 i = Lo.Purchases.Num() - 1; i >= 0; --i)
			if (Lo.Purchases[i].ItemId == ItemId) return i;
		return INDEX_NONE;
	}

	/** Buy with Apply == nullptr is a dry run (TSShop::Check). */
	FTSShopOutcome BuyInternal(const FTSGameData& D, const FTSAgentDef* Agent, ETSSide Side, const FTSLoadout& Lo, FTSLoadout* Apply, int32 Money, const FString& ItemId)
	{
		if (const FTSWeaponDef* W = D.Weapon(ItemId))
		{
			if (W->GetSlot() == ETSWeaponSlot::Melee) return Fail(ETSShopResult::NotForSale, Money);
			const bool bPrimary = W->GetSlot() == ETSWeaponSlot::Primary;
			const FString SlotId = TSIds::ToId(W->GetSlot());
			const FString Current = bPrimary ? Lo.PrimaryId : Lo.SecondaryId;
			if (Current == ItemId) return Fail(ETSShopResult::AlreadyOwned, Money);
			const int32 RefundIndex = Current.IsEmpty() ? INDEX_NONE : FindPurchase(Lo, ETSItemKind::Weapon, Current, SlotId);
			const int32 Refund = RefundIndex != INDEX_NONE ? Lo.Purchases[RefundIndex].Price : 0;
			if (Money + Refund < W->Price) return Fail(ETSShopResult::NotEnoughMoney, Money);
			FString Dropped;
			FString Previous = Current;
			if (RefundIndex != INDEX_NONE)
			{
				Previous = Lo.Purchases[RefundIndex].PreviousId;
			}
			else if (!Current.IsEmpty())
			{
				const FTSWeaponDef* Old = D.Weapon(Current);
				if (Old != nullptr && Old->Price > 0)
				{
					Dropped = Current;
					Previous.Empty();
				}
			}
			FTSShopOutcome O;
			O.Money = Money + Refund - W->Price;
			O.DroppedWeaponId = Dropped;
			if (Apply != nullptr)
			{
				if (RefundIndex != INDEX_NONE) Apply->Purchases.RemoveAt(RefundIndex);
				if (bPrimary) Apply->PrimaryId = ItemId; else Apply->SecondaryId = ItemId;
				FTSPurchaseRecord P;
				P.Kind = ETSItemKind::Weapon;
				P.ItemId = ItemId;
				P.Price = W->Price;
				P.Slot = SlotId;
				P.PreviousId = Previous;
				Apply->Purchases.Add(P);
			}
			return O;
		}

		if (const FTSEquipmentDef* E = D.EquipmentItem(ItemId))
		{
			if (E->IsArmor())
			{
				if (Lo.Armor >= E->Amount) return Fail(ETSShopResult::AlreadyOwned, Money);
				const int32 RefundIndex = FindPurchase(Lo, ETSItemKind::Armor, FString(), FString());
				const int32 Refund = RefundIndex != INDEX_NONE ? Lo.Purchases[RefundIndex].Price : 0;
				if (Money + Refund < E->Price) return Fail(ETSShopResult::NotEnoughMoney, Money);
				const int32 PreviousArmor = RefundIndex != INDEX_NONE ? Lo.Purchases[RefundIndex].PreviousArmor : Lo.Armor;
				if (Apply != nullptr)
				{
					if (RefundIndex != INDEX_NONE) Apply->Purchases.RemoveAt(RefundIndex);
					Apply->Armor = E->Amount;
					FTSPurchaseRecord P;
					P.Kind = ETSItemKind::Armor;
					P.ItemId = ItemId;
					P.Price = E->Price;
					P.PreviousArmor = PreviousArmor;
					Apply->Purchases.Add(P);
				}
				FTSShopOutcome O;
				O.Money = Money + Refund - E->Price;
				return O;
			}
			if (E->IsDefuseKit())
			{
				if (Side != ETSSide::Defense) return Fail(ETSShopResult::WrongSide, Money);
				if (Lo.bHasDefuseKit) return Fail(ETSShopResult::AlreadyOwned, Money);
				if (Money < E->Price) return Fail(ETSShopResult::NotEnoughMoney, Money);
				if (Apply != nullptr)
				{
					Apply->bHasDefuseKit = true;
					FTSPurchaseRecord P;
					P.Kind = ETSItemKind::DefuseKit;
					P.ItemId = ItemId;
					P.Price = E->Price;
					Apply->Purchases.Add(P);
				}
				FTSShopOutcome O;
				O.Money = Money - E->Price;
				return O;
			}
		}

		const int32 SlotIndex = TSShop::AbilitySlotOf(Agent, ItemId);
		if (SlotIndex < 0) return Fail(ETSShopResult::UnknownItem, Money);
		const FTSAgentAbilitySlot& S = Agent->Abilities[SlotIndex];
		if (!S.IsPurchasable()) return Fail(ETSShopResult::NotForSale, Money);
		if (Lo.AbilityCharges[SlotIndex] >= S.MaxCharges) return Fail(ETSShopResult::MaxCharges, Money);
		if (Money < S.Price) return Fail(ETSShopResult::NotEnoughMoney, Money);
		if (Apply != nullptr)
		{
			Apply->AbilityCharges[SlotIndex]++;
			FTSPurchaseRecord P;
			P.Kind = ETSItemKind::Ability;
			P.ItemId = ItemId;
			P.Price = S.Price;
			P.Slot = FString::FromInt(SlotIndex);
			Apply->Purchases.Add(P);
		}
		FTSShopOutcome O;
		O.Money = Money - S.Price;
		return O;
	}
}

FTSShopOutcome TSShop::Buy(const FTSGameData& D, const FTSAgentDef* Agent, ETSSide Side, FTSLoadout& Lo, int32 Money, const FString& ItemId)
{
	return BuyInternal(D, Agent, Side, Lo, &Lo, Money, ItemId);
}

ETSShopResult TSShop::Check(const FTSGameData& D, const FTSAgentDef* Agent, ETSSide Side, const FTSLoadout& Lo, int32 Money, const FString& ItemId)
{
	return BuyInternal(D, Agent, Side, Lo, nullptr, Money, ItemId).Result;
}

bool TSShop::CanSell(const FTSLoadout& Lo, const FString& ItemId)
{
	return FindLatest(Lo, ItemId) != INDEX_NONE;
}

FTSShopOutcome TSShop::Sell(const FTSGameData& D, FTSLoadout& Lo, int32 Money, const FString& ItemId)
{
	const int32 Index = FindLatest(Lo, ItemId);
	if (Index == INDEX_NONE) return Fail(ETSShopResult::NotSellable, Money);
	const FTSPurchaseRecord Rec = Lo.Purchases[Index];
	switch (Rec.Kind)
	{
	case ETSItemKind::Weapon:
	{
		const bool bPrimary = Rec.Slot == TEXT("primary");
		const FString Current = bPrimary ? Lo.PrimaryId : Lo.SecondaryId;
		if (Current != ItemId) return Fail(ETSShopResult::NotSellable, Money);
		if (bPrimary) Lo.PrimaryId = Rec.PreviousId;
		else Lo.SecondaryId = Rec.PreviousId.IsEmpty() ? D.Game.Loadout.DefaultSecondary : Rec.PreviousId;
		break;
	}
	case ETSItemKind::Armor:
		Lo.Armor = Rec.PreviousArmor;
		break;
	case ETSItemKind::DefuseKit:
		Lo.bHasDefuseKit = false;
		break;
	default:
	{
		const int32 SlotIndex = FCString::Atoi(*Rec.Slot);
		if (SlotIndex < 0 || SlotIndex > 3 || Lo.AbilityCharges[SlotIndex] <= 0) return Fail(ETSShopResult::NotSellable, Money);
		Lo.AbilityCharges[SlotIndex]--;
		break;
	}
	}
	Lo.Purchases.RemoveAt(Index);
	FTSShopOutcome O;
	O.Money = Money + Rec.Price;
	return O;
}

void TSShop::GrantFreeCharges(const FTSAgentDef* Agent, FTSLoadout& Lo)
{
	if (Agent == nullptr) return;
	for (int32 i = 0; i < Agent->Abilities.Num() && i < 4; ++i)
	{
		const FTSAgentAbilitySlot& S = Agent->Abilities[i];
		if (S.FreeChargesPerRound > Lo.AbilityCharges[i]) Lo.AbilityCharges[i] = S.FreeChargesPerRound;
	}
}

int32 TSShop::AbilitySlotOf(const FTSAgentDef* Agent, const FString& AbilityId)
{
	if (Agent == nullptr) return -1;
	for (int32 i = 0; i < Agent->Abilities.Num(); ++i)
		if (Agent->Abilities[i].AbilityId == AbilityId) return i;
	return -1;
}

// -------------------------------------------------------------------------------- bot buying

namespace
{
	const FTSEquipmentDef* FindArmor(const FTSGameData& D, int32 Amount)
	{
		for (const FTSEquipmentDef& E : D.Equipment) if (E.IsArmor() && E.Amount == Amount) return &E;
		return nullptr;
	}

	const FTSWeaponDef* FirstOfCategory(const FTSGameData& D, ETSWeaponCategory C)
	{
		for (const FTSWeaponDef& W : D.Weapons) if (W.GetCategory() == C) return &W;
		return nullptr;
	}
}

TArray<FString> TSBotBuy::Plan(const FTSGameData& D, const FTSAgentDef* Agent, ETSSide Side, const FTSLoadout& Lo, int32 Money, FTSRng& Rng)
{
	TArray<FString> Plan;
	const FTSBotBuySettings& Buy = D.Bots.Buy;
	int32 Budget = Money;
	const FTSEquipmentDef* Heavy = FindArmor(D, 50);
	const FTSEquipmentDef* Light = FindArmor(D, 25);
	const int32 LightPrice = Light != nullptr ? Light->Price : 0;
	bool bBoughtPrimary = false;

	if (Lo.PrimaryId.IsEmpty())
	{
		FString Weapon;
		if (Budget >= Buy.FullBuyMoney)
		{
			const FTSWeaponDef* Sniper = FirstOfCategory(D, ETSWeaponCategory::Sniper);
			if (Sniper != nullptr && Rng.Chance(Buy.SniperChance) && Budget >= Sniper->Price + (Heavy != nullptr ? Heavy->Price : 0))
				Weapon = Sniper->Id;
			else if (Buy.PreferredRifles.Num() > 0)
				Weapon = Buy.PreferredRifles[Rng.RangeInt(0, Buy.PreferredRifles.Num())];
		}
		else if (Budget >= Buy.ForceBuyMoney)
		{
			TArray<FString> Options;
			for (const FString& Id : Buy.ForceBuyWeapons)
			{
				const FTSWeaponDef* W = D.Weapon(Id);
				if (W != nullptr && W->Price + LightPrice <= Budget) Options.Add(Id);
			}
			if (Options.Num() > 0) Weapon = Options[Rng.RangeInt(0, Options.Num())];
		}
		const FTSWeaponDef* Def = Weapon.IsEmpty() ? nullptr : D.Weapon(Weapon);
		if (Def != nullptr && Def->Price <= Budget)
		{
			Plan.Add(Def->Id);
			Budget -= Def->Price;
			bBoughtPrimary = Def->GetSlot() == ETSWeaponSlot::Primary;
		}
	}

	// Pistol / eco round: a better sidearm half the time.
	if (Lo.PrimaryId.IsEmpty() && !bBoughtPrimary)
	{
		const FTSWeaponDef* Best = nullptr;
		for (const FTSWeaponDef& W : D.Weapons)
			if (W.GetSlot() == ETSWeaponSlot::Secondary && W.Price > 0 && W.Price <= Budget - LightPrice && (Best == nullptr || W.Price > Best->Price))
				Best = &W;
		if (Best != nullptr && Lo.SecondaryId != Best->Id && Rng.Chance(0.5f))
		{
			Plan.Add(Best->Id);
			Budget -= Best->Price;
		}
	}

	if (Heavy != nullptr && Lo.Armor < Heavy->Amount && Budget >= Heavy->Price)
	{
		Plan.Add(Heavy->Id);
		Budget -= Heavy->Price;
	}
	else if (Light != nullptr && Lo.Armor < Light->Amount && Budget >= Light->Price)
	{
		Plan.Add(Light->Id);
		Budget -= Light->Price;
	}

	if (Agent != nullptr)
	{
		for (int32 i = 0; i < Agent->Abilities.Num() && i < 4; ++i)
		{
			const FTSAgentAbilitySlot& S = Agent->Abilities[i];
			if (!S.IsPurchasable()) continue;
			int32 Charges = Lo.AbilityCharges[i];
			while (Charges < S.MaxCharges && Budget >= S.Price && Rng.Chance(Buy.AbilityBuyChance))
			{
				Plan.Add(S.AbilityId);
				Budget -= S.Price;
				++Charges;
			}
		}
	}

	if (Side == ETSSide::Defense && !Lo.bHasDefuseKit)
	{
		for (const FTSEquipmentDef& E : D.Equipment)
		{
			if (E.IsDefuseKit() && Budget >= E.Price && Rng.Chance(0.6f))
			{
				Plan.Add(E.Id);
				Budget -= E.Price;
			}
		}
	}
	return Plan;
}
