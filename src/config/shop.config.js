/**
 * Shop layout and purchase rules.
 *
 * Prices live on the item definitions (weapons.config.js); this file only
 * decides what is *shown*, in what order, and under which restrictions.
 * ShopSystem enforces the rules - it never contains a list of items.
 */

export const SHOP_CATEGORIES = Object.freeze([
  { id: 'PISTOL', displayName: 'Sidearms', items: ['pistol_scav', 'pistol_dart', 'pistol_talon'] },
  { id: 'SMG', displayName: 'SMGs', items: ['smg_swarm', 'smg_needler'] },
  { id: 'RIFLE', displayName: 'Rifles', items: ['rifle_apex', 'rifle_bulwark', 'rifle_ranger'] },
  { id: 'SNIPER', displayName: 'Snipers', items: ['sniper_horizon', 'sniper_longneck'] },
  { id: 'SHOTGUN', displayName: 'Shotguns', items: ['shotgun_maw'] },
  { id: 'LMG', displayName: 'Heavy', items: ['lmg_thunder'] },
  { id: 'EQUIPMENT', displayName: 'Gear', items: ['eq_armor', 'eq_helmet', 'eq_defuser', 'eq_frag', 'eq_medkit'] },
]);

export const ShopConfig = Object.freeze({
  /** Buying is only allowed during these round phases. */
  allowedPhases: ['BUY', 'WARMUP'],
  /** Players must be inside their own spawn zone to buy (set false for buy-anywhere). */
  requireSpawnZone: true,
  /** Refund window in seconds after a purchase (0 disables refunds). */
  refundWindow: 0,
  /** Weapons dropped on death are removed from the world at round end. */
  dropWeaponOnDeath: true,
});
