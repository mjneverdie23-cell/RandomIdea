import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '../data/demoDataset.ts';
import { generateQuiz } from './generator.ts';
import { MIXED_SOURCE } from './config.ts';
import { describeSeriesRuns, groupIntoSeries, seriesKeyOf, seriesScoreBefore } from './series.ts';
import type { Game, Side } from '../domain/types.ts';

const dataset = buildDemoDataset();

function fakeGame(
  id: string,
  blue: string,
  red: string,
  gameNumber: number,
  hoursFromStart: number,
  winner: Side = 'blue',
): Game {
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
    competition: 'LCK',
    sourceLeague: 'LCK',
    tournamentLabel: 'LCK 2025',
    season: '2025',
    split: 'Summer',
    date: new Date(Date.UTC(2025, 5, 1) + hoursFromStart * 3600_000).toISOString(),
    patch: '15.10',
    stage: { kind: 'regular', label: 'Regular Season', elimination: false },
    seriesFormat: 'BO3',
    seriesFormatInferred: true,
    gameNumber,
    blue: side('blue', blue),
    red: side('red', red),
    winner,
    durationSeconds: 1800,
    demo: true,
  };
}

describe('groupIntoSeries', () => {
  it('groups a matchup’s games into one series, in play order', () => {
    const series = groupIntoSeries([
      fakeGame('g2', 'Gen.G', 'T1', 2, 1),
      fakeGame('g1', 'T1', 'Gen.G', 1, 0),
      fakeGame('g3', 'T1', 'Gen.G', 3, 2),
    ]);
    expect(series).toHaveLength(1);
    expect(series[0]!.games.map((g) => g.gameId)).toEqual(['g1', 'g2', 'g3']);
  });

  it('treats the same pair on a later date as a separate series', () => {
    const series = groupIntoSeries([
      fakeGame('a1', 'T1', 'Gen.G', 1, 0),
      fakeGame('a2', 'Gen.G', 'T1', 2, 1),
      fakeGame('b1', 'T1', 'Gen.G', 1, 24 * 14),
    ]);
    expect(series).toHaveLength(2);
    expect(series.map((s) => s.games.length).sort()).toEqual([1, 2]);
  });

  it('keeps different matchups apart', () => {
    const series = groupIntoSeries([
      fakeGame('a1', 'T1', 'Gen.G', 1, 0),
      fakeGame('b1', 'KT Rolster', 'Dplus KIA', 1, 0),
    ]);
    expect(series).toHaveLength(2);
  });

  it('ignores which side a team was on', () => {
    expect(seriesKeyOf(fakeGame('x', 'T1', 'Gen.G', 1, 0))).toBe(
      seriesKeyOf(fakeGame('y', 'Gen.G', 'T1', 2, 1)),
    );
  });

  it('covers every game exactly once', () => {
    const series = groupIntoSeries(dataset.games);
    const ids = series.flatMap((s) => s.games.map((g) => g.gameId));
    expect(ids).toHaveLength(dataset.games.length);
    expect(new Set(ids).size).toBe(dataset.games.length);
  });

  it('orders every series by game number', () => {
    for (const series of groupIntoSeries(dataset.games)) {
      const numbers = series.games.map((g) => g.gameNumber);
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    }
  });
});

