/**
 * What a character carries: weapons per slot, grenades, the defuse kit and the
 * bomb. Slot rules live here so the shop, the round reset and the pickup code
 * all agree on what "having a primary" means.
 */
import { WeaponSlot } from '../../config/weapons.config.js';
import { WeaponFactory } from '../weapons/WeaponFactory.js';

export class Inventory {
  constructor(character) {
    this.character = character;
    /** @type {Record<string, import('../weapons/Weapon.js').Weapon|null>} */
    this.slots = {
      [WeaponSlot.PRIMARY]: null,
      [WeaponSlot.SECONDARY]: null,
      [WeaponSlot.MELEE]: null,
      [WeaponSlot.GRENADE]: null,
    };
    this.activeSlot = WeaponSlot.MELEE;
    /** @type {Record<string, number>} grenade item id -> count */
    this.grenades = {};
    this.hasDefuseKit = false;
    this.hasBomb = false;
  }

  get activeWeapon() { return this.slots[this.activeSlot]; }

  getWeapon(slot) { return this.slots[slot]; }

  /** Adds a weapon to its own slot, replacing whatever was there. */
  giveWeapon(weaponId, { equip = true } = {}) {
    const weapon = WeaponFactory.create(weaponId);
    const slot = weapon.slot;
    const previous = this.slots[slot];
    this.slots[slot] = weapon;
    if (equip || this.activeWeapon == null) this.equipSlot(slot);
    return { weapon, replaced: previous };
  }

  removeSlot(slot) {
    const removed = this.slots[slot];
    this.slots[slot] = null;
    if (this.activeSlot === slot) this.equipBestAvailable();
    return removed;
  }

  /** @returns {boolean} whether the switch happened */
  equipSlot(slot) {
    if (!this.slots[slot]) return false;
    if (this.activeSlot === slot) return false;
    this.slots[this.activeSlot]?.cancelReload();
    this.activeSlot = slot;
    this.slots[slot].equip();
    return true;
  }

  /** Primary > secondary > melee. Used after dropping/removing a weapon. */
  equipBestAvailable() {
    for (const slot of [WeaponSlot.PRIMARY, WeaponSlot.SECONDARY, WeaponSlot.MELEE]) {
      if (this.slots[slot]) {
        this.activeSlot = slot;
        this.slots[slot].equip();
        return slot;
      }
    }
    this.activeSlot = WeaponSlot.MELEE;
    return null;
  }

  /** Cycles to the next slot that holds something. */
  cycleSlot(direction = 1) {
    const order = [WeaponSlot.PRIMARY, WeaponSlot.SECONDARY, WeaponSlot.MELEE, WeaponSlot.GRENADE];
    const start = order.indexOf(this.activeSlot);
    for (let i = 1; i <= order.length; i++) {
      const slot = order[(start + direction * i + order.length * 4) % order.length];
      if (slot === WeaponSlot.GRENADE ? this.totalGrenades() > 0 : this.slots[slot]) {
        if (slot !== WeaponSlot.GRENADE) this.equipSlot(slot);
        else this.activeSlot = slot;
        return slot;
      }
    }
    return this.activeSlot;
  }

  addGrenade(itemId, count = 1) {
    this.grenades[itemId] = (this.grenades[itemId] ?? 0) + count;
  }

  grenadeCount(itemId) { return this.grenades[itemId] ?? 0; }

  totalGrenades() {
    return Object.values(this.grenades).reduce((sum, n) => sum + n, 0);
  }

  /** Removes one grenade and returns its item id, or null when out. */
  takeGrenade(itemId = null) {
    const id = itemId ?? Object.keys(this.grenades).find((key) => this.grenades[key] > 0);
    if (!id || (this.grenades[id] ?? 0) <= 0) return null;
    this.grenades[id] -= 1;
    if (this.grenades[id] <= 0) delete this.grenades[id];
    return id;
  }

  refillAllAmmo() {
    for (const weapon of Object.values(this.slots)) weapon?.refillAmmo();
  }

  /**
   * Round reset. Weapons are kept between rounds (CS-style), consumables are not.
   * @param {{keepWeapons: boolean, defaultLoadout: object}} options
   */
  resetForRound({ keepWeapons = true, defaultLoadout = {} } = {}) {
    if (!keepWeapons) {
      this.slots[WeaponSlot.PRIMARY] = null;
      this.slots[WeaponSlot.SECONDARY] = null;
    }
    this.grenades = {};
    this.hasBomb = false;
    // Defuse kits are consumed on use, not on round end - kept deliberately.

    if (defaultLoadout.melee && !this.slots[WeaponSlot.MELEE]) this.giveWeapon(defaultLoadout.melee, { equip: false });
    if (defaultLoadout.secondary && !this.slots[WeaponSlot.SECONDARY]) this.giveWeapon(defaultLoadout.secondary, { equip: false });
    if (defaultLoadout.primary && !this.slots[WeaponSlot.PRIMARY]) this.giveWeapon(defaultLoadout.primary, { equip: false });

    this.refillAllAmmo();
    this.activeSlot = WeaponSlot.MELEE;
    this.equipBestAvailable();
  }

  /** Snapshot for UI/scoreboard. */
  describe() {
    return {
      primary: this.slots[WeaponSlot.PRIMARY]?.id ?? null,
      secondary: this.slots[WeaponSlot.SECONDARY]?.id ?? null,
      melee: this.slots[WeaponSlot.MELEE]?.id ?? null,
      grenades: { ...this.grenades },
      hasDefuseKit: this.hasDefuseKit,
      hasBomb: this.hasBomb,
    };
  }
}
