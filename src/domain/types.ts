/**
 * Core domain model.
 *
 * Everything downstream of ingestion (quiz generation, meta calculation, the
 * draft UI, scoring) speaks in these types only. Oracle's Elixir column names
 * never leak past `src/data/ingest.ts`.
 */

export type Side = 'blue' | 'red';

/** Canonical role slots, in standard draft/broadcast order. */
export const ROLES = ['top', 'jungle', 'mid', 'bot', 'support'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  top: 'Top',
  jungle: 'Jungle',
  mid: 'Mid',
  bot: 'Bot',
  support: 'Support',
};

/** Short label used under portraits where horizontal space is tight. */
export const ROLE_SHORT: Record<Role, string> = {
  top: 'TOP',
  jungle: 'JNG',
  mid: 'MID',
  bot: 'BOT',
  support: 'SUP',
};

/** A champion as referenced by the app: stable id + display name. */
export interface Champion {
  /** Normalized, asset-safe identifier, e.g. `Kaisa`, `MonkeyKing`. */
  id: string;
  /** Human-facing name as it appears in the source data, e.g. `Kai'Sa`. */
  name: string;
}

export interface PlayerSlot {
  role: Role;
  playerName: string;
  /** Oracle's Elixir `playerid`, when present. */
  playerId: string | null;
  champion: Champion;
}

export interface TeamSide {
  side: Side;
  teamName: string;
  /** Oracle's Elixir `teamid`, when present. */
  teamId: string | null;
  /** Short broadcast tag (`T1`, `G2`, ...) derived from the team name. */
  tag: string;
  players: PlayerSlot[];
  bans: Champion[];
  /**
   * Gold swing across the 10/15/20/25-minute marks, from this side's point of
   * view. `null` when the export omits those columns, and absent entirely on
   * games imported before this was captured — either way the predictor skips
   * its throw/comeback reads rather than guessing.
   */
  goldDiff?: GoldDiffTrack | null;
}

/** Gold lead (positive) or deficit (negative) at fixed minute marks. */
export interface GoldDiffTrack {
  /** Largest lead held at any checkpoint. */
  peak: number;
  /** Deepest deficit faced at any checkpoint. */
  trough: number;
}

/** Competition bucket the game belongs to. Ids are stable and used in URLs. */
export type CompetitionId =
  | 'LCK'
  | 'LEC'
  | 'LCS'
  | 'LPL'
  | 'WORLDS'
  | 'MSI'
  | 'FIRST_STAND'
  | 'EWC';

export type SeriesFormat = 'BO1' | 'BO3' | 'BO5' | 'UNKNOWN';

export type StageKind =
  | 'regular'
  | 'playin'
  | 'group'
  | 'playoffs'
  | 'quarterfinal'
  | 'semifinal'
  | 'final'
  | 'unknown';

export interface Stage {
  kind: StageKind;
  /** Display label, e.g. `Playoffs — Semifinal`, `Regular Season`. */
  label: string;
  /** True when the loser of the series is knocked out of the tournament. */
  elimination: boolean;
}

/** A fully normalized professional game, ready for the quiz. */
export interface Game {
  gameId: string;
  competition: CompetitionId;
  /** League/tournament string exactly as it appeared in the source data. */
  sourceLeague: string;
  /** Display name for the competition + split, e.g. `LCK 2024 Summer`. */
  tournamentLabel: string;
  season: string;
  split: string | null;
  /** ISO-8601 date string (UTC) of the game. */
  date: string;
  patch: string | null;
  stage: Stage;
  seriesFormat: SeriesFormat;
  /** Whether `seriesFormat` came from the data or was inferred from series length. */
  seriesFormatInferred: boolean;
  /** Game number within its series (1-indexed). */
  gameNumber: number;
  blue: TeamSide;
  red: TeamSide;
  /** The answer. Never rendered before the user submits. */
  winner: Side;
  /** Game length in seconds, when available. */
  durationSeconds: number | null;
  /** True when the row came from the bundled synthetic development dataset. */
  demo: boolean;
}

/** A `Game` with the winner stripped out — this is what the quiz screen renders. */
export type GamePrompt = Omit<Game, 'winner'>;

export function toPrompt(game: Game): GamePrompt {
  const { winner: _winner, ...rest } = game;
  return rest;
}

export interface Dataset {
  games: Game[];
  /** Where the games came from, for display + the demo-data banner. */
  source: DatasetSource;
  importedAt: string;
  stats: DatasetStats;
}

/**
 * One season's worth of imported games.
 *
 * Oracle's Elixir publishes a file per year, and players usually want several
 * of them loaded at once — so imports accumulate into per-year buckets rather
 * than replacing each other. Each year can be switched out of the quiz pool
 * without deleting it.
 */
export interface YearDataset {
  /** Four-digit season, e.g. `2024`. */
  year: string;
  /** File name(s) the games came from. */
  label: string;
  games: Game[];
  stats: DatasetStats;
  importedAt: string;
  /** Whether this year feeds the quiz pool. */
  enabled: boolean;
}

/** Per-year metadata without the games, for listings and index files. */
export interface YearSummary {
  year: string;
  label: string;
  games: number;
  importedAt: string;
  enabled: boolean;
  dateRange: { from: string; to: string } | null;
  perCompetition: Record<string, number>;
}

export interface DatasetSource {
  kind: 'demo' | 'csv';
  /** File names that were imported, or `Development dataset` for demo. */
  label: string;
}

export interface DatasetStats {
  rowsParsed: number;
  gamesBuilt: number;
  gamesKept: number;
  rejectedByCompetition: number;
  rejectedIncomplete: number;
  perCompetition: Record<string, number>;
  patches: string[];
  dateRange: { from: string; to: string } | null;
  /** Non-fatal problems worth surfacing in the import report. */
  warnings: IngestWarning[];
}

export interface IngestWarning {
  code:
    | 'missing_columns'
    | 'incomplete_game'
    | 'unknown_side'
    | 'no_winner'
    | 'duplicate_game'
    | 'bad_row';
  message: string;
  /** How many times this warning fired; identical warnings are collapsed. */
  count: number;
  sample?: string;
}
