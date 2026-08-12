/**
 * Dataset persistence.
 *
 * An imported CSV survives a reload so users don't re-import a 200 MB file
 * every visit. Only the normalized `Dataset` is stored — never the raw rows.
 * Any failure here is non-fatal: the app falls back to the demo dataset.
 */

import type { Dataset } from '../domain/types.ts';
import { idbAvailable, idbDelete, idbGet, idbSet } from './idb.ts';

const DATASET_KEY = 'dataset:v1';

export async function loadStoredDataset(): Promise<Dataset | null> {
  if (!idbAvailable()) return null;
  try {
    const stored = await idbGet<Dataset>(DATASET_KEY);
    if (!stored || !Array.isArray(stored.games) || stored.games.length === 0) return null;
    return stored;
  } catch {
    return null;
  }
}

export async function saveDataset(dataset: Dataset): Promise<boolean> {
  if (!idbAvailable()) return false;
  try {
    await idbSet(DATASET_KEY, dataset);
    return true;
  } catch {
    // Quota exceeded or private-browsing restrictions — the dataset still
    // works for this session, it just won't be remembered.
    return false;
  }
}

export async function clearStoredDataset(): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await idbDelete(DATASET_KEY);
  } catch {
    // Nothing to do — the caller is already resetting to the demo dataset.
  }
}
