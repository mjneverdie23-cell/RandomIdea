/**
 * Dinosaur character classes.
 *
 * A class is pure data: stats, allowed gear, abilities and a *visual key*. The
 * visual key is all the render layer needs to pick a model, so swapping the
 * capsule placeholder for a rigged dinosaur never touches gameplay code
 * (see src/render/ModelRegistry.js).
 *
 * TO ADD A CLASS: append an entry here and, optionally, register a model
 * factory + abilities. Nothing else in the codebase needs to change.
 */

export const ClassId = Object.freeze({
  TANK: 'TANK',
  SNIPER: 'SNIPER',
  ASSASSIN: 'ASSASSIN',
  RANGER: 'RANGER',
  BRUISER: 'BRUISER',
});

/** Weapon categories a class may buy. Mirrors WeaponCategory in weapons.config.js. */
export const CLASS_DEFINITIONS = Object.freeze({
  [ClassId.TANK]: {
    id: ClassId.TANK,
    displayName: 'Ankylo',
    species: 'Ankylosaurus',
    role: 'Tank',
    description: 'Armoured wall. Soaks damage, holds chokes, breaks sites open.',
    stats: {
      maxHealth: 150,
      maxArmor: 100,
      startingArmor: 25,          // natural plating, free every round
      hasHelmetByDefault: false,
      moveSpeed: 4.6,             // units/second, base walking speed
      jumpVelocity: 6.4,
      damageTakenMultiplier: 0.85,
      damageDealtMultiplier: 1.0,
      hitboxRadius: 0.62,
      hitboxHeight: 1.95,
      eyeHeightFraction: 0.86,
    },
    allowedCategories: ['PISTOL', 'SHOTGUN', 'LMG', 'RIFLE', 'MELEE', 'EQUIPMENT'],
    defaultLoadout: { primary: null, secondary: 'pistol_scav', melee: 'melee_claws' },
    abilities: ['ability_bulwark', 'ability_tail_slam'],
    /** Render hint only - never read by gameplay systems. */
    visual: { modelKey: 'dino_ankylo', color: 0x5a7d5a, scale: 1.15 },
    botPreference: { buyPriority: ['lmg_thunder', 'shotgun_maw', 'rifle_apex'] },
  },

  [ClassId.SNIPER]: {
    id: ClassId.SNIPER,
    displayName: 'Ptera',
    species: 'Pteranodon',
    role: 'Sniper',
    description: 'Long-range specialist. Fragile, deadly at distance, terrible up close.',
    stats: {
      maxHealth: 90,
      maxArmor: 100,
      startingArmor: 0,
      hasHelmetByDefault: false,
      moveSpeed: 5.2,
      jumpVelocity: 7.4,
      damageTakenMultiplier: 1.1,
      damageDealtMultiplier: 1.0,
      hitboxRadius: 0.5,
      hitboxHeight: 1.8,
      eyeHeightFraction: 0.88,
    },
    allowedCategories: ['PISTOL', 'SNIPER', 'RIFLE', 'MELEE', 'EQUIPMENT'],
    defaultLoadout: { primary: null, secondary: 'pistol_scav', melee: 'melee_claws' },
    abilities: ['ability_hawk_eye', 'ability_glide'],
    visual: { modelKey: 'dino_ptera', color: 0x7a6fb0, scale: 1.0 },
    botPreference: { buyPriority: ['sniper_longneck', 'sniper_horizon', 'rifle_ranger'] },
  },

  [ClassId.ASSASSIN]: {
    id: ClassId.ASSASSIN,
    displayName: 'Raptor',
    species: 'Velociraptor',
    role: 'Assassin',
    description: 'Fast flanker. Wins duels it starts, loses the ones it does not.',
    stats: {
      maxHealth: 85,
      maxArmor: 75,
      startingArmor: 0,
      hasHelmetByDefault: false,
      moveSpeed: 6.6,
      jumpVelocity: 7.8,
      damageTakenMultiplier: 1.12,
      damageDealtMultiplier: 1.08,
      hitboxRadius: 0.46,
      hitboxHeight: 1.65,
      eyeHeightFraction: 0.9,
    },
    allowedCategories: ['PISTOL', 'SMG', 'SHOTGUN', 'MELEE', 'EQUIPMENT'],
    defaultLoadout: { primary: null, secondary: 'pistol_dart', melee: 'melee_claws' },
    abilities: ['ability_pounce', 'ability_camouflage'],
    visual: { modelKey: 'dino_raptor', color: 0xc08a3e, scale: 0.92 },
    botPreference: { buyPriority: ['smg_swarm', 'shotgun_maw', 'smg_needler'] },
  },

  [ClassId.RANGER]: {
    id: ClassId.RANGER,
    displayName: 'Para',
    species: 'Parasaurolophus',
    role: 'Ranger',
    description: 'All-rounder with map awareness. Scans, supports, holds angles.',
    stats: {
      maxHealth: 110,
      maxArmor: 100,
      startingArmor: 0,
      hasHelmetByDefault: false,
      moveSpeed: 5.6,
      jumpVelocity: 7.0,
      damageTakenMultiplier: 1.0,
      damageDealtMultiplier: 1.0,
      hitboxRadius: 0.52,
      hitboxHeight: 1.85,
      eyeHeightFraction: 0.88,
    },
    allowedCategories: ['PISTOL', 'RIFLE', 'SMG', 'SNIPER', 'MELEE', 'EQUIPMENT'],
    defaultLoadout: { primary: null, secondary: 'pistol_scav', melee: 'melee_claws' },
    abilities: ['ability_echo_call', 'ability_field_dressing'],
    visual: { modelKey: 'dino_para', color: 0x3f8fb5, scale: 1.0 },
    botPreference: { buyPriority: ['rifle_ranger', 'rifle_apex', 'smg_swarm'] },
  },

  [ClassId.BRUISER]: {
    id: ClassId.BRUISER,
    displayName: 'Rex',
    species: 'Tyrannosaurus',
    role: 'Bruiser',
    description: 'Mid-range brawler. Trades hard, buffs allies, terrifies sites.',
    stats: {
      maxHealth: 125,
      maxArmor: 100,
      startingArmor: 0,
      hasHelmetByDefault: false,
      moveSpeed: 5.1,
      jumpVelocity: 6.8,
      damageTakenMultiplier: 0.95,
      damageDealtMultiplier: 1.05,
      hitboxRadius: 0.58,
      hitboxHeight: 1.9,
      eyeHeightFraction: 0.87,
    },
    allowedCategories: ['PISTOL', 'RIFLE', 'SHOTGUN', 'LMG', 'MELEE', 'EQUIPMENT'],
    defaultLoadout: { primary: null, secondary: 'pistol_talon', melee: 'melee_claws' },
    abilities: ['ability_roar', 'ability_charge'],
    visual: { modelKey: 'dino_rex', color: 0xb0503f, scale: 1.08 },
    botPreference: { buyPriority: ['rifle_bulwark', 'shotgun_maw', 'rifle_ranger'] },
  },
});

export const CLASS_IDS = Object.freeze(Object.keys(CLASS_DEFINITIONS));

/** Fallback used when a saved/invalid class id shows up. */
export const DEFAULT_CLASS_ID = ClassId.RANGER;

export function getClassDefinition(classId) {
  return CLASS_DEFINITIONS[classId] ?? CLASS_DEFINITIONS[DEFAULT_CLASS_ID];
}
