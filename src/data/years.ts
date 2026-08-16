/**
 * Per-year datasets.
 *
 * Oracle's Elixir publishes one CSV per season and people want several loaded
 * at once, so an import doesn't replace what's already there: its games are
 * split by season and merged into per-year buckets. Re-importing a year
 * replaces that year's games and leaves the others alone.
 *
 * Games are bucketed by the season *in the data*, not by which file they
 * arrived in, so a file that spans a year boundary lands in the right places.
 */

import type { DatasetStats, Game, YearDataset, YearSummary } from '../domain/types.ts';
import { comparePatches } from './ingest.ts';

/** Season a game belongs to: its `year` column, else the year of its date. */
export function yearOf(game: Game): string {
  if (/^\d{4}$/.test(game.season)) return game.season;
  const parsed = Date.parse(game.date);
  return Number.isFinite(parsed) ? String(new Date(parsed).getUTCFullYear()) : 'unknown';
}

export function splitGamesByYear(games: readonly Game[]): Map<string, Game[]> {
  const byYear = new Map<string, Game[]>();
  for (const game of games) {
    const year = yearOf(game);
    const bucket = byYear.get(year);
    if (bucket) bucket.push(game);
    else byYear.set(year, [game]);
  }
  return byYear;
}

/** Newest season first. */
export function compareYears(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true });
}

export function sortYears<T extends { year: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareYears(a.year, b.year));
}

/**
 * Stats for an arbitrary set of games.
 *
 * The ingestion counters (rows read, games rejected) only make sense for a
 * single import, so they are summed by the caller where that's meaningful and
 * left at zero otherwise.
 */
export function statsForGames(games: readonly Game[], base?: Partial<DatasetStats>): DatasetStats {
  const perCompetition: Record<string, number> = {};
  const patches = new Set<string>();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const game of games) {
    perCompetition[game.competition] = (perCompetition[game.competition] ?? 0) + 1;
    if (game.patch) patches.add(game.patch);
    const time = Date.parse(game.date);
    if (Number.isFinite(time)) {
      if (time < min) min = time;
      if (time > max) max = time;
    }
  }

  return {
    rowsParsed: base?.rowsParsed ?? 0,
    gamesBuilt: base?.gamesBuilt ?? games.length,
    gamesKept: games.length,
    rejectedByCompetition: base?.rejectedByCompetition ?? 0,
    rejectedIncomplete: base?.rejectedIncomplete ?? 0,
    perCompetition,
    patches: [...patches].sort(comparePatches),
    dateRange:
      games.length && Number.isFinite(min) && Number.isFinite(max)
        ? { from: new Date(min).toISOString(), to: new Date(max).toISOString() }
        : null,
    warnings: base?.warnings ?? [],
  };
}

/**
 * Fold freshly imported games into the existing years.
 *
 * A year present in the import replaces the stored copy of that year — a
 * re-download of a partial season is expected to be more complete than what it
 * supersedes, and replacing avoids stale games lingering when Oracle's Elixir
 * revises a row. Years not present in the import are untouched.
 */
export function mergeImportedYears(
  existing: readonly YearDataset[],
  imported: readonly Game[],
  options: { label: string; importedAt?: string },
): YearDataset[] {
  const importedAt = options.importedAt ?? new Date().toISOString();
  const byYear = splitGamesByYear(imported);
  const merged = new Map(existing.map((entry) => [entry.year, entry]));

  for (const [year, games] of byYear) {
    const previous = merged.get(year);
    merged.set(year, {
      year,
      label: options.label,
      games,
      stats: statsForGames(games),
      importedAt,
      // Re-importing a year keeps whatever switch state it already had.
      enabled: previous?.enabled ?? true,
    });
  }

  return sortYears([...merged.values()]);
}

/** Games from the enabled years, de-duplicated by game id. */
export function combineEnabledGames(years: readonly YearDataset[]): Game[] {
  const seen = new Set<string>();
  const games: Game[] = [];
  for (const year of sortYears(years)) {
    if (!year.enabled) continue;
    for (const game of year.games) {
      if (seen.has(game.gameId)) continue;
      seen.add(game.gameId);
      games.push(game);
    }
  }
  games.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return games;
}

/** Combined stats across the enabled years, summing the ingestion counters. */
export function combineStats(years: readonly YearDataset[], games: readonly Game[]): DatasetStats {
  const enabled = years.filter((year) => year.enabled);
  return statsForGames(games, {
    rowsParsed: enabled.reduce((sum, year) => sum + year.stats.rowsParsed, 0),
    gamesBuilt: enabled.reduce((sum, year) => sum + year.stats.gamesBuilt, 0),
    rejectedByCompetition: enabled.reduce(
      (sum, year) => sum + year.stats.rejectedByCompetition,
      0,
    ),
    rejectedIncomplete: enabled.reduce((sum, year) => sum + year.stats.rejectedIncomplete, 0),
    warnings: enabled.flatMap((year) => year.stats.warnings),
  });
}

export function summarizeYear(year: YearDataset): YearSummary {
  return {
    year: year.year,
    label: year.label,
    games: year.games.length,
    importedAt: year.importedAt,
    enabled: year.enabled,
    dateRange: year.stats.dateRange,
    perCompetition: year.stats.perCompetition,
  };
}
