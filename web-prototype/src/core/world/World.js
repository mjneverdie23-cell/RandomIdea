/**
 * The physical world: compiled map geometry, live characters, projectiles and
 * ground pickups, plus every spatial query the game systems need.
 *
 * The World knows nothing about rounds, teams or scoring. It answers questions
 * ("what does this ray hit?", "who is near this point?") and moves things.
 */
import { compileMap } from './MapCompiler.js';
import { overlaps, rayBox, rayVerticalCapsule, containsPoint } from '../math/aabb.js';
import { MovementConfig, CombatConfig } from '../../config/gameplay.config.js';
import * as V3 from '../math/vec3.js';

export const HitZone = Object.freeze({ HEAD: 'HEAD', CHEST: 'CHEST', STOMACH: 'STOMACH', LEGS: 'LEGS' });

export class World {
  constructor(mapData) {
    this.map = compileMap(mapData);
    /** @type {import('../entities/Character.js').Character[]} */
    this.characters = [];
    /** @type {object[]} live grenades */
    this.projectiles = [];
    /** @type {object[]} dropped weapons / the bomb are tracked by their own systems */
    this.pickups = [];
    this.time = 0;
  }

  // ------------------------------------------------------------- entities ---
  addCharacter(character) {
    this.characters.push(character);
    return character;
  }

  removeCharacter(character) {
    const index = this.characters.indexOf(character);
    if (index >= 0) this.characters.splice(index, 1);
  }

  get aliveCharacters() { return this.characters.filter((c) => c.health.alive); }

  charactersOnTeam(teamId, { aliveOnly = true } = {}) {
    return this.characters.filter((c) => c.teamId === teamId && (!aliveOnly || c.health.alive));
  }

  /**
   * @param {object} position
   * @param {number} radius
   * @param {{team?: string, enemyOf?: object, aliveOnly?: boolean}} filter
   */
  charactersWithin(position, radius, { team = null, enemyOf = null, aliveOnly = true } = {}) {
    const radiusSq = radius * radius;
    return this.characters.filter((c) => {
      if (aliveOnly && !c.health.alive) return false;
      if (team && c.teamId !== team) return false;
      if (enemyOf && c.teamId === enemyOf.teamId) return false;
      return V3.distanceSq(c.centerPosition, position) <= radiusSq;
    });
  }

  // ------------------------------------------------------------ collision ---
  characterBox(character, position = character.position, height = character.height) {
    const r = character.radius;
    return {
      min: { x: position.x - r, y: position.y, z: position.z - r },
      max: { x: position.x + r, y: position.y + height, z: position.z + r },
    };
  }

  /** All map colliders overlapping a box. Linear scan - the prototype map is small. */
  collidersOverlapping(box) {
    const out = [];
    for (const collider of this.map.colliders) {
      if (overlaps(box, collider.box)) out.push(collider);
    }
    return out;
  }

  isBoxFree(box) {
    for (const collider of this.map.colliders) {
      if (overlaps(box, collider.box)) return false;
    }
    return true;
  }

  /** Can this character stand up to `height` where it is? */
  hasHeadroom(character, height) {
    return this.isBoxFree(this.characterBox(character, character.position, height));
  }

  /**
   * Moves a character by `delta`, resolving collisions axis by axis and
   * stepping up small obstacles. Mutates `character.position`/`velocity` and
   * updates `movement.onGround`.
   */
  moveCharacter(character, delta, movement) {
    const stepHeight = MovementConfig.stepHeight;

    // --- horizontal, with step-up -------------------------------------------
    for (const axis of ['x', 'z']) {
      const amount = delta[axis];
      if (amount === 0) continue;
      const original = character.position[axis];
      character.position[axis] += amount;

      if (!this.isBoxFree(this.characterBox(character))) {
        // Try again from `stepHeight` higher: that turns stairs and low crates
        // into walkable geometry without a separate "climb" mechanic.
        const originalY = character.position.y;
        character.position.y += stepHeight;
        if (this.isBoxFree(this.characterBox(character))) {
          // Settle back down onto whatever we stepped onto.
          const drop = this._dropToGround(character, stepHeight);
          if (drop === null) {
            character.position.y = originalY;
            character.position[axis] = original;
            character.velocity[axis] = 0;
          } else {
            movement.onGround = true;
            character.velocity.y = Math.max(0, character.velocity.y);
          }
        } else {
          character.position.y = originalY;
          character.position[axis] = original;
          character.velocity[axis] = 0;
        }
      }
    }

    // --- vertical -------------------------------------------------------------
    if (delta.y !== 0) {
      const original = character.position.y;
      character.position.y += delta.y;
      const hits = this.collidersOverlapping(this.characterBox(character));
      if (hits.length > 0) {
        if (delta.y <= 0) {
          // Landing: sit exactly on the highest surface we intersected.
          let highest = -Infinity;
          for (const hit of hits) highest = Math.max(highest, hit.box.max.y);
          character.position.y = highest;
          movement.onGround = true;
        } else {
          // Head bump.
          let lowest = Infinity;
          for (const hit of hits) lowest = Math.min(lowest, hit.box.min.y);
          character.position.y = Math.min(original, lowest - character.height - 0.001);
        }
        character.velocity.y = 0;
      } else if (delta.y < 0) {
        movement.onGround = false;
      }
    }

    // --- ground probe ---------------------------------------------------------
    if (character.velocity.y <= 0.001) {
      const probe = this.characterBox(character);
      probe.min.y -= 0.08;
      probe.max.y = probe.min.y + 0.08;
      movement.onGround = this.collidersOverlapping(probe).length > 0;
    }

    // Keep everything inside the map volume.
    const b = this.map.bounds;
    character.position.x = Math.max(b.min.x + 1, Math.min(b.max.x - 1, character.position.x));
    character.position.z = Math.max(b.min.z + 1, Math.min(b.max.z - 1, character.position.z));
    if (character.position.y < b.min.y) { character.position.y = b.min.y; character.velocity.y = 0; movement.onGround = true; }
  }

