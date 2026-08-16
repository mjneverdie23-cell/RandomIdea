import { describe, expect, it } from 'vitest';
import {
  combineEnabledGames,
  combineStats,
  mergeImportedYears,
  splitGamesByYear,
  statsForGames,
  yearOf,
} from './years.ts';
import type { Game, Side, YearDataset } from '../domain/types.ts';

function fakeGame(id: string, season: string, dateIso: string, competition = 'LCK'): Game {
  const side = (s: Side, team: string) => ({
    side: s,
    teamName: team,
    teamId: null,
    tag: team.slice(0, 3).toUpperCase(),
    players: [],
    bans: [],
  });
  return {
    gameId: id,
    competition: competition as Game['competition'],
    sourceLeague: competition,
    tournamentLabel: `${competition} ${season}`,
    season,
    split: 'Summer',
    date: dateIso,
    patch: '15.10',
    stage: { kind: 'regular', label: 'Regular Season', elimination: false },
    seriesFormat: 'BO3',
    seriesFormatInferred: true,
    gameNumber: 1,
    blue: side('blue', 'Blue Team'),
    red: side('red', 'Red Team'),
    winner: 'blue',
    durationSeconds: 1800,
    demo: false,
  };
}

function year(name: string, games: Game[], enabled = true): YearDataset {
  return {
    year: name,
    label: `${name}.csv`,
    games,
    stats: statsForGames(games),
    importedAt: '2026-01-01T00:00:00.000Z',
    enabled,
  };
}

describe('yearOf', () => {
  it('uses the season column when it is a four-digit year', () => {
    expect(yearOf(fakeGame('a', '2023', '2023-06-01T00:00:00.000Z'))).toBe('2023');
  });

  it('falls back to the date when the season is unusable', () => {
    expect(yearOf(fakeGame('a', 'Summer', '2024-06-01T00:00:00.000Z'))).toBe('2024');
  });

  it('buckets by the season in the data, not the file it arrived in', () => {
    // A 2025 export can carry a January 2026 game; it belongs to 2026.
    expect(yearOf(fakeGame('a', '2026', '2026-01-08T00:00:00.000Z'))).toBe('2026');
  });
});

describe('splitGamesByYear', () => {
  it('separates a mixed import into seasons', () => {
    const split = splitGamesByYear([
      fakeGame('a', '2024', '2024-06-01T00:00:00.000Z'),
      fakeGame('b', '2025', '2025-06-01T00:00:00.000Z'),
      fakeGame('c', '2025', '2025-07-01T00:00:00.000Z'),
    ]);
    expect([...split.keys()].sort()).toEqual(['2024', '2025']);
    expect(split.get('2025')).toHaveLength(2);
  });
});

describe('mergeImportedYears', () => {
  const existing = [
    year('2024', [fakeGame('a', '2024', '2024-06-01T00:00:00.000Z')]),
    year('2025', [fakeGame('b', '2025', '2025-06-01T00:00:00.000Z')]),
  ];

  it('adds a new season without touching the others', () => {
    const merged = mergeImportedYears(existing, [fakeGame('c', '2023', '2023-06-01T00:00:00.000Z')], {
      label: '2023.csv',
    });
    expect(merged.map((y) => y.year)).toEqual(['2025', '2024', '2023']);
    expect(merged.find((y) => y.year === '2024')!.games).toHaveLength(1);
    expect(merged.find((y) => y.year === '2025')!.games).toHaveLength(1);
  });

  it('replaces a re-imported season rather than duplicating it', () => {
    const merged = mergeImportedYears(
      existing,
      [
        fakeGame('b', '2025', '2025-06-01T00:00:00.000Z'),
        fakeGame('d', '2025', '2025-08-01T00:00:00.000Z'),
      ],
      { label: '2025-updated.csv' },
    );
    expect(merged).toHaveLength(2);
    const updated = merged.find((y) => y.year === '2025')!;
    expect(updated.games).toHaveLength(2);
    expect(updated.label).toBe('2025-updated.csv');
  });

  it('keeps a re-imported season switched off if it already was', () => {
    const off = [year('2025', [fakeGame('b', '2025', '2025-06-01T00:00:00.000Z')], false)];
    const merged = mergeImportedYears(off, [fakeGame('e', '2025', '2025-09-01T00:00:00.000Z')], {
      label: 'again.csv',
    });
    expect(merged[0]!.enabled).toBe(false);
  });

  it('splits a multi-season file across seasons', () => {
    const merged = mergeImportedYears(
      [],
      [
        fakeGame('a', '2025', '2025-12-20T00:00:00.000Z'),
        fakeGame('b', '2026', '2026-01-10T00:00:00.000Z'),
      ],
      { label: 'mixed.csv' },
    );
    expect(merged.map((y) => y.year)).toEqual(['2026', '2025']);
  });
});

describe('combineEnabledGames', () => {
  const years = [
    year('2024', [fakeGame('a', '2024', '2024-06-01T00:00:00.000Z')]),
    year('2025', [fakeGame('b', '2025', '2025-06-01T00:00:00.000Z')], false),
    year('2026', [fakeGame('c', '2026', '2026-01-10T00:00:00.000Z')]),
  ];

  it('includes only the switched-on seasons', () => {
    expect(combineEnabledGames(years).map((g) => g.gameId)).toEqual(['c', 'a']);
  });

  it('returns nothing when every season is off', () => {
    const allOff = years.map((y) => ({ ...y, enabled: false }));
    expect(combineEnabledGames(allOff)).toEqual([]);
  });

  it('de-duplicates a game present in two seasons', () => {
    const overlapping = [
      year('2025', [fakeGame('shared', '2025', '2025-06-01T00:00:00.000Z')]),
      year('2026', [fakeGame('shared', '2026', '2026-01-10T00:00:00.000Z')]),
    ];
    expect(combineEnabledGames(overlapping)).toHaveLength(1);
  });

  it('orders games newest first', () => {
    const games = combineEnabledGames(years);
    const times = games.map((g) => Date.parse(g.date));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe('combineStats', () => {
  it('reports only the enabled seasons', () => {
    const years = [
      year('2024', [fakeGame('a', '2024', '2024-06-01T00:00:00.000Z', 'LCK')]),
      year('2025', [fakeGame('b', '2025', '2025-06-01T00:00:00.000Z', 'LEC')], false),
    ];
    const games = combineEnabledGames(years);
    const stats = combineStats(years, games);
    expect(stats.gamesKept).toBe(1);
    expect(stats.perCompetition).toEqual({ LCK: 1 });
  });
});
