import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, advance, place, startLiveRound, collectEvents } from './helpers.js';
import { BombState } from '../src/core/systems/BombSystem.js';
import { BombConfig } from '../src/config/gameplay.config.js';
import { GameEvents } from '../src/core/events/GameEvents.js';

/** A live round with one attacker (carrying the bomb) and one defender. */
function liveRound() {
  const game = createTestGame({ teamSize: 1 });
  const attacker = game.addPlayer({ name: 'A', classId: 'RANGER', teamId: 'TEAM_ONE' });
  const defender = game.addPlayer({ name: 'D', classId: 'RANGER', teamId: 'TEAM_TWO' });
  startLiveRound(game);
  game.bomb.reset();
  game.bomb.giveTo(attacker);
  const siteA = game.world.map.bombSites.find((site) => site.id === 'A');
  return { game, attacker, defender, siteA };
}

test('the bomb is handed to an attacker at the start of a round', () => {
  const game = createTestGame({ teamSize: 1 });
  game.addPlayer({ name: 'A', classId: 'RANGER', teamId: 'TEAM_ONE' });
  game.addPlayer({ name: 'D', classId: 'RANGER', teamId: 'TEAM_TWO' });
  startLiveRound(game);
  assert.ok(game.bomb.carrier, 'someone carries the bomb');
  assert.equal(game.teams.sideOf(game.bomb.carrier.teamId), 'ATTACKERS');
  assert.ok(game.bomb.carrier.inventory.hasBomb);
});

test('planting requires the carrier to be standing inside a site', () => {
  const { game, attacker, defender, siteA } = liveRound();
  place(attacker, 0, -60);
  advance(game, 0.2);
  assert.ok(!game.bomb.canPlant(attacker), 'cannot plant at spawn');

  place(attacker, siteA.plantPoint.x, siteA.plantPoint.z);
  advance(game, 0.3);
  assert.ok(game.bomb.canPlant(attacker), 'can plant on the site');
  assert.ok(!game.bomb.canPlant(defender), 'defenders can never plant');
});

test('planting takes the configured time and can be interrupted', () => {
  const { game, attacker, siteA } = liveRound();
  place(attacker, siteA.plantPoint.x, siteA.plantPoint.z);
  advance(game, 0.3);

  attacker.intent.use = true;
  advance(game, BombConfig.plantDuration * 0.5);
  assert.ok(game.bomb.plantProgress > 0.3 && game.bomb.plantProgress < 0.8, 'plant is in progress');

  attacker.intent.use = false;                       // let go early
  advance(game, 0.2);
  assert.equal(game.bomb.plantProgress, 0, 'progress was lost');
  assert.equal(game.bomb.state, BombState.CARRIED);

  attacker.intent.use = true;
  advance(game, BombConfig.plantDuration + 0.2);
  assert.equal(game.bomb.state, BombState.PLANTED, 'an uninterrupted plant completes');
  assert.equal(game.bomb.siteId, 'A');
  assert.equal(attacker.score.plants, 1);
  assert.ok(!attacker.inventory.hasBomb, 'the carrier no longer holds it');
});

test('a planted bomb counts down and detonates, damaging everyone nearby', () => {
  const { game, attacker, defender, siteA } = liveRound();
  place(attacker, siteA.plantPoint.x, siteA.plantPoint.z);
  advance(game, 0.3);
  attacker.intent.use = true;
  advance(game, BombConfig.plantDuration + 0.2);
  attacker.intent.use = false;

  place(defender, siteA.plantPoint.x + 3, siteA.plantPoint.z);
  const explosions = collectEvents(game.bus, GameEvents.BOMB_EXPLODED);
  // Snapshot at blast time: the round restarts (and respawns everyone) shortly after.
  let defenderSurvivedBlast = null;
  game.bus.on(GameEvents.BOMB_EXPLODED, () => { defenderSurvivedBlast = defender.health.alive; });

  const startFuse = game.bomb.fuseRemaining;
  advance(game, 5);
  assert.ok(game.bomb.fuseRemaining < startFuse, 'the fuse is ticking');

  advance(game, BombConfig.fuseDuration);
  assert.equal(explosions.length, 1, 'the bomb went off');
  assert.equal(defenderSurvivedBlast, false, 'anyone standing on the bomb dies');
});

