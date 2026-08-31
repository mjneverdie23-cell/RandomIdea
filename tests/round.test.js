import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, advance, advanceUntil, place, startLiveRound, collectEvents } from './helpers.js';
import { RoundPhase, RoundEndReason, RoundConfig, BombConfig, Side } from '../src/config/gameplay.config.js';
import { GameEvents } from '../src/core/events/GameEvents.js';

function match({ teamSize = 1 } = {}) {
  const game = createTestGame({ teamSize });
  const attackers = [];
  const defenders = [];
  for (let i = 0; i < teamSize; i++) {
    attackers.push(game.addPlayer({ name: `A${i}`, classId: 'RANGER', teamId: 'TEAM_ONE' }));
    defenders.push(game.addPlayer({ name: `D${i}`, classId: 'RANGER', teamId: 'TEAM_TWO' }));
  }
  return { game, attackers, defenders };
}

test('the round state machine runs warmup -> buy -> live', () => {
  const { game } = match();
  const phases = collectEvents(game.bus, GameEvents.ROUND_PHASE_CHANGED);
  game.start();
  assert.equal(game.round.phase, RoundPhase.WARMUP);

  advance(game, RoundConfig.warmupDuration + 0.1);
  assert.equal(game.round.phase, RoundPhase.BUY);
  assert.equal(game.match.roundNumber, 1, 'round 1 begins at the first buy phase');

  advance(game, RoundConfig.buyDuration + 0.1);
  assert.equal(game.round.phase, RoundPhase.LIVE);
  assert.deepEqual(phases.map((p) => p.phase), [RoundPhase.WARMUP, RoundPhase.BUY, RoundPhase.LIVE]);
});

test('players are frozen during the buy phase and free once live', () => {
  const { game, attackers } = match();
  game.start();
  advance(game, RoundConfig.warmupDuration + 0.1);
  assert.ok(attackers[0].frozen, 'frozen in the buy phase');

  const start = { ...attackers[0].position };
  attackers[0].intent.moveForward = 1;
  advance(game, 1);
  assert.ok(Math.hypot(attackers[0].position.x - start.x, attackers[0].position.z - start.z) < 0.2, 'cannot walk while frozen');

  game.round.skipPhase();
  advance(game, 0.1);
  assert.ok(!attackers[0].frozen);
  advance(game, 1);
  assert.ok(Math.hypot(attackers[0].position.x - start.x, attackers[0].position.z - start.z) > 1, 'moves once live');
});

test('eliminating all defenders wins the round for the attackers', () => {
  const { game, defenders } = match();
  startLiveRound(game);
  const ended = collectEvents(game.bus, GameEvents.ROUND_ENDED);
  game.combat.applyDamage({ target: defenders[0], attacker: null, amount: 999, source: 'test' });
  advance(game, 0.1);

  assert.equal(ended.length, 1);
  assert.equal(ended[0].reason, RoundEndReason.DEFENDERS_ELIMINATED);
  assert.equal(ended[0].winningTeamId, game.teams.teamIdOnSide(Side.ATTACKERS));
});

test('eliminating all attackers wins the round for the defenders', () => {
  const { game, attackers } = match();
  startLiveRound(game);
  const ended = collectEvents(game.bus, GameEvents.ROUND_ENDED);
  game.combat.applyDamage({ target: attackers[0], attacker: null, amount: 999, source: 'test' });
  advance(game, 0.1);
  assert.equal(ended[0].reason, RoundEndReason.ATTACKERS_ELIMINATED);
  assert.equal(ended[0].winningTeamId, game.teams.teamIdOnSide(Side.DEFENDERS));
});

test('after the bomb is planted, wiping the attackers does NOT end the round', () => {
  const { game, attackers, defenders } = match();
  startLiveRound(game);
  game.bomb.reset();
  game.bomb.giveTo(attackers[0]);
  const site = game.world.map.bombSites[0];
  place(attackers[0], site.plantPoint.x, site.plantPoint.z);
  advance(game, 0.3);
  attackers[0].intent.use = true;
  advance(game, BombConfig.plantDuration + 0.2);
  assert.equal(game.bomb.state, 'PLANTED');

  const ended = collectEvents(game.bus, GameEvents.ROUND_ENDED);
  game.combat.applyDamage({ target: attackers[0], attacker: null, amount: 999, source: 'test' });
  advance(game, 1);
  assert.equal(ended.length, 0, 'the bomb is still ticking, so the round continues');

  // The defenders now have to defuse - or lose.
  place(defenders[0], game.bomb.position.x + 1, game.bomb.position.z);
  defenders[0].intent.use = true;
  advance(game, BombConfig.defuseDuration + 0.5);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].reason, RoundEndReason.BOMB_DEFUSED);
});

