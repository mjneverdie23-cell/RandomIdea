/**
 * Types for the plain-ESM LoL Esports helpers, so the tests in `src/` can
 * import the script's implementation and check it against the app's importer.
 */

export const API_BASE: string;
export const FEED_BASE: string;
export const API_KEY: string;

export interface League {
  name?: string;
  slug?: string;
}

export interface KnownTeam {
  name: string;
  tag: string | null;
  competition: string | null;
}

export interface MatchListing {
  matchId: string;
  startTime: string | null;
  state: string | null;
  blockName: string | null;
  league: League | null;
  bestOf: number | null;
  teams: { name: string; code: string | null; wins: number; outcome: string | null }[];
}

export interface EventDetails {
  matchId: string;
  league: League | null;
  blockName: string | null;
  bestOf: number | null;
  teams: { id: string; name: string; code: string | null; wins: number }[];
  games: { id: string; number: number; state: string; sides: Record<string, string> }[];
}

export interface DraftSide {
  teamId: string | null;
  picks: Partial<Record<'top' | 'jungle' | 'mid' | 'bot' | 'support', string>>;
  players: Partial<Record<'top' | 'jungle' | 'mid' | 'bot' | 'support', string>>;
}

export interface FeedDraft {
  patch: string | null;
  blue: DraftSide;
  red: DraftSide;
  live: {
    at: string | null;
    state: string | null;
    gold: [number | null, number | null];
    kills: [number | null, number | null];
    towers: [number | null, number | null];
  } | null;
}

export interface PasteMatch {
  id: string;
  date: string;
  competition: string | null;
  stage?: string;
  series?: string;
  game: number;
  score?: [number, number];
  blue: Record<string, string | null>;
  red: Record<string, string | null>;
}

export function nameKey(name: unknown): string;
export function championDisplayName(key: unknown): string;
export function competitionFor(league: League | null | undefined): string | null;
export function leagueMatches(league: League | null | undefined, filters: string[] | undefined): boolean;
export function teamsFromSeasons(seasons: unknown[]): KnownTeam[];
export function snapTeamName(
  name: string,
  code: string | null,
  known: KnownTeam[],
  aliases?: Record<string, string>,
): { name: string; via: 'alias' | 'exact' | 'spelling' | 'code' | 'partial' | null };
export function liveMatches(json: unknown, leagues?: string[]): MatchListing[];
export function recentMatches(json: unknown, leagues?: string[], limit?: number): MatchListing[];
export function readEventDetails(json: unknown): EventDetails | null;
export function chooseGame(details: EventDetails | null, number?: number | null): EventDetails['games'][number] | null;
export function readWindow(json: unknown, codes?: Record<string, string | null>): FeedDraft | null;
export function buildPasteMatch(args: {
  details: EventDetails;
  game: EventDetails['games'][number];
  draft: FeedDraft;
  startTime?: string | null;
  blockName?: string | null;
  known?: KnownTeam[];
  aliases?: Record<string, string>;
}): { match: PasteMatch; warnings: string[] };
export function pasteText(matches: PasteMatch[]): string;
