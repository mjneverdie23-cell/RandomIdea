/**
 * One tournament at a time, for the Tournament page: how it was structured,
 * what was drafted, how each game's gold went, and which results the model
 * saw coming.
 *
 * Oracle's Elixir has no round column. A game carries its split (`Play-In`,
 * `Main Event`), a playoffs flag and its number inside the series, so the
 * structure is rebuilt from the games themselves:
 *
 * - **Phase** comes from the stage ingest already derived: play-in, knockout
 *   (the playoffs flag or a named knockout round), and everything else as the
 *   group phase.
 * - **Swiss rounds.** In a Swiss every team still in plays once a round, so a
 *   team's third series is round 3. The phase only counts as a Swiss when that
 *   holds and the pairings are record-matched (1–0 against 1–0); a round robin
 *   fails the second test.
 * - **Knockout rounds.** In single elimination a team's first knockout series
 *   is the first round, and the bracket's size — the Swiss qualifiers, or the
 *   number of opening series — says whether that round is a quarterfinal.
 *   That also holds on the night of the first quarterfinal, before the rest of
 *   the bracket exists. Double-elimination brackets aren't split into rounds.
 *
 * Pure: no React, no storage.
 */

import { competitionScope, competitionShort } from '../domain/competitions.ts';
import { partitionSeries } from '../data/stage.ts';
import {
  GOLD_CHECKPOINTS,
  ROLES,
  type Champion,
  type CompetitionId,
  type Game,
  type Role,
  type Side,
  type StageKind,
  type TeamSide,
} from '../domain/types.ts';
import { gamesBefore, isPocketPick } from './derive.ts';
import { predict } from './engine.ts';
import { formatFor } from './formats.ts';
import type { PatchMeta, PredictionInput, PredictorModel, SeriesLength } from './types.ts';

const teamKey = (name: string) => name.trim().toLowerCase();
/** `OTHER` is a bucket of events, never one international event. */
const isInternational = (competition: CompetitionId) =>
  competition !== 'OTHER' && competitionScope(competition) === 'international';
const winnerSide = (game: Game): TeamSide => (game.winner === 'blue' ? game.blue : game.red);
const loserSide = (game: Game): TeamSide => (game.winner === 'blue' ? game.red : game.blue);

/* ------------------------------------------------------------------ */
/* Which tournaments are loaded                                        */
/* ------------------------------------------------------------------ */

export interface TournamentOption {
  key: string;
  label: string;
  competition: CompetitionId;
  season: string;
  international: boolean;
  games: number;
  /** Epoch ms of the first and last game. */
  first: number;
  last: number;
}

/**
 * Which tournament a game belongs to. An international event is one tournament
 * per season, whatever its splits say (`Play-In`, `Main Event` are stages of
 * it); a league is one per split; an `OTHER` event is named by its own league.
 */
export function tournamentKey(game: Game): string {
  if (game.competition === 'OTHER') return `OTHER|${game.sourceLeague}|${game.season}`;
  if (isInternational(game.competition)) return `${game.competition}|${game.season}`;
  return `${game.competition}|${game.season}|${game.split ?? ''}`;
}

function tournamentName(game: Game): string {
  if (isInternational(game.competition)) {
    return `${competitionShort(game.competition)} ${game.season}`;
  }
  return game.tournamentLabel;
}

/** Every loaded tournament: international events first, then newest first. */
export function tournamentOptions(games: readonly Game[]): TournamentOption[] {
  const byKey = new Map<string, TournamentOption>();
  for (const game of games) {
    const key = tournamentKey(game);
    const at = Date.parse(game.date);
    const entry = byKey.get(key);
    if (!entry) {
      byKey.set(key, {
        key,
        label: tournamentName(game),
        competition: game.competition,
        season: game.season,
        international: isInternational(game.competition),
        games: 1,
        first: at,
        last: at,
      });
      continue;
    }
    entry.games += 1;
    entry.first = Math.min(entry.first, at);
    entry.last = Math.max(entry.last, at);
  }
  return [...byKey.values()].sort(
    (a, b) => Number(b.international) - Number(a.international) || b.last - a.last || a.label.localeCompare(b.label),
  );
}

