/**
 * Paste a matchup (or a whole backtest queue) as text and fill the composer.
 *
 * Selecting two teams and ten champions by hand takes about a minute. Checking
 * the model against a season's worth of games at that rate is not work anyone
 * will actually do, so the Predictor accepts the same information as pasted
 * text: one match, or a list of them to step through.
 *
 * The format is JSON-shaped and read leniently — unquoted keys, single quotes,
 * trailing commas and `//` comments all parse — because the point is to be
 * pasteable from a script, a spreadsheet export, or a hand-typed note without
 * anyone having to think about strict syntax.
 *
 * Deliberately no winner field: this fills in what a predictor would know
 * before the game, and nothing that would let a backtest mark its own homework.
 */

import { resolveCompetition } from '../domain/competitions.ts';
import { parseRole } from '../data/oracleSchema.ts';
import { makeChampion } from '../domain/champions.ts';
import { ROLES, type Champion, type CompetitionId, type Role, type StageKind } from '../domain/types.ts';
import { BLANK_DRAFT, clampScores, type DraftSide, type PredictorDraft } from './draft.ts';
import { SERIES_TARGET, type Motivation, type SeriesLength } from './types.ts';

export class MatchImportError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'MatchImportError';
  }
}

/** One matchup, in the shape the paste box accepts. */
export interface ImportedMatch {
  /** Free-text label for the queue, e.g. an Oracle's Elixir game id. */
  id: string | null;
  date: string | null;
  competition: CompetitionId | null;
  /** Competition string as pasted, kept when it doesn't resolve. */
  competitionRaw: string | null;
  stage: StageKind;
  seriesLength: SeriesLength;
  gameNumber: number;
  scoreBlue: number;
  scoreRed: number;
  blue: ImportedSide;
  red: ImportedSide;
}

export interface ImportedSide {
  team: string | null;
  champions: (Champion | null)[];
  motivation: Motivation;
}

export interface MatchImportResult {
  matches: ImportedMatch[];
  /** Non-fatal problems: unknown competition, missing lanes, and so on. */
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Lenient JSON                                                        */
/* ------------------------------------------------------------------ */

/**
 * Parse JSON, then retry with common hand-written slips repaired.
 *
 * The repair pass walks the text tracking whether it is inside a string, so
 * quoting a bare key or dropping a trailing comma can never corrupt a value
 * that happens to contain a brace or a comment marker.
 */
export function looseJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(repairJson(text));
  }
}

function repairJson(text: string): string {
  let out = '';
  let inString: '"' | "'" | null = null;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const next = text[i + 1];

    if (inString) {
      if (char === '\\') {
        out += char + (next ?? '');
        i += 1;
        continue;
      }
      if (char === inString) {
        // Single-quoted strings are re-emitted as double-quoted.
        out += '"';
        inString = null;
        continue;
      }
      // A double quote inside a single-quoted string has to be escaped now.
      out += char === '"' ? '\\"' : char;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = char;
      out += '"';
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }

    out += char;
  }

  return out
    // Quote bare keys: `{ top: "Aatrox" }` -> `{ "top": "Aatrox" }`.
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
    // Drop trailing commas before a closing brace or bracket.
    .replace(/,(\s*[}\]])/g, '$1');
}

/* ------------------------------------------------------------------ */
/* Field readers                                                       */
/* ------------------------------------------------------------------ */

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** First present key, compared case- and punctuation-insensitively. */
function pick(bag: Bag, ...names: string[]): unknown {
  const wanted = new Set(names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '')));
  for (const [key, value] of Object.entries(bag)) {
    if (wanted.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) return value;
  }
  return undefined;
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return null;
}

/**
 * Checked in order, so the narrow rounds win before the general ones — both
 * "semifinal" and "quarterfinal" end in "final", and every bracket round is
 * also a playoff.
 */
const STAGE_WORDS: [RegExp, StageKind][] = [
  [/semi/i, 'semifinal'],
  [/quarter|^qf$/i, 'quarterfinal'],
  [/play[\s_-]*in/i, 'playin'],
  [/final|grand/i, 'final'],
  [/playoff|bracket|knockout/i, 'playoffs'],
  [/group|swiss/i, 'group'],
  [/regular|season|split|round[\s_-]*robin/i, 'regular'],
];

