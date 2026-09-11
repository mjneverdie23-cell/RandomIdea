import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '../data/demoDataset.ts';
import {
  availableFor,
  checkEligibility,
  computeAvailability,
  filterByPeriod,
  filterBySource,
  generateQuiz,
  QuizGenerationError,
} from './generator.ts';
import { compareYears, yearOf } from '../data/years.ts';
import { COMPETITION_IDS, competitionScope } from '../domain/competitions.ts';
import { ALL_PERIOD, MIXED_SOURCE, type QuizPeriod } from './config.ts';
import { createRng, hashSeed } from './rng.ts';
import type { Game } from '../domain/types.ts';

const dataset = buildDemoDataset();

describe('demo dataset', () => {
  it('produces a usable pool across every configured competition', () => {
    expect(dataset.games.length).toBeGreaterThan(300);
    for (const count of Object.values(dataset.stats.perCompetition)) {
      expect(count).toBeGreaterThan(0);
    }
    // Read from the registry rather than listed, so a competition added to
    // `competitions.ts` without demo games fails here instead of silently
    // producing an empty filter.
    expect(Object.keys(dataset.stats.perCompetition).sort()).toEqual([...COMPETITION_IDS].sort());
  });

  it('marks every game as demo data', () => {
    expect(dataset.games.every((game) => game.demo)).toBe(true);
  });

  it('is deterministic for a fixed seed', () => {
    const again = buildDemoDataset();
    expect(again.games.map((g) => g.gameId)).toEqual(dataset.games.map((g) => g.gameId));
  });

  it('gives every game a complete, quiz-eligible draft', () => {
    for (const game of dataset.games) {
      expect(checkEligibility(game).eligible).toBe(true);
      expect(game.blue.players).toHaveLength(5);
      expect(game.red.players).toHaveLength(5);
      expect(game.blue.bans).toHaveLength(5);
    }
  });

  it('never repeats a champion inside a single game', () => {
    for (const game of dataset.games.slice(0, 60)) {
      const picks = [...game.blue.players, ...game.red.players].map((p) => p.champion.id);
      expect(new Set(picks).size).toBe(picks.length);
    }
  });
});

describe('checkEligibility', () => {
  const base = dataset.games[0]!;

  it('rejects a mirror matchup', () => {
    const broken: Game = { ...base, red: { ...base.red, teamName: base.blue.teamName } };
    expect(checkEligibility(broken).reason).toBe('mirror matchup');
  });

  it('rejects an incomplete roster', () => {
    const broken: Game = { ...base, blue: { ...base.blue, players: base.blue.players.slice(0, 3) } };
    expect(checkEligibility(broken).reason).toBe('incomplete roster');
  });

  it('rejects an unparseable date', () => {
    expect(checkEligibility({ ...base, date: 'not-a-date' }).reason).toBe('invalid date');
  });
});

describe('generateQuiz', () => {
  it('returns the requested number of distinct games', () => {
    const quiz = generateQuiz(dataset.games, {
      source: MIXED_SOURCE,
      period: ALL_PERIOD,
      questionCount: 25,
      mode: 'matchups',
      seed: 'ABC123',
    });
    expect(quiz.games).toHaveLength(25);
    expect(new Set(quiz.games.map((g) => g.gameId)).size).toBe(25);
  });

  it('is reproducible from its seed', () => {
    const config = {
      source: MIXED_SOURCE,
      period: ALL_PERIOD,
      questionCount: 10,
      mode: 'matchups',
      seed: 'SEED-1',
    } as const;
    const a = generateQuiz(dataset.games, config);
    const b = generateQuiz(dataset.games, config);
    expect(a.games.map((g) => g.gameId)).toEqual(b.games.map((g) => g.gameId));
  });

  it('produces a different run for a different seed', () => {
    const a = generateQuiz(dataset.games, {
      source: MIXED_SOURCE,
      period: ALL_PERIOD,
      questionCount: 10,
      mode: 'matchups',
      seed: 'SEED-1',
    });
    const b = generateQuiz(dataset.games, {
      source: MIXED_SOURCE,
      period: ALL_PERIOD,
      questionCount: 10,
      mode: 'matchups',
      seed: 'SEED-2',
    });
    expect(a.games.map((g) => g.gameId)).not.toEqual(b.games.map((g) => g.gameId));
  });

  it('restricts a single-competition run to that competition', () => {
    const quiz = generateQuiz(dataset.games, {
      source: { kind: 'single', competition: 'WORLDS' },
      period: ALL_PERIOD,
      questionCount: 10,
      mode: 'matchups',
      seed: 'W',
    });
    expect(quiz.games.every((game) => game.competition === 'WORLDS')).toBe(true);
  });

  it('refuses configurations the pool cannot satisfy', () => {
    const tiny = dataset.games.slice(0, 4);
    expect(() =>
      generateQuiz(tiny, {
        source: MIXED_SOURCE,
        period: ALL_PERIOD,
        questionCount: 10,
        mode: 'matchups',
        seed: 'X',
      }),
    ).toThrow(QuizGenerationError);
  });
});