/** The tournament's games, oldest first. */
export function tournamentGames(games: readonly Game[], key: string): Game[] {
  return games
    .filter((game) => tournamentKey(game) === key)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.gameNumber - b.gameNumber);
}

/* ------------------------------------------------------------------ */
/* Structure: series, phases, rounds                                   */
/* ------------------------------------------------------------------ */

export type Phase = 'playin' | 'group' | 'knockout';

const KNOCKOUT_KINDS = new Set<StageKind>(['playoffs', 'quarterfinal', 'semifinal', 'final']);

export function phaseOf(game: Game): Phase {
  if (game.stage.kind === 'playin') return 'playin';
  return KNOCKOUT_KINDS.has(game.stage.kind) ? 'knockout' : 'group';
}

export interface EventSeries {
  /** The first game's id. */
  id: string;
  phase: Phase;
  /** Where the series sits, e.g. `Round 3`, `Quarterfinal`, `Play-In`. */
  round: string;
  /** The stage filter for that round, e.g. `round-3`, `ko-quarterfinal`; `null` when none was inferred. */
  roundId: string | null;
  /** Both teams' Swiss record going in, e.g. `1–1`; `null` outside a Swiss. */
  pool: string | null;
  /** Oldest first. */
  games: Game[];
  /** Blue side of the first game first. */
  teams: [string, string];
  wins: [number, number];
  /** `null` while the series is level (unfinished, or a drawn Bo2). */
  winner: string | null;
  /** Epoch ms of the first game. */
  start: number;
}

export interface StageOption {
  id: string;
  label: string;
  /** Heading the option sits under, e.g. `Swiss stage`. */
  section: string;
  series: EventSeries[];
}

export interface TournamentStructure {
  /** Oldest first. */
  series: EventSeries[];
  /** Filters in tournament order; the first is always the whole event. */
  stages: StageOption[];
  /** How the group phase read: a Swiss, any other group format, or absent. */
  group: 'swiss' | 'group' | null;
  /** How the knockout read: single elimination with named rounds, another bracket, or absent. */
  knockout: 'single' | 'bracket' | null;
}

/** Share of series that must fit a Swiss for the phase to be read as one. */
const SWISS_FIT = 0.9;

function buildSeries(games: readonly Game[]): EventSeries[] {
  const members = games.map((game) => ({
    game,
    gameId: game.gameId,
    seriesKey: [phaseOf(game), ...[teamKey(game.blue.teamName), teamKey(game.red.teamName)].sort()].join('|'),
    gameNumber: game.gameNumber,
    timestamp: Date.parse(game.date),
  }));
  return partitionSeries(members)
    .map((run): EventSeries => {
      const ordered = run.map((member) => member.game);
      const first = ordered[0]!;
      const teams: [string, string] = [first.blue.teamName, first.red.teamName];
      const wins: [number, number] = [0, 0];
      for (const game of ordered) wins[teamKey(winnerSide(game).teamName) === teamKey(teams[0]) ? 0 : 1] += 1;
      return {
        id: first.gameId,
        phase: phaseOf(first),
        round: '',
        roundId: null,
        pool: null,
        games: ordered,
        teams,
        wins,
        winner: wins[0] === wins[1] ? null : teams[wins[0] > wins[1] ? 0 : 1],
        start: Date.parse(first.date),
      };
    })
    .sort((a, b) => a.start - b.start);
}

interface Tally {
  wins: number;
  losses: number;
}

/**
 * Number each team's series in order and check whether the pairings fit a
 * Swiss. Labels the series either way; returns whether it was one, and each
 * team's record after the phase.
 */
