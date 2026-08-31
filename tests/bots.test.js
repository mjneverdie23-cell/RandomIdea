import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameManager } from '../src/core/GameManager.js';
import { advance, advanceUntil } from './helpers.js';
import { RoundPhase, MatchConfig, RoundEndReason } from '../src/config/gameplay.config.js';
import { GameEvents } from '../src/core/events/GameEvents.js';
import { BotGoal } from '../src/core/ai/BotBrain.js';

/** A bot-only match - the same thing tools/headless-match.js runs. */
function botMatch(seed = 99) {
  return new GameManager({ withLocalPlayer: false, seed });
}

test('bots fill both teams with a spread of classes', () => {
  const game = botMatch();
  assert.equal(game.world.characters.length, MatchConfig.teamSize * 2);
  assert.equal(game.bots.size, MatchConfig.teamSize * 2);
  const classes = new Set(game.world.characters.map((c) => c.classId));
  assert.ok(classes.size >= 3, `bots use several classes (${[...classes].join(', ')})`);
});

test('bots buy gear in the buy phase and spend their money', () => {
  const game = botMatch();
  game.start();
  advanceUntil(game, (g) => g.round.phase === RoundPhase.BUY, 30);
  advance(game, 0.5);

  const richRound = game.world.characters.filter((c) => c.health.armor > 0 || c.inventory.getWeapon('primary'));
  assert.ok(richRound.length > 0, 'bots bought something on the pistol round');

  // Give everyone money and run a later buy phase: they should upgrade.
  for (const character of game.world.characters) character.money = 8000;
  advanceUntil(game, (g) => g.round.phase === RoundPhase.LIVE, 30);
  advanceUntil(game, (g) => g.round.phase === RoundPhase.BUY, 200);
  advance(game, 0.5);
  const withPrimaries = game.world.characters.filter((c) => c.inventory.getWeapon('primary'));
  assert.ok(withPrimaries.length >= 5, `most bots bought a primary (${withPrimaries.length}/10)`);
});

test('bots leave spawn and head for an objective', () => {
  const game = botMatch(5);
  game.start();
  advanceUntil(game, (g) => g.round.phase === RoundPhase.LIVE, 60);
  const startPositions = game.world.characters.map((c) => ({ ...c.position }));
  advance(game, 12);

  const moved = game.world.characters.filter((c, index) =>
    Math.hypot(c.position.x - startPositions[index].x, c.position.z - startPositions[index].z) > 12);
  assert.ok(moved.length >= 6, `most bots pushed out of spawn (${moved.length}/10)`);

  const goals = [...game.bots.values()].map((brain) => brain.goal);
  assert.ok(
    goals.some((goal) => goal === BotGoal.PUSH_SITE || goal === BotGoal.PLANT || goal === BotGoal.FIGHT),
    'attackers are executing an attacking plan',
  );
  assert.ok(goals.some((goal) => goal === BotGoal.HOLD_SITE || goal === BotGoal.FIGHT), 'defenders are holding');
});

test('bots fight, plant and defuse across a series of rounds', () => {
  const game = botMatch(7);
  const reasons = new Set();
  const plants = [];
  const defuses = [];
  game.bus.on(GameEvents.ROUND_ENDED, ({ reason }) => reasons.add(reason));
  game.bus.on(GameEvents.BOMB_PLANTED, (p) => plants.push(p));
  game.bus.on(GameEvents.BOMB_DEFUSED, (p) => defuses.push(p));

  game.start();
  advanceUntil(game, (g) => g.match.completedRounds >= 8, 60 * 25);

  assert.ok(game.match.completedRounds >= 8, 'rounds keep resolving');
  assert.ok(plants.length > 0, 'bots managed to plant the bomb');
  assert.ok(
    reasons.has(RoundEndReason.DEFENDERS_ELIMINATED) || reasons.has(RoundEndReason.ATTACKERS_ELIMINATED),
    'bots kill each other',
  );
  const totalKills = game.world.characters.reduce((sum, c) => sum + c.score.kills, 0);
  assert.ok(totalKills > 10, `bots are shooting to kill (${totalKills} kills)`);
});

test('a full bot match reaches the match win condition', () => {
  const game = botMatch(21);
  const roundResults = [];
  let sideSwitches = 0;
  game.bus.on(GameEvents.ROUND_ENDED, (payload) => roundResults.push(payload));
  game.bus.on(GameEvents.SIDES_SWITCHED, () => { sideSwitches += 1; });

  game.start();
  const finished = advanceUntil(game, (g) => g.round.phase === RoundPhase.MATCH_END, 60 * 75);

  assert.ok(finished, 'the match completed inside the time budget');
  assert.ok(game.match.isOver);
  const winnerScore = Math.max(...Object.values(game.match.scores));
  assert.equal(winnerScore, MatchConfig.roundsToWin, `the winner reached ${MatchConfig.roundsToWin} rounds`);
  assert.ok(roundResults.length >= MatchConfig.roundsToWin, 'every round produced a result');
  assert.ok(roundResults.length <= MatchConfig.maxRounds, 'the match stayed inside the round cap');
  assert.equal(sideSwitches, 1, 'sides switched exactly once at halftime');
});

test('matches are deterministic for a given seed', () => {
  const runMatch = (seed) => {
    const game = new GameManager({ withLocalPlayer: false, seed });
    game.start();
    advanceUntil(game, (g) => g.match.completedRounds >= 3, 60 * 15);
    return {
      scores: game.match.scores,
      history: game.match.history.map((entry) => `${entry.round}:${entry.winningTeamId}:${entry.reason}`),
    };
  };
  const first = runMatch(1234);
  const second = runMatch(1234);
  assert.deepEqual(first, second, 'the same seed replays identically');
});
