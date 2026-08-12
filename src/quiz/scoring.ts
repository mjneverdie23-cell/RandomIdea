/**
 * Scoring.
 *
 * The formula is deliberately simple enough to print on screen:
 *
 *   correct   ->  100 base
 *               + up to 100 speed bonus, linear in the time left on the clock
 *               + 10 per answer in the current correct streak, capped at 50
 *   incorrect ->  0
 *   timeout   ->  0
 *
 * So a question is worth 100-250 points, an instant correct call is worth
 * roughly twice a last-second one, and nothing but a correct answer scores.
 */

import type { Side } from '../domain/types.ts';

/** Time budget per question. The countdown starts when the question mounts. */
export const QUESTION_TIME_MS = 10_000;

export const SCORING = {
  base: 100,
  maxSpeedBonus: 100,
  streakBonusPerStep: 10,
  maxStreakBonus: 50,
} as const;

/** Highest score a single question can produce. */
export const MAX_QUESTION_SCORE =
  SCORING.base + SCORING.maxSpeedBonus + SCORING.maxStreakBonus;

export type AnswerOutcome = 'correct' | 'incorrect' | 'timeout';

export interface ScoreBreakdown {
  outcome: AnswerOutcome;
  base: number;
  speedBonus: number;
  streakBonus: number;
  total: number;
  /** Fraction of the clock still remaining, 0-1. */
  speedFactor: number;
}

export interface ScoreInput {
  /** `null` means the clock ran out with no answer. */
  prediction: Side | null;
  winner: Side;
  /** Milliseconds from question start to submission. */
  responseMs: number;
  /** Consecutive correct answers *before* this question. */
  streakBefore: number;
  timeLimitMs?: number;
}

export function scoreAnswer({
  prediction,
  winner,
  responseMs,
  streakBefore,
  timeLimitMs = QUESTION_TIME_MS,
}: ScoreInput): ScoreBreakdown {
  const clamped = Math.min(Math.max(responseMs, 0), timeLimitMs);
  const speedFactor = timeLimitMs > 0 ? 1 - clamped / timeLimitMs : 0;

  if (prediction === null) {
    return { outcome: 'timeout', base: 0, speedBonus: 0, streakBonus: 0, total: 0, speedFactor: 0 };
  }
  if (prediction !== winner) {
    return {
      outcome: 'incorrect',
      base: 0,
      speedBonus: 0,
      streakBonus: 0,
      total: 0,
      speedFactor,
    };
  }

  const speedBonus = Math.round(SCORING.maxSpeedBonus * speedFactor);
  const streakBonus = Math.min(
    streakBefore * SCORING.streakBonusPerStep,
    SCORING.maxStreakBonus,
  );
  return {
    outcome: 'correct',
    base: SCORING.base,
    speedBonus,
    streakBonus,
    total: SCORING.base + speedBonus + streakBonus,
    speedFactor,
  };
}

/** Points still theoretically available across `remainingQuestions`. */
export function maxRemainingScore(remainingQuestions: number): number {
  return Math.max(0, remainingQuestions) * MAX_QUESTION_SCORE;
}

/** 0-100, used for the results screen's rating band. */
export function scoreEfficiency(totalScore: number, questionCount: number): number {
  const max = questionCount * MAX_QUESTION_SCORE;
  return max > 0 ? Math.round((totalScore / max) * 100) : 0;
}

export interface RatingBand {
  label: string;
  tone: 'legendary' | 'great' | 'good' | 'ok' | 'poor';
  blurb: string;
}

/** Rating is driven by accuracy first, with efficiency breaking ties. */
export function ratingFor(accuracyPct: number, efficiencyPct: number): RatingBand {
  if (accuracyPct >= 85 && efficiencyPct >= 65) {
    return {
      label: 'Challenger Analyst',
      tone: 'legendary',
      blurb: 'You are reading drafts faster than the casters.',
    };
  }
  if (accuracyPct >= 70) {
    return {
      label: 'Master Scout',
      tone: 'great',
      blurb: 'Strong read on side advantage and comp scaling.',
    };
  }
  if (accuracyPct >= 55) {
    return {
      label: 'Diamond Drafter',
      tone: 'good',
      blurb: 'Better than a coin flip — trim the hesitation for more speed points.',
    };
  }
  if (accuracyPct >= 45) {
    return {
      label: 'Gold Spectator',
      tone: 'ok',
      blurb: 'Right around coin-flip territory. Watch the bans.',
    };
  }
  return {
    label: 'Iron Instinct',
    tone: 'poor',
    blurb: 'Rough run. Try a single league to build pattern recognition.',
  };
}
