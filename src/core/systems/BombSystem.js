/**
 * The objective: carrying, dropping, picking up, planting, defusing and
 * detonating the bomb.
 *
 * BombSystem owns the bomb's state machine and emits events; it never decides
 * who wins - RoundManager listens and applies the round rules. Timings and
 * radii come from BombConfig.
 */
import { BombConfig, Side } from '../../config/gameplay.config.js';
import { GameEvents } from '../events/GameEvents.js';
import { containsPointXZ } from '../math/aabb.js';
import * as V3 from '../math/vec3.js';

export const BombState = Object.freeze({
  CARRIED: 'CARRIED',
  DROPPED: 'DROPPED',
  PLANTED: 'PLANTED',
  DEFUSED: 'DEFUSED',
  EXPLODED: 'EXPLODED',
});

export class BombSystem {
  constructor({ world, bus, teams, combat, random, config = BombConfig }) {
    this.world = world;
    this.bus = bus;
    this.teams = teams;
    this.combat = combat;
    this.random = random;
    this.config = config;

    this.state = BombState.CARRIED;
    /** @type {import('../entities/Character.js').Character|null} */
    this.carrier = null;
    this.position = V3.v3(0, 0, 0);
    this.siteId = null;
    this.fuseRemaining = 0;
    this.planter = null;

    // Interaction progress (0..1 of the required duration)
    this.plantProgress = 0;
    this.planting = null;
    this.defuseProgress = 0;
    this.defusing = null;
    this.defuseDuration = config.defuseDuration;

    this._enabled = false;   // set true by RoundManager while the round is live
    this._lastBeep = 0;

    bus.on(GameEvents.CHARACTER_DIED, ({ victim }) => this._onCharacterDied(victim));
  }

  get isPlanted() { return this.state === BombState.PLANTED; }
  get isCarried() { return this.state === BombState.CARRIED; }
  get isDropped() { return this.state === BombState.DROPPED; }

  setEnabled(enabled) { this._enabled = enabled; }

  /** Round setup: hand the bomb to a random member of the attacking side. */
  assignToRandomAttacker() {
    this.reset();
    const attackers = this.teams.membersOnSide(this.config.carrierSide ?? Side.ATTACKERS, { aliveOnly: true });
    if (attackers.length === 0) return null;
    const carrier = attackers[this.random.int(0, attackers.length - 1)];
    this.giveTo(carrier);
    return carrier;
  }

  giveTo(character) {
    this.carrier = character;
    character.inventory.hasBomb = true;
    this.state = BombState.CARRIED;
    this.position = { ...character.position };
    this.bus.emit(GameEvents.BOMB_PICKED_UP, { character });
  }

  drop(fromCharacter) {
    if (this.carrier !== fromCharacter) return;
    this.carrier.inventory.hasBomb = false;
    this.position = { ...fromCharacter.position };
    this.carrier = null;
    this.state = BombState.DROPPED;
    this.cancelPlant();
    this.bus.emit(GameEvents.BOMB_DROPPED, { position: this.position, character: fromCharacter });
  }

  reset() {
    if (this.carrier) this.carrier.inventory.hasBomb = false;
    this.carrier = null;
    this.state = BombState.CARRIED;
    this.siteId = null;
    this.fuseRemaining = 0;
    this.planter = null;
    this.plantProgress = 0;
    this.planting = null;
    this.defuseProgress = 0;
    this.defusing = null;
    this._lastBeep = 0;
  }

  /** Which bomb site (if any) a position is standing in. */
  siteAt(position) {
    for (const site of this.world.map.bombSites) {
      if (containsPointXZ(site.zone, position) &&
          position.y <= site.zone.min.y + this.config.plantMaxHeightAboveSite) {
        return site;
      }
    }
    return null;
  }

  canPlant(character) {
    if (!this._enabled || this.state !== BombState.CARRIED) return false;
    if (this.carrier !== character || !character.health.alive) return false;
    if (!character.movement.onGround) return false;
    return this.siteAt(character.position) != null;
  }

  canDefuse(character) {
    if (!this._enabled || this.state !== BombState.PLANTED) return false;
    if (!character.health.alive) return false;
    if (this.teams.sideOf(character.teamId) !== Side.DEFENDERS) return false;
    return V3.distanceXZ(character.position, this.position) <= this.config.interactRadius &&
      Math.abs(character.position.y - this.position.y) < 2.5;
  }

  canPickUp(character) {
    if (!this._enabled || this.state !== BombState.DROPPED) return false;
    if (this.teams.sideOf(character.teamId) !== Side.ATTACKERS) return false;
    return V3.distance(character.position, this.position) <= this.config.pickupRadius;
  }

