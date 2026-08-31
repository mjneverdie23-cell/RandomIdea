import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, advance, place, pauseRounds, collectEvents } from './helpers.js';
import { CLASS_DEFINITIONS, CLASS_IDS } from '../src/config/classes.config.js';
import { ABILITY_DEFINITIONS, getAbilityDefinition } from '../src/config/abilities.config.js';
import { WeaponFactory } from '../src/core/weapons/WeaponFactory.js';
import { GameEvents } from '../src/core/events/GameEvents.js';
import { RoundPhase } from '../src/config/gameplay.config.js';

test('every class definition is internally consistent', () => {
  for (const [id, definition] of Object.entries(CLASS_DEFINITIONS)) {
    assert.equal(definition.id, id);
    assert.ok(definition.stats.maxHealth > 0, `${id} has health`);
    assert.ok(definition.stats.moveSpeed > 0, `${id} can move`);
    assert.ok(definition.allowedCategories.length > 0, `${id} can carry something`);
    assert.ok(definition.visual.modelKey, `${id} declares a model key for the render layer`);

    for (const abilityId of definition.abilities) {
      assert.ok(getAbilityDefinition(abilityId), `${id} references a real ability: ${abilityId}`);
    }
    for (const [slot, weaponId] of Object.entries(definition.defaultLoadout)) {
      if (!weaponId) continue;
      assert.ok(WeaponFactory.exists(weaponId), `${id} default ${slot} exists`);
      assert.ok(
        WeaponFactory.isAllowedForClass(weaponId, id),
        `${id} is allowed to carry its own default ${slot} (${weaponId})`,
      );
    }
  }
});

test('a character takes its stats, hitbox and abilities from its class', () => {
  const game = createTestGame();
  for (const classId of CLASS_IDS) {
    const character = game.addPlayer({ name: classId, classId, teamId: 'TEAM_ONE' });
    const definition = CLASS_DEFINITIONS[classId];
    assert.equal(character.health.maxHealth, definition.stats.maxHealth);
    assert.equal(character.stats.moveSpeed, definition.stats.moveSpeed);
    assert.equal(character.standingHeight, definition.stats.hitboxHeight);
    assert.equal(character.radius, definition.stats.hitboxRadius);
    assert.equal(character.abilities.slots.length, definition.abilities.length);
    assert.equal(character.visual.modelKey, definition.visual.modelKey, 'render hint travels with the character');
  }
});

test('class speed differences actually show up in movement', () => {
  const game = createTestGame();
  const assassin = game.addPlayer({ name: 'Fast', classId: 'ASSASSIN', teamId: 'TEAM_ONE' });
  const tank = game.addPlayer({ name: 'Slow', classId: 'TANK', teamId: 'TEAM_TWO' });
  pauseRounds(game);
  place(assassin, -2, -66, { yaw: Math.PI });
  place(tank, 2, -66, { yaw: Math.PI });
  assassin.intent.moveForward = 1;
  tank.intent.moveForward = 1;
  advance(game, 3);
  assert.ok(
    assassin.position.z > tank.position.z,
    'the assassin outruns the tank',
  );
});

test('abilities activate, apply their effect and go on cooldown', () => {
  const game = createTestGame();
  const bruiser = game.addPlayer({ name: 'Rex', classId: 'BRUISER', teamId: 'TEAM_ONE' });
  pauseRounds(game);
  place(bruiser, 0, -66);
  const used = collectEvents(game.bus, GameEvents.ABILITY_USED);

  bruiser.intent.useAbility = 0; // Terror Roar
  advance(game, 0.1);
  assert.equal(used.length, 1);
  assert.ok(bruiser.effects.has('roar_buff'), 'the buff was applied');
  assert.ok(bruiser.effects.modifiers.damageDealtMultiplier > 1, 'modifiers are folded together');
  assert.ok(!bruiser.abilities.isReady(0), 'the ability is on cooldown');

  bruiser.intent.useAbility = 0;
  advance(game, 0.1);
  assert.equal(used.length, 1, 'a second activation while on cooldown does nothing');
});

test('timed effects expire on their own', () => {
  const game = createTestGame();
  const tank = game.addPlayer({ name: 'Anky', classId: 'TANK', teamId: 'TEAM_ONE' });
  pauseRounds(game);
  place(tank, 0, -66);

  tank.intent.useAbility = 0; // Bulwark - 8 second damage reduction
  advance(game, 0.1);
  assert.ok(tank.effects.modifiers.damageTakenMultiplier < 1, 'damage reduction is active');
  advance(game, ABILITY_DEFINITIONS.ability_bulwark.duration + 0.2);
  assert.equal(tank.effects.modifiers.damageTakenMultiplier, 1, 'the effect wore off');
});

test('a damage ability hurts enemies but not teammates', () => {
  const game = createTestGame();
  const tank = game.addPlayer({ name: 'Anky', classId: 'TANK', teamId: 'TEAM_ONE' });
  const mate = game.addPlayer({ name: 'Mate', classId: 'RANGER', teamId: 'TEAM_ONE' });
  const enemy = game.addPlayer({ name: 'Enemy', classId: 'RANGER', teamId: 'TEAM_TWO' });
  pauseRounds(game);
  place(tank, 0, -66);
  place(mate, 1, -66);
  place(enemy, 2, -66);

  tank.intent.useAbility = 1; // Tail Slam
  advance(game, 0.2);
  assert.ok(enemy.health.health < enemy.health.maxHealth, 'the enemy took the slam');
  assert.equal(mate.health.health, mate.health.maxHealth, 'the teammate did not');
});

test('scan abilities reveal enemies for a limited time', () => {
  const game = createTestGame();
  const ranger = game.addPlayer({ name: 'Para', classId: 'RANGER', teamId: 'TEAM_ONE' });
  const enemy = game.addPlayer({ name: 'Enemy', classId: 'RANGER', teamId: 'TEAM_TWO' });
  pauseRounds(game);
  place(ranger, 0, -66);
  place(enemy, 5, -66);

  ranger.intent.useAbility = 0; // Echo Call
  advance(game, 0.1);
  assert.ok(enemy.isRevealed(game.world.time), 'the enemy is revealed');
  advance(game, ABILITY_DEFINITIONS.ability_echo_call.duration + 0.2);
  assert.ok(!enemy.isRevealed(game.world.time), 'the reveal expired');
});

test('the local player can change class during the buy phase only', () => {
  const game = createTestGame({ withLocalPlayer: true, teamSize: 1 });
  game.addPlayer({ name: 'D', classId: 'RANGER', teamId: 'TEAM_TWO' });
  game.start();
  advance(game, 0.1);
  assert.ok(game.setLocalPlayerClass('TANK'), 'allowed during warmup');
  assert.equal(game.localPlayer.classId, 'TANK');

  game.round.skipPhase();
  advance(game, 0.2); // -> BUY
  assert.equal(game.round.phase, RoundPhase.BUY);
  assert.ok(game.setLocalPlayerClass('SNIPER'), 'allowed during the buy phase');

  game.round.skipPhase();
  advance(game, 0.2); // -> LIVE
  assert.ok(!game.setLocalPlayerClass('TANK'), 'blocked once the round is live');
  assert.equal(game.localPlayer.classId, 'SNIPER');
});
