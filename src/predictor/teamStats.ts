/**
 * Everything the Team Stat page shows about one team, from the loaded games.
 *
 * Pure: games in, numbers out. Pocket picks are judged against the meta of
 * the patch each game was played on (`metaByPatch`), never against today's —
 * a champion that is meta now may have been a pocket pick three patches ago,
 * and the reverse.
 */

import { COMPETITION_BY_ID } from '../domain/competitions.ts';
import { GOLD_CHECKPOINTS, ROLES, type CompetitionId, type Game, type Role } from '../domain/types.ts';
import { archetypeProfileKey } from './championArchetypes.ts';
import { derivePocketProfiles, emptyPocketProfile, isPocketPick } from './derive.ts';
import type { ArchetypeProfile, PatchMeta, PocketProfile } from './types.ts';

const keyOf = (team: string) => team.toLowerCase();
const mean = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/* ------------------------------------------------------------------ */
/* Choosing a team                                                     */
/* ------------------------------------------------------------------ */

export interface TeamOption {
  name: string;
  /** Where the team plays most of its league games, for grouping the list. */
  home: CompetitionId | null;
  games: number;
  /** ISO date of the team's newest game. */
  lastPlayed: string;
}

/**
 * Every team in the games. A team's home is the league it has played most in;
 * internationals and other events only count when it has no league games.
 */
