/**
 * Oracle's Elixir rows -> normalized `Game[]`.
 *
 * Pipeline:
 *   1. resolve the file's columns (see `oracleSchema.ts`)
 *   2. group rows by `gameid`
 *   3. build a two-sided draft from the 10 player rows + 2 team rows
 *   4. drop anything outside the configured competitions
 *   5. drop anything with an incomplete draft or no decidable winner
 *   6. second pass: infer series length -> best-of format
 *
 * Every rejection is counted and summarized in `DatasetStats` so the import
 * screen can explain what happened to a file rather than silently shrinking it.
 */

import {
  COMPETITION_IDS,
  competitionShort,
  resolveCompetition,
} from '../domain/competitions.ts';
import { makeChampion } from '../domain/champions.ts';
import {
  GOLD_CHECKPOINTS,
  ROLES,
  type Champion,
  type CompetitionId,
  type DatasetStats,
  type Game,
  type GoldDiffTrack,
  type IngestWarning,
  type PlayerSlot,
  type Role,
  type Side,
  type TeamSide,
} from '../domain/types.ts';
import {
  buildColumnMap,
  cell,
  cellBoolean,
  cellNumber,
  isTeamRow,
  missingRequiredFields,
  normalizePatch,
  parseGameDate,
  parseRole,
  parseSide,
  roleFromParticipantId,
  type ColumnMap,
  type LogicalField,
  type RawRow,
} from './oracleSchema.ts';
import {
  computeSeriesLengths,
  deriveStage,
  inferSeriesFormat,
  makeSeriesKey,
  parseSeriesFormat,
  type SeriesMember,
} from './stage.ts';

export class IngestError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'IngestError';
  }
}

export interface IngestOptions {
  /** Restrict to a subset of the configured competitions. Defaults to all. */
  competitions?: CompetitionId[];
  /** Marks resulting games as synthetic development data. */
  demo?: boolean;
}

export interface IngestResult {
  games: Game[];
  stats: DatasetStats;
}

/** Values that mean "no ban" across the exports seen in the wild. */
const EMPTY_VALUES = new Set(['', 'none', 'nan', 'null', 'na', 'n/a', '-', 'no ban', 'noban']);

function isBlank(value: string): boolean {
  return EMPTY_VALUES.has(value.trim().toLowerCase());
}

class WarningCollector {
  private readonly items = new Map<string, IngestWarning>();

  add(code: IngestWarning['code'], message: string, sample?: string): void {
    const key = `${code}:${message}`;
    const existing = this.items.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    this.items.set(key, { code, message, count: 1, ...(sample ? { sample } : {}) });
  }

  list(): IngestWarning[] {
    return [...this.items.values()].sort((a, b) => b.count - a.count);
  }
}

export function ingestRows(
  rows: RawRow[],
  headers: string[],
  options: IngestOptions = {},
): IngestResult {
  const map = buildColumnMap(headers);
  const missing = missingRequiredFields(map);
  if (missing.length) {
    throw new IngestError(
      'This file does not look like an Oracle’s Elixir export.',
      `Missing required column(s): ${missing.join(', ')}. Found headers: ${headers.slice(0, 12).join(', ')}${headers.length > 12 ? '…' : ''}`,
    );
  }

  const allowed = new Set<CompetitionId>(options.competitions ?? COMPETITION_IDS);
  const warnings = new WarningCollector();
  const grouped = groupByGame(rows, map, warnings);

  let rejectedByCompetition = 0;
  let rejectedIncomplete = 0;
  const built: Game[] = [];
  const seenGameIds = new Set<string>();

  for (const [gameId, gameRows] of grouped) {
    const league = firstNonEmpty(gameRows, map, 'league');
    const competition = resolveCompetition(league);
    if (!competition || !allowed.has(competition)) {
      rejectedByCompetition += 1;
      continue;
    }
    if (seenGameIds.has(gameId)) {
      warnings.add('duplicate_game', 'Duplicate gameid encountered; later rows ignored.', gameId);
      continue;
    }

    const game = buildGame(gameId, gameRows, map, competition, league, warnings, options.demo);
    if (!game) {
      rejectedIncomplete += 1;
      continue;
    }
    seenGameIds.add(gameId);
    built.push(game);
  }

  const games = applySeriesFormats(built);
  games.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return { games, stats: buildStats(rows.length, grouped.size, games, {
    rejectedByCompetition,
    rejectedIncomplete,
    warnings: warnings.list(),
  }) };
}

