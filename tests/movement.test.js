import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, advance, place, DT } from './helpers.js';
import { MovementConfig } from '../src/config/gameplay.config.js';

test('characters fall to the ground and stay on it', () => {
  const game = createTestGame();
  const character = game.addPlayer({ name: 'Faller', classId: 'RANGER', teamId: 'TEAM_ONE' });
  place(character, 0, -66, { y: 6 });
  advance(game, 2);
  assert.ok(character.movement.onGround, 'landed');
  assert.ok(Math.abs(character.position.y) < 0.05, `rests on the floor (y=${character.position.y})`);
});

test('walls stop horizontal movement', () => {
  const game = createTestGame();
  const character = game.addPlayer({ name: 'Walker', classId: 'RANGER', teamId: 'TEAM_ONE' });
  // Mid corridor runs x in [-8, 8]; walk east into the wall.
  place(character, 0, -30, { yaw: Math.PI / 2 * 3 });
  character.intent.moveForward = 1;
  advance(game, 4);
  assert.ok(character.position.x < 8, 'did not pass through the corridor wall');
  assert.ok(character.position.x > 5, 'did reach the wall');
  assert.ok(!game.world.isPointSolid(character.centerPosition), 'not stuck inside geometry');
});

test('step-up lets characters walk onto low cover without jumping', () => {
  const game = createTestGame();
  const character = game.addPlayer({ name: 'Stepper', classId: 'RANGER', teamId: 'TEAM_ONE' });
  // mid_nest_steps climb 1.6 units in 4 steps at (0, 25..28).
  place(character, 0, 24, { yaw: Math.PI });
  character.intent.moveForward = 1;
  advance(game, 1);
  assert.ok(character.position.y > 1, `climbed the stairs (y=${character.position.y.toFixed(2)})`);
  assert.ok(character.movement.onGround, 'standing on the platform, not falling');
});

test('crouching lowers the hitbox and slows the character', () => {
  const game = createTestGame();
  const character = game.addPlayer({ name: 'Croucher', classId: 'RANGER', teamId: 'TEAM_ONE' });
  place(character, 0, -66);
  advance(game, 0.5);
  const standingHeight = character.height;
  const standingSpeed = character.movement.targetSpeed();

  character.intent.crouch = true;
  advance(game, 0.5);
  assert.ok(character.height < standingHeight, 'hitbox shrinks while crouched');
  assert.ok(character.movement.targetSpeed() < standingSpeed, 'crouch is slower');
  assert.ok(
    Math.abs(character.height - character.standingHeight * MovementConfig.crouchHeightFraction) < 0.001,
    'crouch height matches the config',
  );
});

test('jumping leaves the ground and gravity brings the character back', () => {
  const game = createTestGame();
  const character = game.addPlayer({ name: 'Jumper', classId: 'ASSASSIN', teamId: 'TEAM_ONE' });
  place(character, 0, -66);
  advance(game, 0.5);
  character.intent.jump = true;
  game.tick(DT);
  character.intent.jump = false;
  let peak = 0;
  for (let i = 0; i < 60; i++) {
    game.tick(DT);
    peak = Math.max(peak, character.position.y);
  }
  assert.ok(peak > 0.5, `jump gained height (${peak.toFixed(2)})`);
  advance(game, 2);
  assert.ok(character.movement.onGround, 'came back down');
});

test('characters cannot leave the map bounds', () => {
  const game = createTestGame();
  const character = game.addPlayer({ name: 'Escapee', classId: 'RANGER', teamId: 'TEAM_ONE' });
  place(character, 0, -66, { yaw: 0 });
  character.intent.moveForward = 1;
  advance(game, 20);
  const bounds = game.world.map.bounds;
  assert.ok(character.position.z >= bounds.min.z && character.position.z <= bounds.max.z);
  assert.ok(character.position.x >= bounds.min.x && character.position.x <= bounds.max.x);
});
