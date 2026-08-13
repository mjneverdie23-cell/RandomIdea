/**
 * Types for the plain-ESM naming helpers, so `src/domain/teams.test.ts` can
 * import the script's implementation and assert it matches the app's.
 */

/** Lookup key for a team name: lowercase, alphanumerics only. */
export function assetKey(name: string): string;

/** On-disk file name for a team logo, e.g. `gen-g`. */
export function teamFileSlug(name: string): string;