function readGroup(series: EventSeries[], label: string): { swiss: boolean; records: Map<string, Tally> } {
  const played = new Map<string, number>();
  const records = new Map<string, Tally>();
  const rounds: number[] = [];
  const pools: (string | null)[] = [];
  let level = 0;
  let matched = 0;

  for (const entry of series) {
    const [a, b] = entry.teams.map(teamKey) as [string, string];
    const playedA = played.get(a) ?? 0;
    const playedB = played.get(b) ?? 0;
    const recordA = records.get(a) ?? { wins: 0, losses: 0 };
    const recordB = records.get(b) ?? { wins: 0, losses: 0 };
    if (playedA === playedB) level += 1;
    const sameRecord = recordA.wins === recordB.wins && recordA.losses === recordB.losses;
    if (sameRecord) matched += 1;
    rounds.push(Math.max(playedA, playedB) + 1);
    pools.push(sameRecord ? `${recordA.wins}–${recordA.losses}` : null);

    played.set(a, playedA + 1);
    played.set(b, playedB + 1);
    records.set(a, recordA);
    records.set(b, recordB);
    if (entry.winner) {
      const winnerIsA = teamKey(entry.winner) === a;
      (winnerIsA ? recordA : recordB).wins += 1;
      (winnerIsA ? recordB : recordA).losses += 1;
    }
  }

  const count = series.length;
  const swiss =
    count >= 6 &&
    played.size >= 6 &&
    level / count >= SWISS_FIT &&
    matched / count >= SWISS_FIT &&
    Math.max(...rounds) >= 2;

  series.forEach((entry, index) => {
    if (swiss) {
      entry.round = `Round ${rounds[index]}`;
      entry.roundId = `round-${rounds[index]}`;
      entry.pool = pools[index] ?? null;
    } else {
      entry.round = label;
    }
  });
  return { swiss, records };
}

const NAMED_ROUNDS: Partial<Record<StageKind, string>> = {
  quarterfinal: 'Quarterfinal',
  semifinal: 'Semifinal',
  final: 'Final',
};

/** Knockout rounds named from the end: the last is the final. */
const FROM_END = ['Final', 'Semifinal', 'Quarterfinal', 'Round of 16'];

const roundSlug = (round: string) => `ko-${round.toLowerCase().replace(/\s+/g, '-')}`;

/**
 * Name the knockout rounds. `qualifiers` is how many teams the group phase
 * sent through, when it is known — it sizes the bracket before every opening
 * series has been played.
 */
function readKnockout(series: EventSeries[], qualifiers: number | null, label: string): 'single' | 'bracket' {
  // An export that names its rounds is taken at its word.
  if (series.every((entry) => NAMED_ROUNDS[entry.games[0]!.stage.kind])) {
    for (const entry of series) {
      entry.round = NAMED_ROUNDS[entry.games[0]!.stage.kind]!;
      entry.roundId = roundSlug(entry.round);
    }
    return 'single';
  }

  const played = new Map<string, number>();
  const out = new Set<string>();
  const rounds: number[] = [];
  let single = true;
  for (const entry of series) {
    const [a, b] = entry.teams.map(teamKey) as [string, string];
    const playedA = played.get(a) ?? 0;
    const playedB = played.get(b) ?? 0;
    if (playedA !== playedB || out.has(a) || out.has(b)) single = false;
    rounds.push(Math.max(playedA, playedB) + 1);
    played.set(a, playedA + 1);
    played.set(b, playedB + 1);
    if (entry.winner) out.add(teamKey(entry.winner) === a ? b : a);
  }

  if (!single) {
    for (const entry of series) {
      const named = NAMED_ROUNDS[entry.games[0]!.stage.kind];
      entry.round = named ?? label;
      entry.roundId = named ? roundSlug(named) : null;
    }
    return 'bracket';
  }

  const openers = rounds.filter((round) => round === 1).length;
  const size = 2 ** Math.ceil(Math.log2(Math.max(2, qualifiers ?? 0, openers * 2)));
  const total = Math.log2(size);
  series.forEach((entry, index) => {
    const round = rounds[index]!;
    entry.round = FROM_END[total - round] ?? `Round ${round}`;
    entry.roundId = roundSlug(entry.round);
  });
  return 'single';
}