  /** Lowers a character up to `maxDrop` until it rests on geometry. */
  _dropToGround(character, maxDrop) {
    const start = character.position.y;
    const stepSize = 0.05;
    for (let dropped = 0; dropped <= maxDrop; dropped += stepSize) {
      character.position.y = start - dropped;
      const below = this.characterBox(character);
      below.min.y -= 0.05;
      below.max.y = below.min.y + 0.05;
      if (this.isBoxFree(this.characterBox(character)) && this.collidersOverlapping(below).length > 0) {
        return character.position.y;
      }
    }
    character.position.y = start;
    return this.isBoxFree(this.characterBox(character)) ? start : null;
  }

  // -------------------------------------------------------------- raycasts ---
  /**
   * Ray against map geometry only.
   * @returns {{distance:number, point:object, collider:object}|null}
   */
  raycastMap(origin, direction, maxDistance = 1000) {
    let best = null;
    for (const collider of this.map.colliders) {
      const distance = rayBox(origin, direction, collider.box, maxDistance);
      if (distance !== null && distance >= 0 && (best === null || distance < best.distance)) {
        best = { distance, collider };
      }
    }
    if (!best) return null;
    return {
      distance: best.distance,
      point: V3.add(origin, V3.mul(direction, best.distance)),
      collider: best.collider,
    };
  }

  /**
   * Full ray: map geometry + character capsules.
   * @param {object} options { ignore: Character[], maxDistance, hitInvisible }
   * @returns {{type:'map'|'character', distance, point, character?, hitZone?, collider?}|null}
   */
  raycast(origin, direction, maxDistance = 1000, { ignore = [], hitInvisible = true } = {}) {
    const mapHit = this.raycastMap(origin, direction, maxDistance);
    let closest = mapHit
      ? { type: 'map', distance: mapHit.distance, point: mapHit.point, collider: mapHit.collider }
      : null;

    for (const character of this.characters) {
      if (!character.health.alive) continue;
      if (ignore.includes(character)) continue;
      if (!hitInvisible && character.isInvisible) continue;

      const distance = rayVerticalCapsule(
        origin, direction, character.position, character.height, character.radius,
        closest ? closest.distance : maxDistance,
      );
      if (distance === null || distance < 0) continue;
      if (closest && distance >= closest.distance) continue;

      const point = V3.add(origin, V3.mul(direction, distance));
      closest = {
        type: 'character',
        distance,
        point,
        character,
        hitZone: this.classifyHitZone(character, point),
      };
    }
    return closest;
  }

  /** Which body part a world-space point corresponds to on a character. */
  classifyHitZone(character, point) {
    const relative = (point.y - character.position.y) / Math.max(0.001, character.height);
    if (relative >= CombatConfig.headZoneFraction) return HitZone.HEAD;
    if (relative >= CombatConfig.stomachZoneFraction) return HitZone.CHEST;
    if (relative >= CombatConfig.legsZoneFraction) return HitZone.STOMACH;
    return HitZone.LEGS;
  }

  /** True when `from` can see `to` (eye to centre of mass, map geometry only). */
  hasLineOfSight(from, to) {
    const origin = from.eyePosition ?? from;
    const target = to.centerPosition ?? to;
    const delta = V3.sub(target, origin);
    const distance = V3.length(delta);
    if (distance < 0.001) return true;
    const direction = V3.mul(delta, 1 / distance);
    const hit = this.raycastMap(origin, direction, distance - 0.05);
    return hit === null;
  }

  /** True when a world point sits inside any solid. */
  isPointSolid(point) {
    for (const collider of this.map.colliders) {
      if (containsPoint(collider.box, point)) return true;
    }
    return false;
  }

  // -------------------------------------------------------------- pickups ---
  addPickup(pickup) { this.pickups.push(pickup); return pickup; }
  removePickup(pickup) {
    const index = this.pickups.indexOf(pickup);
    if (index >= 0) this.pickups.splice(index, 1);
  }
  clearPickups() { this.pickups.length = 0; }

  // ------------------------------------------------------------ utilities ---
  /** Nearest map-legal standing position to `position` (used by spawn logic). */
  findFreePositionNear(position, character, radius = 6, random = null) {
    const candidate = { ...position };
    if (this.isBoxFree(this.characterBox(character, candidate, character.standingHeight))) return candidate;
    for (let attempt = 0; attempt < 40; attempt++) {
      const angle = random ? random.range(0, Math.PI * 2) : (attempt / 40) * Math.PI * 2;
      const distance = radius * ((attempt % 8) + 1) / 8;
      const test = {
        x: position.x + Math.cos(angle) * distance,
        y: position.y,
        z: position.z + Math.sin(angle) * distance,
      };
      if (this.isBoxFree(this.characterBox(character, test, character.standingHeight))) return test;
    }
    return candidate;
  }

  update(dt) { this.time += dt; }
}
