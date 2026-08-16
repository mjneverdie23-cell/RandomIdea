/**
 * Team ratings: GlobalRank and Fraud.
 *
 * These are the one predictor input with no equivalent anywhere in an Oracle's
 * Elixir export — they are hand-maintained judgements about how strong a team
 * is and how reliably it plays to that strength, and they come from the same
 * champion-pool CSV the original app used for rosters.
 *
 * A default table ships with the app (`data/teamRatings.json`) so the rank edge
 * and fraud penalty work immediately; importing a file on the Data tab replaces
 * it. Teams the table doesn't list score neither term, which the report says.
 *
 * The file is small (a few hundred rows), so it is parsed in one pass rather
 * than streamed like the match exports.
 */

import Papa from 'papaparse';
import type { TeamRating } from './types.ts';
import bundled from './data/teamRatings.json';

/** Columns that identify a champion-pool file rather than a match export. */
export const RATINGS_REQUIRED_COLUMNS = ['teamName', 'GlobalRank', 'Fraud'] as const;

export class RatingsParseError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'RatingsParseError';
  }
}

export interface RatingsImport {
  ratings: Map<string, TeamRating>;
  /** Teams that carried a usable rank or fraud value. */
  teamsRead: number;
  warnings: string[];
}

function normalizeHeader(header: string): string {
  return header.replace(/^﻿/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Match keys, loosest last: exact-lowercase, then alphanumerics only. */
export function ratingKeys(teamName: string): string[] {
  const lower = teamName.trim().toLowerCase();
  const squashed = lower.replace(/[^a-z0-9]/g, '');
  return squashed && squashed !== lower ? [lower, squashed] : [lower];
}

/** Look a team up through the same widening keys used when indexing. */
export function lookupRating(
  ratings: Map<string, TeamRating>,
  teamName: string,
): TeamRating | null {
  for (const key of ratingKeys(teamName)) {
    const hit = ratings.get(key);
    if (hit) return hit;
  }
  return null;
}

function toNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse a champion-pool CSV into team ratings.
 *
 * The file is written for humans: a team's league, name, rank and fraud appear
 * once on the first of its five player rows and are left blank on the rest, so
 * values are carried down until the next team starts.
 */
export function parseRatingsCsv(text: string): RatingsImport {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
  });

  const headers = (parsed.meta.fields ?? []).map((field) => ({
    raw: field,
    key: normalizeHeader(field),
  }));
  const columnFor = (name: string): string | null =>
    headers.find((header) => header.key === normalizeHeader(name))?.raw ?? null;

  const missing = RATINGS_REQUIRED_COLUMNS.filter((column) => columnFor(column) === null);
  if (missing.length) {
    throw new RatingsParseError(
      'That file does not look like a team-ratings export.',
      `Missing column(s): ${missing.join(', ')}. A ratings file has ${RATINGS_REQUIRED_COLUMNS.join(
        ', ',
      )} — it is not the Oracle's Elixir match data.`,
    );
  }

  const teamColumn = columnFor('teamName')!;
  const rankColumn = columnFor('GlobalRank')!;
  const fraudColumn = columnFor('Fraud')!;

  /**
   * Collect each column independently across a team's block of rows.
   *
   * The two values do not reliably share a row: a team can carry its rank on
   * the first player's line and its fraud rating further down, or on the blank
   * separator row that closes the block. Reading both from whichever row
   * happened to be seen first silently dropped the other one, which is how a
   * team with a real fraud rating ended up scoring a zero penalty. First
   * non-blank value per column wins, so the order they appear in stops
   * mattering.
   */
  const blocks = new Map<string, { team: string; rank: number | null; fraud: number | null }>();
  const order: string[] = [];
  let currentTeam = '';

  for (const row of parsed.data) {
    const teamCell = (row[teamColumn] ?? '').trim();
    if (teamCell) currentTeam = teamCell;
    if (!currentTeam) continue;

    const key = ratingKeys(currentTeam)[0]!;
    let block = blocks.get(key);
    if (!block) {
      block = { team: currentTeam, rank: null, fraud: null };
      blocks.set(key, block);
      order.push(key);
    }

    if (block.rank === null) block.rank = toNumber(row[rankColumn]);
    if (block.fraud === null) block.fraud = toNumber(row[fraudColumn]);
  }

  const ratings = new Map<string, TeamRating>();
  const warnings: string[] = [];
  let teamsRead = 0;

  for (const key of order) {
    const block = blocks.get(key)!;
    // A block with neither value is just a roster listing, not a rating.
    if (block.rank === null && block.fraud === null) continue;
    const rating: TeamRating = {
      team: block.team,
      globalRank: block.rank,
      fraud: block.fraud ?? 0,
    };
    for (const alias of ratingKeys(block.team)) ratings.set(alias, rating);
    teamsRead += 1;
  }

  if (teamsRead === 0) {
    warnings.push('No team carried a GlobalRank or Fraud value, so no ratings were imported.');
  }
  if (parsed.errors.length) {
    warnings.push(`${parsed.errors.length} row(s) could not be parsed and were skipped.`);
  }

  return { ratings, teamsRead, warnings };
}

/** Serializable form, for storing alongside the imported seasons. */
export interface StoredRatings {
  label: string;
  importedAt: string;
  teams: TeamRating[];
  /** True for the table shipped with the app rather than one the user imported. */
  bundled?: boolean;
}

/**
 * The ratings the app ships with, so the rank edge and fraud penalty do
 * something on a fresh install instead of quietly scoring zero until someone
 * discovers the optional import. Regenerate with
 * `node scripts/build-team-ratings.mjs <champpool.csv>`; an imported file
 * replaces this table wholesale.
 */
export function bundledRatings(): StoredRatings {
  return {
    label: `${bundled.label} (shipped default)`,
    importedAt: bundled.generatedAt,
    teams: bundled.teams as TeamRating[],
    bundled: true,
  };
}

export function ratingsToStored(
  ratings: Map<string, TeamRating>,
  label: string,
): StoredRatings {
  // One rating object is indexed under several keys; store each team once.
  const unique = new Map<string, TeamRating>();
  for (const rating of ratings.values()) unique.set(rating.team, rating);
  return {
    label,
    importedAt: new Date().toISOString(),
    teams: [...unique.values()].sort((a, b) => a.team.localeCompare(b.team)),
  };
}

export function ratingsFromStored(stored: StoredRatings | null): Map<string, TeamRating> {
  const ratings = new Map<string, TeamRating>();
  if (!stored) return ratings;
  for (const rating of stored.teams) {
    for (const key of ratingKeys(rating.team)) ratings.set(key, rating);
  }
  return ratings;
}
