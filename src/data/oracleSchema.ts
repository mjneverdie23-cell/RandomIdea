/**
 * Oracle's Elixir CSV shape.
 *
 * This is the only module that knows the CSV's column names. It normalizes
 * headers (case, spacing and punctuation vary between exports and between
 * years) and exposes typed accessors, so `ingest.ts` can work with a stable
 * `RawRow` regardless of which yearly export was dropped in.
 *
 * Layout reminder: Oracle's Elixir writes 12 rows per game — 10 player rows
 * (`participantid` 1-10) followed by 2 team rows (`participantid` 100/200).
 * Bans live on the team rows; picks live on the player rows.
 */

import { GOLD_CHECKPOINTS, ROLES, type GoldCheckpoint, type Role, type Side } from '../domain/types.ts';

/** Header key after normalization: lowercased, alphanumerics only. */
export type ColumnKey = string;

export function normalizeHeader(header: string): ColumnKey {
  return header
    .replace(/^\ufeff/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Logical field -> accepted normalized header names, most-preferred first.
 * Extra aliases are cheap; add to this table rather than special-casing
 * downstream.
 */
export const COLUMN_ALIASES = {
  gameId: ['gameid', 'id', 'matchid', 'gameidentifier'],
  dataCompleteness: ['datacompleteness', 'completeness'],
  league: ['league', 'tournament', 'competition', 'event'],
  year: ['year', 'season'],
  split: ['split', 'phase'],
  playoffs: ['playoffs', 'isplayoffs', 'playoff'],
  date: ['date', 'gamedate', 'datetime'],
  gameNumber: ['game', 'gamenumber', 'gameinseries'],
  patch: ['patch', 'gameversion', 'version'],
  participantId: ['participantid', 'participant'],
  side: ['side', 'teamside'],
  position: ['position', 'role', 'lane'],
  playerName: ['playername', 'player', 'summonername', 'name'],
  playerId: ['playerid'],
  teamName: ['teamname', 'team'],
  teamId: ['teamid'],
  champion: ['champion', 'championname', 'pick', 'champ'],
  gameLength: ['gamelength', 'duration', 'gameduration', 'length'],
  result: ['result', 'win', 'winner', 'iswin'],
  /** Optional: some exports carry an explicit bracket round. */
  stage: ['stage', 'round', 'bracket', 'brackettype', 'gamestage'],
  /** Optional: some exports carry the series format directly. */
  seriesFormat: ['seriesformat', 'bestof', 'format', 'seriestype'],
  bans: ['ban1', 'ban2', 'ban3', 'ban4', 'ban5'],
  picks: ['pick1', 'pick2', 'pick3', 'pick4', 'pick5'],
  /**
   * Optional: gold difference at fixed minute marks, on the team rows.
   * The predictor reads these to tell a team that throws leads apart from one
   * that wins from behind; files without them simply lose those two reads.
   */
  goldDiff: ['golddiffat10', 'golddiffat15', 'golddiffat20', 'golddiffat25'],
} as const;

export type LogicalField = keyof typeof COLUMN_ALIASES;

/** Columns we keep in memory while streaming; everything else is dropped. */
const KEPT_COLUMNS: ReadonlySet<ColumnKey> = new Set(
  Object.values(COLUMN_ALIASES).flat().map(normalizeHeader),
);

export function isKeptColumn(header: ColumnKey): boolean {
  return KEPT_COLUMNS.has(header);
}

/** A CSV row reduced to the columns we care about, keyed by normalized header. */
export type RawRow = Record<ColumnKey, string>;

/**
 * Resolve which concrete header a logical field maps to for a given file.
 * Computed once per import from the header list.
 */
export type ColumnMap = Partial<Record<LogicalField, ColumnKey>> & {
  banColumns: ColumnKey[];
  pickColumns: ColumnKey[];
  /**
   * Gold-diff columns paired with the minute they describe. Keyed rather than
   * positional: a file missing `golddiffat20` would otherwise shift every later
   * value onto the wrong mark.
   */
  goldDiffColumns: { minute: GoldCheckpoint; column: ColumnKey }[];
};

/** Fields whose aliases are a list of sibling columns, not preference order. */
const MULTI_COLUMN_FIELDS = new Set<LogicalField>(['bans', 'picks', 'goldDiff']);

export function buildColumnMap(headers: string[]): ColumnMap {
  const present = new Set(headers.map(normalizeHeader));
  const map: ColumnMap = { banColumns: [], pickColumns: [], goldDiffColumns: [] };

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [
    LogicalField,
    readonly string[],
  ][]) {
    if (MULTI_COLUMN_FIELDS.has(field)) continue;
    const hit = aliases.map(normalizeHeader).find((alias) => present.has(alias));
    if (hit) map[field] = hit;
  }

  const columnsFor = (aliases: readonly string[]): ColumnKey[] =>
    aliases.map(normalizeHeader).filter((c) => present.has(c));

  map.banColumns = columnsFor(COLUMN_ALIASES.bans);
  map.pickColumns = columnsFor(COLUMN_ALIASES.picks);
  map.goldDiffColumns = GOLD_CHECKPOINTS.map((minute) => ({
    minute,
    column: normalizeHeader(`golddiffat${minute}`),
  })).filter((entry) => present.has(entry.column));
  return map;
}

/** Fields a file must have for ingestion to be possible at all. */
export const REQUIRED_FIELDS: LogicalField[] = ['gameId', 'league', 'champion', 'result'];

export function missingRequiredFields(map: ColumnMap): LogicalField[] {
  return REQUIRED_FIELDS.filter((field) => !map[field]);
}

/* ------------------------------------------------------------------ */
/* Value coercion                                                      */
/* ------------------------------------------------------------------ */

export function cell(row: RawRow, map: ColumnMap, field: LogicalField): string {
  const key = map[field];
  if (!key) return '';
  const value = row[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function cellNumber(row: RawRow, map: ColumnMap, field: LogicalField): number | null {
  const raw = cell(row, map, field);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function cellBoolean(row: RawRow, map: ColumnMap, field: LogicalField): boolean | null {
  const raw = cell(row, map, field).toLowerCase();
  if (!raw) return null;
  if (['1', 'true', 'yes', 'y', 'win', 'w'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'loss', 'l'].includes(raw)) return false;
  return null;
}

const POSITION_ALIASES: Record<string, Role> = {
  top: 'top',
  toplane: 'top',
  toplaner: 'top',
  t: 'top',
  jng: 'jungle',
  jgl: 'jungle',
  jungle: 'jungle',
  jungler: 'jungle',
  jg: 'jungle',
  mid: 'mid',
  middle: 'mid',
  midlane: 'mid',
  m: 'mid',
  bot: 'bot',
  bottom: 'bot',
  adc: 'bot',
  ad: 'bot',
  carry: 'bot',
  botlane: 'bot',
  sup: 'support',
  supp: 'support',
  support: 'support',
  utility: 'support',
  util: 'support',
  s: 'support',
};

export function parseRole(raw: string): Role | null {
  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  return POSITION_ALIASES[key] ?? null;
}

export function isTeamRow(row: RawRow, map: ColumnMap): boolean {
  const position = cell(row, map, 'position').toLowerCase();
  if (position === 'team' || position === 'teams') return true;
  const pid = cellNumber(row, map, 'participantId');
  return pid === 100 || pid === 200;
}

export function parseSide(row: RawRow, map: ColumnMap): Side | null {
  const raw = cell(row, map, 'side').toLowerCase();
  if (raw.startsWith('b')) return 'blue';
  if (raw.startsWith('r')) return 'red';

  // Fall back to participant id: 1-5 + 100 are blue, 6-10 + 200 are red.
  const pid = cellNumber(row, map, 'participantId');
  if (pid === null) return null;
  if (pid === 100) return 'blue';
  if (pid === 200) return 'red';
  if (pid >= 1 && pid <= 5) return 'blue';
  if (pid >= 6 && pid <= 10) return 'red';
  return null;
}

/** Role implied by participant id when the `position` column is unusable. */
export function roleFromParticipantId(pid: number | null): Role | null {
  if (pid === null) return null;
  const index = pid >= 1 && pid <= 5 ? pid - 1 : pid >= 6 && pid <= 10 ? pid - 6 : -1;
  return index >= 0 ? (ROLES[index] ?? null) : null;
}

/**
 * Oracle's Elixir dates look like `2024-01-17 08:31:14`. Return an ISO string,
 * or `null` when the value is unparseable.
 */
export function parseGameDate(raw: string): string | null {
  if (!raw) return null;
  const normalized = raw.trim().replace(' ', 'T');
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = new Date(withZone);
  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
  }
  return parsed.toISOString();
}

/**
 * Patches arrive as `14.01`, `14.1`, `14.01.1` or a full game version string.
 * Normalize to `major.minor` so meta aggregation buckets them together.
 */
export function normalizePatch(raw: string): string | null {
  if (!raw) return null;
  const match = raw.match(/(\d{1,2})\s*[.,]\s*(\d{1,2})/);
  if (!match) {
    const trimmed = raw.trim();
    return trimmed || null;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  return `${major}.${String(minor).padStart(2, '0')}`;
}