export function parseStage(raw: string | null): StageKind {
  if (!raw) return 'regular';
  for (const [pattern, kind] of STAGE_WORDS) {
    if (pattern.test(raw)) return kind;
  }
  return 'regular';
}

export function parseSeriesLength(raw: unknown): SeriesLength | null {
  const text = asText(raw);
  if (!text) return null;
  const digits = text.match(/([135])/);
  if (!digits) return null;
  return (`BO${digits[1]}` as SeriesLength) satisfies SeriesLength;
}

const MOTIVATIONS = new Set<string>([
  'normal',
  'must win',
  'nothing to play for',
  'tank incentive',
]);

function parseMotivation(raw: unknown): Motivation {
  const text = asText(raw)?.toLowerCase().replace(/[_-]+/g, ' ');
  return text && MOTIVATIONS.has(text) ? (text as Motivation) : 'normal';
}

/* ------------------------------------------------------------------ */
/* One side                                                            */
/* ------------------------------------------------------------------ */

/**
 * Read one team's entry.
 *
 * Champions may be given per role (`{ top: "Aatrox", jng: "Viego" }`) or as a
 * plain list in draft order (`["Aatrox", "Viego", ...]`); both show up in
 * hand-written notes, so both are accepted.
 */
function readSide(raw: unknown, label: string, warnings: string[]): ImportedSide {
  const champions: (Champion | null)[] = ROLES.map(() => null);

  if (Array.isArray(raw)) {
    raw.slice(0, ROLES.length).forEach((entry, index) => {
      champions[index] = makeChampion(asText(entry) ?? '');
    });
    return { team: null, champions, motivation: 'normal' };
  }

  if (!isBag(raw)) {
    warnings.push(`${label}: no team entry found.`);
    return { team: null, champions, motivation: 'normal' };
  }

  const team = asText(pick(raw, 'team', 'teamName', 'name'));
  if (!team) warnings.push(`${label}: no team name.`);

  const picks = pick(raw, 'champions', 'picks', 'draft', 'comp');
  if (Array.isArray(picks)) {
    picks.slice(0, ROLES.length).forEach((entry, index) => {
      champions[index] = makeChampion(asText(entry) ?? '');
    });
  } else {
    const source = isBag(picks) ? picks : raw;
    for (const [key, value] of Object.entries(source)) {
      const role = parseRole(key);
      if (!role) continue;
      const name = asText(value);
      if (!name) continue;
      champions[ROLES.indexOf(role)] = makeChampion(name);
    }
  }

  const filled = champions.filter(Boolean).length;
  if (filled > 0 && filled < ROLES.length) {
    warnings.push(`${label}: only ${filled} of ${ROLES.length} lanes filled.`);
  }

  return { team, champions, motivation: parseMotivation(pick(raw, 'motivation', 'motiv')) };
}

/* ------------------------------------------------------------------ */
/* One match                                                           */
/* ------------------------------------------------------------------ */

