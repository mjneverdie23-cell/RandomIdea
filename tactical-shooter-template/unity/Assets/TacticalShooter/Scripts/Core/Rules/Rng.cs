using System.Collections.Generic;
using System.Text;

namespace TacticalShooter.Core
{
    /// <summary>
    /// xorshift32, identical to FTSRng in the Unreal project and Rng in reference_rules.py
    /// (GAME_RULES.md section 13), so seeded behaviour matches across engines.
    /// </summary>
    public sealed class Rng
    {
        uint state;

        public Rng(uint seed) { state = seed == 0 ? 0x9E3779B9u : seed; }

        public uint NextUInt()
        {
            uint s = state;
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            state = s;
            return s;
        }

        /// <summary>Uniform in [0, 1).</summary>
        public float NextFloat() => (NextUInt() >> 8) / 16777216f;

        public float Range(float min, float max) => min + (max - min) * NextFloat();

        /// <summary>Uniform integer in [minInclusive, maxExclusive).</summary>
        public int Range(int minInclusive, int maxExclusive)
        {
            if (maxExclusive <= minInclusive) return minInclusive;
            int v = minInclusive + (int)(NextFloat() * (maxExclusive - minInclusive));
            return v >= maxExclusive ? maxExclusive - 1 : v;
        }

        public bool Chance(float probability) => NextFloat() < probability;

        public T Pick<T>(IList<T> list) => list.Count == 0 ? default : list[Range(0, list.Count)];

        public void Shuffle<T>(IList<T> list)
        {
            for (int i = list.Count - 1; i > 0; i--)
            {
                int j = Range(0, i + 1);
                (list[i], list[j]) = (list[j], list[i]);
            }
        }
    }

    public static class Hash
    {
        /// <summary>32-bit FNV-1a over the UTF-8 bytes.</summary>
        public static uint Fnv1a(string text)
        {
            uint h = 2166136261;
            foreach (byte b in Encoding.UTF8.GetBytes(text ?? ""))
            {
                h ^= b;
                h *= 16777619;
            }
            return h;
        }
    }
}
