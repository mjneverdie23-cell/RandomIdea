/**
 * Single source of truth for which competitions are eligible.
 *
 * The quiz only ever uses LCK, LEC, LCS, LPL, LCP, Worlds, First Stand, MSI and
 * EWC.
 * Nothing else in the app hardcodes a league string: UI filters, quiz
 * generation and the import report all read this registry, so adding or
 * removing a competition is a one-file change.
 *
 * Oracle's Elixir writes the league as a short code that has drifted over the
 * years (`WLDs` vs `Worlds`, `NA LCS` vs `LCS`, ...), and third-party exports
 * re-case it freely. Matching is therefore done on a normalized form against a
 * list of aliases plus optional regex patterns, with an exclusion list that
 * keeps academy/development leagues out (`LCK CL`, `LDL`, `NACL`, ...).
 */

import type { CompetitionId } from './types.ts';

export interface CompetitionDefinition {
  id: CompetitionId;
  /** Full display name. */
  label: string;
  /** Compact label for chips and filters. */
  short: string;
  /** `league` / `region` for regional leagues, `international` for the rest. */
  scope: 'regional' | 'international';
  /** CSS color token used for accenting this competition in the UI. */
  accent: string;
  /**
   * Exact matches after normalization (uppercased, punctuation stripped,
   * whitespace collapsed).
   */
  aliases: string[];
  /** Extra patterns tested against the normalized league string. */
  patterns?: RegExp[];
}

/**
 * Normalized league strings that must never be treated as an eligible
 * competition, even if a competition's alias/pattern would otherwise match.
 * Academy, challenger and development leagues share prefixes with their
 * parent league, so they are rejected explicitly.
 */
const GLOBAL_EXCLUSIONS: RegExp[] = [
  /\bCL\b/, // LCK CL — Challengers League
  /\bACADEMY\b/,
  /\bCHALLENGERS?\b/,
  /\bAMATEUR\b/,
  /\bACADEMIA\b/,
  /^LDL$/, // LPL Development League
  /^NACL$/,
  /^LCKAS$/,
  /\bPROVING GROUNDS\b/,
  /\bSCOUTING GROUNDS\b/,
  /\bQUALIFIER(S)?\b/,
  /\bQUALIFYING\b/,
  /\bDEMACIA\b/, // Demacia Cup — not part of the LPL season
  /\bALL[- ]?STAR\b/,
  /\bSHOWMATCH\b/,
];

export const COMPETITIONS: CompetitionDefinition[] = [
  {
    id: 'LCK',
    label: 'LCK',
    short: 'LCK',
    scope: 'regional',
    accent: '#4f8dff',
    aliases: ['LCK', 'LCK KOREA', 'CHAMPIONS KOREA', 'LEAGUE OF LEGENDS CHAMPIONS KOREA'],
  },
  {
    id: 'LEC',
    label: 'LEC',
    short: 'LEC',
    scope: 'regional',
    accent: '#00c2a8',
    // `EU LCS` is the same competition before the 2019 rebrand; drop it from
    // this list if you only want post-rebrand games.
    aliases: ['LEC', 'EU LCS', 'EULCS', 'EUROPEAN CHAMPIONSHIP', 'LEAGUE OF LEGENDS EMEA CHAMPIONSHIP'],
  },
  {
    id: 'LCS',
    label: 'LCS',
    short: 'LCS',
    scope: 'regional',
    accent: '#ff8a3d',
    // `NA LCS` is the same competition before the 2019 rebrand.
    aliases: ['LCS', 'NA LCS', 'NALCS', 'LCS CHAMPIONSHIP', 'NORTH AMERICAN CHAMPIONSHIP'],
  },
  {
    id: 'LPL',
    label: 'LPL',
    short: 'LPL',
    scope: 'regional',
    accent: '#ff4d6d',
    aliases: ['LPL', 'LPL CHINA', 'TENCENT LPL', 'LEAGUE OF LEGENDS PRO LEAGUE'],
  },
  {
    id: 'LCP',
    label: 'LCP',
    short: 'LCP',
    scope: 'regional',
    accent: '#ff6ec7',
    // The Pacific league, formed in 2025 out of the PCS and LCO regions.
    //
    // PCS is deliberately NOT an alias. It still appears in current exports,
    // but as the tier-two league *below* LCP rather than as its old name: in
    // the 2026 file the LCP teams are CTBC Flying Oyster, GAM Esports and
    // DetonatioN FocusMe, while the PCS entries are Ground Zero Academy,
    // CTBC Flying Oyster Academy and SillySilly Gaming. Aliasing it would pull
    // 66 games of academy play into the model — the exact thing the exclusion
    // list exists to prevent. Anyone wanting pre-merger PCS games can add the
    // alias here, at the cost of also taking the current feeder league.
    aliases: ['LCP', 'CHAMPIONSHIP PACIFIC', 'LEAGUE OF LEGENDS CHAMPIONSHIP PACIFIC', 'LOL CHAMPIONSHIP PACIFIC'],
  },
  {
    id: 'WORLDS',
    label: 'World Championship',
    short: 'Worlds',
    scope: 'international',
    accent: '#f5c542',
    aliases: ['WLDS', 'WORLDS', 'WORLD CHAMPIONSHIP', 'WCS', 'LOL WORLDS'],
    patterns: [/^WORLD CHAMPIONSHIP( \d{4})?$/],
  },
  {
    id: 'MSI',
    label: 'Mid-Season Invitational',
    short: 'MSI',
    scope: 'international',
    accent: '#b06bff',
    aliases: ['MSI', 'MID SEASON INVITATIONAL', 'MIDSEASON INVITATIONAL'],
  },
  {
    id: 'FIRST_STAND',
    label: 'First Stand',
    short: 'First Stand',
    scope: 'international',
    accent: '#5ce1e6',
    aliases: ['FST', 'FIRST STAND', 'FIRST STAND TOURNAMENT', 'FIRSTSTAND'],
  },
  {
    id: 'EWC',
    label: 'Esports World Cup',
    short: 'EWC',
    scope: 'international',
    accent: '#7ce07c',
    aliases: ['EWC', 'ESPORTS WORLD CUP', 'ESPORT WORLD CUP', 'EWC LOL'],
  },
];

