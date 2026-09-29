using System;
using System.Globalization;

namespace TacticalShooter.Core
{
    public struct Rgba
    {
        public float r, g, b, a;
        public Rgba(float r, float g, float b, float a = 1f) { this.r = r; this.g = g; this.b = b; this.a = a; }
    }

    public static class ColorHex
    {
        /// <summary>Parses "#RRGGBB" or "#RRGGBBAA". Returns magenta for anything else so mistakes are visible.</summary>
        public static Rgba Parse(string hex)
        {
            if (string.IsNullOrEmpty(hex)) return new Rgba(1, 0, 1);
            string s = hex.StartsWith("#", StringComparison.Ordinal) ? hex.Substring(1) : hex;
            if ((s.Length != 6 && s.Length != 8) ||
                !uint.TryParse(s, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out uint v))
                return new Rgba(1, 0, 1);
            if (s.Length == 6) v = (v << 8) | 0xFF;
            return new Rgba(((v >> 24) & 0xFF) / 255f, ((v >> 16) & 0xFF) / 255f, ((v >> 8) & 0xFF) / 255f, (v & 0xFF) / 255f);
        }

        public static string ToHex(float r, float g, float b)
        {
            int R = (int)Math.Round(Math.Max(0, Math.Min(1, r)) * 255);
            int G = (int)Math.Round(Math.Max(0, Math.Min(1, g)) * 255);
            int B = (int)Math.Round(Math.Max(0, Math.Min(1, b)) * 255);
            return "#" + R.ToString("X2") + G.ToString("X2") + B.ToString("X2");
        }
    }
}
