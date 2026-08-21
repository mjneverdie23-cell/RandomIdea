import { describe, expect, it } from 'vitest';
import {
  actualWinner,
  buildResultIndex,
  gradeMatch,
  headline,
  summarize,
  type BacktestOutcome,
} from './backtest.ts';
import { parseMatchText } from './matchImport.ts';
import { emptyPredictorModel } from './derive.ts';
import { anywhereKey } from './engine.ts';
import { makeChampion } from '../domain/champions.ts';
import { ROLES, type Game, type Role, type Side } from '../domain/types.ts';
import type { PredictorModel, WinLoss } from './types.ts';

const DRAFT_A = ['Aatrox', 'Viego', 'Azir', 'Jinx', 'Thresh'];
const DRAFT_B = ['Gnar', 'Sejuani', 'Orianna', 'Ezreal', 'Nautilus'];

function makeGame(spec: {
  id: string;
  blue: string;
  red: string;
  winner: Side;
  date: string;
  gameNumber?: number;
}): Game {
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
    bans: [],
    goldDiff: null,
  });

  return {
    gameId: spec.id,
    competition: 'LCK',
    sourceLeague: 'LCK',
    tournamentLabel: 'Test',
    season: '2026',
    split: 'Summer',
    date: spec.date,
    patch: '16.01',
    stage: { kind: 'regular', label: 'Regular Season', elimination: false },
    seriesFormat: 'BO3',
    seriesFormatInferred: true,
    gameNumber: spec.gameNumber ?? 1,
    blue: build('blue', spec.blue, DRAFT_A),
    red: build('red', spec.red, DRAFT_B),
    winner: spec.winner,
    durationSeconds: 1800,
    demo: false,
  };
}

const GAMES: Game[] = [
  makeGame({ id: 'G1', blue: 'T1', red: 'Gen.G', winner: 'blue', date: '2026-07-01T09:00:00.000Z' }),
  makeGame({
    id: 'G2',
    blue: 'T1',
    red: 'Gen.G',
    winner: 'red',
    date: '2026-07-01T10:00:00.000Z',
    gameNumber: 2,
  }),
];

/** One pasted match, written the way the exporter writes them. */
function paste(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    matches: [
      {
        id: 'G1',
        date: '2026-07-01',
        kickoff: '2026-07-01T09:00:00.000Z',
        competition: 'LCK',
        stage: 'regular',
        series: 'BO3',
        game: 1,
        score: [0, 0],
        blue: {
          team: 'T1',
          top: 'Aatrox',
          jungle: 'Viego',
          mid: 'Azir',
          bot: 'Jinx',
          support: 'Thresh',
        },
        red: {
          team: 'Gen.G',
          top: 'Gnar',
          jungle: 'Sejuani',
          mid: 'Orianna',
          bot: 'Ezreal',
          support: 'Nautilus',
        },
        ...overrides,
      },
    ],
  });
}

const first = (text: string) => parseMatchText(text).matches[0]!;

/**
 * A model that clearly favours one team over the other.
 *
 * Both sides need a record: an unplayed champion is credited a full 1.00, so
 * handing one team a strong record and leaving the other blank favours the
 * blank one.
 */
function favouring(strong: string, weak: string): PredictorModel {
  const playerSplitRecord = new Map<string, WinLoss>();
  const rosters = new Map<string, Partial<Record<Role, string>>>();

  for (const [team, draft, wins] of [
    [strong, strong === 'T1' ? DRAFT_A : DRAFT_B, 9],
    [weak, weak === 'T1' ? DRAFT_A : DRAFT_B, 2],
  ] as const) {
    const roster: Partial<Record<Role, string>> = {};
    ROLES.forEach((role, index) => {
      const player = `${team}-${role}`;
      roster[role] = player;
      playerSplitRecord.set(anywhereKey(player, role, makeChampion(draft[index]!)!.id), {
        wins,
        games: 10,
      });
    });
    rosters.set(team.toLowerCase(), roster);
  }

  return { ...emptyPredictorModel(), playerSplitRecord, rosters };
}

