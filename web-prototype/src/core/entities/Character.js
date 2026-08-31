/**
 * A playing character - player or bot, any dinosaur class.
 *
 * The character is a *composition* of components (health, inventory, movement,
 * effects, abilities) plus transform state. It has no rendering, no input and
 * no knowledge of rounds: the render layer reads `visual` and the transform,
 * input writes `intent`, and the round systems call the reset helpers.
 */
import { Health } from '../components/Health.js';
import { Inventory } from '../components/Inventory.js';
import { MovementController } from '../components/MovementController.js';
import { EffectController } from '../components/EffectController.js';
import { AbilityController } from '../components/AbilityController.js';
import { createIntent } from '../components/Intent.js';
import { getClassDefinition, DEFAULT_CLASS_ID } from '../../config/classes.config.js';
import { CombatConfig } from '../../config/gameplay.config.js';
import * as V3 from '../math/vec3.js';

let nextCharacterId = 1;

export class Character {
  constructor({ name = 'Dino', teamId = null, classId = DEFAULT_CLASS_ID, isBot = false, botDifficulty = null } = {}) {
    this.id = `char_${nextCharacterId++}`;
    this.name = name;
    this.teamId = teamId;
    this.isBot = isBot;
    this.botDifficulty = botDifficulty;

    // --- transform ---------------------------------------------------------
    this.position = V3.v3(0, 0, 0);   // feet position
    this.velocity = V3.v3(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;

    // --- components --------------------------------------------------------
    this.health = new Health();
    this.inventory = new Inventory(this);
    this.movement = new MovementController(this);
    this.effects = new EffectController(this);
    this.abilities = new AbilityController(this);
    this.intent = createIntent();

    // --- gameplay state ----------------------------------------------------
    this.frozen = false;              // buy phase / round start freeze
    this.money = 0;
    this.score = { kills: 0, deaths: 0, assists: 0, damageDealt: 0, plants: 0, defuses: 0 };
    /** Damage taken per attacker this round, for assist attribution. */
    this.damageTakenFrom = new Map();
    this.revealedUntilTime = 0;       // set by scan abilities
    this.lastDamageTime = -Infinity;
    this.respawnTimer = 0;

    this.classId = null;
    this.applyClass(classId);
  }

  // ------------------------------------------------------------------ class --
  /** Applies (or swaps) the dinosaur class: stats, hitbox, abilities, visuals. */
  applyClass(classId) {
    const def = getClassDefinition(classId);
    this.classId = def.id;
    this.classDef = def;
    this.stats = { ...def.stats };
    this.standingHeight = def.stats.hitboxHeight;
    this.height = this.standingHeight;
    this.radius = def.stats.hitboxRadius;
    /** Render-only hint. Gameplay never reads this. */
    this.visual = { ...def.visual };

    this.health = new Health({
      maxHealth: def.stats.maxHealth,
      maxArmor: def.stats.maxArmor,
      armor: def.stats.startingArmor,
      hasHelmet: def.stats.hasHelmetByDefault,
      armorDamageFraction: CombatConfig.armorDamageFraction,
      helmetHeadshotReduction: CombatConfig.helmetHeadshotReduction,
    });
    this.abilities.setAbilities(def.abilities);
    this.inventory.resetForRound({ keepWeapons: false, defaultLoadout: def.defaultLoadout });
  }

  // -------------------------------------------------------------- transform --
  get eyeHeight() { return this.height * this.stats.eyeHeightFraction; }

  get eyePosition() {
    return { x: this.position.x, y: this.position.y + this.eyeHeight, z: this.position.z };
  }

  get centerPosition() {
    return { x: this.position.x, y: this.position.y + this.height * 0.5, z: this.position.z };
  }

  get lookDirection() { return V3.dirFromAngles(this.yaw, this.pitch); }

  get alive() { return this.health.alive; }

  get isMoving() { return this.movement.horizontalSpeed > 0.2; }

  get isInvisible() { return this.effects.modifiers.invisible; }

  // ------------------------------------------------------------------ state --
  revealUntil(time) { this.revealedUntilTime = Math.max(this.revealedUntilTime, time); }
  isRevealed(time) { return time < this.revealedUntilTime; }

  /** Wired by GameManager so fall damage flows through the normal damage path. */
  onFallDamage = null;

  spawnAt(position, yaw) {
    this.position = { x: position.x, y: position.y, z: position.z };
    this.velocity = V3.v3(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.intent.yaw = yaw;
    this.intent.pitch = 0;
    this.movement.reset();
    this.height = this.standingHeight;
  }

  /**
   * Round reset. `keepWeapons` mirrors the CS convention of carrying gear
   * across rounds while consumables and status are wiped.
   */
  resetForRound({ keepWeapons = true } = {}) {
    this.health.reset({
      maxHealth: this.stats.maxHealth,
      maxArmor: this.stats.maxArmor,
      armor: this.stats.startingArmor,
      hasHelmet: this.stats.hasHelmetByDefault,
    });
    this.inventory.resetForRound({ keepWeapons, defaultLoadout: this.classDef.defaultLoadout });
    this.abilities.resetForRound();
    this.effects.clear();
    this.damageTakenFrom.clear();
    this.revealedUntilTime = 0;
    this.frozen = false;
    this.respawnTimer = 0;
  }

  /** Compact snapshot used by the HUD, scoreboard and bots. */
  describe() {
    const weapon = this.inventory.activeWeapon;
    return {
      id: this.id,
      name: this.name,
      teamId: this.teamId,
      classId: this.classId,
      className: this.classDef.displayName,
      role: this.classDef.role,
      isBot: this.isBot,
      alive: this.alive,
      health: Math.ceil(this.health.health),
      maxHealth: this.health.maxHealth,
      armor: Math.ceil(this.health.armor),
      hasHelmet: this.health.hasHelmet,
      money: this.money,
      score: { ...this.score },
      weapon: weapon ? {
        id: weapon.id,
        name: weapon.displayName,
        category: weapon.category,
        ammoInMag: weapon.ammoInMag,
        reserveAmmo: weapon.reserveAmmo,
        reloading: weapon.reloading,
        reloadProgress: weapon.reloading ? 1 - weapon.reloadRemaining / weapon.def.reloadTime : 0,
      } : null,
      inventory: this.inventory.describe(),
      abilities: this.abilities.describe(),
    };
  }
}
