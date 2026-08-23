import { describe, expect, it } from 'vitest';
import {
  BLIND_HINTS,
  BLIND_LEVELS,
  BlindLadderError,
  blindReducer,
  buildLadder,
  createBlindRun,
  currentBlindGame,
  currentLevel,
  hintUnlocked,
  awardFor,
  BLIND_TIME_MS,
  lastResult,
  levelForGap,
  LEVEL_POINTS,
  MAX_BLIND_SCORE,
  MIN_RATED_GAMES,
  speedFactor,
  SPEED_SHARE,
  timeChart,
  chartAxis,
  BLIND_TIME_SECONDS,
  rateGames,
  rungsCleared,
} from './blind.ts';
import { makeChampion } from '../domain/champions.ts';
import { ROLES, type Game, type Side } from '../domain/types.ts';

const DRAFT_A = ['Aatrox', 'Viego', 'Azir', 'Jinx', 'Thresh'];
const DRAFT_B = ['Gnar', 'Sejuani', 'Orianna', 'Ezreal', 'Nautilus'];

function makeGame(id: string, blue: string, red: string, winner: Side): Game {
  const build = (side: Side, teamName: string, draft: string[]) => ({
    side,
    teamName,
    teamId: null,
    tag: teamName.slice(0, 3).toUpperCase(),
    players: ROLES.map((role, index) => ({
      role,
      playerName: `${teamName}-${role}`,
      playerId: null,
      champion: makeChampion(draft[index]!)!,
    })),
    bans: [makeChampion('Rumble')!, makeChampion('Yone')!, makeChampion('Kalista')!],
    goldDiff: null,
  });

  return {
    gameId: id,
    competition: 'LCK',
    sourceLeague: 'LCK',
    tournamentLabel: 'Test',
    season: '2026',
    split: 'Summer',
    date: '2026-07-01T09:00:00.000Z',
    patch: '16.01',
    stage: { kind: 'regular', label: 'Regular Season', elimination: false },
    seriesFormat: 'BO3',
    seriesFormatInferred: true,
    gameNumber: 1,
    blue: build('blue', blue, DRAFT_A),
    red: build('red', red, DRAFT_B),
    winner,
    durationSeconds: 1800,
    demo: false,
  };
}

/**
 * A pool where `strong` wins almost everything and `weak` loses almost
 * everything, plus two evenly matched teams — enough to fill every rung.
 */
function pool(): Game[] {
  const games: Game[] = [];
  let n = 0;
  const add = (blue: string, red: string, winner: Side) =>
    games.push(makeGame(`g${(n += 1)}`, blue, red, winner));

  // Strong: 18-2 against filler. Weak: 2-18.
  for (let i = 0; i < 18; i += 1) add('Strong', `Filler${i % 4}`, 'blue');
  for (let i = 0; i < 2; i += 1) add('Strong', `Filler${i % 4}`, 'red');
  for (let i = 0; i < 18; i += 1) add('Weak', `Filler${i % 4}`, 'red');
  for (let i = 0; i < 2; i += 1) add('Weak', `Filler${i % 4}`, 'blue');
  // Two mid teams at ~50%, and a pair a little apart.
  for (let i = 0; i < 10; i += 1) add('MidA', `Filler${i % 4}`, i % 2 === 0 ? 'blue' : 'red');
  for (let i = 0; i < 10; i += 1) add('MidB', `Filler${i % 4}`, i % 2 === 0 ? 'blue' : 'red');
  for (let i = 0; i < 14; i += 1) add('Upper', `Filler${i % 4}`, i % 3 === 0 ? 'red' : 'blue');
  for (let i = 0; i < 14; i += 1) add('Lower', `Filler${i % 4}`, i % 3 === 0 ? 'blue' : 'red');

  // The rungs themselves.
  add('Strong', 'Weak', 'blue'); // huge gap, favourite won → easy
  add('Upper', 'Lower', 'blue'); // moderate gap → medium
  add('Upper', 'MidA', 'blue'); // small gap → hard
  add('MidA', 'MidB', 'blue'); // level → impossible
  return games;
}

