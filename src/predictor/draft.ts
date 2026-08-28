/**
 * The composition the user is building on the Predictor page.
 *
 * This is deliberately separate from `PredictionInput`: it holds what the
 * *form* looks like, including half-filled lanes and a team that hasn't been
 * chosen yet, whereas `PredictionInput` is what gets handed to the engine.
 *
 * It lives in `PredictorContext` rather than in the page component, because a
 * page component unmounts the moment you navigate to another tab and its state
 * goes with it. Losing a ten-champion draft to a stray click on Leaderboard is
 * not acceptable, so the state sits above the router and is persisted — which
 * also means it survives a reload or a closed browser.
 *
 * Persistence goes through `tabScoped`, not `localStorage` directly. A draft is
 * a working document rather than shared reference data, and two browser tabs
 * following two simultaneous series must not overwrite each other; see that
 * module for what went wrong when they did.
 */

import { ROLES, type Champion, type CompetitionId, type StageKind } from '../domain/types.ts';
import { clearTabScoped, readTabScoped, writeTabScoped } from '../storage/tabScoped.ts';
import {
  SERIES_TARGET,
  type Motivation,
  type PredictionInput,
  type SeriesLength,
  type WinRequirement,
} from './types.ts';

export interface DraftSide {
  competition: CompetitionId | null;
  team: string | null;
  /** Five slots in role order; `null` means the lane is still empty. */
  champions: (Champion | null)[];
  motivation: Motivation;
}

export interface PredictorDraft {
  blue: DraftSide;
  red: DraftSide;
  stage: StageKind;
  seriesLength: SeriesLength;
  /** True once the user picks a series length themselves, freezing the suggestion. */
  seriesTouched: boolean;
  scoreBlue: number;
  scoreRed: number;
  /**
   * Game number stated outright, rather than inferred from the score.
   *
   * A pasted backtest match knows it is game 3 of a series but deliberately
   * carries no score, because in a best-of-three a 1-1 scoreline says who won
   * the first two games — exactly the result a backtest must not see. `null`
   * means "derive it from the score", which is what typing in the composer does.
   */
  gameNumber: number | null;
  winRequirement: WinRequirement;
}

export const BLANK_SIDE: DraftSide = {
  competition: null,
  team: null,
  champions: ROLES.map(() => null),
  motivation: 'normal',
};

export const BLANK_DRAFT: PredictorDraft = {
  blue: BLANK_SIDE,
  red: BLANK_SIDE,
  stage: 'regular',
  seriesLength: 'BO3',
  seriesTouched: false,
  scoreBlue: 0,
  scoreRed: 0,
  gameNumber: null,
  winRequirement: 'series',
};

/** Stated game number, else the one the series score implies; game 1 at 0-0. */
export function gameNumberOf(draft: PredictorDraft): number {
  if (draft.scoreBlue + draft.scoreRed > 0) return draft.scoreBlue + draft.scoreRed + 1;
  return draft.gameNumber ?? 1;
}

/**
 * The engine's view of a draft, or `null` while it is still missing a team.
 *
 * Shared by the page and the batch backtest on purpose: a backtest that scored
 * something subtly different from what the report shows for the same match
 * would be worse than no backtest at all.
 */
export function draftToPredictionInput(draft: PredictorDraft): PredictionInput | null {
  if (draft.blue.team === null || draft.red.team === null) return null;
  return {
    blue: {
      competition: draft.blue.competition,
      team: draft.blue.team,
      champions: draft.blue.champions,
      motivation: draft.blue.motivation,
    },
    red: {
      competition: draft.red.competition,
      team: draft.red.team,
      champions: draft.red.champions,
      motivation: draft.red.motivation,
    },
    stage: draft.stage,
    seriesLength: draft.seriesLength,
    gameNumber: gameNumberOf(draft),
    scoreBlue: draft.scoreBlue,
    scoreRed: draft.scoreRed,
    previousWinner: null,
    winRequirement: draft.winRequirement,
  };
}

/** Swap the two sides, carrying each team's score with it. */
export function swapDraftSides(draft: PredictorDraft): PredictorDraft {
  return {
    ...draft,
    blue: draft.red,
    red: draft.blue,
    scoreBlue: draft.scoreRed,
    scoreRed: draft.scoreBlue,
  };
}

/**
 * Clamp a score that a format change made impossible.
 *
 * Dropping from a best-of-five at 2-1 to a best-of-three would otherwise leave
 * a score that has already decided the series.
 */
