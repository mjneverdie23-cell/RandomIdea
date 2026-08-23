/**
 * Blind mode: a four-rung survival ladder played with the draft alone.
 *
 * The normal quiz hands you everything a broadcast would — teams, rosters,
 * event, patch — and asks for the winner. Blind mode takes it all away. You get
 * the bans, the picks and the league, and nothing else: no team names, no
 * players, no tournament, no date. Read the draft or guess.
 *
 * Four questions, one per level, each drawn to be harder than the last. Get one
 * right and you climb; get one wrong and the run is over. Three hints are
 * available at any point, each giving back a piece of what was taken away.
 *
 * Pure: no React, no storage, no dates of its own.
 */

import type { Game, Side } from '../domain/types.ts';
import { createRng } from './rng.ts';
import { isQuizEligible } from './generator.ts';

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

export const BLIND_LEVELS = ['easy', 'medium', 'hard', 'impossible'] as const;
export type BlindLevel = (typeof BLIND_LEVELS)[number];

export const LEVEL_LABEL: Record<BlindLevel, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  impossible: 'Impossible',
};

export const LEVEL_BLURB: Record<BlindLevel, string> = {
  easy: 'A clear favourite, and the form book held',
  medium: 'One side is better, but not by much',
  hard: 'Two teams of similar standing',
  impossible: 'A coin flip on paper',
};

/**
 * How far apart two teams' season records must be for each rung.
 *
 * Difficulty is the gap between the two teams' win rates, which is the closest
 * thing to "how obvious was this on paper". The bands are cut from the real
 * distribution rather than guessed — measured across the 2026 season, the
 * favourite went on to win:
 *
 *   gap >= 0.22   78.8% of 344 games   easy
 *   0.12 - 0.22   64.5% of 611         medium
 *   0.05 - 0.12   58.6% of 418         hard
 *   below 0.05    51.7% of 373         impossible — a genuine coin flip
 *
 * Every band holds several hundred games, so a ladder can always be built.
 */
export const LEVEL_BANDS: Record<BlindLevel, { min: number; max: number }> = {
  easy: { min: 0.22, max: Infinity },
  medium: { min: 0.12, max: 0.22 },
  hard: { min: 0.05, max: 0.12 },
  impossible: { min: 0, max: 0.05 },
};

/** Games a team needs before its win rate is worth rating a match by. */
export const MIN_RATED_GAMES = 10;

/* ------------------------------------------------------------------ */
/* Rating                                                              */
/* ------------------------------------------------------------------ */

export interface RatedGame {
  game: Game;
  level: BlindLevel;
  /** Absolute difference between the two teams' win rates. */
  gap: number;
  /** Whether the stronger record went on to win. */
  favouriteWon: boolean;
}

export function levelForGap(gap: number): BlindLevel {
  for (const level of BLIND_LEVELS) {
    const band = LEVEL_BANDS[level];
    if (gap >= band.min && gap < band.max) return level;
  }
  return 'impossible';
}

/**
 * Sort every eligible game onto a rung.
 *
 * Each team's record is taken over the whole pool **minus the game being
 * rated**. Leaving it in is a quiet form of leakage: a team's win rate is
 * nudged up by the game it just won, which at small gaps is enough to flip
 * which side counts as the favourite. Measured on the 2026 season it made the
 * coin-flip band look 6 points more predictable than it is — 57.7% against the
 * 51.7% that shows up once the game is excluded.
 */
export function rateGames(games: readonly Game[]): RatedGame[] {
  const pool = games.filter(isQuizEligible);
  const record = new Map<string, { wins: number; games: number }>();

  for (const game of pool) {
    for (const side of [game.blue, game.red] as const) {
      const key = side.teamName.toLowerCase();
      const entry = record.get(key) ?? { wins: 0, games: 0 };
      entry.games += 1;
      if (game.winner === side.side) entry.wins += 1;
      record.set(key, entry);
    }
  }

  const rated: RatedGame[] = [];
  for (const game of pool) {
    const without = (side: 'blue' | 'red') => {
      const entry = record.get(game[side].teamName.toLowerCase());
      if (!entry) return null;
      const games = entry.games - 1;
      const wins = entry.wins - (game.winner === side ? 1 : 0);
      return games >= MIN_RATED_GAMES ? wins / games : null;
    };

    const blue = without('blue');
    const red = without('red');
    if (blue === null || red === null) continue;

    const gap = Math.abs(blue - red);
    const favourite: Side | null = blue === red ? null : blue > red ? 'blue' : 'red';
    rated.push({
      game,
      level: levelForGap(gap),
      gap,
      favouriteWon: favourite !== null && game.winner === favourite,
    });
  }
  return rated;
}

