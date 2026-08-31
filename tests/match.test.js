import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, advance, advanceUntil, collectEvents } from './helpers.js';
import { MatchConfig, EconomyConfig, RoundPhase, RoundEndReason } from '../src/config/gameplay.config.js';
import { GameEvents } from '../src/core/events/GameEvents.js';

/** Drives whole rounds without simulating them: the fastest way to test match rules. */
function fastMatch() {
  const game = createTestGame({ teamSize: 1 });
  game.addPlayer({ name: 'A', classId: 'RANGER', teamId: 'TEAM_ONE' });
  game.addPlayer({ name: 'D', classId: 'RANGER', teamId: 'TEAM_TWO' });
  game.start();
  return game;
}

/** Ends the current round in favour of `teamId` and rolls into the next one. */
function winRound(game, teamId) {
  advanceUntil(game, (g) => g.round.phase === RoundPhase.LIVE, 60);
  game.round._endRound(teamId, RoundEndReason.TIME_EXPIRED);
  advanceUntil(
    game,
    (g) => g.round.phase === RoundPhase.BUY || g.round.phase === RoundPhase.MATCH_END,
    60,
  );
}

test('scores accumulate per team and are reported', () => {
  const game = fastMatch();
  const scoreEvents = collectEvents(game.bus, GameEvents.SCORE_CHANGED);
  winRound(game, 'TEAM_ONE');
  winRound(game, 'TEAM_TWO');
  winRound(game, 'TEAM_ONE');
  assert.deepEqual(game.match.scores, { TEAM_ONE: 2, TEAM_TWO: 1 });
  assert.equal(scoreEvents.length, 3);
});

test(`sides switch after round ${MatchConfig.switchSidesAfterRound}`, () => {
  const game = fastMatch();
  const sidesBefore = game.teams.describeSides();
  const switches = collectEvents(game.bus, GameEvents.SIDES_SWITCHED);

  for (let round = 1; round <= MatchConfig.switchSidesAfterRound; round++) {
    assert.deepEqual(
      game.teams.describeSides(), sidesBefore,
      `sides are unchanged during round ${round}`,
    );
    winRound(game, round % 2 === 0 ? 'TEAM_ONE' : 'TEAM_TWO');
  }

  assert.equal(switches.length, 1, 'exactly one switch happened');
  assert.equal(game.teams.sideOf('TEAM_ONE'), sidesBefore.TEAM_TWO, 'team one now defends');
  assert.equal(game.teams.sideOf('TEAM_TWO'), sidesBefore.TEAM_ONE, 'team two now attacks');
  assert.deepEqual(game.match.scores, { TEAM_ONE: 6, TEAM_TWO: 6 }, 'scores survive the switch');
});

test('money and weapons reset at the side switch (second-half pistol round)', () => {
  const game = fastMatch();
  const player = game.world.characters[0];
  for (let round = 1; round <= MatchConfig.switchSidesAfterRound; round++) {
    player.money = 16000;
    player.inventory.giveWeapon('rifle_ranger');
    winRound(game, 'TEAM_ONE');
  }
  assert.equal(player.money, EconomyConfig.startingMoney, 'money reset for the new half');
  assert.equal(player.inventory.getWeapon('primary'), null, 'gear was wiped for the new half');
});

test(`the match ends when a team reaches ${MatchConfig.roundsToWin} round wins`, () => {
  const game = fastMatch();
  const ended = collectEvents(game.bus, GameEvents.MATCH_ENDED);

  for (let round = 1; round <= MatchConfig.roundsToWin; round++) {
    assert.ok(!game.match.isOver, `match still running at ${round - 1} wins`);
    winRound(game, 'TEAM_ONE');
  }

  assert.equal(ended.length, 1, 'the match ended exactly once');
  assert.equal(ended[0].winningTeamId, 'TEAM_ONE');
  assert.equal(game.match.scores.TEAM_ONE, MatchConfig.roundsToWin);
  assert.ok(game.match.completedRounds >= MatchConfig.roundsToWin);

  advanceUntil(game, (g) => g.round.phase === RoundPhase.MATCH_END, 30);
  assert.equal(game.round.phase, RoundPhase.MATCH_END, 'the game settles in the match-end phase');
});

test('a 12-12 match is decided in the second half, not before', () => {
  const game = fastMatch();
  // 12 rounds split 6-6, then team two takes the 13th.
  for (let round = 1; round <= 12; round++) winRound(game, round % 2 === 0 ? 'TEAM_ONE' : 'TEAM_TWO');
  assert.deepEqual(game.match.scores, { TEAM_ONE: 6, TEAM_TWO: 6 });
  assert.ok(!game.match.isOver);

  for (let round = 13; round <= 19; round++) winRound(game, 'TEAM_TWO');
  assert.equal(game.match.scores.TEAM_TWO, 13);
  assert.ok(game.match.isOver);
  assert.equal(game.match.winningTeamId, 'TEAM_TWO');
});

test('match point is reported for the UI', () => {
  const game = fastMatch();
  for (let round = 1; round < MatchConfig.roundsToWin; round++) winRound(game, 'TEAM_ONE');
  assert.ok(game.match.isMatchPoint(), 'one win away is match point');
});

test('no further rounds start once the match is over', () => {
  const game = fastMatch();
  for (let round = 1; round <= MatchConfig.roundsToWin; round++) winRound(game, 'TEAM_ONE');
  const roundNumber = game.match.roundNumber;
  advance(game, 60);
  assert.equal(game.match.roundNumber, roundNumber, 'the round counter stopped');
  assert.equal(game.round.phase, RoundPhase.MATCH_END);
});

test('the loss streak resets on a win and drives the loss bonus', () => {
  const game = fastMatch();
  winRound(game, 'TEAM_ONE');
  winRound(game, 'TEAM_ONE');
  assert.equal(game.teams.get('TEAM_TWO').lossStreak, 2);
  assert.equal(game.teams.get('TEAM_ONE').lossStreak, 0);
  winRound(game, 'TEAM_TWO');
  assert.equal(game.teams.get('TEAM_TWO').lossStreak, 0, 'a win clears the streak');
});
