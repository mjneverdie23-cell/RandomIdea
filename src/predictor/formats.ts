/**
 * Tournament format per competition.
 *
 * Used to pre-fill the series length when the user picks a competition and
 * stage; it is only a suggestion, and the control stays editable. Formats
 * change year to year, so treat this as a starting point to be corrected
 * against the current season rather than as fact.
 */

import type { CompetitionId, StageKind } from '../domain/types.ts';
import type { SeriesLength } from './types.ts';

export type BracketShape =
  | 'round_robin'
  | 'single_elim'
  | 'double_elim'
  | 'gauntlet'
  | 'swiss';

export interface FormatEntry {
  series: SeriesLength;
  bracket: BracketShape;
}

type StageTable = Partial<Record<StageKind, FormatEntry>>;

const DEFAULT_TABLE: StageTable = {
  regular: { series: 'BO3', bracket: 'round_robin' },
  group: { series: 'BO1', bracket: 'round_robin' },
  playin: { series: 'BO5', bracket: 'single_elim' },
  playoffs: { series: 'BO5', bracket: 'single_elim' },
  quarterfinal: { series: 'BO5', bracket: 'single_elim' },
  semifinal: { series: 'BO5', bracket: 'single_elim' },
  final: { series: 'BO5', bracket: 'single_elim' },
};

const TABLES: Partial<Record<CompetitionId, StageTable>> = {
  LCK: {
    regular: { series: 'BO3', bracket: 'round_robin' },
    playoffs: { series: 'BO5', bracket: 'double_elim' },
  },
  LPL: {
    regular: { series: 'BO3', bracket: 'round_robin' },
    playoffs: { series: 'BO5', bracket: 'double_elim' },
  },
  LEC: {
    regular: { series: 'BO3', bracket: 'round_robin' },
    playin: { series: 'BO5', bracket: 'single_elim' },
    playoffs: { series: 'BO5', bracket: 'double_elim' },
  },
  LCS: {
    regular: { series: 'BO3', bracket: 'round_robin' },
    playoffs: { series: 'BO5', bracket: 'double_elim' },
  },
  WORLDS: {
    group: { series: 'BO1', bracket: 'swiss' },
    playin: { series: 'BO5', bracket: 'double_elim' },
    playoffs: { series: 'BO5', bracket: 'single_elim' },
  },
  MSI: {
    group: { series: 'BO3', bracket: 'double_elim' },
    playoffs: { series: 'BO5', bracket: 'double_elim' },
  },
  FIRST_STAND: {
    group: { series: 'BO3', bracket: 'double_elim' },
    playoffs: { series: 'BO5', bracket: 'single_elim' },
  },
  EWC: {
    group: { series: 'BO1', bracket: 'round_robin' },
    playoffs: { series: 'BO5', bracket: 'single_elim' },
  },
};

export function formatFor(
  competition: CompetitionId | null,
  stage: StageKind,
): FormatEntry {
  const table = competition ? TABLES[competition] : undefined;
  return (
    table?.[stage] ??
    DEFAULT_TABLE[stage] ?? { series: 'BO3', bracket: 'round_robin' }
  );
}

export const BRACKET_LABEL: Record<BracketShape, string> = {
  round_robin: 'round robin',
  single_elim: 'single elimination',
  double_elim: 'double elimination',
  gauntlet: 'gauntlet',
  swiss: 'Swiss',
};

/** Stages a user can compose a prediction for, in tournament order. */
export const PREDICTABLE_STAGES: StageKind[] = [
  'regular',
  'group',
  'playin',
  'playoffs',
  'quarterfinal',
  'semifinal',
  'final',
];

export const STAGE_LABEL: Record<StageKind, string> = {
  regular: 'Regular season',
  group: 'Group stage',
  playin: 'Play-in',
  playoffs: 'Playoffs',
  quarterfinal: 'Quarterfinal',
  semifinal: 'Semifinal',
  final: 'Final',
  unknown: 'Unknown',
};
