/**
 * Shooting, damage and grenades.
 *
 * Everything that can reduce a character's health flows through
 * `applyDamage()` - weapons, explosions, abilities, fall damage - so kill
 * attribution, assists, events and rewards only have to be implemented once.
 */
import { CombatConfig } from '../../config/gameplay.config.js';
import { EQUIPMENT_DEFINITIONS } from '../../config/weapons.config.js';
import { GameEvents } from '../events/GameEvents.js';
import { HitZone } from '../world/World.js';
import * as V3 from '../math/vec3.js';

const DEG2RAD = Math.PI / 180;

export class CombatSystem {
  /**
   * @param {object} deps { world, bus, random, config }
   */
  constructor({ world, bus, random, config = CombatConfig }) {
    this.world = world;
    this.bus = bus;
    this.random = random;
    this.config = config;
    /** Set by RoundManager: while false, triggers do nothing (freeze time). */
    this.combatEnabled = true;
  }

  // ------------------------------------------------------------------ firing --
  /**
   * Attempt to fire the character's active weapon. Safe to call every tick with
   * the trigger held - the weapon's own cooldown/fire-mode rules gate it.
   */
  tryFire(character) {
    if (!this.combatEnabled || character.frozen || !character.health.alive) return false;
    const weapon = character.inventory.activeWeapon;
    if (!weapon) return false;

    if (!weapon.canFire()) {
      if (weapon.isEmpty && weapon.fireCooldown <= 0 && !weapon.reloading) {
        this.bus.emit(GameEvents.WEAPON_DRY_FIRE, { character, weapon });
        weapon.fireCooldown = 0.25;
        // Auto-reload keeps the prototype pleasant to play.
        if (weapon.canReload) this.startReload(character);
      }
      return false;
    }

    weapon.consumeShot();
    character.effects.notifyFired();

    const origin = character.eyePosition;
    const baseDirection = this._aimDirection(character, weapon);
    this.bus.emit(GameEvents.WEAPON_FIRED, { character, weapon, origin, direction: baseDirection });

    const spreadDegrees = this.computeSpread(character, weapon);
    const pellets = weapon.def.pellets ?? 1;
    for (let i = 0; i < pellets; i++) {
      const direction = this._applySpread(baseDirection, spreadDegrees);
      this._resolveShot(character, weapon, origin, direction);
    }

    weapon.applyRecoil(this.random);
    return true;
  }

  /** Aim direction including accumulated recoil. */
  _aimDirection(character, weapon) {
    const pitch = character.pitch + weapon.recoilPitch * DEG2RAD;
    const yaw = character.yaw + weapon.recoilYaw * DEG2RAD;
    return V3.dirFromAngles(yaw, pitch);
  }

  /** Cone spread in degrees for the character's current state. */
  computeSpread(character, weapon) {
    const s = weapon.def.spread;
    let spread = s.base;
    spread += s.moving * character.movement.movementFraction;
    if (!character.movement.onGround) spread += s.jumping;
    if (character.movement.crouching) spread += s.crouching;
    if (character.intent.aim) spread += s.ads;
    // Sustained fire opens the cone up.
    spread += Math.min(3, weapon.shotsInSpray * 0.08);
    spread *= character.effects.modifiers.spreadMultiplier;
    return Math.max(0, spread);
  }

