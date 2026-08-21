/**
 * Grading a whole pasted queue against what actually happened.
 *
 * The predictor never reads the result of the game it is predicting, and the
 * export deliberately carries no winner — so the truth for grading comes from
 * somewhere else entirely: the games already imported into the app. A pasted
 * match is joined back to its source game by Oracle's Elixir game id (or, when
 * the paste came from elsewhere, by date + teams + game number), and only then
 * is the winner read.
 *
 * That separation is the whole point. The prediction is made from a model built
 * strictly out of games played *before* kickoff; the answer key is opened
 * afterwards, by a different code path, purely to count. Nothing the grader
 * learns can flow back into the prediction.
 *
 * Pure: no React, no storage. The caller supplies a model per match, which is
 * what lets the UI rebuild history at each kickoff and yield between matches.
 */

import { predict } from './engine.ts';
import { draftToPredictionInput } from './draft.ts';
import { matchToDraft, type ImportedMatch } from './matchImport.ts';
import type { Game } from '../domain/types.ts';
import type { PredictorModel } from './types.ts';

/* ------------------------------------------------------------------ */
/* Answer key                                                          */
/* ------------------------------------------------------------------ */

export interface ResultIndex {
  /** Game id to winning team name — the exact join, when ids line up. */
  byId: Map<string, string>;
  /** Date + both teams + game number, for pastes that carry no usable id. */
  byMatchup: Map<string, string>;
}

const norm = (value: string): string => value.trim().toLowerCase();

/** Day-granular key, so a kickoff time and a bare date still meet. */
function matchupKey(
  date: string,
  teamA: string,
  teamB: string,
  gameNumber: number,
): string {
  const day = date.slice(0, 10);
  const pair = [norm(teamA), norm(teamB)].sort();
  return `${day}|${pair[0]}|${pair[1]}|${gameNumber}`;
}

export function buildResultIndex(games: readonly Game[]): ResultIndex {
  const byId = new Map<string, string>();
  const byMatchup = new Map<string, string>();

  for (const game of games) {
    const winner = game.winner === 'blue' ? game.blue.teamName : game.red.teamName;
    byId.set(norm(game.gameId), winner);
    byMatchup.set(
      matchupKey(game.date, game.blue.teamName, game.red.teamName, game.gameNumber),
      winner,
    );
  }

  return { byId, byMatchup };
}

