/**
 * Local asset manifest.
 *
 * `npm run assets` downloads champion art and team logos into
 * `public/assets/**` and rewrites `assetManifest.json` with what it got. This
 * module is the only thing that reads it.
 *
 * The manifest ships empty, so a fresh clone works with no downloads at all —
 * champion art falls back to Riot's CDN and team logos fall back to the
 * monogram tag. Once the script has run, the same code prefers the local
 * copies and the app works fully offline.
 */

import raw from './assetManifest.json';

export interface AssetManifest {
  /** ISO timestamp of the last successful run, or `null` if never run. */
  generatedAt: string | null;
  /** Data Dragon patch the champion art came from. */
  dataDragonVersion: string | null;
  /** Champion ids (`Kaisa`, `MonkeyKing`) with both art files on disk. */
  champions: string[];
  /** Team lookup key -> logo file name, e.g. `geng` -> `gen-g.png`. */
  teams: Record<string, string>;
}

const manifest = raw as AssetManifest;

export const ASSET_BASE = '/assets';

const localChampions: ReadonlySet<string> = new Set(manifest.champions);

export function hasLocalChampion(championId: string): boolean {
  return localChampions.has(championId);
}

export function localChampionPortrait(championId: string): string {
  return `${ASSET_BASE}/champions/portrait/${championId}.jpg`;
}

export function localChampionIcon(championId: string): string {
  return `${ASSET_BASE}/champions/icon/${championId}.png`;
}

/** `null` when no logo was downloaded for this team. */
export function localTeamLogo(assetKey: string): string | null {
  const file = manifest.teams[assetKey];
  return file ? `${ASSET_BASE}/teams/${file}` : null;
}

export function assetStats(): {
  generatedAt: string | null;
  version: string | null;
  champions: number;
  teams: number;
} {
  return {
    generatedAt: manifest.generatedAt,
    version: manifest.dataDragonVersion,
    champions: manifest.champions.length,
    teams: Object.keys(manifest.teams).length,
  };
}
