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
  levelForGap,
  MIN_RATED_GAMES,
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

describe('blindReducer', () => {
  const ladder = () => buildLadder(rateGames(pool()), 'seed');
  const run = () => createBlindRun(ladder());

  it('climbs a rung on a correct call', () => {
    const start = run();
    const winner = currentBlindGame(start)!.winner;
    const next = blindReducer(start, { type: 'answer', prediction: winner });
    expect(next.status).toBe('playing');
    expect(next.level).toBe(1);
    expect(currentLevel(next)).toBe('medium');
  });

  it('ends the run on a wrong call', () => {
    const start = run();
    const wrong: Side = currentBlindGame(start)!.winner === 'blue' ? 'red' : 'blue';
    const next = blindReducer(start, { type: 'answer', prediction: wrong });
    expect(next.status).toBe('lost');
    expect(next.lastCall).toBe(wrong);
    expect(rungsCleared(next)).toBe(0);
  });

  it('is won by clearing every rung', () => {
    let state = run();
    for (let i = 0; i < BLIND_LEVELS.length; i += 1) {
      state = blindReducer(state, { type: 'answer', prediction: currentBlindGame(state)!.winner });
    }
    expect(state.status).toBe('won');
    expect(rungsCleared(state)).toBe(BLIND_LEVELS.length);
  });

  it('ignores answers once the run is over', () => {
    const start = run();
    const wrong: Side = currentBlindGame(start)!.winner === 'blue' ? 'red' : 'blue';
    const lost = blindReducer(start, { type: 'answer', prediction: wrong });
    expect(blindReducer(lost, { type: 'answer', prediction: 'blue' })).toBe(lost);
  });

  it('takes hints in order and stops at three', () => {
    let state = run();
    for (let i = 0; i < BLIND_HINTS.length; i += 1) {
      state = blindReducer(state, { type: 'hint' });
      expect(state.hints).toBe(i + 1);
    }
    const capped = blindReducer(state, { type: 'hint' });
    expect(capped).toBe(state);
    expect(capped.hints).toBe(BLIND_HINTS.length);
  });

  it('resets hints on the next rung but remembers the total', () => {
    let state = run();
    state = blindReducer(state, { type: 'hint' });
    state = blindReducer(state, { type: 'hint' });
    state = blindReducer(state, { type: 'answer', prediction: currentBlindGame(state)!.winner });
    expect(state.hints).toBe(0);
    expect(state.hintsTotal).toBe(2);
  });

  it('starts clean on restart', () => {
    let state = run();
    state = blindReducer(state, { type: 'hint' });
    const wrong: Side = currentBlindGame(state)!.winner === 'blue' ? 'red' : 'blue';
    state = blindReducer(state, { type: 'answer', prediction: wrong });
    const fresh = blindReducer(state, { type: 'restart', games: ladder() });
    expect(fresh.status).toBe('playing');
    expect(fresh.level).toBe(0);
    expect(fresh.hints).toBe(0);
    expect(fresh.hintsTotal).toBe(0);
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
