using System.Collections.Generic;

namespace TacticalShooter.Core
{
    public struct ShopItem
    {
        public ItemKind kind;
        public string id;
        public string displayName;
        public string group;
        public int price;
        public int abilitySlot;
        public int maxCharges;
        public bool forSale;
    }

    public struct ShopOutcome
    {
        public ShopResult result;
        public int money;
        /// <summary>Weapon that must be dropped as a pickup (GAME_RULES.md 6), or null.</summary>
        public string droppedWeaponId;
        public bool Ok => result == ShopResult.Ok;
    }

    /// <summary>Buying and selling, GAME_RULES.md section 6. Pure: mutates only the Loadout passed in.</summary>
    public static class ShopRules
    {
        public static readonly string[] GroupOrder = { "Sidearms", "SMGs", "Shotguns", "Rifles", "Snipers", "Gear", "Abilities" };

        public static string GroupOf(WeaponDef w)
        {
            switch (w.Category)
            {
                case WeaponCategory.Smg: return "SMGs";
                case WeaponCategory.Shotgun: return "Shotguns";
                case WeaponCategory.Rifle: return "Rifles";
                case WeaponCategory.Sniper: return "Snipers";
                default: return "Sidearms";
            }
        }

        /// <summary>Everything the buy menu shows for this agent, grouped and sorted by price.</summary>
        public static List<ShopItem> Catalog(GameData d, AgentDef agent)
        {
            var items = new List<ShopItem>();
            foreach (var w in d.Weapons)
            {
                if (w.Slot == WeaponSlot.Melee) continue;
                items.Add(new ShopItem { kind = ItemKind.Weapon, id = w.id, displayName = w.displayName, group = GroupOf(w), price = w.price, abilitySlot = -1, forSale = true });
            }
            foreach (var e in d.Equipment)
            {
                items.Add(new ShopItem
                {
                    kind = e.type == "defuseKit" ? ItemKind.DefuseKit : ItemKind.Armor, id = e.id, displayName = e.displayName,
                    group = "Gear", price = e.price, abilitySlot = -1, forSale = true,
                });
            }
            if (agent != null)
            {
                for (int i = 0; i < agent.abilities.Length; i++)
                {
                    var s = agent.abilities[i];
                    var a = d.Ability(s.abilityId);
                    items.Add(new ShopItem
                    {
                        kind = ItemKind.Ability, id = s.abilityId, displayName = a != null ? a.displayName : s.abilityId, group = "Abilities",
                        price = s.price, abilitySlot = i, maxCharges = s.maxCharges, forSale = s.IsPurchasable,
                    });
                }
            }
            items.Sort((x, y) =>
            {
                int gx = System.Array.IndexOf(GroupOrder, x.group), gy = System.Array.IndexOf(GroupOrder, y.group);
                if (gx != gy) return gx.CompareTo(gy);
                if (x.kind == ItemKind.Ability && y.kind == ItemKind.Ability) return x.abilitySlot.CompareTo(y.abilitySlot);
                return x.price.CompareTo(y.price);
            });
            return items;
        }

        public static ShopOutcome Buy(GameData d, AgentDef agent, Side side, Loadout lo, int money, string itemId) =>
            BuyInternal(d, agent, side, lo, money, itemId, true);

        /// <summary>Same checks as Buy without changing anything (for greying out buttons).</summary>
        public static ShopResult Check(GameData d, AgentDef agent, Side side, Loadout lo, int money, string itemId) =>
            BuyInternal(d, agent, side, lo, money, itemId, false).result;

        static ShopOutcome Fail(ShopResult r, int money) => new ShopOutcome { result = r, money = money };

