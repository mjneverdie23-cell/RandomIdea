import { describe, expect, it } from 'vitest';
import {
  compareEntries,
  filterEntries,
  personalBest,
  rankEntries,
  type LeaderboardEntry,
} from './repository.ts';

function entry(overrides: Partial<LeaderboardEntry>): LeaderboardEntry {
  return {
    id: Math.random().toString(36).slice(2),
    username: 'Player',
    score: 1000,
    questionCount: 10,
    accuracy: 70,
    correct: 7,
    incorrect: 3,
    timeouts: 0,
    bestStreak: 3,
    averageResponseMs: 3000,
    sourceKey: 'MIXED',
    sourceLabel: 'All competitions',
    date: '2025-06-01T00:00:00.000Z',
    seed: 'AAA',
    demoData: true,
    ...overrides,
  };
}

describe('compareEntries', () => {
  it('ranks by score first', () => {
    const rows = rankEntries([entry({ score: 900 }), entry({ score: 1500 })]);
    expect(rows.map((r) => r.score)).toEqual([1500, 900]);
  });

  it('breaks score ties on accuracy', () => {
    const rows = rankEntries([
      entry({ score: 1000, accuracy: 60 }),
      entry({ score: 1000, accuracy: 90 }),
    ]);
    expect(rows.map((r) => r.accuracy)).toEqual([90, 60]);
  });

  it('breaks accuracy ties on the faster average answer', () => {
    const rows = rankEntries([
      entry({ score: 1000, accuracy: 70, averageResponseMs: 5000 }),
      entry({ score: 1000, accuracy: 70, averageResponseMs: 2000 }),
    ]);
    expect(rows.map((r) => r.averageResponseMs)).toEqual([2000, 5000]);
  });

  it('sorts runs with no timing data last', () => {
    const rows = rankEntries([
      entry({ score: 1000, accuracy: 70, averageResponseMs: null }),
      entry({ score: 1000, accuracy: 70, averageResponseMs: 9000 }),
    ]);
    expect(rows[0]!.averageResponseMs).toBe(9000);
  });

  it('is a stable comparator for identical rows', () => {
    const a = entry({});
    expect(compareEntries(a, { ...a })).toBe(0);
  });
});

describe('filterEntries', () => {
  const rows = [
    entry({ questionCount: 10, sourceKey: 'MIXED' }),
    entry({ questionCount: 25, sourceKey: 'LCK' }),
    entry({ questionCount: 50, sourceKey: 'LCK' }),
  ];

  it('passes everything through with empty filters', () => {
    expect(filterEntries(rows, { questionCount: null, sourceKey: null })).toHaveLength(3);
  });

  it('filters by question count', () => {
    expect(filterEntries(rows, { questionCount: 25, sourceKey: null })).toHaveLength(1);
  });

  it('filters by source', () => {
    expect(filterEntries(rows, { questionCount: null, sourceKey: 'LCK' })).toHaveLength(2);
  });

  it('combines both filters', () => {
    expect(filterEntries(rows, { questionCount: 50, sourceKey: 'LCK' })).toHaveLength(1);
    expect(filterEntries(rows, { questionCount: 10, sourceKey: 'LCK' })).toHaveLength(0);
  });
});

describe('personalBest', () => {
  const rows = [
    entry({ username: 'Faker', score: 1200 }),
    entry({ username: 'faker', score: 1800 }),
    entry({ username: 'Someone', score: 5000 }),
  ];

  it('finds the highest run for a name, case-insensitively', () => {
    expect(personalBest(rows, 'FAKER')?.score).toBe(1800);
  });

  it('returns null when the player has no runs', () => {
    expect(personalBest(rows, 'Nobody')).toBeNull();
  });
});
