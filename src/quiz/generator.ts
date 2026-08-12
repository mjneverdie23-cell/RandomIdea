/**
 * Quiz generation: pick N distinct, quiz-worthy games from the dataset.
 *
 * A game only enters the pool when it can actually be answered — both drafts
 * complete, both teams named, a real winner, a usable date. Sampling is seeded
 * and without replacement, so a quiz never repeats a game and can be
 * reproduced exactly from its seed.
 */

import { COMPETITION_IDS } from '../domain/competitions.ts';
import { ROLES, type CompetitionId, type Game } from '../domain/types.ts';
import { createRng } from './rng.ts';
import type { QuestionSource, QuizConfig } from './config.ts';

/** Bans are nice-to-have; a game without them is still a fair question. */
const MIN_BANS_FOR_FULL_DRAFT = 3;

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

export function checkEligibility(game: Game): EligibilityResult {
  for (const team of [game.blue, game.red]) {
    if (!team.teamName.trim()) return { eligible: false, reason: 'missing team name' };
    if (team.players.length !== ROLES.length) {
      return { eligible: false, reason: 'incomplete roster' };
    }
    if (team.players.some((slot) => !slot.champion.id)) {
      return { eligible: false, reason: 'missing champion pick' };
    }
  }
  if (game.blue.teamName === game.red.teamName) {
    return { eligible: false, reason: 'mirror matchup' };
  }
  if (game.winner !== 'blue' && game.winner !== 'red') {
    return { eligible: false, reason: 'no winner' };
  }
  if (!Number.isFinite(Date.parse(game.date))) {
    return { eligible: false, reason: 'invalid date' };
  }
  return { eligible: true };
}

export function isQuizEligible(game: Game): boolean {
  return checkEligibility(game).eligible;
}

/** True when both sides have a recognisable ban phase to display. */
export function hasFullDraft(game: Game): boolean {
  return (
    game.blue.bans.length >= MIN_BANS_FOR_FULL_DRAFT &&
    game.red.bans.length >= MIN_BANS_FOR_FULL_DRAFT
  );
}

export function eligibleGames(games: readonly Game[]): Game[] {
  return games.filter(isQuizEligible);
}

export function filterBySource(games: readonly Game[], source: QuestionSource): Game[] {
  if (source.kind === 'mixed') return [...games];
  return games.filter((game) => game.competition === source.competition);
}

export interface Availability {
  /** Eligible games across every competition. */
  total: number;
  /** Eligible games per competition. */
  perCompetition: Record<CompetitionId, number>;
}

export function computeAvailability(games: readonly Game[]): Availability {
  const perCompetition = Object.fromEntries(
    COMPETITION_IDS.map((id) => [id, 0]),
  ) as Record<CompetitionId, number>;

  let total = 0;
  for (const game of games) {
    if (!isQuizEligible(game)) continue;
    total += 1;
    perCompetition[game.competition] += 1;
  }
  return { total, perCompetition };
}

export function availableFor(availability: Availability, source: QuestionSource): number {
  return source.kind === 'mixed'
    ? availability.total
    : availability.perCompetition[source.competition];
}

export class QuizGenerationError extends Error {
  constructor(
    message: string,
    readonly available: number,
    readonly requested: number,
  ) {
    super(message);
    this.name = 'QuizGenerationError';
  }
}

export interface GeneratedQuiz {
  config: QuizConfig;
  games: Game[];
  /** Size of the pool the questions were drawn from. */
  poolSize: number;
}

export function generateQuiz(games: readonly Game[], config: QuizConfig): GeneratedQuiz {
  const pool = filterBySource(eligibleGames(games), config.source);
  if (pool.length < config.questionCount) {
    throw new QuizGenerationError(
      `Only ${pool.length} eligible game${pool.length === 1 ? '' : 's'} available for this selection — need ${config.questionCount}.`,
      pool.length,
      config.questionCount,
    );
  }

  // Sort before sampling so the seed maps to the same questions regardless of
  // the dataset's incoming row order.
  const ordered = [...pool].sort((a, b) => a.gameId.localeCompare(b.gameId));
  const rng = createRng(`${config.seed}:${config.source.kind}:${config.questionCount}`);
  const picked = rng.sample(ordered, config.questionCount);

  return { config, games: picked, poolSize: pool.length };
}