function groupByGame(
  rows: RawRow[],
  map: ColumnMap,
  warnings: WarningCollector,
): Map<string, RawRow[]> {
  const grouped = new Map<string, RawRow[]>();
  for (const row of rows) {
    const gameId = cell(row, map, 'gameId');
    if (!gameId) {
      warnings.add('bad_row', 'Row has no game id and was skipped.');
      continue;
    }
    if (cell(row, map, 'dataCompleteness').toLowerCase() === 'ignore') continue;
    const bucket = grouped.get(gameId);
    if (bucket) bucket.push(row);
    else grouped.set(gameId, [row]);
  }
  return grouped;
}

function firstNonEmpty(rows: RawRow[], map: ColumnMap, field: LogicalField): string {
  for (const row of rows) {
    const value = cell(row, map, field);
    if (value) return value;
  }
  return '';
}

function buildGame(
  gameId: string,
  rows: RawRow[],
  map: ColumnMap,
  competition: CompetitionId,
  sourceLeague: string,
  warnings: WarningCollector,
  demo = false,
): Game | null {
  const teamRows: Partial<Record<Side, RawRow>> = {};
  const playerRows: Record<Side, RawRow[]> = { blue: [], red: [] };

  for (const row of rows) {
    const side = parseSide(row, map);
    if (!side) {
      warnings.add('unknown_side', 'Row has no usable side/participant id.', gameId);
      continue;
    }
    if (isTeamRow(row, map)) {
      teamRows[side] ??= row;
    } else {
      playerRows[side].push(row);
    }
  }

  const blue = buildTeamSide('blue', teamRows.blue, playerRows.blue, map);
  const red = buildTeamSide('red', teamRows.red, playerRows.red, map);
  if (!blue || !red) {
    warnings.add('incomplete_game', 'Draft is missing players or champions; game skipped.', gameId);
    return null;
  }

  const winner = resolveWinner(teamRows, playerRows, map);
  if (!winner) {
    warnings.add('no_winner', 'No decidable winner; game skipped.', gameId);
    return null;
  }

  const date = parseGameDate(firstNonEmpty(rows, map, 'date'));
  if (!date) {
    warnings.add('incomplete_game', 'Unparseable or missing date; game skipped.', gameId);
    return null;
  }

  const yearRaw = firstNonEmpty(rows, map, 'year');
  const season = yearRaw || String(new Date(date).getUTCFullYear());
  const splitRaw = firstNonEmpty(rows, map, 'split');
  const split = splitRaw && !isBlank(splitRaw) ? splitRaw : null;
  const playoffsFlag = firstDefined(rows, (row) => cellBoolean(row, map, 'playoffs'));
  const stageRaw = firstNonEmpty(rows, map, 'stage');

  const stage = deriveStage({ stageRaw, split, playoffs: playoffsFlag });
  const explicitFormat = parseSeriesFormat(firstNonEmpty(rows, map, 'seriesFormat'));
  const gameLength = firstDefined(rows, (row) => cellNumber(row, map, 'gameLength'));

  return {
    gameId,
    competition,
    sourceLeague,
    tournamentLabel: buildTournamentLabel(competition, season, split, stage.kind),
    season,
    split,
    date,
    patch: normalizePatch(firstNonEmpty(rows, map, 'patch')),
    stage,
    seriesFormat: explicitFormat ?? 'UNKNOWN',
    seriesFormatInferred: explicitFormat === null,
    gameNumber: firstDefined(rows, (row) => cellNumber(row, map, 'gameNumber')) ?? 1,
    blue,
    red,
    winner,
    durationSeconds: gameLength && gameLength > 0 ? Math.round(gameLength) : null,
    demo,
  };
}

function firstDefined<T>(rows: RawRow[], read: (row: RawRow) => T | null): T | null {
  for (const row of rows) {
    const value = read(row);
    if (value !== null) return value;
  }
  return null;
}

