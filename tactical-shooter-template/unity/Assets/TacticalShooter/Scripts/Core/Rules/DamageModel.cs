using System;

namespace TacticalShooter.Core
{
    public struct DamageResult
    {
        public int healthDamage;
        public int armorDamage;
        public int Total => healthDamage + armorDamage;
    }

    /// <summary>Hit zones, falloff and armour, GAME_RULES.md section 4.</summary>
    public static class DamageModel
    {
        public static HitZone ZoneFromHeight(CombatSettings c, float hitHeightAboveFeet, float currentHeight)
        {
            float frac = currentHeight > 0f ? hitHeightAboveFeet / currentHeight : 0.5f;
            if (frac >= c.headZoneFraction) return HitZone.Head;
            if (frac < c.legZoneFraction) return HitZone.Legs;
            return HitZone.Body;
        }

        public static float ZoneMultiplier(WeaponDef w, HitZone zone) =>
            zone == HitZone.Head ? w.headMultiplier : zone == HitZone.Legs ? w.legMultiplier : 1f;

        public static float Falloff(WeaponDef w, float distance)
        {
            float start = w.falloffStart, end = w.falloffEnd, min = w.falloffMinMultiplier;
            if (end <= start) return distance <= start ? 1f : min;
            if (distance <= start) return 1f;
            if (distance >= end) return min;
            float t = (distance - start) / (end - start);
            return 1f + (min - 1f) * t;
        }

        public static float RawDamage(WeaponDef w, HitZone zone, float distance) =>
            w.damage * ZoneMultiplier(w, zone) * Falloff(w, distance);

        public static DamageResult ApplyArmor(CombatSettings c, float raw, int armor, float armorPenetration, float damageTakenMultiplier = 1f)
        {
            int total = (int)Math.Floor(raw * damageTakenMultiplier + 0.5 + 0.0001);
            double absorb = Math.Min(1.0, Math.Max(0.0, c.armorAbsorption * (1.0 - armorPenetration)));
            int armorDamage = Math.Min(armor, (int)Math.Floor(total * absorb + 0.0001));
            if (armorDamage < 0) armorDamage = 0;
            return new DamageResult { healthDamage = total - armorDamage, armorDamage = armorDamage };
        }

        /// <summary>Linear area falloff used by frags and the bomb.</summary>
        public static float AreaDamage(float maxDamage, float distance, float radius) =>
            radius <= 0f ? 0f : maxDamage * Math.Max(0f, 1f - distance / radius);
    }
}