function readMatch(raw: unknown, index: number, warnings: string[]): ImportedMatch | null {
  if (!isBag(raw)) {
    warnings.push(`Entry ${index + 1} is not a match object and was skipped.`);
    return null;
  }

  const competitionRaw = asText(pick(raw, 'competition', 'league', 'event', 'tournament'));
  const competition = resolveCompetition(competitionRaw);
  if (competitionRaw && !competition) {
    warnings.push(`Entry ${index + 1}: unrecognized competition "${competitionRaw}".`);
  }

  const label = (side: string) => `Entry ${index + 1} ${side}`;
  const blue = readSide(pick(raw, 'blue', 'blueSide', 'left'), label('blue'), warnings);
  const red = readSide(pick(raw, 'red', 'redSide', 'right'), label('red'), warnings);

  const seriesLength =
    parseSeriesLength(pick(raw, 'series', 'seriesLength', 'bestOf', 'format')) ?? 'BO3';
  const maxScore = SERIES_TARGET[seriesLength] - 1;

  const scoreRaw = pick(raw, 'score');
  let scoreBlue = 0;
  let scoreRed = 0;
  if (Array.isArray(scoreRaw)) {
    scoreBlue = asCount(scoreRaw[0]) ?? 0;
    scoreRed = asCount(scoreRaw[1]) ?? 0;
  } else if (isBag(scoreRaw)) {
    scoreBlue = asCount(pick(scoreRaw, 'blue')) ?? 0;
    scoreRed = asCount(pick(scoreRaw, 'red')) ?? 0;
  } else {
    scoreBlue = asCount(pick(raw, 'scoreBlue')) ?? 0;
    scoreRed = asCount(pick(raw, 'scoreRed')) ?? 0;
  }
  scoreBlue = Math.min(scoreBlue, maxScore);
  scoreRed = Math.min(scoreRed, maxScore);

  // The game number follows from the score; an explicit one only wins when no
  // score was given, since 2-1 cannot be game 1.
  const explicitGame = asCount(pick(raw, 'game', 'gameNumber'));
  const gameNumber =
    scoreBlue + scoreRed > 0 ? scoreBlue + scoreRed + 1 : Math.max(1, explicitGame ?? 1);

  return {
    id: asText(pick(raw, 'id', 'gameId', 'gameid')),
    date: asText(pick(raw, 'date', 'when')),
    competition,
    competitionRaw,
    stage: parseStage(asText(pick(raw, 'stage', 'round', 'phase'))),
    seriesLength,
    gameNumber,
    scoreBlue,
    scoreRed,
    blue,
    red,
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function parseMatchText(text: string): MatchImportResult {
  const trimmed = text.trim();
  if (!trimmed) throw new MatchImportError('Nothing to read — paste a match first.');

  let parsed: unknown;
  try {
    parsed = looseJsonParse(trimmed);
  } catch (cause) {
    throw new MatchImportError(
      'That text is not valid JSON.',
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  const list = Array.isArray(parsed)
    ? parsed
    : isBag(parsed)
      ? (() => {
          const inner = pick(parsed, 'matches', 'games', 'entries');
          return Array.isArray(inner) ? inner : [parsed];
        })()
      : null;

  if (!list) {
    throw new MatchImportError('Expected a match object, or a list of them.');
  }
  if (list.length === 0) {
    throw new MatchImportError('That list is empty — there are no matches to load.');
  }

  const warnings: string[] = [];
  const matches = list
    .map((entry, index) => readMatch(entry, index, warnings))
    .filter((match): match is ImportedMatch => match !== null);

  if (matches.length === 0) {
    throw new MatchImportError('No usable matches found.', warnings.join(' '));
  }

  return { matches, warnings };
}

/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */

function toDraftSide(side: ImportedSide, competition: CompetitionId | null): DraftSide {
  return {
    competition,
    team: side.team,
    champions: [...side.champions],
    motivation: side.motivation,
  };
}

/** Turn an imported match into the composer state that represents it. */
export function matchToDraft(match: ImportedMatch): PredictorDraft {
  return clampScores({
    ...BLANK_DRAFT,
    blue: toDraftSide(match.blue, match.competition),
    red: toDraftSide(match.red, match.competition),
    stage: match.stage,
    seriesLength: match.seriesLength,
    // The pasted format is authoritative, so the suggestion must not overwrite it.
    seriesTouched: true,
    scoreBlue: match.scoreBlue,
    scoreRed: match.scoreRed,
    gameNumber: match.gameNumber,
  });
}

/** One-line description for the queue navigator. */
export function describeMatch(match: ImportedMatch): string {
  const teams = `${match.blue.team ?? '—'} vs ${match.red.team ?? '—'}`;
  const parts = [teams];
  if (match.gameNumber > 1 || match.scoreBlue + match.scoreRed > 0) {
    parts.push(`G${match.gameNumber}`);
  }
  if (match.date) parts.push(match.date.slice(0, 10));
  return parts.join(' · ');
}

/** Which lanes reference a champion the loaded seasons have never seen. */
export function unknownChampions(
  match: ImportedMatch,
  known: ReadonlySet<string>,
): string[] {
  const missing: string[] = [];
  for (const side of [match.blue, match.red]) {
    for (const champion of side.champions) {
      if (champion && !known.has(champion.id)) missing.push(champion.name);
    }
  }
  return [...new Set(missing)];
}

/** Role order the paste format uses, for the help text. */
export const PASTE_ROLE_KEYS: Role[] = [...ROLES];