function buildTeamSide(
  side: Side,
  teamRow: RawRow | undefined,
  rows: RawRow[],
  map: ColumnMap,
): TeamSide | null {
  const players = assignRoles(rows, map);
  if (!players) return null;

  const teamName =
    (teamRow ? cell(teamRow, map, 'teamName') : '') ||
    rows.map((row) => cell(row, map, 'teamName')).find(Boolean) ||
    '';
  if (!teamName) return null;

  const teamId =
    (teamRow ? cell(teamRow, map, 'teamId') : '') ||
    rows.map((row) => cell(row, map, 'teamId')).find(Boolean) ||
    null;

  return {
    side,
    teamName,
    teamId: teamId || null,
    tag: deriveTeamTag(teamName),
    players,
    bans: readBans(teamRow, rows, map),
    goldDiff: readGoldDiff(teamRow, map),
  };
}

/**
 * Read the gold-diff checkpoints from a team row.
 *
 * Both shapes are kept: the per-minute series, which is what the early-game
 * tempo read needs, and the peak/trough summary the throw and comeback reads
 * use. A mark is `null` when the game ended before it — roughly one game in
 * twelve finishes inside 25 minutes — so a missing entry means "not reached",
 * never zero. Player rows carry per-player gold diffs, so only the team row is
 * read.
 */
function readGoldDiff(teamRow: RawRow | undefined, map: ColumnMap): GoldDiffTrack | null {
  if (!teamRow || map.goldDiffColumns.length === 0) return null;

  const byMinute = new Map<number, number>();
  for (const { minute, column } of map.goldDiffColumns) {
    const raw = teamRow[column];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) byMinute.set(minute, value);
  }
  if (byMinute.size === 0) return null;

  const checkpoints = GOLD_CHECKPOINTS.map((minute) => byMinute.get(minute) ?? null);
  const present = [...byMinute.values()];
  return { checkpoints, peak: Math.max(...present), trough: Math.min(...present) };
}

/**
 * Fit five player rows onto the five role slots.
 *
 * The `position` column is authoritative when it is present and unambiguous;
 * duplicates and blanks fall back to participant order, which Oracle's Elixir
 * writes in draft order (top, jungle, mid, bot, support).
 */
function assignRoles(rows: RawRow[], map: ColumnMap): PlayerSlot[] | null {
  if (rows.length !== ROLES.length) return null;

  const ordered = [...rows].sort(
    (a, b) => (cellNumber(a, map, 'participantId') ?? 0) - (cellNumber(b, map, 'participantId') ?? 0),
  );

  const slots = new Map<Role, RawRow>();
  const leftovers: RawRow[] = [];
  for (const row of ordered) {
    const role = parseRole(cell(row, map, 'position'));
    if (role && !slots.has(role)) slots.set(role, row);
    else leftovers.push(row);
  }
  for (const row of leftovers) {
    const fallback =
      roleFromParticipantId(cellNumber(row, map, 'participantId')) ??
      ROLES.find((role) => !slots.has(role)) ??
      null;
    const target = fallback && !slots.has(fallback) ? fallback : ROLES.find((r) => !slots.has(r));
    if (!target) return null;
    slots.set(target, row);
  }

  const players: PlayerSlot[] = [];
  for (const role of ROLES) {
    const row = slots.get(role);
    if (!row) return null;
    const champion = makeChampion(cell(row, map, 'champion'));
    if (!champion) return null;
    const playerId = cell(row, map, 'playerId');
    players.push({
      role,
      playerName: cell(row, map, 'playerName') || 'Unknown',
      playerId: playerId || null,
      champion,
    });
  }
  return players;
}

function readBans(teamRow: RawRow | undefined, rows: RawRow[], map: ColumnMap): Champion[] {
  const source = teamRow ?? rows[0];
  if (!source || map.banColumns.length === 0) return [];
  const bans: Champion[] = [];
  for (const column of map.banColumns) {
    const raw = source[column] ?? '';
    if (isBlank(raw)) continue;
    const champion = makeChampion(raw);
    if (champion) bans.push(champion);
  }
  return bans;
}

