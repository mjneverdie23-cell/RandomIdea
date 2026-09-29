using System.Collections.Generic;

namespace TacticalShooter.Core
{
    /// <summary>
    /// Decides what a bot buys (full buy, force buy or save) from bots.json "buy" settings.
    /// Returns item ids in the order they should be bought; the caller runs each through
    /// ShopRules.Buy, so a bot can never break a shop rule.
    /// </summary>
    public static class BotBuyPlanner
    {
        public static List<string> Plan(GameData d, AgentDef agent, Side side, Loadout lo, int money, Rng rng)
        {
            var plan = new List<string>();
            var buy = d.Bots.buy;
            int budget = money;
            var heavy = FindArmor(d, 50);
            var light = FindArmor(d, 25);

            if (lo.primaryId == null)
            {
                string weapon = null;
                if (budget >= buy.fullBuyMoney)
                {
                    var sniper = FirstOfCategory(d, WeaponCategory.Sniper);
                    if (sniper != null && rng.Chance(buy.sniperChance) && budget >= sniper.price + (heavy?.price ?? 0))
                        weapon = sniper.id;
                    else if (buy.preferredRifles.Length > 0)
                        weapon = rng.Pick(buy.preferredRifles);
                }
                else if (budget >= buy.forceBuyMoney)
                {
                    var options = new List<string>();
                    foreach (string id in buy.forceBuyWeapons)
                    {
                        var w = d.Weapon(id);
                        if (w != null && w.price + (light?.price ?? 0) <= budget) options.Add(id);
                    }
                    if (options.Count > 0) weapon = rng.Pick(options);
                }
                var def = d.Weapon(weapon);
                if (def != null && def.price <= budget)
                {
                    plan.Add(def.id);
                    budget -= def.price;
                }
            }

            // Pistol / eco round: a better sidearm half the time.
            if (lo.primaryId == null && !plan.Exists(id => d.Weapon(id)?.Slot == WeaponSlot.Primary))
            {
                WeaponDef best = null;
                foreach (var w in d.Weapons)
                    if (w.Slot == WeaponSlot.Secondary && w.price > 0 && w.price <= budget - (light?.price ?? 0) && (best == null || w.price > best.price))
                        best = w;
                if (best != null && lo.secondaryId != best.id && rng.Chance(0.5f))
                {
                    plan.Add(best.id);
                    budget -= best.price;
                }
            }

            if (heavy != null && lo.armor < heavy.amount && budget >= heavy.price)
            {
                plan.Add(heavy.id);
                budget -= heavy.price;
            }
            else if (light != null && lo.armor < light.amount && budget >= light.price)
            {
                plan.Add(light.id);
                budget -= light.price;
            }

            if (agent != null)
            {
                for (int i = 0; i < agent.abilities.Length && i < lo.abilityCharges.Length; i++)
                {
                    var s = agent.abilities[i];
                    if (!s.IsPurchasable) continue;
                    int charges = lo.abilityCharges[i];
                    while (charges < s.maxCharges && budget >= s.price && rng.Chance(buy.abilityBuyChance))
                    {
                        plan.Add(s.abilityId);
                        budget -= s.price;
                        charges++;
                    }
                }
            }

            if (side == Side.Defense && !lo.hasDefuseKit)
            {
                foreach (var e in d.Equipment)
                {
                    if (e.type == "defuseKit" && budget >= e.price && rng.Chance(0.6f))
                    {
                        plan.Add(e.id);
                        budget -= e.price;
                    }
                }
            }
            return plan;
        }

        static EquipmentDef FindArmor(GameData d, int amount)
        {
            foreach (var e in d.Equipment) if (e.type == "armor" && e.amount == amount) return e;
            return null;
        }

        static WeaponDef FirstOfCategory(GameData d, WeaponCategory c)
        {
            foreach (var w in d.Weapons) if (w.Category == c) return w;
            return null;
        }
    }
}