export const COMPETITION_BY_ID: Record<CompetitionId, CompetitionDefinition> = Object.fromEntries(
  COMPETITIONS.map((c) => [c.id, c]),
) as Record<CompetitionId, CompetitionDefinition>;

export const COMPETITION_IDS: CompetitionId[] = COMPETITIONS.map((c) => c.id);

/**
 * Uppercase, strip punctuation/diacritics, collapse whitespace.
 * `  lck-cl ` -> `LCK CL`, `Mid-Season Invitational` -> `MID SEASON INVITATIONAL`.
 */
export function normalizeLeagueString(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[._/\\|]+/g, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/[^A-Z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Season labels sometimes ride along in the league column (`LCK 2024 Summer`). */
function stripSeasonNoise(normalized: string): string {
  return normalized
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\b(SPRING|SUMMER|WINTER|AUTUMN|FALL|SEASON|SPLIT|ROTATION|STAGE|GROUPS?|MAIN EVENT|PLAY ?INS?|PLAYOFFS?|REGULAR)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const aliasIndex = new Map<string, CompetitionId>();
for (const comp of COMPETITIONS) {
  for (const alias of comp.aliases) {
    aliasIndex.set(normalizeLeagueString(alias), comp.id);
  }
}

/**
 * Map a raw league/tournament string onto an eligible competition.
 * Returns `null` for anything outside the configured competitions.
 */
export function resolveCompetition(rawLeague: string | null | undefined): CompetitionId | null {
  if (!rawLeague) return null;
  const normalized = normalizeLeagueString(rawLeague);
  if (!normalized) return null;
  if (GLOBAL_EXCLUSIONS.some((rx) => rx.test(normalized))) return null;

  const direct = aliasIndex.get(normalized);
  if (direct) return direct;

  const stripped = stripSeasonNoise(normalized);
  if (stripped && stripped !== normalized) {
    if (GLOBAL_EXCLUSIONS.some((rx) => rx.test(stripped))) return null;
    const viaStripped = aliasIndex.get(stripped);
    if (viaStripped) return viaStripped;
  }

  for (const comp of COMPETITIONS) {
    if (comp.patterns?.some((rx) => rx.test(normalized) || rx.test(stripped))) {
      return comp.id;
    }
  }
  return null;
}

export function isEligibleLeague(rawLeague: string | null | undefined): boolean {
  return resolveCompetition(rawLeague) !== null;
}

export function competitionLabel(id: CompetitionId): string {
  return COMPETITION_BY_ID[id]?.label ?? id;
}

export function competitionShort(id: CompetitionId): string {
  return COMPETITION_BY_ID[id]?.short ?? id;
}

export function competitionAccent(id: CompetitionId): string {
  return COMPETITION_BY_ID[id]?.accent ?? '#8aa0c8';
}
