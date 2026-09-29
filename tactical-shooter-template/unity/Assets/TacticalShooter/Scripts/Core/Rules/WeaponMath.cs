using System;

namespace TacticalShooter.Core
{
    public struct SpreadInput
    {
        public float horizontalSpeed;
        public bool airborne;
        public bool crouched;
        public bool aiming;
        public int shotIndex;
    }

    /// <summary>Spread, recoil and cone sampling, GAME_RULES.md section 5.</summary>
    public static class WeaponMath
    {
        public static float Spread(WeaponDef w, MovementSettings m, SpreadInput s)
        {
            float bloom = Math.Min(s.shotIndex * w.bloomPerShot, w.maxBloom);
            float stable = w.baseSpread + bloom;
            if (s.crouched && !s.airborne) stable *= w.crouchSpreadMultiplier;
            if (s.aiming) stable *= w.adsSpreadMultiplier;
            float frac = m.runSpeed > 0f ? Math.Min(1f, Math.Max(0f, s.horizontalSpeed / m.runSpeed)) : 0f;
            float moving = w.moveSpread * frac + (s.airborne ? w.airSpread : 0f);
            return stable + moving;
        }

        /// <summary>View kick after shot shotIndex (pitch up, yaw right), without the random part.</summary>
        public static void RecoilKick(WeaponDef w, int shotIndex, out float pitch, out float yaw)
        {
            var p = w.recoilPattern;
            if (p == null || p.Length == 0) { pitch = 0f; yaw = 0f; return; }
            var step = p[Math.Min(shotIndex, p.Length - 1)];
            pitch = step.pitch;
            yaw = step.yaw;
        }

        public static float FireInterval(WeaponDef w, float fireRateMultiplier = 1f) =>
            1f / Math.Max(0.01f, w.fireRate * Math.Max(0.01f, fireRateMultiplier));

        /// <summary>Uniform sample inside a cone of half-angle spreadDegrees. Offsets in degrees.</summary>
        public static void SampleCone(Rng rng, float spreadDegrees, out float pitchOffset, out float yawOffset)
        {
            double angle = 2.0 * Math.PI * rng.NextFloat();
            double radius = spreadDegrees * Math.Sqrt(rng.NextFloat());
            pitchOffset = (float)(radius * Math.Sin(angle));
            yawOffset = (float)(radius * Math.Cos(angle));
        }

        /// <summary>Horizontal field of view (degrees) to vertical for a given aspect ratio.</summary>
        public static float HorizontalToVerticalFov(float horizontalDegrees, float aspect)
        {
            double h = horizontalDegrees * Math.PI / 180.0;
            return (float)(2.0 * Math.Atan(Math.Tan(h / 2.0) / Math.Max(0.1, aspect)) * 180.0 / Math.PI);
        }
    }
}