describe('period filtering', () => {
  const availability = computeAvailability(dataset.games);
  const firstSeason = availability.seasons.find((season) => season.splits.length > 0);

  it('exposes the seasons present, newest first', () => {
    expect(availability.seasons.length).toBeGreaterThan(0);
    const years = availability.seasons.map((season) => season.year);
    expect(years).toEqual([...years].sort(compareYears));
  });

  it('keeps a year selection to that year', () => {
    const year = availability.seasons[0]!.year;
    const kept = filterByPeriod(dataset.games, { kind: 'year', year });
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((game) => yearOf(game) === year)).toBe(true);
  });

  it('keeps a split selection to that split', () => {
    if (!firstSeason) return;
    const split = firstSeason.splits[0]!;
    const kept = filterByPeriod(dataset.games, { kind: 'split', year: firstSeason.year, split });
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((game) => yearOf(game) === firstSeason.year && game.split === split)).toBe(
      true,
    );
  });

  it('counts a split as a subset of its year', () => {
    if (!firstSeason) return;
    const year = firstSeason.year;
    const whole = availableFor(availability, MIXED_SOURCE, { kind: 'year', year });
    const parts = firstSeason.splits.reduce(
      (sum, split) => sum + availableFor(availability, MIXED_SOURCE, { kind: 'split', year, split }),
      0,
    );
    // Not equal: games with no split of their own — Worlds, MSI — belong to
    // the year and to none of its splits.
    expect(parts).toBeLessThanOrEqual(whole);
    expect(parts).toBeGreaterThan(0);
  });

  it('sums every year back to the overall total', () => {
    const summed = availability.seasons.reduce(
      (sum, season) =>
        sum + availableFor(availability, MIXED_SOURCE, { kind: 'year', year: season.year }),
      0,
    );
    expect(summed).toBe(availability.total);
  });

  it('agrees with the counts it precomputed', () => {
    for (const season of availability.seasons) {
      for (const source of [MIXED_SOURCE, { kind: 'single' as const, competition: 'LCK' as const }]) {
        const period = { kind: 'year' as const, year: season.year };
        const filtered = filterByPeriod(filterBySource(dataset.games, source), period);
        expect(availableFor(availability, source, period)).toBe(filtered.length);
      }
    }
  });

  it('draws a quiz from the chosen split only', () => {
    if (!firstSeason) return;
    const split = firstSeason.splits[0]!;
    const period = { kind: 'split' as const, year: firstSeason.year, split };
    const available = availableFor(availability, MIXED_SOURCE, period);
    if (available < 10) return;
    const quiz = generateQuiz(dataset.games, {
      source: MIXED_SOURCE,
      period,
      questionCount: 10,
      mode: 'games',
      seed: 'SPLIT',
    });
    expect(quiz.games).toHaveLength(10);
    expect(
      quiz.games.every((game) => yearOf(game) === firstSeason.year && game.split === split),
    ).toBe(true);
  });

  it('gives independent draws for the same seed across periods', () => {
    // Pick a year that selects the whole pool, so the two runs draw from
    // identical games and the ONLY difference is the period in the seed. If
    // the period were left out of the seed these would come back equal.
    const whole = availability.seasons.find(
      (season) =>
        availableFor(availability, MIXED_SOURCE, { kind: 'year', year: season.year }) ===
        availability.total,
    );
    expect(whole).toBeDefined();
    const draw = (period: QuizPeriod) =>
      generateQuiz(dataset.games, {
        source: MIXED_SOURCE,
        period,
        questionCount: 10,
        mode: 'games',
        seed: 'SAME',
      }).games.map((game) => game.gameId);

    const asAll = draw(ALL_PERIOD);
    const asYear = draw({ kind: 'year', year: whole!.year });
    expect(asYear).not.toEqual(asAll);
    // Same pool, so both are valid draws — this is about independence, not
    // about one of them being wrong.
    expect(new Set(asYear).size).toBe(10);
  });

  it('never offers an international stage as a split', () => {
    const offered = new Set(availability.seasons.flatMap((season) => season.splits));
    for (const stage of ['Play-In', 'Main Event', 'Swiss Stage', 'Knockout', 'Quarterfinal']) {
      expect(offered.has(stage)).toBe(false);
    }
    // Those games are still reachable — they belong to their year.
    const international = dataset.games.filter(
      (game) => competitionScope(game.competition) === 'international',
    );
    expect(international.length).toBeGreaterThan(0);
    const year = yearOf(international[0]!);
    expect(filterByPeriod(dataset.games, { kind: 'year', year })).toEqual(
      expect.arrayContaining([international[0]!]),
    );
  });
});

describe('computeAvailability', () => {
  it('counts eligible games overall and per competition', () => {
    const availability = computeAvailability(dataset.games);
    expect(availability.total).toBe(dataset.games.length);
    expect(availableFor(availability, MIXED_SOURCE)).toBe(availability.total);
    expect(availableFor(availability, { kind: 'single', competition: 'LCK' })).toBe(
      availability.perCompetition.LCK,
    );
    const summed = Object.values(availability.perCompetition).reduce((a, b) => a + b, 0);
    expect(summed).toBe(availability.total);
  });
});

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng('seed');
    const b = createRng('seed');
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('samples without replacement', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const sample = createRng('s').sample(items, 20);
    expect(sample).toHaveLength(20);
    expect(new Set(sample).size).toBe(20);
  });

  it('caps a sample at the pool size', () => {
    expect(createRng('s').sample([1, 2, 3], 10)).toHaveLength(3);
    expect(createRng('s').sample([], 5)).toEqual([]);
  });

  it('keeps int() inside the requested range', () => {
    const rng = createRng('bounds');
    for (let i = 0; i < 200; i += 1) {
      const value = rng.int(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
    expect(rng.int(0)).toBe(0);
  });

  it('hashes seeds to distinct states', () => {
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });
});