describe('generateQuiz — matchup mode', () => {
  it('still returns exactly the requested number of distinct games', () => {
    for (const questionCount of [10, 25, 50] as const) {
      const quiz = generateQuiz(dataset.games, {
        source: MIXED_SOURCE,
        questionCount,
        seed: `SERIES-${questionCount}`,
      });
      expect(quiz.games).toHaveLength(questionCount);
      expect(new Set(quiz.games.map((g) => g.gameId)).size).toBe(questionCount);
    }
  });

  it('emits each matchup contiguously and in game order', () => {
    const quiz = generateQuiz(dataset.games, {
      source: MIXED_SOURCE,
      questionCount: 25,
      seed: 'ORDER',
    });
    const positions = describeSeriesRuns(quiz.games);

    // Within a run, game numbers climb; a run boundary resets the counter.
    for (let i = 1; i < quiz.games.length; i += 1) {
      if (positions[i]!.gameInSeries > 1) {
        expect(quiz.games[i]!.gameNumber).toBeGreaterThan(quiz.games[i - 1]!.gameNumber);
        expect(seriesKeyOf(quiz.games[i]!)).toBe(seriesKeyOf(quiz.games[i - 1]!));
      }
    }
  });

  it('reports how many matchups it covers', () => {
    const quiz = generateQuiz(dataset.games, {
      source: MIXED_SOURCE,
      questionCount: 25,
      seed: 'COUNT',
    });
    expect(quiz.seriesCount).toBeGreaterThan(0);
    expect(quiz.seriesCount).toBeLessThanOrEqual(25);
    expect(describeSeriesRuns(quiz.games)[0]!.seriesCount).toBe(quiz.seriesCount);
  });

  it('serves multi-game series rather than only single games', () => {
    const quiz = generateQuiz(dataset.games, {
      source: MIXED_SOURCE,
      questionCount: 50,
      seed: 'MULTI',
    });
    const positions = describeSeriesRuns(quiz.games);
    expect(positions.some((p) => p.seriesLength > 1)).toBe(true);
  });

  it('stays reproducible from its seed', () => {
    const config = { source: MIXED_SOURCE, questionCount: 25, seed: 'REPEAT' } as const;
    expect(generateQuiz(dataset.games, config).games.map((g) => g.gameId)).toEqual(
      generateQuiz(dataset.games, config).games.map((g) => g.gameId),
    );
  });
});

describe('describeSeriesRuns', () => {
  it('numbers matchups and positions within them', () => {
    const positions = describeSeriesRuns([
      fakeGame('a1', 'T1', 'Gen.G', 1, 0),
      fakeGame('a2', 'Gen.G', 'T1', 2, 1),
      fakeGame('b1', 'KT Rolster', 'Dplus KIA', 1, 5),
    ]);
    expect(positions).toEqual([
      { seriesIndex: 1, seriesCount: 2, gameInSeries: 1, seriesLength: 2 },
      { seriesIndex: 1, seriesCount: 2, gameInSeries: 2, seriesLength: 2 },
      { seriesIndex: 2, seriesCount: 2, gameInSeries: 1, seriesLength: 1 },
    ]);
  });

  it('splits back-to-back meetings of the same pair on the game counter', () => {
    const positions = describeSeriesRuns([
      fakeGame('a1', 'T1', 'Gen.G', 1, 0),
      fakeGame('a2', 'Gen.G', 'T1', 2, 1),
      fakeGame('b1', 'T1', 'Gen.G', 1, 2),
    ]);
    expect(positions.map((p) => p.seriesIndex)).toEqual([1, 1, 2]);
  });

  it('handles an empty quiz', () => {
    expect(describeSeriesRuns([])).toEqual([]);
  });
});

describe('seriesScoreBefore', () => {
  const games = [
    fakeGame('a1', 'T1', 'Gen.G', 1, 0, 'blue'), // T1 wins
    fakeGame('a2', 'Gen.G', 'T1', 2, 1, 'blue'), // Gen.G wins
    fakeGame('a3', 'T1', 'Gen.G', 3, 2, 'blue'), // T1 wins
  ];
  const positions = describeSeriesRuns(games);

  it('is empty before the first game of a series', () => {
    expect(seriesScoreBefore(games, positions, 0).every((e) => e.wins === 0)).toBe(true);
  });

  it('counts only earlier games of the same series', () => {
    const afterOne = seriesScoreBefore(games, positions, 1);
    expect(afterOne.find((e) => e.team === 'T1')?.wins).toBe(1);
    expect(afterOne.find((e) => e.team === 'Gen.G')?.wins).toBe(0);

    const afterTwo = seriesScoreBefore(games, positions, 2);
    expect(afterTwo.find((e) => e.team === 'T1')?.wins).toBe(1);
    expect(afterTwo.find((e) => e.team === 'Gen.G')?.wins).toBe(1);
  });

  it('never counts the current game', () => {
    const total = seriesScoreBefore(games, positions, 2).reduce((sum, e) => sum + e.wins, 0);
    expect(total).toBe(2);
  });
});
