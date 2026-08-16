/**
 * Where imported years live.
 *
 * Two backends, picked at runtime:
 *
 * - **Project folder** — when the app is served by the Vite dev/preview server,
 *   `scripts/vite-data-folder.mjs` exposes an endpoint that writes
 *   `data/<year>.json`. This is the store of record when available: it survives
 *   clearing browser storage and can be copied between machines.
 * - **IndexedDB** — the fallback for a statically served build, and the mirror
 *   that makes the app work offline.
 *
 * Both hold the same normalized, competition-filtered games; the raw CSV is
 * never stored. Failures are non-fatal — the app keeps the dataset in memory
 * for the session and says so.
 */

import type { Dataset, YearDataset } from '../domain/types.ts';
import { mergeImportedYears, sortYears } from '../data/years.ts';
import { idbAvailable, idbDelete, idbGet, idbSet } from './idb.ts';

const YEAR_KEY_PREFIX = 'dataset:year:';
const YEAR_INDEX_KEY = 'dataset:years';
/** Single-dataset key used before imports were split by year. */
const LEGACY_KEY = 'dataset:v1';

const FOLDER_ROUTE = '/__draftcall/datasets';

export type StorageBackend = 'folder' | 'indexeddb' | 'memory';

/* ------------------------------------------------------------------ */
/* Project folder                                                      */
/* ------------------------------------------------------------------ */

async function folderRequest(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    const res = await fetch(`${FOLDER_ROUTE}${path}`, init);
    // A static host answers with the SPA's index.html rather than JSON.
    if (!res.headers.get('content-type')?.includes('application/json')) return null;
    return res;
  } catch {
    return null;
  }
}

/** True when the dev-server endpoint is answering. */
export async function folderAvailable(): Promise<boolean> {
  const res = await folderRequest('');
  return res !== null && res.ok;
}

async function loadFromFolder(): Promise<YearDataset[] | null> {
  const listing = await folderRequest('');
  if (!listing || !listing.ok) return null;

  const { years } = (await listing.json()) as { years?: { year: string }[] };
  if (!Array.isArray(years)) return null;

  const loaded: YearDataset[] = [];
  for (const summary of years) {
    const res = await folderRequest(`/${summary.year}`);
    if (!res || !res.ok) continue;
    const dataset = (await res.json()) as YearDataset;
    if (Array.isArray(dataset.games)) {
      loaded.push({ ...dataset, enabled: dataset.enabled !== false });
    }
  }
  return sortYears(loaded);
}

async function saveToFolder(year: YearDataset): Promise<boolean> {
  const res = await folderRequest(`/${year.year}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(year),
  });
  return res !== null && res.ok;
}

async function patchFolderEnabled(year: string, enabled: boolean): Promise<boolean> {
  const res = await folderRequest(`/${year}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  return res !== null && res.ok;
}

async function deleteFromFolder(year: string): Promise<boolean> {
  const res = await folderRequest(`/${year}`, { method: 'DELETE' });
  return res !== null && res.ok;
}

/* ------------------------------------------------------------------ */
/* IndexedDB                                                           */
/* ------------------------------------------------------------------ */

async function loadFromIdb(): Promise<YearDataset[]> {
  if (!idbAvailable()) return [];
  try {
    const index = (await idbGet<string[]>(YEAR_INDEX_KEY)) ?? [];
    const loaded: YearDataset[] = [];
    for (const year of index) {
      const dataset = await idbGet<YearDataset>(`${YEAR_KEY_PREFIX}${year}`);
      if (dataset && Array.isArray(dataset.games)) {
        loaded.push({ ...dataset, enabled: dataset.enabled !== false });
      }
    }
    return sortYears(loaded);
  } catch {
    return [];
  }
}

async function saveToIdb(year: YearDataset): Promise<boolean> {
  if (!idbAvailable()) return false;
  try {
    await idbSet(`${YEAR_KEY_PREFIX}${year.year}`, year);
    const index = new Set((await idbGet<string[]>(YEAR_INDEX_KEY)) ?? []);
    index.add(year.year);
    await idbSet(YEAR_INDEX_KEY, [...index]);
    return true;
  } catch {
    // Quota exceeded or private browsing — the session still works.
    return false;
  }
}

async function deleteFromIdb(year: string): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await idbDelete(`${YEAR_KEY_PREFIX}${year}`);
    const index = ((await idbGet<string[]>(YEAR_INDEX_KEY)) ?? []).filter((y) => y !== year);
    await idbSet(YEAR_INDEX_KEY, index);
  } catch {
    // Nothing further to clean up.
  }
}

/**
 * Fold a pre-year-split dataset into per-year buckets.
 *
 * Anyone who imported before this change has one blob under the old key;
 * migrating it means they don't lose the import they already did.
 */
async function migrateLegacyDataset(): Promise<YearDataset[]> {
  if (!idbAvailable()) return [];
  try {
    const legacy = await idbGet<Dataset>(LEGACY_KEY);
    if (!legacy || !Array.isArray(legacy.games) || legacy.games.length === 0) return [];

    const years = mergeImportedYears([], legacy.games, {
      label: legacy.source?.label ?? 'Imported dataset',
      importedAt: legacy.importedAt,
    });
    for (const year of years) await saveToIdb(year);
    await idbDelete(LEGACY_KEY);
    return years;
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface LoadedYears {
  years: YearDataset[];
  backend: StorageBackend;
}

/**
 * Load every stored year, preferring the project folder.
 *
 * When the folder is available but empty and IndexedDB has years — the case
 * right after this feature lands — the browser copies are pushed up so the
 * folder becomes authoritative without the user re-importing anything.
 */
export async function loadStoredYears(): Promise<LoadedYears> {
  const migrated = await migrateLegacyDataset();
  const fromIdb = migrated.length ? migrated : await loadFromIdb();

  const fromFolder = await loadFromFolder();
  if (fromFolder === null) {
    return { years: fromIdb, backend: idbAvailable() ? 'indexeddb' : 'memory' };
  }

  if (fromFolder.length === 0 && fromIdb.length > 0) {
    for (const year of fromIdb) await saveToFolder(year);
    return { years: fromIdb, backend: 'folder' };
  }
  return { years: fromFolder, backend: 'folder' };
}

/** Persist one year to whichever backends accept it. */
export async function saveYear(year: YearDataset): Promise<StorageBackend | null> {
  const folder = await saveToFolder(year);
  const idb = await saveToIdb(year);
  if (folder) return 'folder';
  if (idb) return 'indexeddb';
  return null;
}

export async function setYearEnabled(year: string, enabled: boolean): Promise<void> {
  await patchFolderEnabled(year, enabled);
  if (!idbAvailable()) return;
  try {
    const stored = await idbGet<YearDataset>(`${YEAR_KEY_PREFIX}${year}`);
    if (stored) await idbSet(`${YEAR_KEY_PREFIX}${year}`, { ...stored, enabled });
  } catch {
    // The in-memory switch still applies for this session.
  }
}

export async function removeYear(year: string): Promise<void> {
  await deleteFromFolder(year);
  await deleteFromIdb(year);
}

export async function clearAllYears(years: readonly string[]): Promise<void> {
  for (const year of years) await removeYear(year);
}