test('the bomb detonating wins the round for the attackers even if they are all dead', () => {
  const { game, attackers } = match();
  startLiveRound(game);
  game.bomb.reset();
  game.bomb.giveTo(attackers[0]);
  const site = game.world.map.bombSites[1];
  place(attackers[0], site.plantPoint.x, site.plantPoint.z);
  advance(game, 0.3);
  attackers[0].intent.use = true;
  advance(game, BombConfig.plantDuration + 0.2);

  const ended = collectEvents(game.bus, GameEvents.ROUND_ENDED);
  game.combat.applyDamage({ target: attackers[0], attacker: null, amount: 999, source: 'test' });
  advance(game, BombConfig.fuseDuration + 0.5);
  assert.equal(ended[0].reason, RoundEndReason.BOMB_DETONATED);
  assert.equal(ended[0].winningTeamId, game.teams.teamIdOnSide(Side.ATTACKERS));
});

test('running out of time with no plant wins the round for the defenders', () => {
  const { game } = match();
  startLiveRound(game);
  const ended = collectEvents(game.bus, GameEvents.ROUND_ENDED);
  advance(game, RoundConfig.roundDuration + 0.5);
  assert.equal(ended[0].reason, RoundEndReason.TIME_EXPIRED);
  assert.equal(ended[0].winningTeamId, game.teams.teamIdOnSide(Side.DEFENDERS));
});

test('the round clock is replaced by the bomb fuse once planted', () => {
  const { game, attackers } = match();
  startLiveRound(game);
  game.bomb.reset();
  game.bomb.giveTo(attackers[0]);
  const site = game.world.map.bombSites[0];
  place(attackers[0], site.plantPoint.x, site.plantPoint.z);
  advance(game, 0.3);
  const roundClock = game.round.timeRemaining;
  attackers[0].intent.use = true;
  advance(game, BombConfig.plantDuration + 0.2);
  assert.ok(game.round.timeRemaining < roundClock, 'the displayed clock switched to the fuse');
  assert.ok(Math.abs(game.round.timeRemaining - game.bomb.fuseRemaining) < 0.001);
});

test('a new round respawns everyone, resets health and re-arms the bomb', () => {
  const { game, attackers, defenders } = match();
  startLiveRound(game);
  attackers[0].health.health = 10;
  game.combat.applyDamage({ target: defenders[0], attacker: null, amount: 999, source: 'test' });

  advanceUntil(game, (g) => g.round.phase === RoundPhase.BUY && g.match.roundNumber === 2, 30);
  assert.equal(game.match.roundNumber, 2);
  assert.ok(defenders[0].health.alive, 'the dead are back');
  assert.equal(attackers[0].health.health, attackers[0].health.maxHealth, 'health is restored');
  assert.ok(game.bomb.carrier, 'the bomb is back with an attacker');
  assert.equal(game.bomb.state, 'CARRIED');
});

test('survivors keep their weapons, the dead lose them', () => {
  const { game, attackers, defenders } = match();
  startLiveRound(game);
  attackers[0].inventory.giveWeapon('rifle_ranger');
  defenders[0].inventory.giveWeapon('rifle_ranger');
  game.combat.applyDamage({ target: defenders[0], attacker: null, amount: 999, source: 'test' });

  advanceUntil(game, (g) => g.match.roundNumber === 2 && g.round.phase === RoundPhase.BUY, 30);
  assert.equal(attackers[0].inventory.getWeapon('primary')?.id, 'rifle_ranger', 'the survivor kept the rifle');
  assert.equal(defenders[0].inventory.getWeapon('primary'), null, 'the dead player has to re-buy');
});
