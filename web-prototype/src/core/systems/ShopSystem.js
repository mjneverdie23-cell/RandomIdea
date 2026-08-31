/**
 * The buy menu rules.
 *
 * Every restriction (phase, buy zone, class, side, money, duplicate purchases)
 * is checked in one place and reported with a reason code the UI can display.
 * The shop's *contents* come from shop.config.js + weapons.config.js.
 */
import { SHOP_CATEGORIES, ShopConfig } from '../../config/shop.config.js';
import { getItemDefinition, WeaponSlot } from '../../config/weapons.config.js';
import { WeaponFactory } from '../weapons/WeaponFactory.js';
import { containsPointXZ } from '../math/aabb.js';
import { GameEvents } from '../events/GameEvents.js';

export const PurchaseRejection = Object.freeze({
  WRONG_PHASE: 'WRONG_PHASE',
  NOT_IN_BUY_ZONE: 'NOT_IN_BUY_ZONE',
  NOT_ENOUGH_MONEY: 'NOT_ENOUGH_MONEY',
  CLASS_RESTRICTED: 'CLASS_RESTRICTED',
  SIDE_RESTRICTED: 'SIDE_RESTRICTED',
  ALREADY_OWNED: 'ALREADY_OWNED',
  UNKNOWN_ITEM: 'UNKNOWN_ITEM',
  DEAD: 'DEAD',
});

export class ShopSystem {
  /**
   * @param {object} deps { bus, world, teams, economy, getPhase, config }
   * `getPhase` is a callback so the shop never holds a reference to RoundManager.
   */
  constructor({ bus, world, teams, economy, getPhase, config = ShopConfig }) {
    this.bus = bus;
    this.world = world;
    this.teams = teams;
    this.economy = economy;
    this.getPhase = getPhase;
    this.config = config;
  }

  get isBuyPhase() { return this.config.allowedPhases.includes(this.getPhase()); }

  inBuyZone(character) {
    if (!this.config.requireSpawnZone) return true;
    const side = this.teams.sideOf(character.teamId);
    const zone = this.world.map.buyZones[side];
    return zone ? containsPointXZ(zone, character.position) : true;
  }

  /**
   * @returns {{ok: boolean, reason?: string, price?: number}}
   */
  canBuy(character, itemId) {
    const item = getItemDefinition(itemId);
    if (!item) return { ok: false, reason: PurchaseRejection.UNKNOWN_ITEM };
    if (!character.health.alive) return { ok: false, reason: PurchaseRejection.DEAD };
    if (!this.isBuyPhase) return { ok: false, reason: PurchaseRejection.WRONG_PHASE };
    if (!this.inBuyZone(character)) return { ok: false, reason: PurchaseRejection.NOT_IN_BUY_ZONE };

    if (item.sideRestriction && this.teams.sideOf(character.teamId) !== item.sideRestriction) {
      return { ok: false, reason: PurchaseRejection.SIDE_RESTRICTED };
    }
    if (!WeaponFactory.isAllowedForClass(itemId, character.classId)) {
      return { ok: false, reason: PurchaseRejection.CLASS_RESTRICTED };
    }
    if (item.canBuy && !item.canBuy(character)) {
      return { ok: false, reason: PurchaseRejection.ALREADY_OWNED };
    }
    if (character.money < item.price) {
      return { ok: false, reason: PurchaseRejection.NOT_ENOUGH_MONEY, price: item.price };
    }
    return { ok: true, price: item.price };
  }

  /**
   * Buys an item for a character.
   * @returns {{ok: boolean, reason?: string, itemId: string}}
   */
  buy(character, itemId) {
    const check = this.canBuy(character, itemId);
    if (!check.ok) {
      this.bus.emit(GameEvents.PURCHASE_REJECTED, { character, itemId, reason: check.reason });
      return { ok: false, reason: check.reason, itemId };
    }

    const item = getItemDefinition(itemId);
    this.economy.spend(character, item.price, `buy:${itemId}`);

    if (WeaponFactory.isEquipment(itemId)) {
      item.apply(character);
    } else {
      character.inventory.giveWeapon(itemId, { equip: item.slot === WeaponSlot.PRIMARY });
    }

    this.bus.emit(GameEvents.ITEM_PURCHASED, { character, itemId, price: item.price });
    return { ok: true, itemId, price: item.price };
  }

  /** Shop contents for one character, ready to render. */
  listFor(character) {
    return SHOP_CATEGORIES.map((category) => ({
      id: category.id,
      displayName: category.displayName,
      items: category.items
        .map((itemId) => {
          const item = getItemDefinition(itemId);
          if (!item) return null;
          const check = this.canBuy(character, itemId);
          return {
            id: itemId,
            name: item.displayName,
            price: item.price,
            category: item.category,
            available: check.ok,
            reason: check.reason ?? null,
            /** Stat summary for the buy menu tooltip. */
            stats: item.damage != null ? {
              damage: item.damage,
              fireRate: item.fireRate,
              magSize: item.magSize === Infinity ? '-' : item.magSize,
              range: item.range,
              reload: item.reloadTime,
            } : null,
            description: item.description ?? null,
          };
        })
        .filter(Boolean)
        // Items the class can never use are hidden entirely; unaffordable ones stay visible.
        .filter((entry) => entry.reason !== PurchaseRejection.CLASS_RESTRICTED),
    })).filter((category) => category.items.length > 0);
  }

  /** Convenience used by bots: buy the first affordable item from a wish list. */
  buyFromPriority(character, priorityIds) {
    for (const itemId of priorityIds) {
      if (this.canBuy(character, itemId).ok) return this.buy(character, itemId);
    }
    return { ok: false, reason: PurchaseRejection.NOT_ENOUGH_MONEY, itemId: null };
  }
}