export function clampScores(draft: PredictorDraft): PredictorDraft {
  const max = SERIES_TARGET[draft.seriesLength] - 1;
  if (draft.scoreBlue <= max && draft.scoreRed <= max) return draft;
  return {
    ...draft,
    scoreBlue: Math.min(draft.scoreBlue, max),
    scoreRed: Math.min(draft.scoreRed, max),
  };
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'predictor:draft:v1';
const QUEUE_KEY = 'predictor:queue:v1';

const SERIES_LENGTHS = new Set<string>(['BO1', 'BO3', 'BO5']);
const MOTIVATION_VALUES = new Set<string>([
  'normal',
  'must win',
  'nothing to play for',
  'tank incentive',
]);

function isChampion(value: unknown): value is Champion {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Champion).id === 'string' &&
    typeof (value as Champion).name === 'string'
  );
}

/**
 * Rebuild a side from stored JSON.
 *
 * Anything unrecognized is dropped rather than trusted — the stored blob
 * outlives app versions, and a malformed champion slot would otherwise crash
 * the picker on load.
 */
function reviveSide(raw: unknown): DraftSide {
  if (typeof raw !== 'object' || raw === null) return BLANK_SIDE;
  const side = raw as Partial<DraftSide>;

  const champions = ROLES.map((_role, index) => {
    const entry = Array.isArray(side.champions) ? side.champions[index] : null;
    return isChampion(entry) ? entry : null;
  });

  return {
    competition: typeof side.competition === 'string' ? (side.competition as CompetitionId) : null,
    team: typeof side.team === 'string' && side.team ? side.team : null,
    champions,
    motivation:
      typeof side.motivation === 'string' && MOTIVATION_VALUES.has(side.motivation)
        ? (side.motivation as Motivation)
        : 'normal',
  };
}

export function reviveDraft(raw: unknown): PredictorDraft {
  if (typeof raw !== 'object' || raw === null) return BLANK_DRAFT;
  const draft = raw as Partial<PredictorDraft>;

  const seriesLength =
    typeof draft.seriesLength === 'string' && SERIES_LENGTHS.has(draft.seriesLength)
      ? (draft.seriesLength as SeriesLength)
      : 'BO3';

  const clampScore = (value: unknown): number => {
    const max = SERIES_TARGET[seriesLength] - 1;
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(Math.max(0, Math.floor(value)), max)
      : 0;
  };

  return {
    blue: reviveSide(draft.blue),
    red: reviveSide(draft.red),
    stage: typeof draft.stage === 'string' ? (draft.stage as StageKind) : 'regular',
    seriesLength,
    seriesTouched: draft.seriesTouched === true,
    scoreBlue: clampScore(draft.scoreBlue),
    scoreRed: clampScore(draft.scoreRed),
    gameNumber:
      typeof draft.gameNumber === 'number' && draft.gameNumber >= 1
        ? Math.floor(draft.gameNumber)
        : null,
    winRequirement: draft.winRequirement === 'sweep' ? 'sweep' : 'series',
  };
}

export function loadDraft(): PredictorDraft {
  try {
    const raw = readTabScoped(STORAGE_KEY);
    if (!raw) return BLANK_DRAFT;
    return reviveDraft(JSON.parse(raw));
  } catch {
    // Private browsing, a full quota, or a corrupt blob — start clean.
    return BLANK_DRAFT;
  }
}

export function saveDraft(draft: PredictorDraft): void {
  writeTabScoped(STORAGE_KEY, JSON.stringify(draft));
}

export function clearSavedDraft(): void {
  clearTabScoped(STORAGE_KEY);
}

/* ------------------------------------------------------------------ */
/* Backtest queue                                                      */
/* ------------------------------------------------------------------ */

/**
 * A pasted list of matches to step through.
 *
 * Only the raw text and the cursor are stored, never the parsed matches: the
 * text is the thing the user actually owns, it is a fraction of the size, and
 * re-parsing it on load means a change to the reader can never leave a stale
 * shape sitting in storage.
 */
export interface StoredQueue {
  text: string;
  index: number;
}

export function loadQueue(): StoredQueue | null {
  try {
    const raw = readTabScoped(QUEUE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { text, index } = parsed as Partial<StoredQueue>;
    if (typeof text !== 'string' || !text.trim()) return null;
    return { text, index: typeof index === 'number' && index >= 0 ? Math.floor(index) : 0 };
  } catch {
    return null;
  }
}

export function saveQueue(queue: StoredQueue): void {
  writeTabScoped(QUEUE_KEY, JSON.stringify(queue));
}

export function clearSavedQueue(): void {
  clearTabScoped(QUEUE_KEY);
}