        static ShopOutcome BuyInternal(GameData d, AgentDef agent, Side side, Loadout lo, int money, string itemId, bool apply)
        {
            var w = d.Weapon(itemId);
            if (w != null)
            {
                if (w.Slot == WeaponSlot.Melee) return Fail(ShopResult.NotForSale, money);
                string slot = Ids.ToId(w.Slot);
                string current = w.Slot == WeaponSlot.Primary ? lo.primaryId : lo.secondaryId;
                if (current == itemId) return Fail(ShopResult.AlreadyOwned, money);
                var refundRec = current == null ? null : FindPurchase(lo, ItemKind.Weapon, current, slot);
                int refund = refundRec != null ? refundRec.price : 0;
                if (money + refund < w.price) return Fail(ShopResult.NotEnoughMoney, money);
                string dropped = null;
                string previous = current;
                if (refundRec != null)
                {
                    previous = refundRec.previousId;
                }
                else if (current != null && (d.Weapon(current)?.price ?? 0) > 0)
                {
                    dropped = current;
                    previous = null;
                }
                int newMoney = money + refund - w.price;
                if (apply)
                {
                    if (refundRec != null) lo.purchases.Remove(refundRec);
                    if (w.Slot == WeaponSlot.Primary) lo.primaryId = itemId; else lo.secondaryId = itemId;
                    lo.purchases.Add(new PurchaseRecord { kind = ItemKind.Weapon, itemId = itemId, price = w.price, slot = slot, previousId = previous });
                }
                return new ShopOutcome { result = ShopResult.Ok, money = newMoney, droppedWeaponId = dropped };
            }

            var e = d.EquipmentItem(itemId);
            if (e != null && e.type == "armor")
            {
                if (lo.armor >= e.amount) return Fail(ShopResult.AlreadyOwned, money);
                var refundRec = FindPurchase(lo, ItemKind.Armor, null, null);
                int refund = refundRec != null ? refundRec.price : 0;
                if (money + refund < e.price) return Fail(ShopResult.NotEnoughMoney, money);
                int previousArmor = refundRec != null ? refundRec.previousArmor : lo.armor;
                if (apply)
                {
                    if (refundRec != null) lo.purchases.Remove(refundRec);
                    lo.armor = e.amount;
                    lo.purchases.Add(new PurchaseRecord { kind = ItemKind.Armor, itemId = itemId, price = e.price, previousArmor = previousArmor });
                }
                return new ShopOutcome { result = ShopResult.Ok, money = money + refund - e.price };
            }
            if (e != null && e.type == "defuseKit")
            {
                if (side != Side.Defense) return Fail(ShopResult.WrongSide, money);
                if (lo.hasDefuseKit) return Fail(ShopResult.AlreadyOwned, money);
                if (money < e.price) return Fail(ShopResult.NotEnoughMoney, money);
                if (apply)
                {
                    lo.hasDefuseKit = true;
                    lo.purchases.Add(new PurchaseRecord { kind = ItemKind.DefuseKit, itemId = itemId, price = e.price });
                }
                return new ShopOutcome { result = ShopResult.Ok, money = money - e.price };
            }

            int slotIndex = AbilitySlotOf(agent, itemId);
            if (slotIndex < 0) return Fail(ShopResult.UnknownItem, money);
            var s = agent.abilities[slotIndex];
            if (!s.IsPurchasable) return Fail(ShopResult.NotForSale, money);
            if (lo.abilityCharges[slotIndex] >= s.maxCharges) return Fail(ShopResult.MaxCharges, money);
            if (money < s.price) return Fail(ShopResult.NotEnoughMoney, money);
            if (apply)
            {
                lo.abilityCharges[slotIndex]++;
                lo.purchases.Add(new PurchaseRecord { kind = ItemKind.Ability, itemId = itemId, price = s.price, slot = slotIndex.ToString() });
            }
            return new ShopOutcome { result = ShopResult.Ok, money = money - s.price };
        }

        public static bool CanSell(Loadout lo, string itemId) => FindLatest(lo, itemId) != null;

        public static ShopOutcome Sell(GameData d, Loadout lo, int money, string itemId)
        {
            var rec = FindLatest(lo, itemId);
            if (rec == null) return Fail(ShopResult.NotSellable, money);
            switch (rec.kind)
            {
                case ItemKind.Weapon:
                {
                    bool primary = rec.slot == "primary";
                    string current = primary ? lo.primaryId : lo.secondaryId;
                    if (current != itemId) return Fail(ShopResult.NotSellable, money);
                    if (primary) lo.primaryId = rec.previousId;
                    else lo.secondaryId = rec.previousId ?? d.Game.loadout.defaultSecondary;
                    break;
                }
                case ItemKind.Armor:
                    lo.armor = rec.previousArmor;
                    break;
                case ItemKind.DefuseKit:
                    lo.hasDefuseKit = false;
                    break;
                default:
                {
                    int idx = int.Parse(rec.slot);
                    if (lo.abilityCharges[idx] <= 0) return Fail(ShopResult.NotSellable, money);
                    lo.abilityCharges[idx]--;
                    break;
                }
            }
            lo.purchases.Remove(rec);
            return new ShopOutcome { result = ShopResult.Ok, money = money + rec.price };
        }

        /// <summary>Round start: signature abilities refill (GAME_RULES.md 6, last rule).</summary>
        public static void GrantFreeCharges(AgentDef agent, Loadout lo)
        {
            if (agent == null) return;
            for (int i = 0; i < agent.abilities.Length && i < lo.abilityCharges.Length; i++)
            {
                var s = agent.abilities[i];
                if (s.freeChargesPerRound > lo.abilityCharges[i]) lo.abilityCharges[i] = s.freeChargesPerRound;
            }
        }

        public static int AbilitySlotOf(AgentDef agent, string abilityId)
        {
            if (agent == null) return -1;
            for (int i = 0; i < agent.abilities.Length; i++) if (agent.abilities[i].abilityId == abilityId) return i;
            return -1;
        }

        /// <summary>First purchase of this kind; itemId/slot narrow the search when not null.</summary>
        static PurchaseRecord FindPurchase(Loadout lo, ItemKind kind, string itemId, string slot)
        {
            foreach (var p in lo.purchases)
            {
                if (p.kind != kind) continue;
                if (itemId != null && p.itemId != itemId) continue;
                if (slot != null && p.slot != slot) continue;
                return p;
            }
            return null;
        }

        static PurchaseRecord FindLatest(Loadout lo, string itemId)
        {
            for (int i = lo.purchases.Count - 1; i >= 0; i--) if (lo.purchases[i].itemId == itemId) return lo.purchases[i];
            return null;
        }
    }
}
