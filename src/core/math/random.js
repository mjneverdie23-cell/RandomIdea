/**
 * Seeded RNG (mulberry32).
 *
 * Everything random in the simulation - spread, bot aim error, spawn jitter -
 * goes through an instance of this so a match can be replayed deterministically
 * from a seed. Never call Math.random() inside src/core.
 */
export class Random {
  constructor(seed = 1337) {
    this.seed = seed >>> 0;
    this._state = this.seed;
  }

  /** Float in [0, 1). */
  next() {
    this._state = (this._state + 0x6d2b79f5) >>> 0;
    let t = this._state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min, max) { return min + this.next() * (max - min); }

  /** Float in [-magnitude, +magnitude). */
  symmetric(magnitude) { return this.range(-magnitude, magnitude); }

  /** Integer in [min, max]. */
  int(min, max) { return Math.floor(this.range(min, max + 1)); }

  chance(probability) { return this.next() < probability; }

  pick(array) { return array[this.int(0, array.length - 1)]; }

  reset(seed = this.seed) { this._state = seed >>> 0; }
}