/** The team that actually won, or `null` when the loaded data has no such game. */
export function actualWinner(index: ResultIndex, match: ImportedMatch): string | null {
  if (match.id) {
    const byId = index.byId.get(norm(match.id));
    if (byId) return byId;
  }
  const date = match.kickoff ?? match.date;
  if (date && match.blue.team && match.red.team) {
    const byMatchup = index.byMatchup.get(
      matchupKey(date, match.blue.team, match.red.team, match.gameNumber),
    );
    if (byMatchup) return byMatchup;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Per-match grading                                                   */
/* ------------------------------------------------------------------ */

export type GradeReason =
  | 'graded'
  /** The loaded seasons contain no game matching this one. */
  | 'no result'
  /** A team, or a whole side, was missing from the paste. */
  | 'incomplete'
  /** No date, so history could not be cut and the prediction would cheat. */
  | 'no date'
  /** The model called it exactly level, so there is nothing to be right about. */
  | 'too close';

export interface BacktestOutcome {
  /** Position in the queue, so a result can be jumped to. */
  index: number;
  label: string;
  predicted: string | null;
  actual: string | null;
  /** `null` when the match was not graded at all. */
  correct: boolean | null;
  reason: GradeReason;
  /** Probability the model gave the side it favoured, 0.5–1. */
  confidence: number | null;
  /** Whether blue side won, for the free baseline. Independent of the model. */
  blueWon: boolean | null;
}

export function gradeMatch(
  model: PredictorModel,
  match: ImportedMatch,
  index: number,
  results: ResultIndex,
): BacktestOutcome {
  const label = `${match.blue.team ?? '?'} vs ${match.red.team ?? '?'}${
    match.gameNumber > 1 ? ` (game ${match.gameNumber})` : ''
  }`;
  const blank = {
    index,
    label,
    predicted: null,
    actual: null,
    correct: null,
    confidence: null,
    blueWon: null,
  };

  const input = draftToPredictionInput(matchToDraft(match));
  if (!input) return { ...blank, reason: 'incomplete' };

  const actual = actualWinner(results, match);
  if (!actual) return { ...blank, reason: 'no result' };

  const blueWon = norm(actual) === norm(input.blue.team);

  const prediction = predict(model, input);
  if (prediction.favourite === null) {
    return { ...blank, actual, blueWon, reason: 'too close' };
  }

  const predicted = prediction.favourite === 'blue' ? input.blue.team : input.red.team;
  const confidence =
    prediction.favourite === 'blue' ? prediction.gameProbBlue : prediction.gameProbRed;

  return {
    index,
    label,
    predicted,
    actual,
    correct: norm(predicted) === norm(actual),
    reason: 'graded',
    confidence,
    blueWon,
  };
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

/** Confidence bands, so calibration is visible and not just the headline. */
const BANDS: { min: number; max: number; label: string }[] = [
  { min: 0.5, max: 0.6, label: '50–60%' },
  { min: 0.6, max: 0.7, label: '60–70%' },
  { min: 0.7, max: 0.8, label: '70–80%' },
  { min: 0.8, max: 1.01, label: '80%+' },
];

export interface ConfidenceBand {
  label: string;
  graded: number;
  right: number;
  /** Average probability the model claimed in this band. */
  claimed: number;
}

export interface BacktestSummary {
  total: number;
  graded: number;
  right: number;
  wrong: number;
  skipped: number;
  /** Why matches were left ungraded, largest group first. */
  skippedBy: { reason: GradeReason; count: number }[];
  accuracy: number | null;
  /**
   * What "always pick blue side" would have scored on the same matches.
   *
   * An accuracy with nothing to compare it against is unreadable — 54% sounds
   * fine until you learn the dumbest possible rule beat it. Blue side is the
   * free baseline: it needs no model, no history and no data beyond which end
   * of the map a team started on.
   */
  blueSideAccuracy: number | null;
  /**
   * Mean squared error of the stated probability against the outcome.
   *
   * Accuracy alone cannot tell a model that is right 70% of the time while
   * claiming 95% from one that is honest about its 70%. Lower is better; 0.25
   * is what calling every game a coin flip scores.
   */
  brier: number | null;
  bands: ConfidenceBand[];
  outcomes: BacktestOutcome[];
}

export function summarize(outcomes: readonly BacktestOutcome[]): BacktestSummary {
  const graded = outcomes.filter((o) => o.correct !== null);
  const right = graded.filter((o) => o.correct === true).length;

  const skippedBy = new Map<GradeReason, number>();
  for (const outcome of outcomes) {
    if (outcome.correct !== null) continue;
    skippedBy.set(outcome.reason, (skippedBy.get(outcome.reason) ?? 0) + 1);
  }

  let squaredError = 0;
  const bands: ConfidenceBand[] = BANDS.map((band) => ({
    label: band.label,
    graded: 0,
    right: 0,
    claimed: 0,
  }));

  for (const outcome of graded) {
    const p = outcome.confidence ?? 0.5;
    squaredError += (1 - p) ** 2 * (outcome.correct ? 1 : 0) + p ** 2 * (outcome.correct ? 0 : 1);
    const slot = BANDS.findIndex((band) => p >= band.min && p < band.max);
    if (slot >= 0) {
      const entry = bands[slot]!;
      entry.graded += 1;
      entry.claimed += p;
      if (outcome.correct) entry.right += 1;
    }
  }

  for (const band of bands) {
    if (band.graded > 0) band.claimed /= band.graded;
  }

  const withSide = outcomes.filter((o) => o.blueWon !== null);
  const blueWins = withSide.filter((o) => o.blueWon === true).length;

  return {
    total: outcomes.length,
    graded: graded.length,
    right,
    wrong: graded.length - right,
    skipped: outcomes.length - graded.length,
    skippedBy: [...skippedBy.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    accuracy: graded.length > 0 ? right / graded.length : null,
    blueSideAccuracy: withSide.length > 0 ? blueWins / withSide.length : null,
    brier: graded.length > 0 ? squaredError / graded.length : null,
    bands: bands.filter((band) => band.graded > 0),
    outcomes: [...outcomes],
  };
}

/** The one line the user asked for: `Accuracy 70.0% · 70R 30W`. */
export function headline(summary: BacktestSummary): string {
  if (summary.accuracy === null) return 'Nothing could be graded.';
  return `Accuracy ${(summary.accuracy * 100).toFixed(1)}% · ${summary.right}R ${summary.wrong}W`;
}