describe('levelForGap', () => {
  it('sorts a gap onto the right rung', () => {
    expect(levelForGap(0.4)).toBe('easy');
    expect(levelForGap(0.22)).toBe('easy');
    expect(levelForGap(0.21)).toBe('medium');
    expect(levelForGap(0.12)).toBe('medium');
    expect(levelForGap(0.11)).toBe('hard');
    expect(levelForGap(0.05)).toBe('hard');
    expect(levelForGap(0.04)).toBe('impossible');
    expect(levelForGap(0)).toBe('impossible');
  });

  it('gets harder as the gap narrows, which is the whole ladder', () => {
    const order = [0.4, 0.15, 0.08, 0.01].map(levelForGap);
    expect(order).toEqual(['easy', 'medium', 'hard', 'impossible']);
  });
});

describe('rateGames', () => {
  it('excludes the game being rated from both records', () => {
    // Two teams that split 2 games. Including the game itself would make the
    // winner look stronger and turn a dead-even pair into a favourite.
    const games: Game[] = [];
    for (let i = 0; i < 10; i += 1) {
      games.push(makeGame(`a${i}`, 'Even1', `F${i % 3}`, i % 2 === 0 ? 'blue' : 'red'));
      games.push(makeGame(`b${i}`, 'Even2', `F${i % 3}`, i % 2 === 0 ? 'blue' : 'red'));
    }
    games.push(makeGame('head', 'Even1', 'Even2', 'blue'));

    const rated = rateGames(games);
    const head = rated.find((entry) => entry.game.gameId === 'head')!;
    expect(head.gap).toBeCloseTo(0, 10);
    expect(head.level).toBe('impossible');
    // With the game left in, blue would sit above red and read as a favourite.
    expect(head.favouriteWon).toBe(false);
  });

  it('ignores teams with too few games to judge', () => {
    const games = [makeGame('only', 'Newbie', 'Rookie', 'blue')];
    expect(rateGames(games)).toHaveLength(0);
    expect(MIN_RATED_GAMES).toBeGreaterThan(1);
  });

  it('rates a lopsided matchup as easy and a level one as impossible', () => {
    const rated = rateGames(pool());
    const byId = new Map(rated.map((entry) => [entry.game.gameId, entry]));
    const lopsided = [...byId.values()].find(
      (e) => e.game.blue.teamName === 'Strong' && e.game.red.teamName === 'Weak',
    )!;
    const level = [...byId.values()].find(
      (e) => e.game.blue.teamName === 'MidA' && e.game.red.teamName === 'MidB',
    )!;
    expect(lopsided.level).toBe('easy');
    expect(lopsided.favouriteWon).toBe(true);
    expect(level.level).toBe('impossible');
  });
});

describe('buildLadder', () => {
  it('returns one game per rung, easy first', () => {
    const ladder = buildLadder(rateGames(pool()), 'seed');
    expect(ladder).toHaveLength(BLIND_LEVELS.length);
    const rated = rateGames(pool());
    const levelOf = new Map(rated.map((e) => [e.game.gameId, e.level]));
    expect(ladder.map((game) => levelOf.get(game.gameId))).toEqual([...BLIND_LEVELS]);
  });

  it('never repeats a game', () => {
    const ladder = buildLadder(rateGames(pool()), 'seed');
    expect(new Set(ladder.map((g) => g.gameId)).size).toBe(ladder.length);
  });

  it('is reproducible from the seed, and varies with it', () => {
    const rated = rateGames(pool());
    const a = buildLadder(rated, 'one').map((g) => g.gameId);
    const b = buildLadder(rated, 'one').map((g) => g.gameId);
    expect(a).toEqual(b);
  });

  it('only offers an easy game the favourite actually won', () => {
    // The first rung has to be winnable: without this, roughly a fifth of easy
    // questions would be upsets and reading the form book would lose.
    const rated = rateGames(pool());
    const byId = new Map(rated.map((entry) => [entry.game.gameId, entry]));
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const easy = byId.get(buildLadder(rated, seed)[0]!.gameId)!;
      expect(easy.level).toBe('easy');
      expect(easy.favouriteWon).toBe(true);
    }
    // Upsets do exist in the band, so this is a real filter and not a no-op.
    expect(rated.some((e) => e.level === 'easy' && !e.favouriteWon)).toBe(true);
  });

  it('says which rung it could not fill', () => {
    try {
      buildLadder([], 'seed');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BlindLadderError);
      expect((error as BlindLadderError).level).toBe('easy');
      expect((error as BlindLadderError).message).toContain('easy');
    }
  });
});

