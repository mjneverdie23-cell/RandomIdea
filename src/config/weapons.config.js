/**
 * Weapon and equipment database.
 *
 * Weapons are data, not classes. `WeaponFactory` turns one of these records
 * into a runtime instance that only tracks mutable state (ammo, cooldowns,
 * recoil index). Adding a gun therefore means adding an object here - no new
 * code, no subclassing.
 *
 * Units: damage = hit points, range/falloff = world units, times = seconds,
 * fireRate = rounds per minute, spread/recoil = degrees.
 */

export const WeaponCategory = Object.freeze({
  PISTOL: 'PISTOL',
  SMG: 'SMG',
  RIFLE: 'RIFLE',
  SNIPER: 'SNIPER',
  SHOTGUN: 'SHOTGUN',
  LMG: 'LMG',
  MELEE: 'MELEE',
  EQUIPMENT: 'EQUIPMENT',
});

/** Inventory slots. One item per slot; buying replaces what is there. */
export const WeaponSlot = Object.freeze({
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  MELEE: 'melee',
  GRENADE: 'grenade',
});

export const FireMode = Object.freeze({
  AUTO: 'AUTO',
  SEMI: 'SEMI',
  BURST: 'BURST',
  MELEE: 'MELEE',
  THROWN: 'THROWN',
});

/** Defaults merged into every weapon record so entries stay short. */
export const WEAPON_DEFAULTS = Object.freeze({
  category: WeaponCategory.RIFLE,
  slot: WeaponSlot.PRIMARY,
  fireMode: FireMode.AUTO,
  price: 0,
  damage: 25,
  headshotMultiplier: 4.0,
  armorPenetration: 0.7,     // 0..1 - fraction of damage that ignores armor
  fireRate: 600,             // rounds per minute
  burstCount: 3,
  burstDelay: 0.32,
  magSize: 30,
  reserveAmmo: 90,
  reloadTime: 2.2,
  equipTime: 0.6,
  range: 90,                 // beyond falloffEnd damage stops dropping
  falloffStart: 35,
  falloffEnd: 80,
  falloffMinMultiplier: 0.55,
  pellets: 1,
  spread: {
    base: 0.6,               // degrees of cone while standing still, hip fire
    moving: 3.2,             // added at full run speed
    jumping: 6.0,            // added while airborne
    crouching: -0.25,        // added (negative = tighter) while crouched
    ads: -0.45,              // added while aiming down sights
  },
  recoil: {
    vertical: 0.45,          // degrees kicked up per shot
    horizontal: 0.22,        // max degrees kicked sideways per shot
    recovery: 7.0,           // degrees per second returned to the original aim
    recoveryDelay: 0.22,     // seconds after the last shot before recovery starts
    maxVertical: 9.0,
  },
  adsZoom: 1.25,             // camera FOV divisor while aiming
  adsTime: 0.22,
  moveSpeedMultiplier: 1.0,  // carried-weapon speed penalty
  killReward: 300,
  allowedClasses: null,      // null = every class whose allowedCategories match
  visual: { modelKey: 'weapon_generic', color: 0x9aa0a6 },
});

/**
 * @typedef {typeof WEAPON_DEFAULTS & {id: string, displayName: string}} WeaponDefinition
 */
const W = (def) => ({
  ...WEAPON_DEFAULTS,
  ...def,
  spread: { ...WEAPON_DEFAULTS.spread, ...(def.spread ?? {}) },
  recoil: { ...WEAPON_DEFAULTS.recoil, ...(def.recoil ?? {}) },
  visual: { ...WEAPON_DEFAULTS.visual, ...(def.visual ?? {}) },
});

