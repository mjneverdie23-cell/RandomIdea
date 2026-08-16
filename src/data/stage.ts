/**
 * Stage and series-format derivation.
 *
 * Oracle's Elixir does not ship a bracket-round column or a best-of column.
 * What it does ship is `split`, a `playoffs` flag and `game` (the game's index
 * within its series). Everything here is derived from those, plus an optional
 * explicit stage/format column when a richer export provides one.
 *
 * Derived values are flagged (`seriesFormatInferred`) so the UI can present
 * them honestly rather than as source truth.
 */

import type { SeriesFormat, Stage, StageKind } from '../domain/types.ts';

const STAGE_LABELS: Record<StageKind, string> = {
  regular: 'Regular Season',
  playin: 'Play-In',
  group: 'Group Stage',
  playoffs: 'Playoffs',
  quarterfinal: 'Quarterfinal',
  semifinal: 'Semifinal',
  final: 'Final',
  unknown: 'Unknown Stage',
};

/** Kinds where losing the series ends the team's run. */
const ELIMINATION_KINDS: ReadonlySet<StageKind> = new Set<StageKind>([
  'quarterfinal',
  'semifinal',
  'final',
]);

/**
 * Ordered patterns — first match wins. `Semi-final` and `Quarter-final` are
 * tested before `Final` because the hyphen creates a word boundary that would
 * otherwise let the generic pattern claim them.
 */
const STAGE_PATTERNS: [RegExp, StageKind][] = [
  [/\bsemi[\s-]?finals?\b|\bsemis?\b|\bsf\b|\bfinal\s*four\b/i, 'semifinal'],
  [/\bquarter[\s-]?finals?\b|\bquarters?\b|\bqf\b/i, 'quarterfinal'],
  [/\bgrand\s*finals?\b|\bfinals?\b/i, 'final'],
  [/\bplay[\s-]?in\b|\bplayins?\b/i, 'playin'],
  [/\bgroups?\b|\bswiss\b|\bround\s*robin\b|\bmain\s*event\b/i, 'group'],
  [/\bplay[\s-]?offs?\b|\bknockouts?\b|\bbracket\b|\belimination\b|\bgauntlet\b/i, 'playoffs'],
  [/\bregular\b|\bseason\b|\bsplit\b|\bweek\b/i, 'regular'],
];

export interface StageInput {
  /** Value of an explicit stage/round column, when the export has one. */
  stageRaw?: string | null;
  /** Oracle's Elixir `split` (`Spring`, `Summer`, `Main Event`, `Play-In`). */
  split?: string | null;
  /** Oracle's Elixir `playoffs` flag. */
  playoffs?: boolean | null;
}

/**
 * Best-effort stage classification.
 *
 * Precedence: an explicit stage column, then the split string, then the
 * playoffs flag. Regional splits (`Spring`, `Summer`) carry no stage
 * information of their own, so the flag decides.
 */
export function deriveStage({ stageRaw, split, playoffs }: StageInput): Stage {
  const explicit = stageRaw?.trim();
  if (explicit) {
    const kind = matchStageKind(explicit);
    if (kind) return makeStage(kind, explicit);
  }

  const splitText = split?.trim() ?? '';
  const fromSplit = splitText ? matchStageKind(splitText) : null;

  if (playoffs) {
    // `Play-In` + playoffs flag means the play-in knockout, not the group phase.
    const kind: StageKind =
      fromSplit && fromSplit !== 'regular' && fromSplit !== 'group' ? fromSplit : 'playoffs';
    const label =
      splitText && kind === 'playoffs' && !/play[\s-]?offs?/i.test(splitText)
        ? `${splitText} — Playoffs`
        : STAGE_LABELS[kind];
    return { kind, label, elimination: ELIMINATION_KINDS.has(kind) };
  }

  if (fromSplit && fromSplit !== 'regular') {
    return makeStage(fromSplit, splitText);
  }
  if (playoffs === false || fromSplit === 'regular') {
    return { kind: 'regular', label: STAGE_LABELS.regular, elimination: false };
  }
  return { kind: 'unknown', label: splitText || STAGE_LABELS.unknown, elimination: false };
}

