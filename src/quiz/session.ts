/**
 * Quiz session state machine + end-of-run aggregation.
 *
 * Kept as a pure reducer so the flow (question -> reveal -> next -> finished)
 * is testable without React, and so the timer component can stay a dumb
 * renderer that only reports "the user answered X after Y ms".
 */

import type { CompetitionId, Game, Side } from '../domain/types.ts';
import {
  QUESTION_TIME_MS,
  ratingFor,
  scoreAnswer,
  scoreEfficiency,
  type AnswerOutcome,
  type RatingBand,
  type ScoreBreakdown,
} from './scoring.ts';
import type { QuizConfig } from './config.ts';

export interface AnswerRecord {
  gameId: string;
  competition: CompetitionId;
  /** `null` when the clock ran out. */
  prediction: Side | null;
  winner: Side;
  outcome: AnswerOutcome;
  responseMs: number;
  score: ScoreBreakdown;
}

export type QuizPhase = 'question' | 'reveal' | 'finished';

export interface QuizState {
  config: QuizConfig;
  games: Game[];
  index: number;
  phase: QuizPhase;
  answers: AnswerRecord[];
  totalScore: number;
  streak: number;
  bestStreak: number;
  startedAt: number;
  finishedAt: number | null;
}

export type QuizAction =
  | { type: 'answer'; prediction: Side | null; responseMs: number }
  | { type: 'next' };

export function createQuizState(config: QuizConfig, games: Game[], now = Date.now()): QuizState {
  return {
    config,
    games,
    index: 0,
    phase: 'question',
    answers: [],
    totalScore: 0,
    streak: 0,
    bestStreak: 0,
    startedAt: now,
    finishedAt: null,
  };
}

export function quizReducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case 'answer': {
      if (state.phase !== 'question') return state;
      const game = state.games[state.index];
      if (!game) return state;

      const score = scoreAnswer({
        prediction: action.prediction,
        winner: game.winner,
        responseMs: action.responseMs,
        streakBefore: state.streak,
      });

      const record: AnswerRecord = {
        gameId: game.gameId,
        competition: game.competition,
        prediction: action.prediction,
        winner: game.winner,
        outcome: score.outcome,
        // A timeout always costs the full clock, however late the tick fired.
        responseMs:
          score.outcome === 'timeout'
            ? QUESTION_TIME_MS
            : Math.min(Math.max(action.responseMs, 0), QUESTION_TIME_MS),
        score,
      };

      const streak = score.outcome === 'correct' ? state.streak + 1 : 0;
      return {
        ...state,
        phase: 'reveal',
        answers: [...state.answers, record],
        totalScore: state.totalScore + score.total,
        streak,
        bestStreak: Math.max(state.bestStreak, streak),
      };
    }

    case 'next': {
      if (state.phase !== 'reveal') return state;
      const nextIndex = state.index + 1;
      if (nextIndex >= state.games.length) {
        return { ...state, phase: 'finished', finishedAt: Date.now() };
      }
      return { ...state, index: nextIndex, phase: 'question' };
    }

    default:
      return state;
  }
}

export function currentGame(state: QuizState): Game | null {
  return state.games[state.index] ?? null;
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

export interface CompetitionBreakdown {
  competition: CompetitionId;
  questions: number;
  correct: number;
  accuracy: number;
  score: number;
}

export interface QuizSummary {
  totalScore: number;
  questionCount: number;
  correct: number;
  incorrect: number;
  timeouts: number;
  /** Percentage of all questions answered correctly, 0-100. */
  accuracy: number;
  /** Average over answered questions only; `null` if every question timed out. */
  averageResponseMs: number | null;
  /** Fastest correct answer; falls back to fastest answer of any kind. */
  fastestResponseMs: number | null;
  bestStreak: number;
  efficiency: number;
  rating: RatingBand;
  byCompetition: CompetitionBreakdown[];
  /** Highest-accuracy competition with at least two questions. */
  bestCompetition: CompetitionBreakdown | null;
  /** Wall-clock duration of the run, in ms. */
  durationMs: number;
}

export function summarize(state: QuizState): QuizSummary {
  const { answers } = state;
  const correct = answers.filter((a) => a.outcome === 'correct');
  const incorrect = answers.filter((a) => a.outcome === 'incorrect').length;
  const timeouts = answers.filter((a) => a.outcome === 'timeout').length;
  const answered = answers.filter((a) => a.outcome !== 'timeout');

  const accuracy = answers.length ? (correct.length / answers.length) * 100 : 0;
  const averageResponseMs = answered.length
    ? answered.reduce((sum, a) => sum + a.responseMs, 0) / answered.length
    : null;

  const fastestPool = correct.length ? correct : answered;
  const fastestResponseMs = fastestPool.length
    ? Math.min(...fastestPool.map((a) => a.responseMs))
    : null;

  const grouped = new Map<CompetitionId, CompetitionBreakdown>();
  for (const answer of answers) {
    const entry = grouped.get(answer.competition) ?? {
      competition: answer.competition,
      questions: 0,
      correct: 0,
      accuracy: 0,
      score: 0,
    };
    entry.questions += 1;
    if (answer.outcome === 'correct') entry.correct += 1;
    entry.score += answer.score.total;
    grouped.set(answer.competition, entry);
  }
  const byCompetition = [...grouped.values()]
    .map((entry) => ({ ...entry, accuracy: (entry.correct / entry.questions) * 100 }))
    .sort((a, b) => b.score - a.score || b.accuracy - a.accuracy);

  const bestCompetition =
    byCompetition.length > 1
      ? ([...byCompetition]
          .filter((entry) => entry.questions >= 2)
          .sort((a, b) => b.accuracy - a.accuracy || b.questions - a.questions)[0] ?? null)
      : null;

  return {
    totalScore: state.totalScore,
    questionCount: state.games.length,
    correct: correct.length,
    incorrect,
    timeouts,
    accuracy,
    averageResponseMs,
    fastestResponseMs,
    bestStreak: state.bestStreak,
    efficiency: scoreEfficiency(state.totalScore, state.games.length),
    rating: ratingFor(accuracy, scoreEfficiency(state.totalScore, state.games.length)),
    byCompetition,
    bestCompetition,
    durationMs: (state.finishedAt ?? Date.now()) - state.startedAt,
  };
}
