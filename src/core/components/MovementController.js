/**
 * Kinematic character controller: acceleration, gravity, jumping, crouching and
 * axis-separated AABB collision with automatic step-up.
 *
 * Characters collide as boxes (fast and stable) but are *hit* as capsules
 * (CombatSystem) - a deliberate prototype trade-off, documented in HANDBOOK.md.
 */
import { MovementConfig } from '../../config/gameplay.config.js';
import * as V3 from '../math/vec3.js';

export class MovementController {
  constructor(character, config = MovementConfig) {
    this.character = character;
    this.config = config;
    this.onGround = false;
    this.crouching = false;
    /** Fall speed on the last airborne tick, used for fall damage. */
    this.lastFallSpeed = 0;
    this.wasOnGround = false;
  }

  /** Horizontal speed the character is allowed to reach right now. */
  targetSpeed() {
    const character = this.character;
    const config = this.config;
    let speed = character.stats.moveSpeed;

    const weapon = character.inventory.activeWeapon;
    if (weapon) speed *= weapon.def.moveSpeedMultiplier;
    speed *= character.effects.modifiers.speedMultiplier;

    if (this.crouching) speed *= config.crouchMultiplier;
    else if (character.intent.sprint && character.intent.moveForward > 0 && !character.intent.aim) speed *= config.sprintMultiplier;
    if (character.intent.aim && !this.crouching) speed *= config.adsMultiplier;

    return speed;
  }

  update(dt, world) {
    const character = this.character;
    const config = this.config;
    const intent = character.intent;

    if (!character.health.alive) {
      character.velocity.x = 0; character.velocity.z = 0;
      return;
    }

    // Crouch state drives the collision height, so uncrouching needs headroom.
    const wantsCrouch = intent.crouch && !character.frozen;
    if (wantsCrouch !== this.crouching) {
      if (!wantsCrouch) {
        if (world.hasHeadroom(character, character.standingHeight)) this.crouching = false;
      } else {
        this.crouching = true;
      }
    }
    character.height = this.crouching
      ? character.standingHeight * config.crouchHeightFraction
      : character.standingHeight;

    // --- desired horizontal velocity ---------------------------------------
    let wishX = 0, wishZ = 0;
    if (!character.frozen) {
      const forward = V3.dirFromAngles(intent.yaw, 0);
      const right = { x: -forward.z, y: 0, z: forward.x };
      wishX = forward.x * intent.moveForward + right.x * intent.moveRight;
      wishZ = forward.z * intent.moveForward + right.z * intent.moveRight;
      const wishLength = Math.hypot(wishX, wishZ);
      if (wishLength > 1e-4) { wishX /= wishLength; wishZ /= wishLength; }
    }

    const speed = this.targetSpeed();
    const accel = (this.onGround ? config.groundAcceleration : config.airAcceleration * (1 / config.airControlMultiplier)) * dt;
    const targetVX = wishX * speed;
    const targetVZ = wishZ * speed;

    if (wishX !== 0 || wishZ !== 0) {
      character.velocity.x = approach(character.velocity.x, targetVX, accel);
      character.velocity.z = approach(character.velocity.z, targetVZ, accel);
    } else if (this.onGround) {
      const friction = config.groundFriction * dt;
      character.velocity.x = approach(character.velocity.x, 0, friction * Math.max(1, Math.abs(character.velocity.x)));
      character.velocity.z = approach(character.velocity.z, 0, friction * Math.max(1, Math.abs(character.velocity.z)));
    }

    // --- jump / gravity ------------------------------------------------------
    if (intent.jump && this.onGround && !character.frozen) {
      character.velocity.y = character.stats.jumpVelocity;
      this.onGround = false;
    }
    character.velocity.y += config.gravity * character.effects.modifiers.gravityMultiplier * dt;
    if (character.velocity.y < -60) character.velocity.y = -60;

    // --- integrate + collide -------------------------------------------------
    this.wasOnGround = this.onGround;
    if (!this.onGround) this.lastFallSpeed = Math.max(this.lastFallSpeed, -character.velocity.y);

    world.moveCharacter(character, {
      x: character.velocity.x * dt,
      y: character.velocity.y * dt,
      z: character.velocity.z * dt,
    }, this);

    // --- landing / fall damage ----------------------------------------------
    if (this.onGround && !this.wasOnGround) {
      const impact = this.lastFallSpeed;
      if (impact > config.fallDamageMinSpeed) {
        const damage = (impact - config.fallDamageMinSpeed) * config.fallDamagePerUnitSpeed;
        character.onFallDamage?.(damage);
      }
      this.lastFallSpeed = 0;
    }
    if (this.onGround) this.lastFallSpeed = 0;
  }

  get horizontalSpeed() {
    return Math.hypot(this.character.velocity.x, this.character.velocity.z);
  }

  /** 0..1 - how fast the character is moving relative to its walk speed. */
  get movementFraction() {
    return Math.min(1, this.horizontalSpeed / Math.max(0.001, this.character.stats.moveSpeed));
  }

  reset() {
    this.onGround = false;
    this.crouching = false;
    this.lastFallSpeed = 0;
  }
}

function approach(current, target, maxDelta) {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}