describe('buildResultIndex', () => {
  it('finds the winner by game id', () => {
    const index = buildResultIndex(GAMES);
    expect(actualWinner(index, first(paste()))).toBe('T1');
    expect(actualWinner(index, first(paste({ id: 'G2', game: 2 })))).toBe('Gen.G');
  });

  it('is case- and whitespace-insensitive on the id', () => {
    const index = buildResultIndex(GAMES);
    expect(actualWinner(index, first(paste({ id: ' g1 ' })))).toBe('T1');
  });

  it('falls back to date, teams and game number when the id is unknown', () => {
    const index = buildResultIndex(GAMES);
    // A paste from somewhere else: no matching id, but the matchup lines up.
    expect(actualWinner(index, first(paste({ id: 'not-an-oe-id' })))).toBe('T1');
    expect(actualWinner(index, first(paste({ id: 'nope', game: 2 })))).toBe('Gen.G');
  });

  it('does not confuse two games of the same series', () => {
    const index = buildResultIndex(GAMES);
    const gameOne = actualWinner(index, first(paste({ id: 'x', game: 1 })));
    const gameTwo = actualWinner(index, first(paste({ id: 'y', game: 2 })));
    expect(gameOne).toBe('T1');
    expect(gameTwo).toBe('Gen.G');
  });

  it('returns null when the loaded seasons have no such game', () => {
    const index = buildResultIndex(GAMES);
    const elsewhere = paste({ id: 'zz', date: '2020-01-01', kickoff: '2020-01-01T09:00:00.000Z' });
    expect(actualWinner(index, first(elsewhere))).toBeNull();
  });
});

describe('gradeMatch', () => {
  const results = buildResultIndex(GAMES);

  it('marks a correct call right', () => {
    // T1 won game one, and the model is built to favour T1's draft.
    const outcome = gradeMatch(favouring('T1', 'Gen.G'), first(paste()), 0, results);
    expect(outcome.reason).toBe('graded');
    expect(outcome.predicted).toBe('T1');
    expect(outcome.actual).toBe('T1');
    expect(outcome.correct).toBe(true);
    expect(outcome.confidence).toBeGreaterThan(0.5);
  });

  it('marks a wrong call wrong', () => {
    const outcome = gradeMatch(favouring('Gen.G', 'T1'), first(paste()), 0, results);
    expect(outcome.predicted).toBe('Gen.G');
    expect(outcome.actual).toBe('T1');
    expect(outcome.correct).toBe(false);
  });

  it('leaves a dead heat ungraded rather than guessing', () => {
    // Two identical, empty-history drafts produce an exact tie.
    const outcome = gradeMatch(emptyPredictorModel(), first(paste()), 0, results);
    expect(outcome.reason).toBe('too close');
    expect(outcome.correct).toBeNull();
    // The answer is still reported, so the row is readable.
    expect(outcome.actual).toBe('T1');
  });

  it('skips a match the loaded seasons cannot answer', () => {
    const outcome = gradeMatch(
      favouring('T1', 'Gen.G'),
      first(paste({ id: 'zz', date: '2020-01-01', kickoff: '2020-01-01T09:00:00.000Z' })),
      0,
      results,
    );
    expect(outcome.reason).toBe('no result');
    expect(outcome.correct).toBeNull();
  });

  it('never reads the winner into the prediction itself', () => {
    // The same draft graded against two opposite answer keys must produce the
    // same call — only the verdict may differ.
    const flipped = buildResultIndex([
      makeGame({ id: 'G1', blue: 'T1', red: 'Gen.G', winner: 'red', date: '2026-07-01T09:00:00.000Z' }),
    ]);
    const model = favouring('T1', 'Gen.G');
    const asWon = gradeMatch(model, first(paste()), 0, results);
    const asLost = gradeMatch(model, first(paste()), 0, flipped);
    expect(asWon.predicted).toBe(asLost.predicted);
    expect(asWon.confidence).toBe(asLost.confidence);
    expect(asWon.correct).toBe(true);
    expect(asLost.correct).toBe(false);
  });
});

