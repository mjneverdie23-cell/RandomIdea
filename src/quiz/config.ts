/**
 * Quiz configuration: what the setup screen produces and the engine consumes.
 */

import { COMPETITION_IDS, competitionShort } from '../domain/competitions.ts';
import type { CompetitionId } from '../domain/types.ts';

export const QUESTION_COUNTS = [10, 25, 50] as const;
export type QuestionCount = (typeof QUESTION_COUNTS)[number];
export const DEFAULT_QUESTION_COUNT: QuestionCount = 10;

/** `mixed` draws from every eligible competition; `single` locks to one. */
export type QuestionSource =
  | { kind: 'mixed' }
  | { kind: 'single'; competition: CompetitionId };

/**
 * How questions are drawn.
 *
 * `matchups` plays whole series in order — game 1 through the decider — so
 * later games carry the context of the earlier ones. `games` is the original
 * shuffle: every question an unrelated game.
 */
export type QuizMode = 'matchups' | 'games';
export const DEFAULT_MODE: QuizMode = 'matchups';

export const MODE_LABEL: Record<QuizMode, string> = {
  matchups: 'Matchups',
  games: 'Random games',
};

export const MODE_BLURB: Record<QuizMode, string> = {
  matchups: 'Whole series, game 1 to the decider',
  games: 'Every question an unrelated game',
};

export function isQuizMode(value: string): value is QuizMode {
  return value === 'matchups' || value === 'games';
}

/**
 * Which slice of history the questions come from.
 *
 * A whole year is a lot of meta to hold in your head — patches turn over, the
 * pick pool rotates, and a Spring draft reads nothing like a Summer one. Being
 * able to lock a run to a single split makes it a memory test of one meta
 * rather than of four.
 *
 * `year` covers everything in that season, which is how international events
 * are reached: Worlds and MSI carry no split in the source data, so they
 * belong to their year and to no split within it.
 */
export type QuizPeriod =
  | { kind: 'all' }
  | { kind: 'year'; year: string }
  | { kind: 'split'; year: string; split: string };

export const ALL_PERIOD: QuizPeriod = { kind: 'all' };

export interface QuizConfig {
  source: QuestionSource;
  period: QuizPeriod;
  questionCount: QuestionCount;
  mode: QuizMode;
  /** Reproducibility handle — same seed + same dataset = same questions. */
  seed: string;
}

export function periodKey(period: QuizPeriod): string {
  if (period.kind === 'all') return 'ALL';
  if (period.kind === 'year') return period.year;
  return `${period.year}|${period.split}`;
}

export function periodLabel(period: QuizPeriod): string {
  if (period.kind === 'all') return 'All seasons';
  if (period.kind === 'year') return period.year;
  return `${period.year} ${period.split}`;
}

export function parsePeriodKey(key: string | null | undefined): QuizPeriod {
  if (!key || key === 'ALL') return ALL_PERIOD;
  const [year = '', split = ''] = key.split('|');
  if (!/^\d{4}$/.test(year)) return ALL_PERIOD;
  return split ? { kind: 'split', year, split } : { kind: 'year', year };
}

export function samePeriod(a: QuizPeriod, b: QuizPeriod): boolean {
  return periodKey(a) === periodKey(b);
}

/**
 * What a run was drawn from, in one string: `LCK · 2024 Summer`.
 *
 * Falls back to the source alone when the run spans every season, so the
 * common case reads exactly as it did before periods existed.
 */
export function scopeLabel(source: QuestionSource, period: QuizPeriod = ALL_PERIOD): string {
  const base = sourceLabel(source);
  return period.kind === 'all' ? base : `${base} · ${periodLabel(period)}`;
}

export const MIXED_SOURCE: QuestionSource = { kind: 'mixed' };

export function sourceKey(source: QuestionSource): string {
  return source.kind === 'mixed' ? 'MIXED' : source.competition;
}

export function sourceLabel(source: QuestionSource): string {
  return source.kind === 'mixed' ? 'All competitions' : competitionShort(source.competition);
}

export function parseSourceKey(key: string | null | undefined): QuestionSource {
  if (!key || key === 'MIXED') return MIXED_SOURCE;
  const match = COMPETITION_IDS.find((id) => id === key);
  return match ? { kind: 'single', competition: match } : MIXED_SOURCE;
}

export function isQuestionCount(value: number): value is QuestionCount {
  return (QUESTION_COUNTS as readonly number[]).includes(value);
}