  /**
   * Called every tick with the character's `use` intent.
   * Handles plant, defuse and pickup depending on context.
   */
  handleUse(character, held) {
    if (!this._enabled) return;

    if (this.state === BombState.DROPPED && held && this.canPickUp(character)) {
      this.giveTo(character);
      return;
    }

    if (this.state === BombState.CARRIED && this.carrier === character) {
      if (held && this.canPlant(character)) {
        if (this.planting !== character) {
          this.planting = character;
          this.plantProgress = 0;
          this.bus.emit(GameEvents.BOMB_PLANT_STARTED, {
            character, siteId: this.siteAt(character.position)?.id ?? null,
          });
        }
      } else if (this.planting === character) {
        this.cancelPlant();
      }
      return;
    }

    if (this.state === BombState.PLANTED) {
      if (held && this.canDefuse(character)) {
        if (this.defusing !== character) {
          this.defusing = character;
          this.defuseProgress = 0;
          this.defuseDuration = character.inventory.hasDefuseKit
            ? this.config.defuseDurationWithKit
            : this.config.defuseDuration;
          this.bus.emit(GameEvents.BOMB_DEFUSE_STARTED, { character, duration: this.defuseDuration });
        }
      } else if (this.defusing === character) {
        this.cancelDefuse();
      }
    }
  }

  cancelPlant() {
    if (this.planting) this.bus.emit(GameEvents.BOMB_PLANT_ABORTED, { character: this.planting });
    this.planting = null;
    this.plantProgress = 0;
  }

  cancelDefuse() {
    if (this.defusing) this.bus.emit(GameEvents.BOMB_DEFUSE_ABORTED, { character: this.defusing });
    this.defusing = null;
    this.defuseProgress = 0;
  }

  update(dt) {
    if (!this._enabled) return;

    // Bomb follows its carrier.
    if (this.state === BombState.CARRIED && this.carrier) {
      this.position = { ...this.carrier.position };
    }

    // --- planting -----------------------------------------------------------
    if (this.planting) {
      const character = this.planting;
      const stillValid = this.canPlant(character) && character.intent.use;
      if (!stillValid) {
        this.cancelPlant();
      } else {
        this.plantProgress += dt / this.config.plantDuration;
        if (this.plantProgress >= 1) this._completePlant(character);
      }
    }

    // --- ticking ------------------------------------------------------------
    if (this.state === BombState.PLANTED) {
      this.fuseRemaining -= dt;
      // Beeps accelerate as the fuse runs down - a cue the audio layer uses.
      const interval = Math.max(0.12, (this.fuseRemaining / this.config.fuseDuration) * 1.4);
      this._lastBeep += dt;
      if (this._lastBeep >= interval) {
        this._lastBeep = 0;
        this.bus.emit('bomb:beep', { fuseRemaining: this.fuseRemaining, position: this.position });
      }

      if (this.defusing) {
        const character = this.defusing;
        const stillValid = this.canDefuse(character) && character.intent.use;
        if (!stillValid) {
          this.cancelDefuse();
        } else {
          this.defuseProgress += dt / this.defuseDuration;
          if (this.defuseProgress >= 1) this._completeDefuse(character);
        }
      }

      if (this.state === BombState.PLANTED && this.fuseRemaining <= 0) this._detonate();
    }
  }

  _completePlant(character) {
    const site = this.siteAt(character.position);
    this.state = BombState.PLANTED;
    this.siteId = site?.id ?? null;
    this.position = { x: character.position.x, y: character.position.y, z: character.position.z };
    this.fuseRemaining = this.config.fuseDuration;
    this.planter = character;
    this.planting = null;
    this.plantProgress = 0;
    character.inventory.hasBomb = false;
    character.score.plants += 1;
    this.carrier = null;
    this.bus.emit(GameEvents.BOMB_PLANTED, { character, siteId: this.siteId, position: this.position });
  }

  _completeDefuse(character) {
    this.state = BombState.DEFUSED;
    this.defusing = null;
    this.defuseProgress = 0;
    character.score.defuses += 1;
    this.bus.emit(GameEvents.BOMB_DEFUSED, { character });
  }

  _detonate() {
    this.state = BombState.EXPLODED;
    const { explosionRadius, explosionDamage, explosionMinDamageFraction } = this.config;
    for (const character of this.world.aliveCharacters) {
      const distance = V3.distance(character.centerPosition, this.position);
      if (distance > explosionRadius) continue;
      const falloff = Math.max(explosionMinDamageFraction, 1 - distance / explosionRadius);
      this.combat.applyDamage({
        target: character, attacker: this.planter, amount: explosionDamage * falloff,
        source: 'bomb', armorPenetration: 0.9,
      });
    }
    this.bus.emit(GameEvents.BOMB_EXPLODED, { position: this.position, siteId: this.siteId });
  }

  _onCharacterDied(victim) {
    if (this.carrier === victim) this.drop(victim);
    if (this.planting === victim) this.cancelPlant();
    if (this.defusing === victim) this.cancelDefuse();
  }

  /** Snapshot for the HUD and for bots. */
  describe() {
    return {
      state: this.state,
      siteId: this.siteId,
      carrierId: this.carrier?.id ?? null,
      carrierName: this.carrier?.name ?? null,
      position: { ...this.position },
      fuseRemaining: Math.max(0, this.fuseRemaining),
      fuseDuration: this.config.fuseDuration,
      plantProgress: this.plantProgress,
      defuseProgress: this.defuseProgress,
      defuserName: this.defusing?.name ?? null,
      defuseDuration: this.defuseDuration,
    };
  }
}