/* ------------------------------------------------------------------ */
/* Building a ladder                                                   */
/* ------------------------------------------------------------------ */

export class BlindLadderError extends Error {
  constructor(
    message: string,
    readonly level: BlindLevel,
  ) {
    super(message);
    this.name = 'BlindLadderError';
  }
}

/**
 * One game per rung, in level order.
 *
 * The easy rung additionally requires that the favourite actually won. Without
 * it roughly a fifth of easy questions are upsets, which makes the first rung —
 * the one that has to be winnable — a trap. Every rung above takes whatever the
 * band offers, upsets included, because that is the difficulty being asked for.
 */
export function buildLadder(rated: readonly RatedGame[], seed: string): Game[] {
  const rng = createRng(`blind:${seed}`);
  const ladder: Game[] = [];
  const used = new Set<string>();

  for (const level of BLIND_LEVELS) {
    const candidates = rated
      .filter(
        (entry) =>
          entry.level === level &&
          !used.has(entry.game.gameId) &&
          (level !== 'easy' || entry.favouriteWon),
      )
      // Sorted before sampling so a seed maps to the same ladder regardless of
      // the order games arrived in.
      .sort((a, b) => a.game.gameId.localeCompare(b.game.gameId));

    if (candidates.length === 0) {
      throw new BlindLadderError(
        `No ${LEVEL_LABEL[level].toLowerCase()} games available — import more seasons to play blind mode.`,
        level,
      );
    }
    const picked = rng.sample(candidates, 1)[0]!;
    used.add(picked.game.gameId);
    ladder.push(picked.game);
  }
  return ladder;
}

/* ------------------------------------------------------------------ */
/* Hints                                                               */
/* ------------------------------------------------------------------ */

export const BLIND_HINTS = ['teams', 'meta', 'event'] as const;
export type BlindHint = (typeof BLIND_HINTS)[number];

export const HINT_LABEL: Record<BlindHint, string> = {
  teams: 'Reveal teams and players',
  meta: 'Reveal the patch and its meta',
  event: 'Reveal the tournament and date',
};

/** Whether a hint has been unlocked, given how many were taken. */
export function hintUnlocked(hint: BlindHint, taken: number): boolean {
  return BLIND_HINTS.indexOf(hint) < taken;
}

/* ------------------------------------------------------------------ */
/* Run state                                                           */
/* ------------------------------------------------------------------ */

export type BlindStatus = 'playing' | 'lost' | 'won';

export interface BlindRun {
  /** One game per level, easy first. */
  games: Game[];
  /** Index into `games`, which is also the current rung. */
  level: number;
  /** Hints taken on the current rung, 0–3. */
  hints: number;
  /** Hints taken across the whole run, for the end panel. */
  hintsTotal: number;
  status: BlindStatus;
  /** What the player called on the rung that ended the run. */
  lastCall: Side | null;
}

export function createBlindRun(games: Game[]): BlindRun {
  return { games, level: 0, hints: 0, hintsTotal: 0, status: 'playing', lastCall: null };
}

export type BlindAction =
  | { type: 'hint' }
  | { type: 'answer'; prediction: Side }
  | { type: 'restart'; games: Game[] };

export function blindReducer(run: BlindRun, action: BlindAction): BlindRun {
  switch (action.type) {
    case 'restart':
      return createBlindRun(action.games);

    case 'hint': {
      if (run.status !== 'playing' || run.hints >= BLIND_HINTS.length) return run;
      return { ...run, hints: run.hints + 1, hintsTotal: run.hintsTotal + 1 };
    }

    case 'answer': {
      if (run.status !== 'playing') return run;
      const game = run.games[run.level];
      if (!game) return run;

      if (action.prediction !== game.winner) {
        return { ...run, status: 'lost', lastCall: action.prediction };
      }
      const next = run.level + 1;
      return next >= run.games.length
        ? { ...run, status: 'won', level: run.level, lastCall: action.prediction }
        : { ...run, level: next, hints: 0, lastCall: action.prediction };
    }
  }
}

/** The rung being played, or the one that ended the run. */
export function currentLevel(run: BlindRun): BlindLevel {
  return BLIND_LEVELS[Math.min(run.level, BLIND_LEVELS.length - 1)]!;
}

export function currentBlindGame(run: BlindRun): Game | null {
  return run.games[run.level] ?? null;
}

/** Rungs cleared, which is the score a run ends on. */
export function rungsCleared(run: BlindRun): number {
  return run.status === 'won' ? run.games.length : run.level;
}