const ROUND_ORDER = ['Round of 16', 'Quarterfinal', 'Semifinal', 'Final'];
const plural = (round: string) => (round === 'Final' || round.startsWith('Round') ? round : `${round}s`);

/** Rebuild a tournament's structure from its games (any order). */
export function tournamentStructure(games: readonly Game[]): TournamentStructure {
  const series = buildSeries(games);
  const competition = games[0]?.competition;
  const regional = competition ? !isInternational(competition) && competition !== 'OTHER' : false;

  const playin = series.filter((entry) => entry.phase === 'playin');
  const group = series.filter((entry) => entry.phase === 'group');
  const knockout = series.filter((entry) => entry.phase === 'knockout');

  for (const entry of playin) entry.round = 'Play-In';

  const groupLabel = regional ? 'Regular season' : 'Group stage';
  const groupRead = group.length ? readGroup(group, groupLabel) : null;
  const swiss = groupRead?.swiss ?? false;
  let qualifiers: number | null = null;
  if (swiss && groupRead) {
    const best = Math.max(...[...groupRead.records.values()].map((record) => record.wins));
    qualifiers = [...groupRead.records.values()].filter((record) => record.wins === best).length;
  }
  const knockoutLabel = regional ? 'Playoffs' : 'Knockout stage';
  const knockoutRead = knockout.length ? readKnockout(knockout, qualifiers, regional ? 'Playoffs' : 'Bracket') : null;

  const stages: StageOption[] = [{ id: 'all', label: 'Whole event', section: 'Event', series }];
  if (playin.length && playin.length < series.length) {
    stages.push({ id: 'main', label: 'Main event', section: 'Event', series: [...group, ...knockout].sort((a, b) => a.start - b.start) });
    stages.push({ id: 'playin', label: 'Play-In', section: 'Play-In', series: playin });
  }
  if (group.length) {
    const section = swiss ? 'Swiss stage' : groupLabel;
    stages.push({ id: 'group', label: swiss ? 'All rounds' : section, section, series: group });
    if (swiss) {
      const rounds = [...new Set(group.map((entry) => entry.roundId!))];
      for (const id of rounds) {
        const members = group.filter((entry) => entry.roundId === id);
        stages.push({ id, label: members[0]!.round, section, series: members });
      }
    }
  }
  if (knockout.length) {
    stages.push({
      id: 'knockout',
      label: regional ? 'All playoffs' : 'All knockouts',
      section: knockoutLabel,
      series: knockout,
    });
    const named = [...new Set(knockout.filter((entry) => entry.roundId).map((entry) => entry.round))].sort(
      (a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b),
    );
    for (const round of named) {
      stages.push({
        id: roundSlug(round),
        label: plural(round),
        section: knockoutLabel,
        series: knockout.filter((entry) => entry.round === round),
      });
    }
  }

  return {
    series,
    stages,
    group: groupRead ? (swiss ? 'swiss' : 'group') : null,
    knockout: knockoutRead,
  };
}

/** A stage's games, oldest first. */
export function stageGames(stage: StageOption): Game[] {
  return stage.series.flatMap((entry) => entry.games).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/* ------------------------------------------------------------------ */
/* Champions                                                           */
/* ------------------------------------------------------------------ */

export interface ChampionLine {
  champion: Champion;
  picks: number;
  wins: number;
  /** Who played it, most games first. */
  players: { name: string; team: string; games: number }[];
}

interface ChampionAcc {
  champion: Champion;
  picks: number;
  wins: number;
  players: Map<string, { name: string; team: string; games: number }>;
}

function addPick(map: Map<string, ChampionAcc>, key: string, champion: Champion, player: string, team: string, won: boolean) {
  const acc = map.get(key) ?? { champion, picks: 0, wins: 0, players: new Map() };
  acc.picks += 1;
  if (won) acc.wins += 1;
  const playerKey = `${teamKey(team)}|${teamKey(player)}`;
  const entry = acc.players.get(playerKey) ?? { name: player, team, games: 0 };
  entry.games += 1;
  acc.players.set(playerKey, entry);
  map.set(key, acc);
}

const byPicks = (a: ChampionLine, b: ChampionLine) =>
  b.picks - a.picks || b.wins - a.wins || a.champion.name.localeCompare(b.champion.name);

function toLine(acc: ChampionAcc): ChampionLine {
  return {
    champion: acc.champion,
    picks: acc.picks,
    wins: acc.wins,
    players: [...acc.players.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)),
  };
}