function resolveWinner(
  teamRows: Partial<Record<Side, RawRow>>,
  playerRows: Record<Side, RawRow[]>,
  map: ColumnMap,
): Side | null {
  for (const side of ['blue', 'red'] as const) {
    const row = teamRows[side];
    if (!row) continue;
    const result = cellBoolean(row, map, 'result');
    if (result === true) return side;
    if (result === false) return side === 'blue' ? 'red' : 'blue';
  }

  // No team rows: fall back to the majority verdict of the player rows.
  for (const side of ['blue', 'red'] as const) {
    const wins = playerRows[side].filter((row) => cellBoolean(row, map, 'result') === true).length;
    if (wins >= 3) return side;
  }
  return null;
}

function buildTournamentLabel(
  competition: CompetitionId,
  season: string,
  split: string | null,
  stageKind: string,
): string {
  const base = `${competitionShort(competition)} ${season}`.trim();
  // `Main Event` / `Play-In` are stage information, already shown separately.
  if (!split || ['main event', 'play-in', 'playin', 'playoffs'].includes(split.toLowerCase())) {
    return base;
  }
  if (stageKind === 'group' || stageKind === 'playin') return base;
  return `${base} ${split}`;
}

/**
 * Short broadcast-style tag derived from the team name.
 * Purely algorithmic — no per-team table — so new orgs work without changes.
 */
export function deriveTeamTag(teamName: string): string {
  const cleaned = teamName
    .replace(/\b(esports?|e-sports?|gaming|team|club|academy|pro|the)\b/gi, ' ')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = (cleaned || teamName).split(/\s+/).filter(Boolean);
  if (words.length === 0) return teamName.slice(0, 3).toUpperCase();
  if (words.length === 1) {
    const word = words[0]!;
    return word.length <= 4 ? word.toUpperCase() : word.slice(0, 3).toUpperCase();
  }
  return words
    .slice(0, 4)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase();
}

/** Second pass: series length -> best-of, for games without an explicit format. */
function applySeriesFormats(games: Game[]): Game[] {
  const members: SeriesMember[] = games.map((game) => ({
    gameId: game.gameId,
    seriesKey: makeSeriesKey({
      competition: game.competition,
      season: game.season,
      split: game.split,
      playoffs: game.stage.kind !== 'regular',
      teamA: game.blue.teamName,
      teamB: game.red.teamName,
    }),
    gameNumber: game.gameNumber,
    timestamp: Date.parse(game.date),
  }));

  const lengths = computeSeriesLengths(members);
  return games.map((game) => {
    if (!game.seriesFormatInferred) return game;
    const size = lengths.get(game.gameId) ?? 1;
    return { ...game, seriesFormat: inferSeriesFormat(size), seriesFormatInferred: true };
  });
}

function buildStats(
  rowsParsed: number,
  gamesBuilt: number,
  games: Game[],
  extra: {
    rejectedByCompetition: number;
    rejectedIncomplete: number;
    warnings: IngestWarning[];
  },
): DatasetStats {
  const perCompetition: Record<string, number> = {};
  const patches = new Set<string>();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const game of games) {
    perCompetition[game.competition] = (perCompetition[game.competition] ?? 0) + 1;
    if (game.patch) patches.add(game.patch);
    const time = Date.parse(game.date);
    if (Number.isFinite(time)) {
      if (time < min) min = time;
      if (time > max) max = time;
    }
  }

  return {
    rowsParsed,
    gamesBuilt,
    gamesKept: games.length,
    rejectedByCompetition: extra.rejectedByCompetition,
    rejectedIncomplete: extra.rejectedIncomplete,
    perCompetition,
    patches: [...patches].sort(comparePatches),
    dateRange:
      games.length && Number.isFinite(min) && Number.isFinite(max)
        ? { from: new Date(min).toISOString(), to: new Date(max).toISOString() }
        : null,
    warnings: extra.warnings,
  };
}

/** Newest patch first: `14.10` sorts above `14.9`, `9.24` below `14.1`. */
export function comparePatches(a: string, b: string): number {
  const parse = (value: string): [number, number] => {
    const match = value.match(/(\d+)\D+(\d+)/);
    return match ? [Number(match[1]), Number(match[2])] : [0, 0];
  };
  const [aMajor, aMinor] = parse(a);
  const [bMajor, bMinor] = parse(b);
  return bMajor - aMajor || bMinor - aMinor;
}
