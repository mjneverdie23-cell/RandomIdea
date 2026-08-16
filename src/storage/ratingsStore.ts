/**
 * Persistence for the optional team-ratings file.
 *
 * Unlike the season imports, ratings are a single small hand-maintained table,
 * so they live in IndexedDB only — there is no folder mirror to keep in sync
 * and re-importing the file is a one-drag operation. A failure to persist is
 * non-fatal: the ratings still apply for the rest of the session.
 */

import { idbAvailable, idbDelete, idbGet, idbSet } from './idb.ts';
import type { StoredRatings } from '../predictor/ratings.ts';

const RATINGS_KEY = 'predictor:ratings:v1';

export async function loadStoredRatings(): Promise<StoredRatings | null> {
  if (!idbAvailable()) return null;
  try {
    const stored = await idbGet<StoredRatings>(RATINGS_KEY);
    return stored && Array.isArray(stored.teams) ? stored : null;
  } catch {
    return null;
  }
}

export async function saveStoredRatings(ratings: StoredRatings): Promise<boolean> {
  if (!idbAvailable()) return false;
  try {
    await idbSet(RATINGS_KEY, ratings);
    return true;
  } catch {
    return false;
  }
}

export async function clearStoredRatings(): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await idbDelete(RATINGS_KEY);
  } catch {
    // Nothing further to clean up.
  }
}