function matchStageKind(text: string): StageKind | null {
  for (const [pattern, kind] of STAGE_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

function makeStage(kind: StageKind, rawLabel: string): Stage {
  const cleaned = rawLabel.replace(/\s+/g, ' ').trim();
  const canonical = STAGE_LABELS[kind];
  const looksCanonical = cleaned.toLowerCase() === canonical.toLowerCase();
  const label = !cleaned || looksCanonical ? canonical : `${canonical} — ${cleaned}`;
  return { kind, label, elimination: ELIMINATION_KINDS.has(kind) };
}

/* ------------------------------------------------------------------ */
/* Series format                                                       */
/* ------------------------------------------------------------------ */

export function parseSeriesFormat(raw: string | null | undefined): SeriesFormat | null {
  if (!raw) return null;
  const text = raw.toLowerCase().replace(/\s|-/g, '');
  if (/^(bo)?1$/.test(text) || text.includes('bestof1') || text === 'single') return 'BO1';
  if (/^(bo)?3$/.test(text) || text.includes('bestof3')) return 'BO3';
  if (/^(bo)?5$/.test(text) || text.includes('bestof5')) return 'BO5';
  if (/^(bo)?7$/.test(text) || text.includes('bestof7')) return 'BO5';
  return null;
}

/**
 * Infer a best-of from how many games the series actually contained.
 *
 * A sweep hides the true format (a 3-0 in a BO5 looks like a BO3), so this is
 * a floor, not a fact — callers mark it as inferred.
 */
export function inferSeriesFormat(gamesInSeries: number): SeriesFormat {
  if (gamesInSeries <= 0) return 'UNKNOWN';
  if (gamesInSeries === 1) return 'BO1';
  if (gamesInSeries <= 3) return 'BO3';
  return 'BO5';
}

export interface SeriesMember {
  gameId: string;
  /** Unordered pair of team names + tournament context. */
  seriesKey: string;
  gameNumber: number;
  /** Epoch ms, used to order games within a series. */
  timestamp: number;
}

/** Two games more than this far apart belong to different series. */
const SERIES_GAP_MS = 12 * 60 * 60 * 1000;

/**
 * Cut a flat list of games into series runs.
 *
 * Two teams meet many times per split, so a shared team pair is not enough.
 * Games are ordered by time inside a pair and cut into a new series whenever
 * the `game` counter stops increasing, or when more than 12 hours pass between
 * consecutive games.
 *
 * This is the single definition of "a series" — ingestion uses it to infer the
 * best-of, and quiz generation uses it to serve a matchup's games in order.
 */
export function partitionSeries<T extends SeriesMember>(members: readonly T[]): T[][] {
  const byKey = new Map<string, T[]>();
  for (const member of members) {
    const bucket = byKey.get(member.seriesKey);
    if (bucket) bucket.push(member);
    else byKey.set(member.seriesKey, [member]);
  }

  const runs: T[][] = [];
  for (const bucket of byKey.values()) {
    bucket.sort((a, b) => a.timestamp - b.timestamp || a.gameNumber - b.gameNumber);

    let current: T[] = [];
    let previous: T | null = null;
    for (const member of bucket) {
      const newSeries =
        previous !== null &&
        (member.gameNumber <= previous.gameNumber ||
          member.timestamp - previous.timestamp > SERIES_GAP_MS);
      if (newSeries && current.length) {
        runs.push(current);
        current = [];
      }
      current.push(member);
      previous = member;
    }
    if (current.length) runs.push(current);
  }
  return runs;
}

/** Each game's series length, keyed by game id. */
export function computeSeriesLengths(members: SeriesMember[]): Map<string, number> {
  const lengths = new Map<string, number>();
  for (const run of partitionSeries(members)) {
    // A sweep can leave fewer rows than the highest game number; trust the max.
    const size = Math.max(run.length, ...run.map((m) => m.gameNumber));
    for (const member of run) lengths.set(member.gameId, size);
  }
  return lengths;
}

/** Stable key for the unordered team pair inside a tournament context. */
export function makeSeriesKey(parts: {
  competition: string;
  season: string;
  split: string | null;
  playoffs: boolean | null;
  teamA: string;
  teamB: string;
}): string {
  const [a, b] = [parts.teamA, parts.teamB].sort();
  return [
    parts.competition,
    parts.season,
    parts.split ?? '',
    parts.playoffs ? 'po' : 'rs',
    a,
    b,
  ].join('|');
}
