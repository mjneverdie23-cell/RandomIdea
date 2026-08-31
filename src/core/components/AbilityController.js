/**
 * Per-character ability slots: cooldowns, charges and activation.
 *
 * Abilities themselves are data (abilities.config.js); this controller only
 * decides *whether* one may run and builds the sandboxed context it runs with.
 */
import { getAbilityDefinition } from '../../config/abilities.config.js';
import { GameEvents } from '../events/GameEvents.js';

export class AbilityController {
  constructor(character) {
    this.character = character;
    /** @type {Array<{id:string, def:object, cooldownRemaining:number, chargesLeft:number, activeRemaining:number}>} */
    this.slots = [];
  }

  /** Rebuilds the slots from the character's class definition. */
  setAbilities(abilityIds = []) {
    this.slots = abilityIds
      .map((id) => ({ id, def: getAbilityDefinition(id) }))
      .filter((slot) => slot.def != null)
      .map((slot) => ({
        ...slot,
        cooldownRemaining: 0,
        chargesLeft: slot.def.chargesPerRound ?? Infinity,
        activeRemaining: 0,
      }));
  }

  getSlot(index) { return this.slots[index] ?? null; }

  isReady(index) {
    const slot = this.slots[index];
    return !!slot && slot.cooldownRemaining <= 0 && slot.chargesLeft > 0 && this.character.health.alive;
  }

  /**
   * @param {number} index slot index (0 = primary)
   * @param {object} context { bus, world, combat, random, time }
   */
  activate(index, context) {
    if (!this.isReady(index)) return false;
    const slot = this.slots[index];
    slot.cooldownRemaining = slot.def.cooldown ?? 0;
    if (slot.chargesLeft !== Infinity) slot.chargesLeft -= 1;
    slot.activeRemaining = slot.def.duration ?? 0;

    slot.def.onActivate?.({ ...context, character: this.character });
    context.bus?.emit(GameEvents.ABILITY_USED, { character: this.character, abilityId: slot.id });
    return true;
  }

  update(dt, context) {
    for (const slot of this.slots) {
      if (slot.cooldownRemaining > 0) slot.cooldownRemaining = Math.max(0, slot.cooldownRemaining - dt);
      if (slot.activeRemaining > 0) {
        slot.activeRemaining -= dt;
        if (slot.activeRemaining <= 0) {
          slot.def.onEnd?.({ ...context, character: this.character });
          context.bus?.emit(GameEvents.ABILITY_ENDED, { character: this.character, abilityId: slot.id });
        }
      }
    }
  }

  /** Round reset: cooldowns cleared, charges restored. */
  resetForRound() {
    for (const slot of this.slots) {
      slot.cooldownRemaining = 0;
      slot.activeRemaining = 0;
      slot.chargesLeft = slot.def.chargesPerRound ?? Infinity;
    }
  }

  /** Snapshot for the HUD. */
  describe() {
    return this.slots.map((slot, index) => ({
      index,
      id: slot.id,
      name: slot.def.displayName,
      description: slot.def.description,
      cooldown: slot.def.cooldown ?? 0,
      cooldownRemaining: slot.cooldownRemaining,
      ready: this.isReady(index),
      charges: slot.chargesLeft,
    }));
  }
}
