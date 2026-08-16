/**
 * Quiz generation, in one of two modes.
 *
 * `matchups` draws a series at a time — pick T1 vs Gen.G and you play that
 * series from game 1 to its last game. `games` draws unrelated games, one per
 * question. Both sample without replacement from the same eligible pool and
 * are seeded, so a quiz never repeats a game and can be reproduced exactly.
 *
 * A game only enters the pool when it can actually be answered — both drafts
 * complete, both teams named, a real winner, a usable date.
 */

import { COMPETITION_IDS } from '../domain/competitions.ts';
import { ROLES, type CompetitionId, type Game } from '../domain/types.ts';
import { createRng, type Rng } from './rng.ts';
import { groupIntoSeries, seriesKeyOf } from './series.ts';
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
  /** Questions in play order. In `matchups` mode, whole series game 1 → last. */
  games: Game[];
  /** Size of the pool the questions were drawn from. */
  poolSize: number;
  /** How many matchups the questions span (equals the count in `games` mode). */
  seriesCount: number;
}

/**
 * Build a quiz in the configured mode.
 *
 * Both modes sample without replacement from the same eligible pool and both
 * honour the requested question count exactly, so runs stay comparable on the
 * leaderboard.
 */
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
  const rng = createRng(
    `${config.seed}:${config.mode}:${config.source.kind}:${config.questionCount}`,
  );

  const picked =
    config.mode === 'games' ? pickGames(pool, config, rng) : pickMatchups(pool, config, rng);

  return {
    config,
    games: picked,
    poolSize: pool.length,
    seriesCount: config.mode === 'games' ? picked.length : countSeries(picked),
  };
}

/** Unrelated games, shuffled — the original behaviour. */
function pickGames(pool: readonly Game[], config: QuizConfig, rng: Rng): Game[] {
  const ordered = [...pool].sort((a, b) => a.gameId.localeCompare(b.gameId));
  return rng.sample(ordered, config.questionCount);
}

/**
 * Whole series, in play order.
 *
 * Series are shuffled, then taken whole while they fit in the remaining
 * question slots — so a best-of-5 contributes all five games, in order. If no
 * remaining series fits the last few slots, one is truncated, keeping game 1
 * onward, so the question count still lands exactly.
 */
function pickMatchups(pool: readonly Game[], config: QuizConfig, rng: Rng): Game[] {
  const allSeries = groupIntoSeries(pool).sort((a, b) => a.key.localeCompare(b.key));
  const shuffled = rng.shuffle(allSeries);

  const picked: Game[] = [];
  const used = new Set<string>();
  let remaining: number = config.questionCount;

  for (const series of shuffled) {
    if (remaining === 0) break;
    if (series.games.length > remaining) continue;
    picked.push(...series.games);
    used.add(series.key);
    remaining -= series.games.length;
  }

  // Every leftover series is longer than the slots left; trim one to finish.
  if (remaining > 0) {
    const filler = shuffled.find((series) => !used.has(series.key));
    if (filler) picked.push(...filler.games.slice(0, remaining));
  }
  return picked;
}

function countSeries(games: readonly Game[]): number {
  let count = 0;
  for (let i = 0; i < games.length; i += 1) {
    const previous = i > 0 ? games[i - 1]! : null;
    if (
      previous === null ||
      seriesKeyOf(previous) !== seriesKeyOf(games[i]!) ||
      games[i]!.gameNumber <= previous.gameNumber
    ) {
      count += 1;
    }
  }
  return count;
}
