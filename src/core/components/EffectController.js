/**
 * Timed status effects (ability buffs, slows, camouflage...).
 *
 * Effects are additive data: each carries a `modifiers` bag, and the controller
 * folds all active effects into one multiplier set that movement, combat and
 * the AI read. Adding a new kind of modifier = adding a key here and reading it
 * where it matters; no system needs to know which ability produced it.
 */

const NEUTRAL = Object.freeze({
  speedMultiplier: 1,
  damageTakenMultiplier: 1,
  damageDealtMultiplier: 1,
  spreadMultiplier: 1,
  gravityMultiplier: 1,
  invisible: false,
});

export class EffectController {
  constructor(character) {
    this.character = character;
    /** @type {Array<{id:string, duration:number, remaining:number, modifiers:object, visual?:string, onTick?:Function, breakOnFire?:boolean}>} */
    this.active = [];
    this.modifiers = { ...NEUTRAL };
  }

  add(effect) {
    // Re-applying an effect refreshes it rather than stacking duplicates.
    const existing = this.active.find((e) => e.id === effect.id);
    if (existing) {
      existing.remaining = effect.duration ?? 0;
      existing.modifiers = effect.modifiers ?? {};
      return existing;
    }
    const instance = {
      visual: null,
      onTick: null,
      breakOnFire: false,
      modifiers: {},
      ...effect,
      remaining: effect.duration ?? 0,
    };
    this.active.push(instance);
    this._recompute();
    return instance;
  }

  remove(effectId) {
    const index = this.active.findIndex((e) => e.id === effectId);
    if (index >= 0) {
      this.active.splice(index, 1);
      this._recompute();
      return true;
    }
    return false;
  }

  has(effectId) { return this.active.some((e) => e.id === effectId); }

  clear() {
    this.active.length = 0;
    this._recompute();
  }

  /** Called when the owner fires; cancels effects flagged `breakOnFire` (camouflage). */
  notifyFired() {
    const broken = this.active.filter((e) => e.breakOnFire);
    for (const effect of broken) this.remove(effect.id);
    return broken.map((e) => e.id);
  }

  update(dt, context) {
    if (this.active.length === 0) return;
    let dirty = false;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const effect = this.active[i];
      effect.onTick?.(this.character, dt, context);
      // duration 0 means "instant"; such effects are removed on the next tick.
      effect.remaining -= dt;
      if (effect.remaining <= 0) {
        this.active.splice(i, 1);
        dirty = true;
      }
    }
    if (dirty) this._recompute();
  }

  _recompute() {
    const result = { ...NEUTRAL };
    for (const effect of this.active) {
      const m = effect.modifiers ?? {};
      if (m.speedMultiplier != null) result.speedMultiplier *= m.speedMultiplier;
      if (m.damageTakenMultiplier != null) result.damageTakenMultiplier *= m.damageTakenMultiplier;
      if (m.damageDealtMultiplier != null) result.damageDealtMultiplier *= m.damageDealtMultiplier;
      if (m.spreadMultiplier != null) result.spreadMultiplier *= m.spreadMultiplier;
      if (m.gravityMultiplier != null) result.gravityMultiplier *= m.gravityMultiplier;
      if (m.invisible) result.invisible = true;
    }
    this.modifiers = result;
  }
}