export const WEAPON_DEFINITIONS = Object.freeze({
  // ---------------------------------------------------------------- MELEE --
  melee_claws: W({
    id: 'melee_claws', displayName: 'Claws', category: WeaponCategory.MELEE,
    slot: WeaponSlot.MELEE, fireMode: FireMode.MELEE, price: 0,
    damage: 55, headshotMultiplier: 2.0, armorPenetration: 0.85,
    fireRate: 90, magSize: Infinity, reserveAmmo: Infinity, reloadTime: 0,
    range: 2.4, falloffStart: 2.4, falloffEnd: 2.4, equipTime: 0.35,
    moveSpeedMultiplier: 1.1, killReward: 1200,
    visual: { modelKey: 'weapon_claws', color: 0xd9c9a3 },
  }),

  // -------------------------------------------------------------- PISTOLS --
  pistol_scav: W({
    id: 'pistol_scav', displayName: 'Scavenger P9', category: WeaponCategory.PISTOL,
    slot: WeaponSlot.SECONDARY, fireMode: FireMode.SEMI, price: 0,
    damage: 26, fireRate: 400, magSize: 15, reserveAmmo: 60, reloadTime: 1.9,
    range: 55, falloffStart: 18, falloffEnd: 45, armorPenetration: 0.55,
    moveSpeedMultiplier: 1.05, killReward: 450,
    recoil: { vertical: 0.5, horizontal: 0.2, maxVertical: 4 },
    visual: { modelKey: 'weapon_pistol', color: 0x8e9296 },
  }),
  pistol_talon: W({
    id: 'pistol_talon', displayName: 'Talon .50', category: WeaponCategory.PISTOL,
    slot: WeaponSlot.SECONDARY, fireMode: FireMode.SEMI, price: 700,
    damage: 52, headshotMultiplier: 3.6, fireRate: 230, magSize: 7, reserveAmmo: 35,
    reloadTime: 2.3, range: 70, falloffStart: 25, falloffEnd: 60, armorPenetration: 0.82,
    moveSpeedMultiplier: 1.0, killReward: 350,
    spread: { base: 1.1, moving: 5.0 },
    recoil: { vertical: 1.4, horizontal: 0.5, maxVertical: 7 },
    visual: { modelKey: 'weapon_pistol_heavy', color: 0x6f7477 },
  }),
  pistol_dart: W({
    id: 'pistol_dart', displayName: 'Dart Repeater', category: WeaponCategory.PISTOL,
    slot: WeaponSlot.SECONDARY, fireMode: FireMode.AUTO, price: 450,
    damage: 17, fireRate: 850, magSize: 24, reserveAmmo: 96, reloadTime: 1.8,
    range: 45, falloffStart: 14, falloffEnd: 38, armorPenetration: 0.5,
    moveSpeedMultiplier: 1.08, killReward: 500,
    spread: { base: 1.0, moving: 3.4 },
    recoil: { vertical: 0.35, horizontal: 0.3, maxVertical: 5 },
    visual: { modelKey: 'weapon_pistol_auto', color: 0x93856b },
  }),

  // ------------------------------------------------------------------ SMG --
  smg_swarm: W({
    id: 'smg_swarm', displayName: 'Swarm SMG', category: WeaponCategory.SMG,
    price: 1250, damage: 22, fireRate: 900, magSize: 30, reserveAmmo: 120,
    reloadTime: 2.0, range: 55, falloffStart: 16, falloffEnd: 45,
    armorPenetration: 0.6, falloffMinMultiplier: 0.45,
    moveSpeedMultiplier: 1.06, killReward: 600,
    spread: { base: 1.0, moving: 2.4 },
    recoil: { vertical: 0.34, horizontal: 0.28, maxVertical: 7 },
    visual: { modelKey: 'weapon_smg', color: 0x7d8a92 },
  }),
  smg_needler: W({
    id: 'smg_needler', displayName: 'Needler PDW', category: WeaponCategory.SMG,
    price: 1600, damage: 27, fireRate: 750, magSize: 25, reserveAmmo: 100,
    reloadTime: 2.2, range: 62, falloffStart: 20, falloffEnd: 50,
    armorPenetration: 0.72, moveSpeedMultiplier: 1.03, killReward: 450,
    spread: { base: 0.9, moving: 2.8 },
    recoil: { vertical: 0.42, horizontal: 0.24, maxVertical: 7.5 },
    visual: { modelKey: 'weapon_smg', color: 0x6d7d85 },
  }),

  // --------------------------------------------------------------- RIFLES --
  rifle_ranger: W({
    id: 'rifle_ranger', displayName: 'Ranger AR', category: WeaponCategory.RIFLE,
    price: 2700, damage: 33, fireRate: 660, magSize: 30, reserveAmmo: 90,
    reloadTime: 2.4, range: 100, falloffStart: 45, falloffEnd: 90,
    armorPenetration: 0.78, moveSpeedMultiplier: 0.96, killReward: 300,
    spread: { base: 0.55, moving: 3.4 },
    recoil: { vertical: 0.5, horizontal: 0.26, maxVertical: 9 },
    visual: { modelKey: 'weapon_rifle', color: 0x59636b },
  }),
  rifle_apex: W({
    id: 'rifle_apex', displayName: 'Apex Carbine', category: WeaponCategory.RIFLE,
    price: 2250, damage: 28, fireRate: 780, magSize: 30, reserveAmmo: 90,
    reloadTime: 2.1, range: 85, falloffStart: 35, falloffEnd: 75,
    armorPenetration: 0.7, moveSpeedMultiplier: 0.99, killReward: 300,
    spread: { base: 0.7, moving: 3.0 },
    recoil: { vertical: 0.4, horizontal: 0.3, maxVertical: 8 },
    visual: { modelKey: 'weapon_rifle', color: 0x63706b },
  }),
  rifle_bulwark: W({
    id: 'rifle_bulwark', displayName: 'Bulwark BR', category: WeaponCategory.RIFLE,
    fireMode: FireMode.BURST, price: 2100, damage: 30, fireRate: 900,
    burstCount: 3, burstDelay: 0.34, magSize: 24, reserveAmmo: 72, reloadTime: 2.3,
    range: 95, falloffStart: 40, falloffEnd: 85, armorPenetration: 0.75,
    moveSpeedMultiplier: 0.97, killReward: 350,
    spread: { base: 0.45, moving: 3.6 },
    recoil: { vertical: 0.55, horizontal: 0.18, maxVertical: 8 },
    visual: { modelKey: 'weapon_rifle', color: 0x6b6355 },
  }),

  // -------------------------------------------------------------- SNIPERS --
  sniper_longneck: W({
    id: 'sniper_longneck', displayName: 'Longneck Bolt', category: WeaponCategory.SNIPER,
    fireMode: FireMode.SEMI, price: 4750, damage: 115, headshotMultiplier: 2.4,
    fireRate: 41, magSize: 5, reserveAmmo: 25, reloadTime: 3.4,
    range: 200, falloffStart: 120, falloffEnd: 200, falloffMinMultiplier: 0.85,
    armorPenetration: 0.95, equipTime: 1.0, adsZoom: 4.0, adsTime: 0.35,
    moveSpeedMultiplier: 0.82, killReward: 100,
    spread: { base: 3.5, moving: 9.0, ads: -3.45 }, // useless from the hip, exact when scoped
    recoil: { vertical: 3.0, horizontal: 0.6, recovery: 12, maxVertical: 6 },
    visual: { modelKey: 'weapon_sniper', color: 0x4d5560 },
  }),
  sniper_horizon: W({
    id: 'sniper_horizon', displayName: 'Horizon DMR', category: WeaponCategory.SNIPER,
    fireMode: FireMode.SEMI, price: 3200, damage: 68, headshotMultiplier: 2.8,
    fireRate: 180, magSize: 10, reserveAmmo: 40, reloadTime: 2.8,
    range: 160, falloffStart: 80, falloffEnd: 150, falloffMinMultiplier: 0.7,
    armorPenetration: 0.85, adsZoom: 2.5, adsTime: 0.28,
    moveSpeedMultiplier: 0.9, killReward: 300,
    spread: { base: 2.2, moving: 7.0, ads: -2.0 },
    recoil: { vertical: 1.6, horizontal: 0.4, recovery: 10, maxVertical: 7 },
    visual: { modelKey: 'weapon_sniper', color: 0x566070 },
  }),

  // ------------------------------------------------------------- SHOTGUNS --
  shotgun_maw: W({
    id: 'shotgun_maw', displayName: 'Maw Breaker', category: WeaponCategory.SHOTGUN,
    fireMode: FireMode.SEMI, price: 1900, damage: 17, headshotMultiplier: 1.8,
    pellets: 8, fireRate: 120, magSize: 7, reserveAmmo: 28, reloadTime: 3.0,
    range: 28, falloffStart: 8, falloffEnd: 24, falloffMinMultiplier: 0.25,
    armorPenetration: 0.55, moveSpeedMultiplier: 0.95, killReward: 900,
    spread: { base: 5.5, moving: 2.0, ads: -1.5 },
    recoil: { vertical: 2.2, horizontal: 0.5, recovery: 9, maxVertical: 6 },
    visual: { modelKey: 'weapon_shotgun', color: 0x7a5b46 },
  }),

  // ------------------------------------------------------------------ LMG --
  lmg_thunder: W({
    id: 'lmg_thunder', displayName: 'Thunderfoot LMG', category: WeaponCategory.LMG,
    price: 4200, damage: 30, fireRate: 700, magSize: 100, reserveAmmo: 200,
    reloadTime: 5.2, range: 110, falloffStart: 50, falloffEnd: 95,
    armorPenetration: 0.8, equipTime: 1.1, moveSpeedMultiplier: 0.82, killReward: 300,
    spread: { base: 1.4, moving: 5.0, crouching: -0.8 },
    recoil: { vertical: 0.42, horizontal: 0.4, recovery: 5.5, maxVertical: 11 },
    visual: { modelKey: 'weapon_lmg', color: 0x4f5a4f },
  }),
});

