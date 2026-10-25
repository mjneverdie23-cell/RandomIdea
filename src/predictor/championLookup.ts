/**
 * Champion lookup for the Tournament page: how champions did in their roles,
 * on their own and together in one team's draft.
 *
 * A pick only counts in the role it was asked for — Akali mid is not Akali
 * top — and "together" means the same team drafted every chosen champion in
 * its role in the same game. Rankings use a small-sample discount, a win rate
 * of (wins + 1) / (games + 2), so one 1–0 doesn't outrank a 6–1; the records
 * shown are always the raw ones.
 *
 * A team narrows everything to that team's own drafts: its record on the
 * champions, its players, what it drafted around them and what beat it.
 *
 * Pure: no React, no storage.
 */

import { ROLES, type Champion, type Game, type Role, type TeamSide } from '../domain/types.ts';

/** The champion id chosen for each role; roles left out are open. */
export type LookupPicks = Partial<Record<Role, string>>;

/** What the lookup is asked: champions by role, and optionally one team's drafts only. */
export interface LookupQuery {
  picks: LookupPicks;
  team: string | null;
}

/** One team's draft in one game. */
export interface DraftHit {
  game: Game;
  /** The team that drafted the champions. */
  side: TeamSide;
  opponent: TeamSide;
  won: boolean;
}

export interface WinLoss {
  games: number;
  wins: number;
}

const slotOf = (side: TeamSide, role: Role) => side.players.find((player) => player.role === role);
const newestFirst = (a: DraftHit, b: DraftHit) =>
  Date.parse(b.game.date) - Date.parse(a.game.date) || b.game.gameNumber - a.game.gameNumber;
/** Win rate with a small-sample discount, for ranking only. */
const shrunk = (record: WinLoss) => (record.wins + 1) / (record.games + 2);

export function chosenRoles(picks: LookupPicks): Role[] {
  return ROLES.filter((role) => picks[role]);
}

const sameTeam = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const isTeam = (side: TeamSide, team: string | null | undefined) => !team || sameTeam(side.teamName, team);

/**
 * Every draft that had each chosen champion in its role, newest first. With a
 * team, only that team's drafts — and with a team and no champions, all of
 * them. With neither, nothing.
 */
export function draftsWith(games: readonly Game[], picks: LookupPicks, team?: string | null): DraftHit[] {
  const wanted = chosenRoles(picks);
  if (wanted.length === 0 && !team) return [];
  const hits: DraftHit[] = [];
  for (const game of games) {
    for (const side of [game.blue, game.red]) {
      if (!isTeam(side, team)) continue;
      if (!wanted.every((role) => slotOf(side, role)?.champion.id === picks[role])) continue;
      hits.push({ game, side, opponent: side === game.blue ? game.red : game.blue, won: game.winner === side.side });
    }
  }
  return hits.sort(newestFirst);
}

export interface DraftSummary extends WinLoss {
  /** Newest first. */
  hits: DraftHit[];
  averageSeconds: number | null;
  /** Average gold lead (+) or deficit (−) at 15 minutes for the drafting team; `null` when not recorded. */
  gold15: number | null;
  /** Record by the side the drafting team played on. */
  sides: { blue: WinLoss; red: WinLoss };
  /** Teams that drafted it, most games first. */
  teams: { team: string; games: number; wins: number }[];
}

