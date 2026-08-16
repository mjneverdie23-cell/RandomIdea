import { describe, expect, it } from 'vitest';
import {
  compareEntries,
  entriesInCategory,
  filterEntries,
  LEADERBOARD_CATEGORIES,
  personalBest,
  rankEntries,
  summarizeCategories,
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
    mode: 'matchups',
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
    expect(filterEntries(rows, { questionCount: null, sourceKey: null, mode: null })).toHaveLength(3);
  });

  it('filters by question count', () => {
    expect(filterEntries(rows, { questionCount: 25, sourceKey: null, mode: null })).toHaveLength(1);
  });

  it('filters by source', () => {
    expect(filterEntries(rows, { questionCount: null, sourceKey: 'LCK', mode: null })).toHaveLength(2);
  });

  it('filters by style', () => {
    const mixedStyles = [
      entry({ mode: 'matchups' }),
      entry({ mode: 'games' }),
      entry({ mode: 'games' }),
    ];
    expect(
      filterEntries(mixedStyles, { questionCount: null, sourceKey: null, mode: 'games' }),
    ).toHaveLength(2);
  });

  it('leaves pre-style runs out of a style-filtered view', () => {
    const legacy = entry({});
    delete legacy.mode;
    const rowsWithLegacy = [legacy, entry({ mode: 'matchups' })];
    expect(
      filterEntries(rowsWithLegacy, { questionCount: null, sourceKey: null, mode: 'matchups' }),
    ).toHaveLength(1);
    expect(
      filterEntries(rowsWithLegacy, { questionCount: null, sourceKey: null, mode: null }),
    ).toHaveLength(2);
  });

  it('combines every filter', () => {
    expect(
      filterEntries(rows, { questionCount: 50, sourceKey: 'LCK', mode: 'matchups' }),
    ).toHaveLength(1);
    expect(
      filterEntries(rows, { questionCount: 10, sourceKey: 'LCK', mode: 'matchups' }),
    ).toHaveLength(0);
    expect(
      filterEntries(rows, { questionCount: 50, sourceKey: 'LCK', mode: 'games' }),
    ).toHaveLength(0);
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


describe('categories', () => {
  it('covers every style and length combination', () => {
    expect(LEADERBOARD_CATEGORIES).toHaveLength(6);
    expect(LEADERBOARD_CATEGORIES.map((c) => `${c.mode}:${c.questionCount}`)).toEqual([
      'matchups:10',
      'matchups:25',
      'matchups:50',
      'games:10',
      'games:25',
      'games:50',
    ]);
  });

  it('ranks only runs of the same style and length', () => {
    const rows = [
      entry({ mode: 'matchups', questionCount: 10, score: 1200 }),
      entry({ mode: 'matchups', questionCount: 50, score: 9000 }),
      entry({ mode: 'games', questionCount: 10, score: 1800 }),
      entry({ mode: 'matchups', questionCount: 10, score: 1500 }),
    ];
    const board = entriesInCategory(rows, { mode: 'matchups', questionCount: 10 });
    expect(board.map((e) => e.score)).toEqual([1500, 1200]);
  });

  it('never lets a longer run outrank a shorter one in its own board', () => {
    const rows = [
      entry({ mode: 'matchups', questionCount: 10, score: 2000 }),
      entry({ mode: 'matchups', questionCount: 50, score: 11000 }),
    ];
    const short = entriesInCategory(rows, { mode: 'matchups', questionCount: 10 });
    expect(short).toHaveLength(1);
    expect(short[0]!.score).toBe(2000);
  });

  it('summarizes leader, personal best and rank per category', () => {
    const rows = [
      entry({ username: 'Ava', mode: 'matchups', questionCount: 10, score: 2000 }),
      entry({ username: 'Bo', mode: 'matchups', questionCount: 10, score: 1500 }),
      entry({ username: 'Bo', mode: 'games', questionCount: 25, score: 4000 }),
    ];
    const summaries = summarizeCategories(rows, LEADERBOARD_CATEGORIES, 'Bo');
    const m10 = summaries.find((s) => s.category.mode === 'matchups' && s.category.questionCount === 10)!;
    expect(m10.runs).toBe(2);
    expect(m10.leader?.username).toBe('Ava');
    expect(m10.personal?.score).toBe(1500);
    expect(m10.personalRank).toBe(2);

    const empty = summaries.find((s) => s.category.mode === 'games' && s.category.questionCount === 50)!;
    expect(empty.runs).toBe(0);
    expect(empty.leader).toBeNull();
    expect(empty.personalRank).toBeNull();
  });

  it('scopes a personal best to a category when asked', () => {
    const rows = [
      entry({ username: 'Ava', mode: 'matchups', questionCount: 50, score: 9000 }),
      entry({ username: 'Ava', mode: 'matchups', questionCount: 10, score: 1900 }),
    ];
    expect(personalBest(rows, 'Ava')?.score).toBe(9000);
    expect(personalBest(rows, 'Ava', { mode: 'matchups', questionCount: 10 })?.score).toBe(1900);
  });
});
