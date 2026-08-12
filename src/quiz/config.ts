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

export interface QuizConfig {
  source: QuestionSource;
  questionCount: QuestionCount;
  /** Reproducibility handle — same seed + same dataset = same questions. */
  seed: string;
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