/** Gold lead at 15 minutes from one side's point of view. */
function goldAt15(game: Game, side: TeamSide): number | null {
  const own = side.goldDiff?.checkpoints?.[1];
  if (own !== undefined && own !== null) return own;
  const other = (side === game.blue ? game.red : game.blue).goldDiff?.checkpoints?.[1];
  return other === undefined || other === null ? null : -other;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function summarize(hits: DraftHit[]): DraftSummary {
  const sides = { blue: { games: 0, wins: 0 }, red: { games: 0, wins: 0 } };
  const teams = new Map<string, { team: string; games: number; wins: number }>();
  const seconds: number[] = [];
  const gold: number[] = [];
  for (const hit of hits) {
    const record = sides[hit.side.side];
    record.games += 1;
    if (hit.won) record.wins += 1;
    const key = hit.side.teamName.toLowerCase();
    const team = teams.get(key) ?? { team: hit.side.teamName, games: 0, wins: 0 };
    team.games += 1;
    if (hit.won) team.wins += 1;
    teams.set(key, team);
    if (hit.game.durationSeconds) seconds.push(hit.game.durationSeconds);
    const at15 = goldAt15(hit.game, hit.side);
    if (at15 !== null) gold.push(at15);
  }
  return {
    hits,
    games: hits.length,
    wins: hits.filter((hit) => hit.won).length,
    averageSeconds: mean(seconds),
    gold15: mean(gold),
    sides,
    teams: [...teams.values()].sort((a, b) => b.games - a.games || b.wins - a.wins || a.team.localeCompare(b.team)),
  };
}

export interface Partner extends WinLoss {
  role: Role;
  champion: Champion;
}

export interface PlayerLine extends WinLoss {
  player: string;
  team: string;
}

export interface ChampionReport extends DraftSummary {
  role: Role;
  /** `null` when it was never picked in this role in scope. */
  champion: Champion | null;
  /** Games in scope, for the presence share. */
  scope: number;
  bans: number;
  /** Picked in any role or banned, as a share of games in scope. */
  presence: number;
  /** With a team: its games, how often it picked the champion in any role, and the bans either way. */
  team: { games: number; picked: number; bannedBy: number; bannedAgainst: number } | null;
  /** Best record first. */
  players: PlayerLine[];
  /** Champions on the same team, best record together first. */
  teammates: Partner[];
  /** Enemy champions, the ones it did worst against first. */
  counters: Partner[];
  /** The enemy in the same role, worst matchup first. */
  lane: Partner[];
}

function addPartner(map: Map<string, Partner>, role: Role, champion: Champion, won: boolean) {
  const key = `${role}|${champion.id}`;
  const entry = map.get(key) ?? { role, champion, games: 0, wins: 0 };
  entry.games += 1;
  if (won) entry.wins += 1;
  map.set(key, entry);
}

const best = <T extends WinLoss>(a: T, b: T) => shrunk(b) - shrunk(a) || b.games - a.games;
const worst = <T extends WinLoss>(a: T, b: T) => shrunk(a) - shrunk(b) || b.games - a.games;

/** One champion in one role, across the games in scope — or across one team's drafts. */
export function championReport(
  games: readonly Game[],
  role: Role,
  championId: string,
  team?: string | null,
): ChampionReport {
  const hits = draftsWith(games, { [role]: championId }, team);
  const players = new Map<string, PlayerLine>();
  const teammates = new Map<string, Partner>();
  const counters = new Map<string, Partner>();
  const lane = new Map<string, Partner>();

  for (const hit of hits) {
    const slot = slotOf(hit.side, role)!;
    const key = `${hit.side.teamName.toLowerCase()}|${slot.playerName.toLowerCase()}`;
    const line = players.get(key) ?? { player: slot.playerName, team: hit.side.teamName, games: 0, wins: 0 };
    line.games += 1;
    if (hit.won) line.wins += 1;
    players.set(key, line);
    for (const mate of hit.side.players) {
      if (mate.role !== role) addPartner(teammates, mate.role, mate.champion, hit.won);
    }
    for (const enemy of hit.opponent.players) {
      addPartner(counters, enemy.role, enemy.champion, hit.won);
      if (enemy.role === role) addPartner(lane, enemy.role, enemy.champion, hit.won);
    }
  }

  let bans = 0;
  let anyRole = 0;
  const forTeam = team ? { games: 0, picked: 0, bannedBy: 0, bannedAgainst: 0 } : null;
  const banned = (side: TeamSide) => side.bans.some((ban) => ban.id === championId);
  const picked = (side: TeamSide) => side.players.some((player) => player.champion.id === championId);
  for (const game of games) {
    for (const side of [game.blue, game.red]) {
      if (banned(side)) bans += 1;
      if (picked(side)) anyRole += 1;
      if (forTeam && isTeam(side, team)) {
        const opponent = side === game.blue ? game.red : game.blue;
        forTeam.games += 1;
        if (picked(side)) forTeam.picked += 1;
        if (banned(side)) forTeam.bannedBy += 1;
        if (banned(opponent)) forTeam.bannedAgainst += 1;
      }
    }
  }

  return {
    ...summarize(hits),
    role,
    champion: hits[0] ? slotOf(hits[0].side, role)!.champion : null,
    scope: games.length,
    bans,
    presence: games.length ? (anyRole + bans) / games.length : 0,
    team: forTeam,
    players: [...players.values()].sort(best),
    teammates: [...teammates.values()].sort(best),
    counters: [...counters.values()].sort(worst),
    lane: [...lane.values()].sort(worst),
  };
}

export interface PairLine extends WinLoss {
  roles: [Role, Role];
}

/** Every pair of the chosen picks, with their record together. */
export function pairRecords(games: readonly Game[], picks: LookupPicks, team?: string | null): PairLine[] {
  const roles = chosenRoles(picks);
  const pairs: PairLine[] = [];
  for (let i = 0; i < roles.length; i += 1) {
    for (let j = i + 1; j < roles.length; j += 1) {
      const [a, b] = [roles[i]!, roles[j]!];
      const hits = draftsWith(games, { [a]: picks[a], [b]: picks[b] }, team);
      pairs.push({ roles: [a, b], games: hits.length, wins: hits.filter((hit) => hit.won).length });
    }
  }
  return pairs;
}

/** Champions seen in each role, most picked first — the options for each slot. With a team, its picks only. */
export function rolePools(
  games: readonly Game[],
  team?: string | null,
): Record<Role, { champion: Champion; picks: number }[]> {
  const counts = Object.fromEntries(ROLES.map((role) => [role, new Map<string, { champion: Champion; picks: number }>()])) as Record<
    Role,
    Map<string, { champion: Champion; picks: number }>
  >;
  for (const game of games) {
    for (const side of [game.blue, game.red]) {
      if (!isTeam(side, team)) continue;
      for (const player of side.players) {
        const entry = counts[player.role].get(player.champion.id) ?? { champion: player.champion, picks: 0 };
        entry.picks += 1;
        counts[player.role].set(player.champion.id, entry);
      }
    }
  }
  return Object.fromEntries(
    ROLES.map((role) => [
      role,
      [...counts[role].values()].sort((a, b) => b.picks - a.picks || a.champion.name.localeCompare(b.champion.name)),
    ]),
  ) as Record<Role, { champion: Champion; picks: number }[]>;
}

/* ------------------------------------------------------------------ */
/* Teams                                                               */
/* ------------------------------------------------------------------ */

/** Teams that played in scope, most games first — the options for the team slot. */
export function lookupTeams(games: readonly Game[]): { team: string; games: number }[] {
  const teams = new Map<string, { team: string; games: number }>();
  for (const game of games) {
    for (const side of [game.blue, game.red]) {
      const key = side.teamName.trim().toLowerCase();
      const entry = teams.get(key) ?? { team: side.teamName, games: 0 };
      entry.games += 1;
      teams.set(key, entry);
    }
  }
  return [...teams.values()].sort((a, b) => b.games - a.games || a.team.localeCompare(b.team));
}

export interface BanLine {
  champion: Champion;
  count: number;
}

export interface TeamLookup extends DraftSummary {
  /** As the data spells it, or as asked when the team didn't play in scope. */
  team: string;
  /** Its champions in each role, most played first. */
  roles: Record<Role, Partner[]>;
  /** What it banned, and what its opponents banned against it, most first. */
  bannedBy: BanLine[];
  bannedAgainst: BanLine[];
  /** Its record against each opponent, most games first. */
  opponents: { team: string; games: number; wins: number }[];
}

function addBan(map: Map<string, BanLine>, champion: Champion) {
  const entry = map.get(champion.id) ?? { champion, count: 0 };
  entry.count += 1;
  map.set(champion.id, entry);
}

const mostPlayed = (a: Partner, b: Partner) => b.games - a.games || shrunk(b) - shrunk(a) || a.champion.name.localeCompare(b.champion.name);
const mostBanned = (a: BanLine, b: BanLine) => b.count - a.count || a.champion.name.localeCompare(b.champion.name);

/** One team across the games in scope: record, champions by role, bans both ways, opponents. */
export function teamLookup(games: readonly Game[], team: string): TeamLookup {
  const hits = draftsWith(games, {}, team);
  const roles = Object.fromEntries(ROLES.map((role) => [role, new Map<string, Partner>()])) as Record<Role, Map<string, Partner>>;
  const bannedBy = new Map<string, BanLine>();
  const bannedAgainst = new Map<string, BanLine>();
  const opponents = new Map<string, { team: string; games: number; wins: number }>();
  for (const hit of hits) {
    for (const player of hit.side.players) addPartner(roles[player.role], player.role, player.champion, hit.won);
    for (const ban of hit.side.bans) addBan(bannedBy, ban);
    for (const ban of hit.opponent.bans) addBan(bannedAgainst, ban);
    const key = hit.opponent.teamName.trim().toLowerCase();
    const entry = opponents.get(key) ?? { team: hit.opponent.teamName, games: 0, wins: 0 };
    entry.games += 1;
    if (hit.won) entry.wins += 1;
    opponents.set(key, entry);
  }
  return {
    ...summarize(hits),
    team: hits[0]?.side.teamName ?? team,
    roles: Object.fromEntries(ROLES.map((role) => [role, [...roles[role].values()].sort(mostPlayed)])) as Record<Role, Partner[]>,
    bannedBy: [...bannedBy.values()].sort(mostBanned),
    bannedAgainst: [...bannedAgainst.values()].sort(mostBanned),
    opponents: [...opponents.values()].sort((a, b) => b.games - a.games || b.wins - a.wins || a.team.localeCompare(b.team)),
  };
}

/** `jungle:Nocturne,mid:Akali` <-> picks, for the page link. Unknown roles are dropped. */
export function encodePicks(picks: LookupPicks): string {
  return chosenRoles(picks)
    .map((role) => `${role}:${picks[role]}`)
    .join(',');
}

export function decodePicks(text: string | null): LookupPicks {
  const picks: LookupPicks = {};
  for (const part of (text ?? '').split(',')) {
    const [role, id] = part.split(':');
    if (id && (ROLES as readonly string[]).includes(role ?? '')) picks[role as Role] = id;
  }
  return picks;
}
