/**
 * Turns weapon ids into runtime instances and answers "may this class use it?".
 * The only place that reads the weapon database directly.
 */
import { Weapon } from './Weapon.js';
import {
  WEAPON_DEFINITIONS, getWeaponDefinition, getEquipmentDefinition, getItemDefinition,
} from '../../config/weapons.config.js';
import { getClassDefinition } from '../../config/classes.config.js';

export const WeaponFactory = {
  create(weaponId) {
    const def = getWeaponDefinition(weaponId);
    if (!def) throw new Error(`Unknown weapon id: ${weaponId}`);
    return new Weapon(def);
  },

  exists(itemId) { return getItemDefinition(itemId) != null; },
  isEquipment(itemId) { return getEquipmentDefinition(itemId) != null; },
  definition(itemId) { return getItemDefinition(itemId); },

  /** Class restrictions: category allow-list plus an optional per-weapon list. */
  isAllowedForClass(itemId, classId) {
    const item = getItemDefinition(itemId);
    if (!item) return false;
    const classDef = getClassDefinition(classId);
    if (Array.isArray(item.allowedClasses) && !item.allowedClasses.includes(classId)) return false;
    return classDef.allowedCategories.includes(item.category);
  },

  /** All weapon ids a class may buy, grouped by category. */
  listForClass(classId) {
    const classDef = getClassDefinition(classId);
    return Object.values(WEAPON_DEFINITIONS).filter(
      (w) => classDef.allowedCategories.includes(w.category) &&
        (!Array.isArray(w.allowedClasses) || w.allowedClasses.includes(classId)),
    );
  },
};