describe('summarize', () => {
  const outcome = (
    correct: boolean | null,
    confidence: number | null,
    reason: BacktestOutcome['reason'] = 'graded',
  ): BacktestOutcome => ({
    index: 0,
    label: 'A vs B',
    predicted: correct === null ? null : 'A',
    actual: correct === null ? null : correct ? 'A' : 'B',
    correct,
    reason,
    confidence,
    blueWon: correct,
  });

  it('counts the record and reports it in one line', () => {
    const summary = summarize([
      ...Array.from({ length: 7 }, () => outcome(true, 0.65)),
      ...Array.from({ length: 3 }, () => outcome(false, 0.65)),
    ]);
    expect(summary.graded).toBe(10);
    expect(summary.right).toBe(7);
    expect(summary.wrong).toBe(3);
    expect(summary.accuracy).toBeCloseTo(0.7, 10);
    expect(headline(summary)).toBe('Accuracy 70.0% · 7R 3W');
  });

  it('keeps ungraded matches out of the accuracy', () => {
    const summary = summarize([
      outcome(true, 0.7),
      outcome(false, 0.6),
      outcome(null, null, 'no result'),
      outcome(null, null, 'no result'),
      outcome(null, null, 'too close'),
    ]);
    expect(summary.total).toBe(5);
    expect(summary.graded).toBe(2);
    expect(summary.skipped).toBe(3);
    expect(summary.accuracy).toBe(0.5);
    expect(summary.skippedBy[0]).toEqual({ reason: 'no result', count: 2 });
  });

  it('scores a coin-flip model at the Brier baseline', () => {
    const summary = summarize([outcome(true, 0.5), outcome(false, 0.5)]);
    expect(summary.brier).toBeCloseTo(0.25, 10);
  });

  it('rewards confident calls that come off and punishes confident misses', () => {
    const sure = summarize([outcome(true, 0.9)]);
    const wrongAndSure = summarize([outcome(false, 0.9)]);
    expect(sure.brier!).toBeLessThan(0.25);
    expect(wrongAndSure.brier!).toBeGreaterThan(0.25);
  });

  it('buckets by stated confidence so calibration is visible', () => {
    const summary = summarize([
      outcome(true, 0.55),
      outcome(false, 0.58),
      outcome(true, 0.85),
      outcome(true, 0.92),
    ]);
    const low = summary.bands.find((band) => band.label === '50–60%')!;
    const high = summary.bands.find((band) => band.label === '80%+')!;
    expect(low.graded).toBe(2);
    expect(low.right).toBe(1);
    expect(high.graded).toBe(2);
    expect(high.right).toBe(2);
    // Bands with nothing in them are dropped rather than shown as 0/0.
    expect(summary.bands.every((band) => band.graded > 0)).toBe(true);
  });

  it('reports the blue-side baseline alongside the model', () => {
    // Blue won three of four; the model got two of four.
    const summary = summarize([
      { ...outcome(true, 0.6), blueWon: true },
      { ...outcome(true, 0.6), blueWon: true },
      { ...outcome(false, 0.6), blueWon: true },
      { ...outcome(false, 0.6), blueWon: false },
    ]);
    expect(summary.accuracy).toBe(0.5);
    expect(summary.blueSideAccuracy).toBe(0.75);
  });

  it('counts a match the model would not call toward the baseline anyway', () => {
    // "Too close" is the model's failing, not a missing result — blue side
    // still has an answer for it.
    const summary = summarize([{ ...outcome(null, null, 'too close'), blueWon: true }]);
    expect(summary.accuracy).toBeNull();
    expect(summary.blueSideAccuracy).toBe(1);
  });

  it('says so plainly when nothing could be graded', () => {
    const summary = summarize([outcome(null, null, 'no result')]);
    expect(summary.accuracy).toBeNull();
    expect(headline(summary)).toBe('Nothing could be graded.');
  });
});