  _applySpread(direction, spreadDegrees) {
    if (spreadDegrees <= 0) return direction;
    // Random point in a cone: uniform angle, sqrt-distributed radius.
    const angle = this.random.range(0, Math.PI * 2);
    const radius = Math.sqrt(this.random.next()) * spreadDegrees * DEG2RAD;
    const up = Math.abs(direction.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const right = V3.normalize(V3.cross(direction, up));
    const trueUp = V3.cross(right, direction);
    const offset = V3.add(V3.mul(right, Math.cos(angle) * radius), V3.mul(trueUp, Math.sin(angle) * radius));
    return V3.normalize(V3.add(direction, offset));
  }

  _resolveShot(attacker, weapon, origin, direction) {
    const maxDistance = weapon.def.range;
    const hit = this.world.raycast(origin, direction, maxDistance, { ignore: [attacker] });

    if (!hit) {
      this.bus.emit(GameEvents.WEAPON_HIT, {
        character: attacker, weapon, point: V3.add(origin, V3.mul(direction, maxDistance)),
        target: null, hitZone: null, missed: true,
      });
      return;
    }

    if (hit.type === 'map') {
      this.bus.emit(GameEvents.WEAPON_HIT, {
        character: attacker, weapon, point: hit.point, target: null, hitZone: null, surface: hit.collider?.kind,
      });
      return;
    }

    const target = hit.character;
    const zoneConfig = this.config.hitZones[hit.hitZone] ?? this.config.hitZones.CHEST;
    const isHeadshot = hit.hitZone === HitZone.HEAD;

    let damage = weapon.def.damage;
    damage *= this._falloffMultiplier(weapon, hit.distance);
    damage *= zoneConfig.damageMultiplier;
    if (zoneConfig.useWeaponHeadshotMultiplier) damage *= weapon.def.headshotMultiplier;

    this.applyDamage({
      target, attacker, amount: damage, source: weapon.id, hitZone: hit.hitZone,
      isHeadshot, armorPenetration: weapon.def.armorPenetration, point: hit.point,
    });

    this.bus.emit(GameEvents.WEAPON_HIT, {
      character: attacker, weapon, point: hit.point, target, hitZone: hit.hitZone, isHeadshot,
    });
  }

  _falloffMultiplier(weapon, distance) {
    const { falloffStart, falloffEnd, falloffMinMultiplier } = weapon.def;
    if (distance <= falloffStart) return 1;
    if (distance >= falloffEnd) return falloffMinMultiplier;
    const t = (distance - falloffStart) / Math.max(0.001, falloffEnd - falloffStart);
    return 1 + (falloffMinMultiplier - 1) * t;
  }

  // ------------------------------------------------------------------ damage --
  /**
   * The single damage entry point.
   * @param {object} params { target, attacker, amount, source, hitZone, isHeadshot, armorPenetration }
   * @returns {number} health actually removed
   */
  applyDamage({ target, attacker = null, amount, source = 'unknown', hitZone = HitZone.CHEST, isHeadshot = false, armorPenetration = 1, point = null }) {
    if (!target?.health.alive || amount <= 0) return 0;

    const sameTeam = attacker && attacker !== target && attacker.teamId === target.teamId;
    if (sameTeam && !this.config.friendlyFire) return 0;

    let finalAmount = amount;
    if (attacker) {
      finalAmount *= attacker.stats.damageDealtMultiplier * attacker.effects.modifiers.damageDealtMultiplier;
    }
    finalAmount *= target.stats.damageTakenMultiplier * target.effects.modifiers.damageTakenMultiplier;
    if (sameTeam) finalAmount *= this.config.friendlyFireMultiplier;

    const result = target.health.takeDamage(finalAmount, { armorPenetration, isHeadshot });
    target.lastDamageTime = this.world.time;

    if (attacker && attacker !== target) {
      attacker.score.damageDealt += result.healthDamage;
      target.damageTakenFrom.set(attacker, (target.damageTakenFrom.get(attacker) ?? 0) + result.healthDamage);
    }

    this.bus.emit(GameEvents.CHARACTER_DAMAGED, {
      target, attacker, amount: result.healthDamage, armorDamage: result.armorDamage,
      hitZone, weaponId: source, isHeadshot, point,
    });

    if (result.died) this._handleDeath(target, attacker, source, hitZone, isHeadshot);
    return result.healthDamage;
  }

  _handleDeath(victim, attacker, source, hitZone, isHeadshot) {
    victim.score.deaths += 1;
    victim.frozen = false;
    victim.effects.clear();

    if (attacker && attacker !== victim) {
      if (attacker.teamId === victim.teamId) attacker.score.kills -= 1;
      else attacker.score.kills += 1;
    }

    // Assists: anyone else who did meaningful damage to the victim this round.
    for (const [contributor, damage] of victim.damageTakenFrom) {
      if (contributor !== attacker && contributor.teamId !== victim.teamId && damage >= 40) {
        contributor.score.assists += 1;
      }
    }

    this.bus.emit(GameEvents.CHARACTER_DIED, {
      victim, attacker, weaponId: source, hitZone, isHeadshot,
    });
    this.bus.emit(GameEvents.KILL_FEED, {
      attackerName: attacker?.name ?? 'World',
      attackerTeam: attacker?.teamId ?? null,
      victimName: victim.name,
      victimTeam: victim.teamId,
      weaponId: source,
      headshot: isHeadshot,
    });
  }

  // ------------------------------------------------------------------ reload --
  startReload(character) {
    const weapon = character.inventory.activeWeapon;
    if (!weapon || !weapon.canReload) return false;
    if (weapon.startReload()) {
      this.bus.emit(GameEvents.WEAPON_RELOAD_STARTED, { character, weapon });
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- grenades --
  /** Throws the character's next grenade in the direction they are looking. */
  throwGrenade(character) {
    if (!this.combatEnabled || character.frozen || !character.health.alive) return false;
    const itemId = character.inventory.takeGrenade();
    if (!itemId) return false;

    const definition = EQUIPMENT_DEFINITIONS[itemId]?.grenade;
    if (!definition) return false;

    const direction = V3.dirFromAngles(character.yaw, character.pitch + 0.12);
    const grenade = {
      id: `nade_${Math.round(this.world.time * 1000)}_${character.id}`,
      itemId,
      owner: character,
      teamId: character.teamId,
      definition,
      position: V3.add(character.eyePosition, V3.mul(direction, 0.6)),
      velocity: V3.add(V3.mul(direction, definition.throwSpeed), V3.mul(character.velocity, 0.5)),
      fuseRemaining: definition.fuseTime,
      radius: 0.18,
    };
    this.world.projectiles.push(grenade);
    this.bus.emit(GameEvents.GRENADE_THROWN, { character, grenade });
    return true;
  }

  updateProjectiles(dt) {
    const gravity = -22;
    for (let i = this.world.projectiles.length - 1; i >= 0; i--) {
      const grenade = this.world.projectiles[i];
      grenade.velocity.y += gravity * grenade.definition.gravityScale * dt;

      const next = V3.add(grenade.position, V3.mul(grenade.velocity, dt));
      const delta = V3.sub(next, grenade.position);
      const travel = V3.length(delta);
      if (travel > 0.0001) {
        const direction = V3.mul(delta, 1 / travel);
        const hit = this.world.raycastMap(grenade.position, direction, travel + grenade.radius);
        if (hit) {
          // Bounce off the surface we hit, dampened.
          const normal = surfaceNormal(hit, direction);
          const bounce = grenade.definition.bounce;
          const dot = V3.dot(grenade.velocity, normal);
          grenade.velocity = V3.mul(V3.sub(grenade.velocity, V3.mul(normal, 2 * dot)), bounce);
          grenade.position = V3.add(hit.point, V3.mul(normal, grenade.radius + 0.02));
        } else {
          grenade.position = next;
        }
      }

      grenade.fuseRemaining -= dt;
      if (grenade.fuseRemaining <= 0) {
        this.explodeGrenade(grenade);
        this.world.projectiles.splice(i, 1);
      }
    }
  }

  explodeGrenade(grenade) {
    const { damage, radius, minDamageFraction } = grenade.definition;
    const victims = this.world.charactersWithin(grenade.position, radius, { aliveOnly: true });
    for (const victim of victims) {
      if (!this.world.hasLineOfSight({ eyePosition: grenade.position }, victim)) continue;
      const distance = V3.distance(victim.centerPosition, grenade.position);
      const falloff = Math.max(minDamageFraction, 1 - distance / radius);
      this.applyDamage({
        target: victim, attacker: grenade.owner, amount: damage * falloff,
        source: grenade.itemId, hitZone: HitZone.CHEST, armorPenetration: 0.5,
      });
    }
    this.bus.emit(GameEvents.GRENADE_EXPLODED, { grenade, position: grenade.position });
  }

  clearProjectiles() { this.world.projectiles.length = 0; }
}

function surfaceNormal(hit, direction) {
  // Approximate the normal from which face of the box the point sits on.
  const box = hit.collider.box;
  const p = hit.point;
  const epsilon = 0.05;
  if (Math.abs(p.x - box.min.x) < epsilon) return { x: -1, y: 0, z: 0 };
  if (Math.abs(p.x - box.max.x) < epsilon) return { x: 1, y: 0, z: 0 };
  if (Math.abs(p.z - box.min.z) < epsilon) return { x: 0, y: 0, z: -1 };
  if (Math.abs(p.z - box.max.z) < epsilon) return { x: 0, y: 0, z: 1 };
  if (Math.abs(p.y - box.max.y) < epsilon) return { x: 0, y: 1, z: 0 };
  if (Math.abs(p.y - box.min.y) < epsilon) return { x: 0, y: -1, z: 0 };
  return V3.mul(direction, -1);
}