test('defusing works, is faster with a kit, and can be interrupted', () => {
  const { game, attacker, defender, siteA } = liveRound();
  place(attacker, siteA.plantPoint.x, siteA.plantPoint.z);
  advance(game, 0.3);
  attacker.intent.use = true;
  advance(game, BombConfig.plantDuration + 0.2);
  attacker.intent.use = false;

  place(defender, game.bomb.position.x + 1, game.bomb.position.z);
  advance(game, 0.2);
  assert.ok(game.bomb.canDefuse(defender), 'a defender next to the bomb can defuse');
  assert.ok(!game.bomb.canDefuse(attacker), 'attackers cannot defuse');

  defender.intent.use = true;
  advance(game, 1);
  assert.ok(game.bomb.defuseProgress > 0, 'defuse started');
  assert.equal(game.bomb.defuseDuration, BombConfig.defuseDuration, 'no kit means the slow defuse');

  defender.intent.use = false;
  advance(game, 0.2);
  assert.equal(game.bomb.defuseProgress, 0, 'interrupting resets progress');

  defender.inventory.hasDefuseKit = true;
  defender.intent.use = true;
  advance(game, 0.2);
  assert.equal(game.bomb.defuseDuration, BombConfig.defuseDurationWithKit, 'a kit halves the defuse');
  advance(game, BombConfig.defuseDurationWithKit + 0.2);
  assert.equal(game.bomb.state, BombState.DEFUSED);
  assert.equal(defender.score.defuses, 1);
});

test('killing the carrier drops the bomb, and another attacker can pick it up', () => {
  const game = createTestGame({ teamSize: 2 });
  const carrier = game.addPlayer({ name: 'Carrier', classId: 'RANGER', teamId: 'TEAM_ONE' });
  const mate = game.addPlayer({ name: 'Mate', classId: 'RANGER', teamId: 'TEAM_ONE' });
  game.addPlayer({ name: 'D1', classId: 'RANGER', teamId: 'TEAM_TWO' });
  game.addPlayer({ name: 'D2', classId: 'RANGER', teamId: 'TEAM_TWO' });
  startLiveRound(game);
  game.bomb.reset();
  game.bomb.giveTo(carrier);

  place(carrier, 0, -40);
  place(mate, 0.5, -40);
  advance(game, 0.2);

  const drops = collectEvents(game.bus, GameEvents.BOMB_DROPPED);
  game.combat.applyDamage({ target: carrier, attacker: null, amount: 999, source: 'test' });
  assert.equal(drops.length, 1, 'the bomb dropped where the carrier died');
  assert.equal(game.bomb.state, BombState.DROPPED);

  mate.intent.use = true;
  advance(game, 0.2);
  assert.equal(game.bomb.state, BombState.CARRIED);
  assert.equal(game.bomb.carrier, mate, 'the teammate picked it up');
  assert.ok(mate.inventory.hasBomb);
});

test('killing the planter mid-plant cancels the plant', () => {
  const { game, attacker, siteA } = liveRound();
  place(attacker, siteA.plantPoint.x, siteA.plantPoint.z);
  advance(game, 0.3);
  attacker.intent.use = true;
  advance(game, BombConfig.plantDuration * 0.6);
  assert.ok(game.bomb.planting === attacker);

  game.combat.applyDamage({ target: attacker, attacker: null, amount: 999, source: 'test' });
  advance(game, 0.2);
  assert.equal(game.bomb.planting, null, 'the plant was aborted');
  assert.equal(game.bomb.state, BombState.DROPPED);
});

test('both bomb sites are plantable', () => {
  for (const siteId of ['A', 'B']) {
    const { game, attacker } = liveRound();
    const site = game.world.map.bombSites.find((s) => s.id === siteId);
    place(attacker, site.plantPoint.x, site.plantPoint.z);
    advance(game, 0.3);
    attacker.intent.use = true;
    advance(game, BombConfig.plantDuration + 0.3);
    assert.equal(game.bomb.state, BombState.PLANTED, `site ${siteId} accepts a plant`);
    assert.equal(game.bomb.siteId, siteId);
  }
});
