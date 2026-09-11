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

import { COMPETITION_IDS, competitionScope } from '../domain/competitions.ts';
import { compareYears, yearOf } from '../data/years.ts';
import { ROLES, type CompetitionId, type Game } from '../domain/types.ts';
import { createRng, type Rng } from './rng.ts';
import { groupIntoSeries, seriesKeyOf } from './series.ts';
import {
  ALL_PERIOD,
  periodKey,
  sourceKey,
  type QuestionSource,
  type QuizConfig,
  type QuizPeriod,
} from './config.ts';

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

/**
 * Narrow to a season, or to one split inside it.
 *
 * A `year` selection deliberately includes games with no split — that is where
 * Worlds and MSI live, since the source data gives them no split name.
 */
export function filterByPeriod(games: readonly Game[], period: QuizPeriod): Game[] {
  if (period.kind === 'all') return [...games];
  if (period.kind === 'year') return games.filter((game) => yearOf(game) === period.year);
  // `hasSeasonSplit` rather than a bare `split ===` so the draw matches the
  // counts exactly: both sides agree on what counts as a split.
  return games.filter(
    (game) => yearOf(game) === period.year && hasSeasonSplit(game) && game.split === period.split,
  );
}

/**
 * Whether a game's `split` names a real season split.
 *
 * Only regional leagues run splits. At an international event the column
 * carries the *stage* instead — `Play-In`, `Swiss Stage`, `Quarterfinal` — and
 * offering those as "splits" would be both wrong and useless, since the stage
 * is already visible on the game itself. Worlds and MSI are reached by picking
 * the competition and the year.
 */
export function hasSeasonSplit(game: Game): game is Game & { split: string } {
  return game.split !== null && competitionScope(game.competition) === 'regional';
}

/** A season present in the dataset, with the splits found inside it. */
export interface SeasonOption {
  year: string;
  /** Split names in the order they were played. */
  splits: string[];
}

export interface Availability {
  /** Eligible games across every competition. */
  total: number;
  /** Eligible games per competition. */
  perCompetition: Record<CompetitionId, number>;
  /** Seasons present in the data, newest first. */
  seasons: SeasonOption[];
  /**
   * Eligible games for every source/period pair, keyed `${sourceKey}#${periodKey}`.
   *
   * Precomputed rather than filtered on demand because the setup screen shows a
   * live count on every chip, and both axes move: choosing a split has to
   * restate the per-competition counts and vice versa.
   */
  counts: Record<string, number>;
}

export function countsKey(source: QuestionSource, period: QuizPeriod): string {
  return `${sourceKey(source)}#${periodKey(period)}`;
}

export function computeAvailability(games: readonly Game[]): Availability {
  const perCompetition = Object.fromEntries(
    COMPETITION_IDS.map((id) => [id, 0]),
  ) as Record<CompetitionId, number>;
  const counts: Record<string, number> = {};
  // Splits are ordered by when they were actually played, so Spring lands
  // before Summer without hardcoding either name.
  const splitFirstSeen = new Map<string, number>();

  const add = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };

  let total = 0;
  for (const game of games) {
    if (!isQuizEligible(game)) continue;
    total += 1;
    perCompetition[game.competition] += 1;

    const year = yearOf(game);
    const periods: QuizPeriod[] = [ALL_PERIOD, { kind: 'year', year }];
    if (hasSeasonSplit(game)) {
      periods.push({ kind: 'split', year, split: game.split });
      const bucket = `${year}|${game.split}`;
      const time = Date.parse(game.date);
      const seen = splitFirstSeen.get(bucket);
      if (Number.isFinite(time) && (seen === undefined || time < seen)) {
        splitFirstSeen.set(bucket, time);
      }
    }
    const sources: QuestionSource[] = [
      { kind: 'mixed' },
      { kind: 'single', competition: game.competition },
    ];
    for (const source of sources) {
      for (const period of periods) add(countsKey(source, period));
    }
  }

  const byYear = new Map<string, { split: string; at: number }[]>();
  for (const [bucket, at] of splitFirstSeen) {
    const [year = '', split = ''] = bucket.split('|');
    const list = byYear.get(year);
    if (list) list.push({ split, at });
    else byYear.set(year, [{ split, at }]);
  }
  const years = new Set<string>();
  for (const game of games) if (isQuizEligible(game)) years.add(yearOf(game));

  const seasons: SeasonOption[] = [...years].sort(compareYears).map((year) => ({
    year,
    splits: (byYear.get(year) ?? [])
      .sort((a, b) => a.at - b.at)
      .map((entry) => entry.split),
  }));

  return { total, perCompetition, seasons, counts };
}

export function availableFor(
  availability: Availability,
  source: QuestionSource,
  period: QuizPeriod = ALL_PERIOD,
): number {
  if (period.kind === 'all') {
    return source.kind === 'mixed'
      ? availability.total
      : availability.perCompetition[source.competition];
  }
  return availability.counts[countsKey(source, period)] ?? 0;
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
  const period = config.period ?? ALL_PERIOD;
  const pool = filterByPeriod(filterBySource(eligibleGames(games), config.source), period);
  if (pool.length < config.questionCount) {
    throw new QuizGenerationError(
      `Only ${pool.length} eligible game${pool.length === 1 ? '' : 's'} available for this selection — need ${config.questionCount}.`,
      pool.length,
      config.questionCount,
    );
  }

  // Sort before sampling so the seed maps to the same questions regardless of
  // the dataset's incoming row order. The period is part of the seed so that
  // the same handle drawn against two different splits gives two independent
  // draws rather than correlated ones.
  const rng = createRng(
    `${config.seed}:${config.mode}:${config.source.kind}:${periodKey(period)}:${config.questionCount}`,
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
