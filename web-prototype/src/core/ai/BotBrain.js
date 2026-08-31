/**
 * Bot AI.
 *
 * A bot is a thin decision layer that fills in the same `intent` structure a
 * human produces - it has no privileged access to the world beyond the queries
 * a player's senses justify (field of view, line of sight, view distance).
 *
 * Behaviour is intentionally simple and readable: perceive -> pick a goal ->
 * path to it -> shoot what you can see. Difficulty is a set of multipliers, not
 * a different code path (bots.config.js).
 */
import { BotConfig } from '../../config/bots.config.js';
import { RoundPhase, Side } from '../../config/gameplay.config.js';
import { BombState } from '../systems/BombSystem.js';
import { WeaponSlot } from '../../config/weapons.config.js';
import { NavGrid } from './NavGrid.js';
import * as V3 from '../math/vec3.js';

export const BotGoal = Object.freeze({
  IDLE: 'IDLE',
  BUY: 'BUY',
  PUSH_SITE: 'PUSH_SITE',
  PLANT: 'PLANT',
  DEFEND_BOMB: 'DEFEND_BOMB',
  HOLD_SITE: 'HOLD_SITE',
  DEFUSE: 'DEFUSE',
  RETAKE: 'RETAKE',
  FETCH_BOMB: 'FETCH_BOMB',
  FIGHT: 'FIGHT',
});

export class BotBrain {
  constructor({ character, world, teams, bomb, shop, combat, random, getPhase, difficulty = BotConfig.defaultDifficulty }) {
    this.character = character;
    this.world = world;
    this.teams = teams;
    this.bomb = bomb;
    this.shop = shop;
    this.combat = combat;
    this.random = random;
    this.getPhase = getPhase;
    this.tuning = BotConfig.difficulties[difficulty] ?? BotConfig.difficulties.NORMAL;
    this.nav = new NavGrid(world.map.navGrid);

    this.goal = BotGoal.IDLE;
    this.path = [];
    this.pathIndex = 0;
    this.goalPosition = null;
    this.target = null;
    this.targetLastSeen = -Infinity;
    this.targetLastKnownPosition = null;
    this.reactionRemaining = 0;
    this.thinkTimer = random.range(0, BotConfig.thinkInterval);
    this.fireTimer = 0;
    this.firing = false;
    this.strafeDirection = random.chance(0.5) ? 1 : -1;
    this.strafeTimer = 0;
    this.assignedSiteId = null;
    this.holdPosition = null;
    this.stuckTimer = 0;
    this.lastPosition = { ...character.position };
    this._lastPhase = null;
  }

  // ------------------------------------------------------------------ tick --
  update(dt) {
    const character = this.character;
    const intent = character.intent;
    const phase = this.getPhase();

    // Reset per-tick action flags; look direction persists between ticks.
    intent.moveForward = 0;
    intent.moveRight = 0;
    intent.jump = false;
    intent.fire = false;
    intent.use = false;
    intent.sprint = false;
    intent.aim = false;

    if (phase !== this._lastPhase) {
      this._onPhaseChanged(phase, this._lastPhase);
      this._lastPhase = phase;
    }

    if (!character.health.alive) return;

    if (phase === RoundPhase.BUY || phase === RoundPhase.ROUND_END || phase === RoundPhase.MATCH_END) {
      return; // frozen or nothing to do
    }

    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = BotConfig.thinkInterval;
      this._think();
    }

