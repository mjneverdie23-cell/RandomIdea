using System;

namespace TacticalShooter.Core
{
    /// <summary>The two persistent teams. The human player is always on team A.</summary>
    public enum TeamId { A = 0, B = 1 }

    public enum Side { Attack = 0, Defense = 1 }

    public enum MatchPhase { NotStarted, BuyPhase, Live, RoundEnd, Halftime, MatchOver }

    public enum RoundEndReason { None, Elimination, BombDetonated, BombDefused, TimeExpired }

    public enum HitZone { Head, Body, Legs }

    public enum WeaponSlot { Primary = 0, Secondary = 1, Melee = 2 }

    public enum FireMode { Auto, Semi, Melee }

    public enum WeaponCategory { Melee, Sidearm, Smg, Shotgun, Rifle, Sniper }

    public enum AbilityType { Flash, Smoke, Frag, Incendiary, Dash, Heal, Wall, Recon, Buff }

    public enum CellType { Wall, Floor, LowCover, HighCover, SiteA, SiteB, AttackSpawn, DefenseSpawn }

    public enum ItemKind { Weapon, Armor, DefuseKit, Ability }

    public enum ShopResult { Ok, NotForSale, WrongSide, AlreadyOwned, MaxCharges, NotEnoughMoney, UnknownItem, NotSellable, NotAllowed }

    /// <summary>What happens to money and loadouts when a round starts (GAME_RULES.md 2.3).</summary>
    public enum EconomyReset { None, StartMoney, OvertimeMoney, OvertimeMoneyAndClear }

    public enum Wave { Sine, Square, Saw, Triangle, Noise }

    /// <summary>String &lt;-&gt; enum conversions for the lowercase ids used in the JSON files.</summary>
    public static class Ids
    {
        public static Side Other(Side s) => s == Side.Attack ? Side.Defense : Side.Attack;
        public static TeamId Other(TeamId t) => t == TeamId.A ? TeamId.B : TeamId.A;

        public static Side ParseSide(string s) =>
            string.Equals(s, "defense", StringComparison.OrdinalIgnoreCase) ? Side.Defense : Side.Attack;

        public static string ToId(Side s) => s == Side.Attack ? "attack" : "defense";

        public static WeaponSlot ParseSlot(string s)
        {
            switch ((s ?? "").ToLowerInvariant())
            {
                case "primary": return WeaponSlot.Primary;
                case "melee": return WeaponSlot.Melee;
                default: return WeaponSlot.Secondary;
            }
        }

        public static string ToId(WeaponSlot s) => s == WeaponSlot.Primary ? "primary" : s == WeaponSlot.Melee ? "melee" : "secondary";

        public static FireMode ParseFireMode(string s)
        {
            switch ((s ?? "").ToLowerInvariant())
            {
                case "auto": return FireMode.Auto;
                case "melee": return FireMode.Melee;
                default: return FireMode.Semi;
            }
        }

        public static WeaponCategory ParseCategory(string s)
        {
            switch ((s ?? "").ToLowerInvariant())
            {
                case "melee": return WeaponCategory.Melee;
                case "smg": return WeaponCategory.Smg;
                case "shotgun": return WeaponCategory.Shotgun;
                case "rifle": return WeaponCategory.Rifle;
                case "sniper": return WeaponCategory.Sniper;
                default: return WeaponCategory.Sidearm;
            }
        }

        public static bool TryParseAbilityType(string s, out AbilityType type)
        {
            switch ((s ?? "").ToLowerInvariant())
            {
                case "flash": type = AbilityType.Flash; return true;
                case "smoke": type = AbilityType.Smoke; return true;
                case "frag": type = AbilityType.Frag; return true;
                case "incendiary": type = AbilityType.Incendiary; return true;
                case "dash": type = AbilityType.Dash; return true;
                case "heal": type = AbilityType.Heal; return true;
                case "wall": type = AbilityType.Wall; return true;
                case "recon": type = AbilityType.Recon; return true;
                case "buff": type = AbilityType.Buff; return true;
                default: type = AbilityType.Buff; return false;
            }
        }

        public static Wave ParseWave(string s)
        {
            switch ((s ?? "").ToLowerInvariant())
            {
                case "square": return Wave.Square;
                case "saw": return Wave.Saw;
                case "triangle": return Wave.Triangle;
                case "noise": return Wave.Noise;
                default: return Wave.Sine;
            }
        }

        public static string ToId(HitZone z) => z == HitZone.Head ? "head" : z == HitZone.Legs ? "legs" : "body";

        public static HitZone ParseZone(string s)
        {
            switch ((s ?? "").ToLowerInvariant())
            {
                case "head": return HitZone.Head;
                case "legs": return HitZone.Legs;
                default: return HitZone.Body;
            }
        }

        /// <summary>camelCase id used in rules_vectors.json, e.g. NotEnoughMoney -> "notEnoughMoney".</summary>
        public static string ToId(ShopResult r)
        {
            string s = r.ToString();
            return char.ToLowerInvariant(s[0]) + s.Substring(1);
        }

        public static string SiteName(int site) => site == 0 ? "A" : site == 1 ? "B" : "?";
    }
}