/**
 * Equipment: non-shooting purchases. `apply` runs on the character when bought,
 * so new equipment types need no changes in ShopSystem.
 */
export const EQUIPMENT_DEFINITIONS = Object.freeze({
  eq_armor: {
    id: 'eq_armor', displayName: 'Hide Plating', category: WeaponCategory.EQUIPMENT,
    price: 650, description: 'Restores armour to full.',
    apply: (character) => { character.health.armor = character.health.maxArmor; },
    canBuy: (character) => character.health.armor < character.health.maxArmor || !character.health.hasHelmet,
  },
  eq_helmet: {
    id: 'eq_helmet', displayName: 'Crested Helm', category: WeaponCategory.EQUIPMENT,
    price: 1000, description: 'Full armour plus head protection.',
    apply: (character) => {
      character.health.armor = character.health.maxArmor;
      character.health.hasHelmet = true;
    },
    canBuy: (character) => !character.health.hasHelmet || character.health.armor < character.health.maxArmor,
  },
  eq_defuser: {
    id: 'eq_defuser', displayName: 'Defuse Kit', category: WeaponCategory.EQUIPMENT,
    price: 400, description: 'Halves bomb defuse time. Defenders only.',
    apply: (character) => { character.inventory.hasDefuseKit = true; },
    canBuy: (character) => !character.inventory.hasDefuseKit,
    sideRestriction: 'DEFENDERS',
  },
  eq_frag: {
    id: 'eq_frag', displayName: 'Frag Egg', category: WeaponCategory.EQUIPMENT,
    price: 300, description: 'Thrown explosive. Max 2 carried.',
    grenade: {
      fuseTime: 2.4, damage: 105, radius: 8.5, minDamageFraction: 0.15,
      throwSpeed: 22, gravityScale: 1.0, bounce: 0.35, killReward: 300,
    },
    maxCount: 2,
    apply: (character) => { character.inventory.addGrenade('eq_frag'); },
    canBuy: (character) => character.inventory.grenadeCount('eq_frag') < 2,
  },
  eq_medkit: {
    id: 'eq_medkit', displayName: 'Regen Gland', category: WeaponCategory.EQUIPMENT,
    price: 800, description: 'Heals 50 health instantly when bought, once per round.',
    apply: (character) => { character.health.heal(50); },
    canBuy: (character) => character.health.health < character.health.maxHealth,
  },
});

export function getWeaponDefinition(weaponId) {
  return WEAPON_DEFINITIONS[weaponId] ?? null;
}
export function getEquipmentDefinition(itemId) {
  return EQUIPMENT_DEFINITIONS[itemId] ?? null;
}
export function getItemDefinition(itemId) {
  return WEAPON_DEFINITIONS[itemId] ?? EQUIPMENT_DEFINITIONS[itemId] ?? null;
}
