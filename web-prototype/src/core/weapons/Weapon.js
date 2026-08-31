/**
 * Runtime weapon instance.
 *
 * Holds ONLY mutable state; every stat is read from the immutable definition in
 * weapons.config.js. That split is what makes weapons data-driven: rebalancing
 * is a config edit, and a new gun never needs a new class.
 */
import { FireMode } from '../../config/weapons.config.js';

export class Weapon {
  /** @param {object} definition entry from WEAPON_DEFINITIONS */
  constructor(definition) {
    this.def = definition;
    this.id = definition.id;

    this.ammoInMag = definition.magSize;
    this.reserveAmmo = definition.reserveAmmo;

    this.fireCooldown = 0;      // seconds until the next shot is allowed
    this.equipRemaining = 0;    // seconds left of the draw animation
    this.reloading = false;
    this.reloadRemaining = 0;

    // Burst-fire bookkeeping
    this.burstRemaining = 0;
    this.burstDelayRemaining = 0;

    // Accumulated recoil, in degrees, applied to the aim direction.
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.shotsInSpray = 0;
    this.timeSinceLastShot = Infinity;
    /** Semi-auto weapons need the trigger released between shots. */
    this.triggerReleased = true;
  }

  get displayName() { return this.def.displayName; }
  get category() { return this.def.category; }
  get slot() { return this.def.slot; }
  get secondsPerShot() { return 60 / this.def.fireRate; }
  get isMelee() { return this.def.fireMode === FireMode.MELEE; }
  get hasInfiniteAmmo() { return this.def.magSize === Infinity; }
  get isEmpty() { return !this.hasInfiniteAmmo && this.ammoInMag <= 0; }
  get canReload() {
    return !this.hasInfiniteAmmo && !this.reloading &&
      this.ammoInMag < this.def.magSize && this.reserveAmmo > 0;
  }

  /** True when the trigger pull should produce a shot this tick. */
  canFire() {
    if (this.equipRemaining > 0 || this.reloading) return false;
    if (this.fireCooldown > 0) return false;
    if (this.isEmpty) return false;
    if (this.def.fireMode === FireMode.SEMI && !this.triggerReleased) return false;
    if (this.def.fireMode === FireMode.BURST && this.burstDelayRemaining > 0) return false;
    return true;
  }

  /** Called by CombatSystem right after a shot is resolved. */
  consumeShot() {
    if (!this.hasInfiniteAmmo) this.ammoInMag -= 1;
    this.fireCooldown = this.secondsPerShot;
    this.timeSinceLastShot = 0;
    this.triggerReleased = false;
    this.shotsInSpray += 1;

    if (this.def.fireMode === FireMode.BURST) {
      if (this.burstRemaining <= 0) this.burstRemaining = this.def.burstCount;
      this.burstRemaining -= 1;
      if (this.burstRemaining <= 0) this.burstDelayRemaining = this.def.burstDelay;
    }
  }

  /** Adds one shot of recoil. `random` is the seeded RNG. */
  applyRecoil(random) {
    const r = this.def.recoil;
    this.recoilPitch = Math.min(r.maxVertical, this.recoilPitch + r.vertical);
    this.recoilYaw += random.symmetric(r.horizontal);
    // Horizontal drift stays bounded so sprays are learnable rather than random.
    this.recoilYaw = Math.max(-r.maxVertical / 2, Math.min(r.maxVertical / 2, this.recoilYaw));
  }

  startReload() {
    if (!this.canReload) return false;
    this.reloading = true;
    this.reloadRemaining = this.def.reloadTime;
    return true;
  }

  cancelReload() {
    this.reloading = false;
    this.reloadRemaining = 0;
  }

  finishReload() {
    const needed = this.def.magSize - this.ammoInMag;
    const taken = Math.min(needed, this.reserveAmmo);
    this.ammoInMag += taken;
    this.reserveAmmo -= taken;
    this.reloading = false;
    this.reloadRemaining = 0;
  }

  /** Called when this weapon is drawn. */
  equip() {
    this.equipRemaining = this.def.equipTime;
    this.cancelReload();
    this.resetSpray();
  }

  resetSpray() {
    this.shotsInSpray = 0;
    this.timeSinceLastShot = Infinity;
    this.burstRemaining = 0;
    this.burstDelayRemaining = 0;
  }

  refillAmmo() {
    this.ammoInMag = this.def.magSize;
    this.reserveAmmo = this.def.reserveAmmo;
    this.reloading = false;
    this.reloadRemaining = 0;
  }

  /**
   * Advance timers.
   * @returns {'reloadFinished'|null} event hint for the caller to emit
   */
  update(dt, { triggerHeld = false } = {}) {
    let event = null;
    if (this.equipRemaining > 0) this.equipRemaining = Math.max(0, this.equipRemaining - dt);
    if (this.fireCooldown > 0) this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.burstDelayRemaining > 0) this.burstDelayRemaining = Math.max(0, this.burstDelayRemaining - dt);
    if (!triggerHeld) {
      this.triggerReleased = true;
      // Spray discipline: recoil resets once the trigger is released.
      if (this.shotsInSpray > 0 && this.fireCooldown <= 0) this.resetSpray();
    }

    if (this.reloading) {
      this.reloadRemaining -= dt;
      if (this.reloadRemaining <= 0) { this.finishReload(); event = 'reloadFinished'; }
    }

    // Recoil recovery pulls the aim back toward where the player was pointing,
    // but only once the burst is over - otherwise sustained fire never climbs.
    this.timeSinceLastShot += dt;
    if (triggerHeld || this.timeSinceLastShot < (this.def.recoil.recoveryDelay ?? 0)) return event;
    const recovery = this.def.recoil.recovery * dt;
    if (this.recoilPitch > 0) this.recoilPitch = Math.max(0, this.recoilPitch - recovery);
    if (this.recoilYaw !== 0) {
      const sign = Math.sign(this.recoilYaw);
      this.recoilYaw = Math.abs(this.recoilYaw) <= recovery ? 0 : this.recoilYaw - sign * recovery;
    }
    return event;
  }
}