/** Champions picked in each role, most picked first. */
export function championsByRole(games: readonly Game[]): Record<Role, ChampionLine[]> {
  const byRole = Object.fromEntries(ROLES.map((role) => [role, new Map<string, ChampionAcc>()])) as Record<
    Role,
    Map<string, ChampionAcc>
  >;
  for (const game of games) {
    for (const side of [game.blue, game.red]) {
      const won = game.winner === side.side;
      for (const slot of side.players) {
        addPick(byRole[slot.role], slot.champion.id, slot.champion, slot.playerName, side.teamName, won);
      }
    }
  }
  return Object.fromEntries(
    ROLES.map((role) => [role, [...byRole[role].values()].map(toLine).sort(byPicks)]),
  ) as Record<Role, ChampionLine[]>;
}

export interface ContestedLine {
  champion: Champion;
  bans: number;
  picks: number;
  wins: number;
  /** Share of games it was picked or banned in. */
  presence: number;
}

/** Every champion picked or banned, most banned first. */
export function contestedChampions(games: readonly Game[]): ContestedLine[] {
  const lines = new Map<string, ContestedLine>();
  const line = (champion: Champion) => {
    const existing = lines.get(champion.id);
    if (existing) return existing;
    const created = { champion, bans: 0, picks: 0, wins: 0, presence: 0 };
    lines.set(champion.id, created);
    return created;
  };
  for (const game of games) {
    for (const side of [game.blue, game.red]) {
      for (const ban of side.bans) line(ban).bans += 1;
      for (const slot of side.players) {
        const entry = line(slot.champion);
        entry.picks += 1;
        if (game.winner === side.side) entry.wins += 1;
      }
    }
  }
  const total = Math.max(1, games.length);
  return [...lines.values()]
    .map((entry) => ({ ...entry, presence: (entry.picks + entry.bans) / total }))
    .sort((a, b) => b.bans - a.bans || b.presence - a.presence || a.champion.name.localeCompare(b.champion.name));
}

/* ------------------------------------------------------------------ */
/* Pocket picks                                                        */
/* ------------------------------------------------------------------ */

export interface PocketLine extends ChampionLine {
  role: Role;
}

export interface PocketSummary {
  lines: PocketLine[];
  /** Drafts (one per team per game) whose patch could be judged. */
  judged: number;
  pocketDrafts: number;
  pocketWins: number;
  metaDrafts: number;
  metaWins: number;
}

/**
 * Pocket picks at the event, each judged against the meta of the patch its
 * game was played on — the same rule as the Predictor and Team Stat.
 */