export function teamOptions(games: readonly Game[]): TeamOption[] {
  const acc = new Map<string, { name: string; games: number; last: string; comps: Map<CompetitionId, number> }>();
  for (const game of games) {
    for (const side of [game.blue, game.red]) {
      const entry = acc.get(keyOf(side.teamName)) ?? { name: side.teamName, games: 0, last: '', comps: new Map() };
      entry.games += 1;
      if (game.date > entry.last) {
        entry.last = game.date;
        entry.name = side.teamName; // the newest spelling wins
      }
      entry.comps.set(game.competition, (entry.comps.get(game.competition) ?? 0) + 1);
      acc.set(keyOf(side.teamName), entry);
    }
  }
  return [...acc.values()]
    .map((entry) => {
      const ranked = [...entry.comps].sort((a, b) => b[1] - a[1]);
      const league = ranked.find(([id]) => COMPETITION_BY_ID[id]?.scope === 'regional');
      return { name: entry.name, home: (league ?? ranked[0])?.[0] ?? null, games: entry.games, lastPlayed: entry.last };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Seasons a team played in, newest first. */
export function teamSeasons(team: string, games: readonly Game[]): string[] {
  const key = keyOf(team);
  const seasons = new Set<string>();
  for (const game of games) {
    if (keyOf(game.blue.teamName) === key || keyOf(game.red.teamName) === key) seasons.add(game.season);
  }
  return [...seasons].sort((a, b) => b.localeCompare(a));
}

/** Games that vote on a team's current season. */
const CURRENT_SEASON_GAMES = 20;

/**
 * The season most of a team's newest games belong to — not its highest label.
 * Oracle's Elixir labels some late-year games with next year's season, and a
 * team's page shouldn't open on three cup games of a season that hasn't
 * started. Ties go to the newer season.
 */
export function currentTeamSeason(team: string, games: readonly Game[]): string | null {
  const key = keyOf(team);
  const newest = games
    .filter((game) => keyOf(game.blue.teamName) === key || keyOf(game.red.teamName) === key)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, CURRENT_SEASON_GAMES);
  const votes = new Map<string, number>();
  for (const game of newest) votes.set(game.season, (votes.get(game.season) ?? 0) + 1);
  let best: string | null = null;
  let most = 0;
  for (const [season, count] of votes) {
    if (count > most || (count === most && best !== null && season > best)) {
      best = season;
      most = count;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* The stats                                                           */
/* ------------------------------------------------------------------ */

export interface GoldMark {
  minute: number;
  /** Average team gold at the mark; `null` when no game carries it. */
  gold: number | null;
  /** Average gold lead (+) or deficit (−) at the mark. */
  diff: number | null;
  /** Games that reached the mark with a value. */
  sample: number;
}

export interface ChampionUse {
  championId: string;
  name: string;
  role: Role;
  games: number;
  wins: number;
  /** Of those games, how many it was a pocket pick on its patch. */
  pocketGames: number;
  /** Average length of the games it was played in, seconds. */
  seconds: number | null;
  /** Who played it, most games first. */
  players: string[];
}

export interface PlayerStats {
  player: string;
  role: Role;
  games: number;
  wins: number;
  /** In the team's newest lineup. */
  current: boolean;
  /** Picks that could be judged against their patch, and how many were pockets. */
  judged: number;
  pocketPicks: number;
  pocketWins: number;
  /** Most played first. */
  champions: ChampionUse[];
  /** Favourite archetype and pool in the role, when the player has a profile. */
  style: ArchetypeProfile | null;
}

export interface TeamStats {
  team: string;
  games: number;
  wins: number;
  competitions: { id: CompetitionId; games: number }[];
  duration: {
    average: number | null;
    wins: number | null;
    losses: number | null;
    sample: number;
  };
  /** At 10/15/20/25 minutes — Oracle's Elixir records nothing at 5 or 30. */
  gold: GoldMark[];
  endGold: { average: number | null; perMinute: number | null; sample: number };
  /** Games imported before team gold was captured (they still carry the diffs). */
  goldMissing: number;
  pocket: PocketProfile;
  /** Every champion this team played as a pocket pick, most games first. */
  pocketChampions: ChampionUse[];
  players: PlayerStats[];
}

interface ChampionAcc {
  championId: string;
  name: string;
  role: Role;
  games: number;
  wins: number;
  pocketGames: number;
  time: number;
  timed: number;
  players: Map<string, number>;
}

function bumpChampion(
  map: Map<string, ChampionAcc>,
  role: Role,
  championId: string,
  name: string,
  player: string,
  won: boolean,
  pocket: boolean,
  seconds: number | null,
) {
  const key = `${role}|${championId}`;
  const entry = map.get(key) ?? {
    championId,
    name,
    role,
    games: 0,
    wins: 0,
    pocketGames: 0,
    time: 0,
    timed: 0,
    players: new Map<string, number>(),
  };
  entry.games += 1;
  if (won) entry.wins += 1;
  if (pocket) entry.pocketGames += 1;
  if (seconds) {
    entry.time += seconds;
    entry.timed += 1;
  }
  entry.players.set(player, (entry.players.get(player) ?? 0) + 1);
  map.set(key, entry);
}

const finishChampion = (entry: ChampionAcc): ChampionUse => ({
  championId: entry.championId,
  name: entry.name,
  role: entry.role,
  games: entry.games,
  wins: entry.wins,
  pocketGames: entry.pocketGames,
  seconds: entry.timed ? entry.time / entry.timed : null,
  players: [...entry.players].sort((a, b) => b[1] - a[1]).map(([player]) => player),
});

const byGames = (a: { games: number; name?: string }, b: { games: number; name?: string }) =>
  b.games - a.games || (a.name ?? '').localeCompare(b.name ?? '');

/**
 * Stats for `team` over `games`.
 *
 * `meta` should come from every loaded game — what a patch's meta was depends
 * on the whole field, not on this team — while `games` can be narrowed to a
 * season. `styles` are archetype profiles keyed by `archetypeProfileKey`.
 * `null` when the team has no games in `games`.
 */
export function teamStats(
  team: string,
  games: readonly Game[],
  meta: ReadonlyMap<string, PatchMeta>,
  styles: ReadonlyMap<string, ArchetypeProfile> = new Map(),
): TeamStats | null {
  const key = keyOf(team);
  const played = games
    .filter((game) => keyOf(game.blue.teamName) === key || keyOf(game.red.teamName) === key)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  if (played.length === 0) return null;

  let wins = 0;
  const comps = new Map<CompetitionId, number>();
  const lengths: number[] = [];
  const winLengths: number[] = [];
  const lossLengths: number[] = [];
  const goldAt = GOLD_CHECKPOINTS.map(() => [] as number[]);
  const diffAt = GOLD_CHECKPOINTS.map(() => [] as number[]);
  const totals: number[] = [];
  const perMinute: number[] = [];
  let goldMissing = 0;
  const pocketChampions = new Map<string, ChampionAcc>();
  const players = new Map<string, {
    player: string;
    role: Role;
    games: number;
    wins: number;
    judged: number;
    pocketPicks: number;
    pocketWins: number;
    champions: Map<string, ChampionAcc>;
  }>();

  for (const game of played) {
    const side = keyOf(game.blue.teamName) === key ? game.blue : game.red;
    const won = game.winner === side.side;
    if (won) wins += 1;
    comps.set(game.competition, (comps.get(game.competition) ?? 0) + 1);

    const seconds = game.durationSeconds;
    if (seconds) {
      lengths.push(seconds);
      (won ? winLengths : lossLengths).push(seconds);
    }

    if (side.gold) {
      side.gold.at.forEach((value, index) => {
        if (value !== null && value !== undefined) goldAt[index]!.push(value);
      });
      if (side.gold.total !== null) {
        totals.push(side.gold.total);
        if (seconds) perMinute.push(side.gold.total / (seconds / 60));
      }
    } else {
      goldMissing += 1;
    }
    side.goldDiff?.checkpoints?.forEach((value, index) => {
      if (value !== null && value !== undefined) diffAt[index]!.push(value);
    });

    for (const slot of side.players) {
      const pocket = isPocketPick(meta, game, slot.role, slot.champion.id);
      const playerKey = `${slot.playerName}|${slot.role}`;
      const entry = players.get(playerKey) ?? {
        player: slot.playerName,
        role: slot.role,
        games: 0,
        wins: 0,
        judged: 0,
        pocketPicks: 0,
        pocketWins: 0,
        champions: new Map<string, ChampionAcc>(),
      };
      entry.games += 1;
      if (won) entry.wins += 1;
      if (pocket !== null) {
        entry.judged += 1;
        if (pocket) {
          entry.pocketPicks += 1;
          if (won) entry.pocketWins += 1;
        }
      }
      bumpChampion(entry.champions, slot.role, slot.champion.id, slot.champion.name, slot.playerName, won, pocket === true, seconds);
      if (pocket) {
        bumpChampion(pocketChampions, slot.role, slot.champion.id, slot.champion.name, slot.playerName, won, true, seconds);
      }
      players.set(playerKey, entry);
    }
  }

  const newest = played[0]!;
  const newestSide = keyOf(newest.blue.teamName) === key ? newest.blue : newest.red;
  const lineup = new Map(newestSide.players.map((slot) => [`${slot.playerName}|${slot.role}`, slot.role]));

  const playerStats: PlayerStats[] = [...players.entries()]
    .map(([playerKey, entry]) => ({
      player: entry.player,
      role: entry.role,
      games: entry.games,
      wins: entry.wins,
      current: lineup.has(playerKey),
      judged: entry.judged,
      pocketPicks: entry.pocketPicks,
      pocketWins: entry.pocketWins,
      champions: [...entry.champions.values()].map(finishChampion).sort(byGames),
      style: styles.get(archetypeProfileKey(entry.player, entry.role)) ?? null,
    }))
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        ROLES.indexOf(a.role) - ROLES.indexOf(b.role) ||
        b.games - a.games,
    );

  return {
    team: newestSide.teamName,
    games: played.length,
    wins,
    competitions: [...comps].map(([id, count]) => ({ id, games: count })).sort((a, b) => b.games - a.games),
    duration: { average: mean(lengths), wins: mean(winLengths), losses: mean(lossLengths), sample: lengths.length },
    gold: GOLD_CHECKPOINTS.map((minute, index) => ({
      minute,
      gold: mean(goldAt[index]!),
      diff: mean(diffAt[index]!),
      sample: Math.max(goldAt[index]!.length, diffAt[index]!.length),
    })),
    endGold: { average: mean(totals), perMinute: mean(perMinute), sample: totals.length },
    goldMissing,
    pocket: derivePocketProfiles(played, meta).get(key) ?? emptyPocketProfile(),
    pocketChampions: [...pocketChampions.values()].map(finishChampion).sort(byGames),
    players: playerStats,
  };
}
