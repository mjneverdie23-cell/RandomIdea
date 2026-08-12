/**
 * Patch meta, computed from the loaded dataset.
 *
 * Nothing here is hardcoded: pick/ban/win rates are aggregated from whatever
 * games are currently loaded, so importing a different Oracle's Elixir export
 * changes the meta panel automatically.
 *
 * Rates are per-game, not per-slot: a champion picked in 40 of 100 games on a
 * patch has a 40% pick rate, and one banned by either team in 60 of them has a
 * 60% ban rate. Presence is the share of games where a champion was picked or
 * banned — the number broadcasts usually put on screen.
 */

import type { Champion, CompetitionId, Game, Role } from '../domain/types.ts';
import { comparePatches } from '../data/ingest.ts';

export interface ChampionMetaEntry {
  champion: Champion;
  /** Games in which the champion was picked. */
  picks: number;
  /** Games in which the champion was banned by either team. */
  bans: number;
  pickRate: number;
  banRate: number;
  presence: number;
  wins: number;
  /** `null` when the champion was never picked (ban-only). */
  winRate: number | null;
  primaryRole: Role | null;
}

export interface PatchMeta {
  patch: string;
  /** Games the rates were computed from. */
  sampleSize: number;
  competitions: CompetitionId[];
  /** Sorted by pick rate, descending. */
  topPicked: ChampionMetaEntry[];
  /** Sorted by ban rate, descending. */
  topBanned: ChampionMetaEntry[];
  /** Sorted by presence, descending. */
  topPresence: ChampionMetaEntry[];
}

interface Accumulator {
  champion: Champion;
  picks: number;
  bans: number;
  wins: number;
  roleCounts: Partial<Record<Role, number>>;
}

export interface MetaScope {
  /** Restrict the sample to one competition. */
  competition?: CompetitionId | null;
}

/**
 * Lazily-computed, cached patch meta over a fixed set of games.
 * Recreated whenever the dataset changes; queries are memoized per scope key.
 */
export class MetaIndex {
  private readonly byPatch = new Map<string, Game[]>();
  private readonly cache = new Map<string, PatchMeta>();

  constructor(games: readonly Game[]) {
    for (const game of games) {
      if (!game.patch) continue;
      const bucket = this.byPatch.get(game.patch);
      if (bucket) bucket.push(game);
      else this.byPatch.set(game.patch, [game]);
    }
  }

  /** All patches present in the dataset, newest first. */
  patches(): string[] {
    return [...this.byPatch.keys()].sort(comparePatches);
  }

  gamesOnPatch(patch: string): number {
    return this.byPatch.get(patch)?.length ?? 0;
  }

  /**
   * Meta for one patch. When `scope.competition` is set and that slice has too
   * few games to be meaningful, the full cross-league sample for the patch is
   * used instead so the panel never shows noise from a handful of games.
   */
  get(patch: string, scope: MetaScope = {}): PatchMeta | null {
    const key = `${patch}::${scope.competition ?? '*'}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const all = this.byPatch.get(patch);
    if (!all || all.length === 0) return null;

    const MIN_SCOPED_SAMPLE = 20;
    const scoped = scope.competition
      ? all.filter((game) => game.competition === scope.competition)
      : all;
    const sample = scoped.length >= MIN_SCOPED_SAMPLE ? scoped : all;

    const meta = computePatchMeta(patch, sample);
    this.cache.set(key, meta);
    return meta;
  }
}

export function computePatchMeta(patch: string, games: readonly Game[]): PatchMeta {
  const accumulators = new Map<string, Accumulator>();
  const competitions = new Set<CompetitionId>();

  const touch = (champion: Champion): Accumulator => {
    let entry = accumulators.get(champion.id);
    if (!entry) {
      entry = { champion, picks: 0, bans: 0, wins: 0, roleCounts: {} };
      accumulators.set(champion.id, entry);
    }
    return entry;
  };

  for (const game of games) {
    competitions.add(game.competition);

    for (const team of [game.blue, game.red]) {
      const won = team.side === game.winner;
      for (const slot of team.players) {
        const entry = touch(slot.champion);
        entry.picks += 1;
        if (won) entry.wins += 1;
        entry.roleCounts[slot.role] = (entry.roleCounts[slot.role] ?? 0) + 1;
      }
    }

    // A champion banned by both teams still only counts once for the game.
    const bannedThisGame = new Set<string>();
    for (const team of [game.blue, game.red]) {
      for (const ban of team.bans) {
        if (!ban.id || bannedThisGame.has(ban.id)) continue;
        bannedThisGame.add(ban.id);
        touch(ban).bans += 1;
      }
    }
  }

  const sampleSize = games.length;
  const entries: ChampionMetaEntry[] = [...accumulators.values()].map((acc) => ({
    champion: acc.champion,
    picks: acc.picks,
    bans: acc.bans,
    wins: acc.wins,
    pickRate: sampleSize ? acc.picks / sampleSize : 0,
    banRate: sampleSize ? acc.bans / sampleSize : 0,
    presence: sampleSize ? Math.min(1, (acc.picks + acc.bans) / sampleSize) : 0,
    winRate: acc.picks > 0 ? acc.wins / acc.picks : null,
    primaryRole: dominantRole(acc.roleCounts),
  }));

  const byPick = [...entries].sort(
    (a, b) => b.picks - a.picks || a.champion.name.localeCompare(b.champion.name),
  );
  const byBan = [...entries].sort(
    (a, b) => b.bans - a.bans || a.champion.name.localeCompare(b.champion.name),
  );
  const byPresence = [...entries].sort(
    (a, b) => b.presence - a.presence || a.champion.name.localeCompare(b.champion.name),
  );

  return {
    patch,
    sampleSize,
    competitions: [...competitions],
    topPicked: byPick.filter((e) => e.picks > 0),
    topBanned: byBan.filter((e) => e.bans > 0),
    topPresence: byPresence,
  };
}

function dominantRole(counts: Partial<Record<Role, number>>): Role | null {
  let best: Role | null = null;
  let bestCount = 0;
  for (const [role, count] of Object.entries(counts) as [Role, number][]) {
    if (count > bestCount) {
      best = role;
      bestCount = count;
    }
  }
  return best;
}

export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