export function pocketSummary(games: readonly Game[], meta: ReadonlyMap<string, PatchMeta>): PocketSummary {
  const picks = new Map<string, ChampionAcc & { role: Role }>();
  const summary = { judged: 0, pocketDrafts: 0, pocketWins: 0, metaDrafts: 0, metaWins: 0 };
  for (const game of games) {
    for (const side of [game.blue, game.red]) {
      const won = game.winner === side.side;
      const flags = side.players.map((slot) => isPocketPick(meta, game, slot.role, slot.champion.id));
      if (flags.some((flag) => flag === null)) continue;
      summary.judged += 1;
      if (flags.some(Boolean)) {
        summary.pocketDrafts += 1;
        if (won) summary.pocketWins += 1;
      } else {
        summary.metaDrafts += 1;
        if (won) summary.metaWins += 1;
      }
      side.players.forEach((slot, index) => {
        if (!flags[index]) return;
        const key = `${slot.role}|${slot.champion.id}`;
        if (!picks.has(key)) picks.set(key, { champion: slot.champion, role: slot.role, picks: 0, wins: 0, players: new Map() });
        addPick(picks, key, slot.champion, slot.playerName, side.teamName, won);
      });
    }
  }
  const lines = [...picks.values()]
    .map((acc): PocketLine => ({ ...toLine(acc), role: acc.role }))
    .sort((a, b) => byPicks(a, b) || ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  return { lines, ...summary };
}

/* ------------------------------------------------------------------ */
/* Each game's gold                                                    */
/* ------------------------------------------------------------------ */

export interface GoldPoint {
  minute: number;
  /** Blue's lead (+) or deficit (−). */
  diff: number;
}

export interface GoldMoment {
  amount: number;
  minute: number;
}

export interface GoldStory {
  /** From 0:00, through each recorded mark, to the end when total gold is known. */
  points: GoldPoint[];
  /** Whether the last point is the end of the game (from total gold) rather than a mark. */
  hasEnd: boolean;
  /** Each side's biggest lead at any point, `null` if it never led. */
  biggestLead: Record<Side, GoldMoment | null>;
  /** The winner's deepest deficit before winning; `null` if it never trailed at a mark. */
  comeback: GoldMoment | null;
  /** Gold difference at the end, from the winner's side. */
  endDiff: number | null;
}

/**
 * A game's gold, from blue's side. Oracle's Elixir records the difference at
 * 10, 15, 20 and 25 minutes only, plus each team's total at the end; between
 * those the line is a straight join, not a measurement.
 */
export function goldStory(game: Game): GoldStory | null {
  const fromBlue = game.blue.goldDiff?.checkpoints;
  const fromRed = game.red.goldDiff?.checkpoints;
  const checkpoints = fromBlue ?? fromRed?.map((value) => (value === null ? null : -value)) ?? null;
  const points: GoldPoint[] = [{ minute: 0, diff: 0 }];
  checkpoints?.forEach((diff, index) => {
    if (diff !== null) points.push({ minute: GOLD_CHECKPOINTS[index]!, diff });
  });

  const blueTotal = game.blue.gold?.total ?? null;
  const redTotal = game.red.gold?.total ?? null;
  const endMinute = game.durationSeconds ? game.durationSeconds / 60 : null;
  const endDiff = blueTotal !== null && redTotal !== null ? blueTotal - redTotal : null;
  const hasEnd = endDiff !== null && endMinute !== null && endMinute > points.at(-1)!.minute;
  if (hasEnd) points.push({ minute: endMinute!, diff: endDiff! });
  if (points.length < 2) return null;

  const lead = (sign: 1 | -1): GoldMoment | null => {
    let best: GoldMoment | null = null;
    for (const point of points) {
      const amount = point.diff * sign;
      if (amount > 0 && (!best || amount > best.amount)) best = { amount, minute: point.minute };
    }
    return best;
  };
  const winnerSign = game.winner === 'blue' ? 1 : -1;
  // The end is when the winner has usually pulled ahead, so only the marks count.
  let comeback: GoldMoment | null = null;
  for (const point of points.slice(1, hasEnd ? -1 : undefined)) {
    const deficit = -point.diff * winnerSign;
    if (deficit > 0 && (!comeback || deficit > comeback.amount)) comeback = { amount: deficit, minute: point.minute };
  }

  return {
    points,
    hasEnd,
    biggestLead: { blue: lead(1), red: lead(-1) },
    comeback,
    endDiff: endDiff === null ? null : endDiff * winnerSign,
  };
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export interface GameMoment {
  game: Game;
  /** The team the moment belongs to: who came back, or who led. */
  team: string;
  opponent: string;
  amount: number;
  minute: number;
}

export interface TournamentRecords {
  games: number;
  blueWins: number;
  averageSeconds: number | null;
  /** Wins from behind, biggest deficit first. */
  comebacks: GameMoment[];
  /** Biggest gold lead at 15 minutes, and whether it held. */
  leadsAt15: (GameMoment & { held: boolean })[];
  fastest: Game[];
  longest: Game[];
}

const RECORD_ROWS = 5;

export function tournamentRecords(games: readonly Game[]): TournamentRecords {
  const comebacks: GameMoment[] = [];
  const leadsAt15: (GameMoment & { held: boolean })[] = [];
  for (const game of games) {
    const story = goldStory(game);
    const winner = winnerSide(game);
    const loser = loserSide(game);
    if (story?.comeback) {
      comebacks.push({ game, team: winner.teamName, opponent: loser.teamName, ...story.comeback });
    }
    const at15 = story?.points.find((point) => point.minute === 15);
    if (at15 && at15.diff !== 0) {
      const leader = at15.diff > 0 ? game.blue : game.red;
      const trailer = at15.diff > 0 ? game.red : game.blue;
      leadsAt15.push({
        game,
        team: leader.teamName,
        opponent: trailer.teamName,
        amount: Math.abs(at15.diff),
        minute: 15,
        held: leader.side === game.winner,
      });
    }
  }
  const timed = games.filter((game) => game.durationSeconds);
  const seconds = timed.map((game) => game.durationSeconds!);
  return {
    games: games.length,
    blueWins: games.filter((game) => game.winner === 'blue').length,
    averageSeconds: seconds.length ? seconds.reduce((a, b) => a + b, 0) / seconds.length : null,
    comebacks: comebacks.sort((a, b) => b.amount - a.amount).slice(0, RECORD_ROWS),
    leadsAt15: leadsAt15.sort((a, b) => b.amount - a.amount).slice(0, RECORD_ROWS),
    fastest: [...timed].sort((a, b) => a.durationSeconds! - b.durationSeconds!).slice(0, 3),
    longest: [...timed].sort((a, b) => b.durationSeconds! - a.durationSeconds!).slice(0, 3),
  };
}

/* ------------------------------------------------------------------ */
/* Expected and unexpected results                                     */
/* ------------------------------------------------------------------ */

/**
 * The best-of a series was played as, without peeking at how it ended: a
 * knockout is its competition's knockout format (a Bo5 that ended 3–0 is
 * still a Bo5), and a group series is a Bo1 when it was one game and a Bo3
 * when it was more — formats announced before the series, not results.
 */
export function seriesLengthOf(entry: EventSeries): SeriesLength {
  const first = entry.games[0]!;
  if (!first.seriesFormatInferred && first.seriesFormat !== 'UNKNOWN') return first.seriesFormat;
  if (entry.phase !== 'group') return formatFor(first.competition, first.stage.kind).series;
  if (entry.games.length === 1) return 'BO1';
  return entry.games.length > 3 ? 'BO5' : 'BO3';
}

const championsOf = (side: TeamSide) =>
  ROLES.map((role) => side.players.find((slot) => slot.role === role)?.champion ?? null);

/**
 * What the Predictor is given for a game: both drafts, the stage, the best-of
 * and the series score going in. Earlier games of the same series are already
 * over, so their results are fair input; this game's result is not read.
 */
export function predictionInput(game: Game, entry: EventSeries): PredictionInput {
  const index = entry.games.findIndex((member) => member.gameId === game.gameId);
  const before = entry.games.slice(0, Math.max(0, index));
  const wonBy = (team: string) => before.filter((member) => teamKey(winnerSide(member).teamName) === teamKey(team)).length;
  return {
    blue: { competition: game.competition, team: game.blue.teamName, champions: championsOf(game.blue), motivation: 'normal' },
    red: { competition: game.competition, team: game.red.teamName, champions: championsOf(game.red), motivation: 'normal' },
    stage: game.stage.kind,
    seriesLength: seriesLengthOf(entry),
    gameNumber: index + 1,
    scoreBlue: wonBy(game.blue.teamName),
    scoreRed: wonBy(game.red.teamName),
    previousWinner: null,
    winRequirement: 'series',
  };
}

export interface GameCall {
  /** Chance the Predictor gave the blue side to win this game. */
  probBlue: number;
  /** Chance it gave this game's blue side to win the series from here. */
  seriesProbBlue: number;
  favourite: Side | null;
}

/** Below this the Predictor was calling a coin flip, and neither result surprises. */
export const TOSS_UP = 0.55;
/** At or above this, the favourite losing is a big upset. */
export const BIG_UPSET = 0.7;

export type Verdict = 'expected' | 'upset' | 'big upset' | 'toss-up';

export function verdict(favouriteProbability: number, favouriteWon: boolean): Verdict {
  if (favouriteProbability < TOSS_UP) return 'toss-up';
  if (favouriteWon) return 'expected';
  return favouriteProbability >= BIG_UPSET ? 'big upset' : 'upset';
}

export interface Call {
  favourite: string;
  underdog: string;
  /** The favourite's chance. */
  probability: number;
  verdict: Verdict;
}

/** The game's call, or `null` when the Predictor had it level. */
export function gameCall(game: Game, call: GameCall | undefined): Call | null {
  if (!call?.favourite) return null;
  const favourite = call.favourite === 'blue' ? game.blue : game.red;
  const underdog = call.favourite === 'blue' ? game.red : game.blue;
  const probability = call.favourite === 'blue' ? call.probBlue : 1 - call.probBlue;
  return {
    favourite: favourite.teamName,
    underdog: underdog.teamName,
    probability,
    verdict: verdict(probability, game.winner === call.favourite),
  };
}

/**
 * The series call, read off the first game: the chance the Predictor gave each
 * team to win the series once the game-1 draft was in. `null` while the series
 * is unfinished or the call was level.
 */
export function seriesCall(entry: EventSeries, calls: ReadonlyMap<string, GameCall>): Call | null {
  const first = calls.get(entry.games[0]!.gameId);
  if (!first || !entry.winner || first.seriesProbBlue === 0.5) return null;
  const blueFavoured = first.seriesProbBlue > 0.5;
  const favourite = entry.teams[blueFavoured ? 0 : 1];
  const underdog = entry.teams[blueFavoured ? 1 : 0];
  const probability = blueFavoured ? first.seriesProbBlue : 1 - first.seriesProbBlue;
  return {
    favourite,
    underdog,
    probability,
    verdict: verdict(probability, teamKey(entry.winner) === teamKey(favourite)),
  };
}

export interface CallHooks {
  onProgress?: (done: number, total: number) => void;
  cancelled?: () => boolean;
}

/**
 * The Predictor's call on every game, each from a model built only out of
 * games played before that game's day began.
 *
 * Cutting at the day rather than the game means one model per match day, not
 * per game — a whole Worlds is a couple of dozen models — at the cost of a
 * later series not seeing an earlier one from the same day. That can only
 * leave information out, never let a result in. The loop yields between days
 * so the page stays responsive. `allGames` is the whole dataset, newest first.
 */
export async function callTournament(
  allGames: readonly Game[],
  series: readonly EventSeries[],
  buildModel: (history: Game[]) => PredictorModel,
  hooks: CallHooks = {},
): Promise<Map<string, GameCall> | null> {
  const byDay = new Map<string, { cutoff: number; games: { game: Game; entry: EventSeries }[] }>();
  for (const entry of series) {
    for (const game of entry.games) {
      const day = new Date(Date.parse(game.date)).toISOString().slice(0, 10);
      const bucket = byDay.get(day) ?? { cutoff: Infinity, games: [] };
      bucket.cutoff = Math.min(bucket.cutoff, Date.parse(game.date));
      bucket.games.push({ game, entry });
      byDay.set(day, bucket);
    }
  }

  const days = [...byDay.values()].sort((a, b) => a.cutoff - b.cutoff);
  const calls = new Map<string, GameCall>();
  let done = 0;
  for (const day of days) {
    if (hooks.cancelled?.()) return null;
    const model = buildModel(gamesBefore(allGames, day.cutoff));
    for (const { game, entry } of day.games) {
      const prediction = predict(model, predictionInput(game, entry));
      calls.set(game.gameId, {
        probBlue: prediction.gameProbBlue,
        seriesProbBlue: prediction.seriesProbBlue,
        favourite: prediction.favourite,
      });
    }
    done += 1;
    hooks.onProgress?.(done, days.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return calls;
}
