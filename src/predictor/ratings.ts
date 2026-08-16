/**
 * Optional team ratings: GlobalRank and Fraud.
 *
 * These are the one predictor input with no equivalent anywhere in an Oracle's
 * Elixir export — they are hand-maintained judgements about how strong a team
 * is and how reliably it plays to that strength. The original app kept them in
 * a champion-pool CSV alongside rosters; here that file stays optional, and
 * without it the engine simply awards no rank edge and no fraud penalty.
 *
 * The file is small (a few hundred rows), so it is parsed in one pass rather
 * than streamed like the match exports.
 */

import Papa from 'papaparse';
import type { TeamRating } from './types.ts';

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

  const ratings = new Map<string, TeamRating>();
  const warnings: string[] = [];
  let currentTeam = '';
  let teamsRead = 0;

  for (const row of parsed.data) {
    const teamCell = (row[teamColumn] ?? '').trim();
    if (teamCell) currentTeam = teamCell;
    if (!currentTeam) continue;

    const rank = toNumber(row[rankColumn]);
    const fraud = toNumber(row[fraudColumn]);
    // Only the team's header row carries these; blanks below it are expected.
    if (rank === null && fraud === null) continue;

    const keys = ratingKeys(currentTeam);
    if (ratings.has(keys[0]!)) continue;

    const rating: TeamRating = { team: currentTeam, globalRank: rank, fraud: fraud ?? 0 };
    for (const key of keys) ratings.set(key, rating);
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
