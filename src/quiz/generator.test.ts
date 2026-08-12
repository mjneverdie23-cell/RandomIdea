import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '../data/demoDataset.ts';
import {
  availableFor,
  checkEligibility,
  computeAvailability,
  generateQuiz,
  QuizGenerationError,
} from './generator.ts';
import { MIXED_SOURCE } from './config.ts';
import { createRng, hashSeed } from './rng.ts';
import type { Game } from '../domain/types.ts';

const dataset = buildDemoDataset();

describe('demo dataset', () => {
  it('produces a usable pool across every configured competition', () => {
    expect(dataset.games.length).toBeGreaterThan(300);
    for (const count of Object.values(dataset.stats.perCompetition)) {
      expect(count).toBeGreaterThan(0);
    }
    expect(Object.keys(dataset.stats.perCompetition).sort()).toEqual(
      ['EWC', 'FIRST_STAND', 'LCK', 'LCS', 'LEC', 'LPL', 'MSI', 'WORLDS'].sort(),
    );
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
      questionCount: 25,
      seed: 'ABC123',
    });
    expect(quiz.games).toHaveLength(25);
    expect(new Set(quiz.games.map((g) => g.gameId)).size).toBe(25);
  });

  it('is reproducible from its seed', () => {
    const config = { source: MIXED_SOURCE, questionCount: 10, seed: 'SEED-1' } as const;
    const a = generateQuiz(dataset.games, config);
    const b = generateQuiz(dataset.games, config);
    expect(a.games.map((g) => g.gameId)).toEqual(b.games.map((g) => g.gameId));
  });

  it('produces a different run for a different seed', () => {
    const a = generateQuiz(dataset.games, {
      source: MIXED_SOURCE,
      questionCount: 10,
      seed: 'SEED-1',
    });
    const b = generateQuiz(dataset.games, {
      source: MIXED_SOURCE,
      questionCount: 10,
      seed: 'SEED-2',
    });
    expect(a.games.map((g) => g.gameId)).not.toEqual(b.games.map((g) => g.gameId));
  });

  it('restricts a single-competition run to that competition', () => {
    const quiz = generateQuiz(dataset.games, {
      source: { kind: 'single', competition: 'WORLDS' },
      questionCount: 10,
      seed: 'W',
    });
    expect(quiz.games.every((game) => game.competition === 'WORLDS')).toBe(true);
  });

  it('refuses configurations the pool cannot satisfy', () => {
    const tiny = dataset.games.slice(0, 4);
    expect(() =>
      generateQuiz(tiny, { source: MIXED_SOURCE, questionCount: 10, seed: 'X' }),
    ).toThrow(QuizGenerationError);
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
