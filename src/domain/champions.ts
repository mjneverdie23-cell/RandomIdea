/**
 * Champion identity + art.
 *
 * Source data gives us a display name (`Kai'Sa`, `Nunu & Willump`). Riot's Data
 * Dragon CDN keys art off a different identifier (`Kaisa`, `Nunu`). Most names
 * convert with one rule — strip everything that is not a letter or digit — but
 * a handful are irregular and live in `IRREGULAR_IDS`.
 *
 * Every champion reference in the app carries both halves (`{ id, name }`), so
 * the UI never re-derives an asset key from a display string.
 */

import {
  hasLocalChampion,
  localChampionIcon,
  localChampionPortrait,
} from '../assets/manifest.ts';
import type { Champion } from './types.ts';

/** Used when Data Dragon's version list can't be reached. */
export const DDRAGON_FALLBACK_VERSION = '15.24.1';

const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com';

/**
 * Names whose Data Dragon key doesn't follow the strip-punctuation rule.
 * Keys are normalized display names (lowercase, alphanumeric only).
 */
const IRREGULAR_IDS: Record<string, string> = {
  belveth: 'Belveth',
  chogath: 'Chogath',
  kaisa: 'Kaisa',
  khazix: 'Khazix',
  leblanc: 'Leblanc',
  velkoz: 'Velkoz',
  wukong: 'MonkeyKing',
  monkeyking: 'MonkeyKing',
  nunuwillump: 'Nunu',
  nunuandwillump: 'Nunu',
  renataglasc: 'Renata',
  // Legacy spellings that show up in older exports.
  fiddlesticks: 'Fiddlesticks',
  drmundo: 'DrMundo',
};

function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Derive the Data Dragon asset id for a champion display name.
 * `Miss Fortune` -> `MissFortune`, `Jarvan IV` -> `JarvanIV`, `Kai'Sa` -> `Kaisa`.
 */
export function championIdFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const irregular = IRREGULAR_IDS[normalizeName(trimmed)];
  if (irregular) return irregular;

  // Preserve inner capitals (`RekSai`, `KogMaw`, `JarvanIV`) and drop
  // apostrophes, periods, spaces and ampersands.
  const stripped = trimmed.replace(/[^A-Za-z0-9]/g, '');
  if (!stripped) return '';
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

const championCache = new Map<string, Champion>();

/** Build (and memoize) a champion reference from a raw display name. */
export function makeChampion(rawName: string): Champion | null {
  const name = rawName.trim();
  if (!name) return null;
  const cached = championCache.get(name);
  if (cached) return cached;
  const id = championIdFromName(name);
  if (!id) return null;
  const champion: Champion = { id, name };
  championCache.set(name, champion);
  return champion;
}

/** Placeholder used for an empty/unused ban slot (`no ban` rows in the CSV). */
export const EMPTY_BAN: Champion = { id: '', name: 'No ban' };

export function isEmptyChampion(champion: Champion | null | undefined): boolean {
  return !champion || !champion.id;
}

/* ------------------------------------------------------------------ */
/* Art URLs                                                            */
/* ------------------------------------------------------------------ */

let resolvedVersion: string = DDRAGON_FALLBACK_VERSION;

/**
 * Ask Data Dragon for the newest patch so square icons stay current.
 * Failure is non-fatal — the pinned fallback keeps art working offline-ish,
 * and portrait art is version-independent regardless.
 */
export async function refreshDataDragonVersion(signal?: AbortSignal): Promise<string> {
  try {
    const res = await fetch(`${DDRAGON_BASE}/api/versions.json`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const versions: unknown = await res.json();
    if (Array.isArray(versions) && typeof versions[0] === 'string') {
      resolvedVersion = versions[0];
    }
  } catch {
    // Keep the fallback version.
  }
  return resolvedVersion;
}

export function dataDragonVersion(): string {
  return resolvedVersion;
}

/** Tall loading art on Riot's CDN — cropped to the face by the pick card. */
export function championPortraitUrl(champion: Champion): string {
  return `${DDRAGON_BASE}/cdn/img/champion/loading/${champion.id}_0.jpg`;
}

/** Square face icon on Riot's CDN — used for bans and compact lists. */
export function championIconUrl(champion: Champion): string {
  return `${DDRAGON_BASE}/cdn/${resolvedVersion}/img/champion/${champion.id}.png`;
}

/** Wide splash — used for ambient backgrounds. */
export function championSplashUrl(champion: Champion): string {
  return `${DDRAGON_BASE}/cdn/img/champion/splash/${champion.id}_0.jpg`;
}

/**
 * Ordered candidate URLs for a champion's art, best source first.
 *
 * A downloaded local copy wins when `npm run assets` has run; Riot's CDN is
 * the fallback, so a fresh clone still shows art without any download step.
 * `ChampionArt` walks this list on load errors and lands on the initials
 * plate if every source fails.
 */
export function championPortraitSources(champion: Champion): string[] {
  if (!champion.id) return [];
  const sources: string[] = [];
  if (hasLocalChampion(champion.id)) sources.push(localChampionPortrait(champion.id));
  sources.push(championPortraitUrl(champion));
  return sources;
}

export function championIconSources(champion: Champion): string[] {
  if (!champion.id) return [];
  const sources: string[] = [];
  if (hasLocalChampion(champion.id)) sources.push(localChampionIcon(champion.id));
  sources.push(championIconUrl(champion));
  return sources;
}

/** Deterministic hue so art-less fallbacks still read as distinct cards. */
export function championHue(champion: Champion): number {
  let hash = 0;
  for (let i = 0; i < champion.id.length; i += 1) {
    hash = (hash * 31 + champion.id.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/** Two-letter monogram shown while art loads or when it fails. */
export function championInitials(champion: Champion): string {
  const words = champion.name.split(/[\s'&.]+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]!.charAt(0)}${words[1]!.charAt(0)}`.toUpperCase();
  }
  return champion.name.slice(0, 2).toUpperCase();
}