describe('awardFor', () => {
  it('pays the face value for an instant, hint-free correct call, plus speed', () => {
    const award = awardFor('easy', 0, 0);
    expect(award.base).toBe(LEVEL_POINTS.easy);
    expect(award.speedBonus).toBe(Math.round(LEVEL_POINTS.easy * SPEED_SHARE));
    expect(award.total).toBe(LEVEL_POINTS.easy + award.speedBonus);
  });

  it('falls to the base alone once the clock is spent', () => {
    expect(awardFor('hard', 0, BLIND_TIME_MS).total).toBe(LEVEL_POINTS.hard);
    // And never below it, however late the call.
    expect(awardFor('hard', 0, BLIND_TIME_MS * 3).total).toBe(LEVEL_POINTS.hard);
  });

  it('scales the bonus linearly with the clock', () => {
    const half = awardFor('impossible', 0, BLIND_TIME_MS / 2);
    expect(half.speedBonus).toBe(Math.round(LEVEL_POINTS.impossible * SPEED_SHARE * 0.5));
    const quarter = awardFor('impossible', 0, BLIND_TIME_MS * 0.75);
    expect(quarter.speedBonus).toBeLessThan(half.speedBonus);
  });

  it('is worth more the harder the level, at the same speed', () => {
    const totals = BLIND_LEVELS.map((level) => awardFor(level, 0, 1000).total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  });

  it('discounts the speed bonus too, so hints cannot be spent for free', () => {
    const clean = awardFor('impossible', 0, 0);
    const hinted = awardFor('impossible', 3, 0);
    expect(hinted.hintMultiplier).toBeCloseTo(0.25, 10);
    expect(hinted.total).toBe(Math.round(clean.total * 0.25));
    // Three hints and a snap answer must not beat a slow, unaided read.
    expect(hinted.total).toBeLessThan(awardFor('impossible', 0, BLIND_TIME_MS).total);
  });

  it('never pays a negative amount', () => {
    for (const level of BLIND_LEVELS) {
      for (let hints = 0; hints <= 6; hints += 1) {
        expect(awardFor(level, hints, BLIND_TIME_MS).total).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('speedFactor', () => {
  it('runs from a full share to none, and clamps outside the clock', () => {
    expect(speedFactor(0)).toBe(1);
    expect(speedFactor(BLIND_TIME_MS / 4)).toBeCloseTo(0.75, 10);
    expect(speedFactor(BLIND_TIME_MS)).toBe(0);
    expect(speedFactor(BLIND_TIME_MS * 2)).toBe(0);
    expect(speedFactor(-500)).toBe(1);
  });

  it('is zero when there is no clock to race', () => {
    expect(speedFactor(0, 0)).toBe(0);
  });
});

describe('blindReducer', () => {
  const ladder = () => buildLadder(rateGames(pool()), 'seed');
  const run = () => createBlindRun(ladder());
  const right = (state: ReturnType<typeof run>, elapsedMs = 0) =>
    blindReducer(state, {
      type: 'answer',
      prediction: currentBlindGame(state)!.winner,
      elapsedMs,
    });
  const wrong = (state: ReturnType<typeof run>, elapsedMs = 0) =>
    blindReducer(state, {
      type: 'answer',
      prediction: currentBlindGame(state)!.winner === 'blue' ? 'red' : 'blue',
      elapsedMs,
    });

  it('banks the level points plus speed for a correct call', () => {
    const revealed = right(run(), 0);
    expect(revealed.status).toBe('revealing');
    expect(revealed.score).toBe(awardFor('easy', 0, 0).total);
    expect(lastResult(revealed)!.correct).toBe(true);
    expect(lastResult(revealed)!.speedBonus).toBeGreaterThan(0);
  });

  it('pays less for the same correct call made later', () => {
    const fast = right(run(), 1_000).score;
    const slow = right(run(), BLIND_TIME_MS - 1_000).score;
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThanOrEqual(LEVEL_POINTS.easy);
  });

  it('records the time taken and totals it across the run', () => {
    let state = right(run(), 5_000);
    expect(lastResult(state)!.elapsedMs).toBe(5_000);
    expect(state.timeMs).toBe(5_000);
    state = blindReducer(state, { type: 'next' });
    state = wrong(state, 3_000);
    expect(state.timeMs).toBe(8_000);
  });

  it('treats a timeout as a miss that still costs the clock', () => {
    const timedOut = blindReducer(run(), {
      type: 'answer',
      prediction: null,
      elapsedMs: BLIND_TIME_MS,
    });
    const result = lastResult(timedOut)!;
    expect(result.correct).toBe(false);
    expect(result.call).toBeNull();
    expect(result.points).toBe(0);
    expect(timedOut.timeMs).toBe(BLIND_TIME_MS);
    // And the run carries on, same as a wrong call.
    expect(blindReducer(timedOut, { type: 'next' }).status).toBe('playing');
  });

  it('scores a wrong call zero and carries the run on', () => {
    const revealed = wrong(run());
    expect(revealed.score).toBe(0);
    expect(lastResult(revealed)!.points).toBe(0);

    const next = blindReducer(revealed, { type: 'next' });
    expect(next.status).toBe('playing');
    expect(next.level).toBe(1);
    expect(currentLevel(next)).toBe('medium');
  });

  it('plays all four levels however they go', () => {
    let state = run();
    for (let i = 0; i < BLIND_LEVELS.length; i += 1) {
      state = blindReducer(i % 2 === 0 ? right(state) : wrong(state), { type: 'next' });
    }
    expect(state.status).toBe('finished');
    expect(state.results).toHaveLength(BLIND_LEVELS.length);
    expect(rungsCleared(state)).toBe(2);
  });

  it('tops out at the advertised maximum', () => {
    let state = run();
    for (let i = 0; i < BLIND_LEVELS.length; i += 1) {
      state = blindReducer(right(state, 0), { type: 'next' });
    }
    expect(state.score).toBe(MAX_BLIND_SCORE);
  });

  it('cannot answer twice on one level', () => {
    const revealed = right(run());
    expect(blindReducer(revealed, { type: 'answer', prediction: 'blue', elapsedMs: 0 })).toBe(
      revealed,
    );
  });

  it('ignores next outside the reveal', () => {
    const start = run();
    expect(blindReducer(start, { type: 'next' })).toBe(start);
  });

  it('takes hints in order and stops at three', () => {
    let state = run();
    for (let i = 0; i < BLIND_HINTS.length; i += 1) {
      state = blindReducer(state, { type: 'hint' });
      expect(state.hints).toBe(i + 1);
    }
    expect(blindReducer(state, { type: 'hint' })).toBe(state);
  });

  it('charges each hint against the level it was spent on', () => {
    let state = run();
    state = blindReducer(state, { type: 'hint' });
    state = blindReducer(state, { type: 'hint' });
    const revealed = right(state, 2_000);
    expect(revealed.score).toBe(awardFor('easy', 2, 2_000).total);
    expect(revealed.score).toBeLessThan(awardFor('easy', 0, 2_000).total);
    expect(lastResult(revealed)!.hints).toBe(2);
  });

  it('cannot take a hint during the reveal', () => {
    const revealed = right(run());
    expect(blindReducer(revealed, { type: 'hint' })).toBe(revealed);
  });

  it('resets hints on the next level but remembers the total', () => {
    let state = run();
    state = blindReducer(state, { type: 'hint' });
    state = blindReducer(state, { type: 'hint' });
    state = blindReducer(right(state), { type: 'next' });
    expect(state.hints).toBe(0);
    expect(state.hintsTotal).toBe(2);
  });

  it('starts clean on restart', () => {
    let state = run();
    state = blindReducer(state, { type: 'hint' });
    state = blindReducer(wrong(state, 4_000), { type: 'next' });
    const fresh = blindReducer(state, { type: 'restart', games: ladder() });
    expect(fresh).toEqual(createBlindRun(fresh.games));
    expect(fresh.score).toBe(0);
    expect(fresh.timeMs).toBe(0);
  });
});

describe('timeChart', () => {
  const ladder = () => buildLadder(rateGames(pool()), 'seed');
  const answer = (state: ReturnType<typeof createBlindRun>, correct: boolean, elapsedMs: number) =>
    blindReducer(
      blindReducer(state, {
        type: 'answer',
        prediction: correct
          ? currentBlindGame(state)!.winner
          : currentBlindGame(state)!.winner === 'blue'
            ? 'red'
            : 'blue',
        elapsedMs,
      }),
      { type: 'next' },
    );

  it('keeps a slot for every level from the start', () => {
    const chart = timeChart(createBlindRun(ladder()));
    expect(chart.map((point) => point.level)).toEqual([...BLIND_LEVELS]);
    expect(chart.every((point) => point.seconds === null)).toBe(true);
  });

  it('rounds to whole seconds', () => {
    // 6.914s is noise pretending to be information on a bar chart.
    let state = createBlindRun(ladder());
    state = answer(state, true, 6_914);
    state = answer(state, true, 12_500);
    state = answer(state, true, 12_499);
    expect(timeChart(state).map((point) => point.seconds)).toEqual([7, 13, 12, null]);
  });

  it('marks each bar right, wrong or timed out', () => {
    let state = createBlindRun(ladder());
    state = answer(state, true, 1_000);
    state = answer(state, false, 2_000);
    state = blindReducer(
      blindReducer(state, { type: 'answer', prediction: null, elapsedMs: 45_000 }),
      { type: 'next' },
    );
    const chart = timeChart(state);
    expect(chart[0]).toMatchObject({ correct: true, timedOut: false });
    expect(chart[1]).toMatchObject({ correct: false, timedOut: false });
    expect(chart[2]).toMatchObject({ correct: false, timedOut: true, seconds: 45 });
    expect(chart[3]!.seconds).toBeNull();
  });

  it('reports the clock in the same whole seconds the bars use', () => {
    expect(BLIND_TIME_SECONDS).toBe(45);
    expect(Number.isInteger(BLIND_TIME_SECONDS)).toBe(true);
  });

  it('scales the axis to the slowest round, not the whole clock', () => {
    // Four calls inside ten seconds against a 45s axis is four identical
    // stubs; against the slowest of them the differences are the chart.
    let state = createBlindRun(ladder());
    state = answer(state, true, 1_000);
    state = answer(state, true, 5_000);
    state = answer(state, true, 3_000);
    expect(chartAxis(timeChart(state))).toBe(5);
  });

  it('never divides by zero on an unplayed or instant run', () => {
    expect(chartAxis(timeChart(createBlindRun(ladder())))).toBe(1);
    const instant = answer(createBlindRun(ladder()), true, 200);
    expect(chartAxis(timeChart(instant))).toBe(1);
  });
});

describe('hintUnlocked', () => {
  it('reveals in the stated order', () => {
    expect(hintUnlocked('teams', 0)).toBe(false);
    expect(hintUnlocked('teams', 1)).toBe(true);
    expect(hintUnlocked('meta', 1)).toBe(false);
    expect(hintUnlocked('meta', 2)).toBe(true);
    expect(hintUnlocked('event', 2)).toBe(false);
    expect(hintUnlocked('event', 3)).toBe(true);
  });
});