    this._updateCombat(dt);
    this._updateMovement(dt);
    this._updateStuckDetection(dt);
  }

  // ---------------------------------------------------------------- phases --
  _onPhaseChanged(phase, previous) {
    if (phase === RoundPhase.BUY) {
      this._planRound();
      this._buy();
    }
    if (phase === RoundPhase.LIVE) {
      this.path = [];
      this.pathIndex = 0;
      this.goalPosition = null;
      this.target = null;
    }
  }

  /** Picks the site this bot will attack or defend for the round. */
  _planRound() {
    const sites = this.world.map.bombSites;
    if (sites.length === 0) return;
    // Two-site maps use the configured A/B bias; maps with more sites spread evenly.
    const site = sites.length === 2
      ? (this.random.chance(BotConfig.siteBPreference) ? sites[1] : sites[0])
      : sites[this.random.int(0, sites.length - 1)];
    this.assignedSiteId = site.id;
    this.holdPosition = null;
    this.target = null;
    this.path = [];
  }

  _buy() {
    const character = this.character;
    const side = this.teams.sideOf(character.teamId);
    const preference = character.classDef.botPreference?.buyPriority ?? [];

    // Armour first - it is the best value purchase in almost every economy.
    if (character.money >= 1000) this.shop.buy(character, 'eq_helmet');
    else if (character.money >= 650) this.shop.buy(character, 'eq_armor');

    const hasPrimary = character.inventory.getWeapon(WeaponSlot.PRIMARY) != null;
    if (!hasPrimary && character.money >= BotConfig.saveThreshold) {
      this.shop.buyFromPriority(character, preference);
    }
    if (side === Side.DEFENDERS && character.money >= 400) this.shop.buy(character, 'eq_defuser');
    if (character.money >= 1200) this.shop.buy(character, 'eq_frag');
    if (!character.inventory.getWeapon(WeaponSlot.PRIMARY) && character.money >= 700) {
      this.shop.buy(character, 'pistol_talon');
    }
  }

  // ----------------------------------------------------------- perception ---
  _think() {
    this._acquireTarget();
    this._chooseGoal();
  }

  _acquireTarget() {
    const me = this.character;
    const eye = me.eyePosition;
    const forward = V3.dirFromAngles(me.yaw, 0);
    let best = null;
    let bestScore = Infinity;

    for (const enemy of this.world.characters) {
      if (!enemy.health.alive || enemy.teamId === me.teamId) continue;
      const revealed = enemy.isRevealed(this.world.time);
      if (enemy.isInvisible && !revealed) continue;

      const distance = V3.distance(eye, enemy.centerPosition);
      if (distance > this.tuning.viewDistance) continue;

      if (!revealed) {
        const toEnemy = V3.normalize(V3.sub(enemy.centerPosition, eye));
        const angle = Math.acos(Math.max(-1, Math.min(1, V3.dot(forward, toEnemy))));
        // Getting shot at counts as noticing, even from behind.
        const recentlyHurt = this.world.time - me.lastDamageTime < 1.5;
        if (angle > BotConfig.fieldOfView / 2 && !recentlyHurt) continue;
      }
      if (!this.world.hasLineOfSight(me, enemy)) continue;

      const score = distance - (enemy === this.target ? 12 : 0); // sticky targeting
      if (score < bestScore) { bestScore = score; best = enemy; }
    }

    if (best) {
      if (best !== this.target) this.reactionRemaining = this.tuning.reactionTime;
      this.target = best;
      this.targetLastSeen = this.world.time;
      this.targetLastKnownPosition = { ...best.centerPosition };
    } else if (this.target && this.world.time - this.targetLastSeen > BotConfig.targetMemory) {
      this.target = null;
      this.targetLastKnownPosition = null;
    }
  }

  // ---------------------------------------------------------------- goals ---
  _chooseGoal() {
    const me = this.character;
    const side = this.teams.sideOf(me.teamId);
    const bomb = this.bomb;
    const site = this.world.map.bombSites.find((s) => s.id === this.assignedSiteId) ?? this.world.map.bombSites[0];

    let goal = BotGoal.IDLE;
    let goalPosition = null;

    if (side === Side.ATTACKERS) {
      if (bomb.state === BombState.PLANTED) {
        goal = BotGoal.DEFEND_BOMB;
        goalPosition = this._positionNear(bomb.position, 9);
      } else if (bomb.carrier === me) {
        goal = BotGoal.PLANT;
        goalPosition = site.plantPoint;
      } else if (bomb.state === BombState.DROPPED && this._isClosestToBomb()) {
        goal = BotGoal.FETCH_BOMB;
        goalPosition = bomb.position;
      } else {
        goal = BotGoal.PUSH_SITE;
        const target = bomb.carrier && bomb.carrier !== me
          ? this._siteOfCarrier(bomb.carrier, site)
          : site;
        goalPosition = this._positionNear(target.plantPoint, 7);
      }
    } else {
      if (bomb.state === BombState.PLANTED) {
        goal = BotGoal.DEFUSE;
        goalPosition = bomb.position;
      } else {
        goal = BotGoal.HOLD_SITE;
        if (!this.holdPosition) this.holdPosition = this._positionNear(site.plantPoint, 8);
        goalPosition = this.holdPosition;
      }
    }

    // Fighting overrides navigation but keeps the objective as the fallback.
    if (this.target && goal !== BotGoal.DEFUSE && goal !== BotGoal.PLANT) {
      this.goal = BotGoal.FIGHT;
    } else {
      this.goal = goal;
    }

    if (goalPosition && (!this.goalPosition || V3.distanceXZ(goalPosition, this.goalPosition) > 3 || this.path.length === 0)) {
      this._repath(goalPosition);
    }
  }

  _siteOfCarrier(carrier, fallback) {
    // Support the carrier: head for whichever site they are closest to.
    let best = fallback;
    let bestDistance = Infinity;
    for (const site of this.world.map.bombSites) {
      const distance = V3.distanceXZ(carrier.position, site.plantPoint);
      if (distance < bestDistance) { bestDistance = distance; best = site; }
    }
    return best;
  }

  _isClosestToBomb() {
    const me = this.character;
    const myDistance = V3.distance(me.position, this.bomb.position);
    return this.teams.membersOnSide(Side.ATTACKERS, { aliveOnly: true })
      .every((mate) => mate === me || V3.distance(mate.position, this.bomb.position) >= myDistance - 0.01);
  }

  /** A point within `radius` of `center`, jittered so bots do not stack up. */
  _positionNear(center, radius) {
    const angle = this.random.range(0, Math.PI * 2);
    const distance = this.random.range(0, radius);
    const candidate = {
      x: center.x + Math.cos(angle) * distance,
      y: center.y,
      z: center.z + Math.sin(angle) * distance,
    };
    const cell = this.nav.nearestOpenCell(candidate);
    return cell ? this.nav.toWorld(cell.cx, cell.cz) : { ...center };
  }

  _repath(goalPosition) {
    this.goalPosition = { ...goalPosition };
    this.path = this.nav.findPath(this.character.position, goalPosition);
    this.pathIndex = 0;
  }

  // --------------------------------------------------------------- combat ---
  _updateCombat(dt) {
    const me = this.character;
    const intent = me.intent;
    const weapon = me.inventory.activeWeapon;

    if (this.reactionRemaining > 0) this.reactionRemaining -= dt;

    // Keep a usable weapon in hand.
    if (weapon?.isEmpty && weapon.canReload) intent.reload = true;
    if (!weapon || (weapon.isEmpty && weapon.reserveAmmo <= 0)) {
      intent.switchToSlot = me.inventory.getWeapon(WeaponSlot.PRIMARY) && !me.inventory.getWeapon(WeaponSlot.PRIMARY).isEmpty
        ? WeaponSlot.PRIMARY
        : WeaponSlot.SECONDARY;
    } else if (me.inventory.activeSlot === WeaponSlot.MELEE && me.inventory.getWeapon(WeaponSlot.PRIMARY)) {
      intent.switchToSlot = WeaponSlot.PRIMARY;
    }

    const aimPoint = this.target?.health.alive
      ? this._predictedAimPoint(this.target)
      : this.targetLastKnownPosition;

    if (aimPoint) {
      this._aimAt(aimPoint, dt);
    } else {
      // No target: look where we are going.
      const waypoint = this.path[this.pathIndex];
      if (waypoint) this._aimAt({ ...waypoint, y: waypoint.y + me.eyeHeight }, dt, 0.6);
    }

    const canShoot = this.target?.health.alive &&
      this.reactionRemaining <= 0 &&
      weapon && !weapon.reloading && !weapon.isEmpty &&
      this.world.hasLineOfSight(me, this.target);

    if (canShoot) {
      const toTarget = V3.normalize(V3.sub(this._predictedAimPoint(this.target), me.eyePosition));
      const facing = V3.dirFromAngles(me.yaw, me.pitch);
      const aimError = Math.acos(Math.max(-1, Math.min(1, V3.dot(facing, toTarget))));
      const distance = V3.distance(me.eyePosition, this.target.centerPosition);
      // Allow a wider cone up close, a tight one at range.
      const tolerance = Math.max(0.02, Math.atan2(this.target.radius * 1.4, Math.max(1, distance)));

      if (aimError < tolerance) {
        this._updateTrigger(dt, weapon);
        intent.fire = this.firing;
        // Snipers and DMRs steady up before firing.
        if (weapon.def.adsZoom >= 2) intent.aim = true;
      } else {
        this.firing = false;
      }
    } else {
      this.firing = false;
      if (weapon && !weapon.reloading && weapon.ammoInMag < weapon.def.magSize * 0.35 && !this.target) {
        intent.reload = true;
      }
    }
  }

  /** Simple lead: aim where the target will be, scaled by difficulty. */
  _predictedAimPoint(target) {
    const me = this.character;
    const distance = V3.distance(me.eyePosition, target.centerPosition);
    const lead = Math.min(0.35, distance / 260) * this.tuning.accuracyMoving;
    const point = {
      x: target.centerPosition.x + target.velocity.x * lead,
      y: target.centerPosition.y + target.velocity.y * lead * 0.3,
      z: target.centerPosition.z + target.velocity.z * lead,
    };
    return point;
  }

  _aimAt(point, dt, rateScale = 1) {
    const me = this.character;
    const intent = me.intent;
    const eye = me.eyePosition;

    const errorScale = this.tuning.aimError * (Math.PI / 180);
    const desiredYaw = V3.yawTo(eye, point) + this.random.symmetric(errorScale * 0.5);
    const desiredPitch = V3.pitchTo(eye, point) + this.random.symmetric(errorScale * 0.35);

    const rate = this.tuning.aimTurnRate * rateScale * dt;
    intent.yaw = approachAngle(intent.yaw, desiredYaw, rate);
    intent.pitch = Math.max(-1.4, Math.min(1.4, approachAngle(intent.pitch, desiredPitch, rate)));
  }

  /** Trigger discipline: short bursts with pauses, per difficulty. */
  _updateTrigger(dt, weapon) {
    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;
    this.firing = !this.firing;
    this.fireTimer = this.firing
      ? this.random.range(this.tuning.fireBurstMin, this.tuning.fireBurstMax)
      : this.random.range(0.08, 0.25);
  }

  // ------------------------------------------------------------- movement ---
  _updateMovement(dt) {
    const me = this.character;
    const intent = me.intent;

    // Objective interactions: stand still and hold use.
    if (this.goal === BotGoal.PLANT && this.bomb.canPlant(me)) {
      intent.use = true;
      return;
    }
    if (this.goal === BotGoal.DEFUSE && this.bomb.canDefuse(me)) {
      intent.use = true;
      return;
    }
    if (this.goal === BotGoal.FETCH_BOMB && this.bomb.canPickUp(me)) {
      intent.use = true;
      return;
    }

    let desired = null;

    if (this.goal === BotGoal.FIGHT && this.target) {
      const distance = V3.distanceXZ(me.position, this.target.position);
      const preferred = this._preferredRange();
      const toTarget = V3.normalize(V3.sub(this.target.position, me.position));

      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = this.random.range(0.4, 1.2);
        this.strafeDirection *= -1;
      }
      const strafe = { x: -toTarget.z, y: 0, z: toTarget.x };

      const approach = distance > preferred * 1.2 ? 1 : distance < preferred * 0.6 ? -1 : 0;
      desired = V3.normalize({
        x: toTarget.x * approach + strafe.x * this.strafeDirection * BotConfig.combatStrafe,
        y: 0,
        z: toTarget.z * approach + strafe.z * this.strafeDirection * BotConfig.combatStrafe,
      });
    } else {
      desired = this._followPath();
      if (desired && !this.target) intent.sprint = true;
    }

    if (!desired) return;

    // Convert a world-space direction into local move axes so the bot can walk
    // one way while aiming another.
    const forward = V3.dirFromAngles(me.yaw, 0);
    const right = { x: -forward.z, y: 0, z: forward.x };
    intent.moveForward = clamp11(V3.dot(desired, forward));
    intent.moveRight = clamp11(V3.dot(desired, right));

    // Hop over small obstacles rather than grinding into them.
    if (this.stuckTimer > 0.6 && me.movement.onGround) intent.jump = true;
  }

  _preferredRange() {
    const weapon = this.character.inventory.activeWeapon;
    if (!weapon) return 6;
    switch (weapon.category) {
      case 'SNIPER': return 45;
      case 'RIFLE': return 25;
      case 'LMG': return 22;
      case 'SMG': return 12;
      case 'SHOTGUN': return 6;
      case 'MELEE': return 1.5;
      default: return 15;
    }
  }

  _followPath() {
    const me = this.character;
    if (this.pathIndex >= this.path.length) {
      if (this.goalPosition && V3.distanceXZ(me.position, this.goalPosition) > BotConfig.waypointRadius) {
        this._repath(this.goalPosition);
      }
      return null;
    }
    let waypoint = this.path[this.pathIndex];
    while (waypoint && V3.distanceXZ(me.position, waypoint) < BotConfig.waypointRadius) {
      this.pathIndex += 1;
      waypoint = this.path[this.pathIndex];
    }
    if (!waypoint) return null;
    return V3.normalize({ x: waypoint.x - me.position.x, y: 0, z: waypoint.z - me.position.z });
  }

  _updateStuckDetection(dt) {
    const me = this.character;
    const moved = V3.distanceXZ(me.position, this.lastPosition);
    if (moved < 0.08 && (this.goal !== BotGoal.HOLD_SITE || this.path.length > 0)) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.2) {
        this.stuckTimer = 0;
        // Force a fresh route; jitter the goal so bots do not re-derive the same block.
        if (this.goalPosition) this._repath(this._positionNear(this.goalPosition, 4));
      }
    } else {
      this.stuckTimer = 0;
    }
    this.lastPosition = { ...me.position };
  }

  describe() {
    return {
      name: this.character.name,
      goal: this.goal,
      site: this.assignedSiteId,
      target: this.target?.name ?? null,
      waypoints: this.path.length - this.pathIndex,
    };
  }
}

function clamp11(value) { return Math.max(-1, Math.min(1, value)); }

function approachAngle(current, target, maxDelta) {
  const difference = V3.wrapAngle(target - current);
  if (Math.abs(difference) <= maxDelta) return V3.wrapAngle(target);
  return V3.wrapAngle(current + Math.sign(difference) * maxDelta);
}
