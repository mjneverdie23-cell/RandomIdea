/**
 * Seeded pseudo-random number generation.
 *
 * Quiz generation is reproducible: the same seed always yields the same set of
 * games in the same order. That makes bugs reportable ("seed X question 4"),
 * makes tests deterministic, and leaves room for shared/daily challenges later.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, max). Returns 0 for max <= 0. */
  int(max: number): number;
  /** Fisher-Yates copy — the input array is not mutated. */
  shuffle<T>(items: readonly T[]): T[];
  /** Uniform element, or `undefined` for an empty array. */
  pick<T>(items: readonly T[]): T | undefined;
  /** Sample `count` distinct elements without replacement. */
  sample<T>(items: readonly T[], count: number): T[];
}

/** 32-bit string hash (FNV-1a) used to turn a seed string into a numeric state. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — small, fast, good enough for shuffling a quiz. */
function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: string | number): Rng {
  const next = mulberry32(typeof seed === 'number' ? seed >>> 0 : hashSeed(seed));

  const int = (max: number): number => (max <= 0 ? 0 : Math.floor(next() * max));

  const shuffle = <T,>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(i + 1);
      const a = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = a;
    }
    return copy;
  };

  return {
    next,
    int,
    shuffle,
    pick: <T,>(items: readonly T[]): T | undefined =>
      items.length ? items[int(items.length)] : undefined,
    /**
     * Partial Fisher-Yates: only the first `count` positions are resolved, so
     * sampling 10 games out of 50,000 stays cheap.
     */
    sample: <T,>(items: readonly T[], count: number): T[] => {
      const take = Math.min(count, items.length);
      if (take <= 0) return [];
      const pool = [...items];
      const out: T[] = [];
      for (let i = 0; i < take; i += 1) {
        const j = i + int(pool.length - i);
        const a = pool[i]!;
        pool[i] = pool[j]!;
        pool[j] = a;
        out.push(pool[i]!);
      }
      return out;
    },
  };
}

/** Random, human-shareable seed for a fresh quiz. */
export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}
