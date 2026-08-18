/**
 * Predictor state.
 *
 * The model is derived from whichever seasons are switched on, and rebuilding
 * it is the expensive part (tens of milliseconds over a few thousand games),
 * so it is memoized against the game list and the ratings table. A single
 * prediction costs about two milliseconds, which is why the page recomputes on
 * every change instead of hiding behind a Predict button.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useDataset } from './DatasetContext.tsx';
import { buildPredictorModel, emptyPredictorModel, gamesBefore } from '../predictor/derive.ts';
import {
  RatingsParseError,
  bundledRatings,
  parseRatingsCsv,
  ratingsFromStored,
  ratingsToStored,
  type StoredRatings,
} from '../predictor/ratings.ts';
import {
  clearStoredRatings,
  loadStoredRatings,
  saveStoredRatings,
} from '../storage/ratingsStore.ts';
import {
  BLANK_DRAFT,
  clampScores,
  clearSavedDraft,
  clearSavedQueue,
  loadDraft,
  loadQueue,
  saveDraft,
  saveQueue,
  type PredictorDraft,
} from '../predictor/draft.ts';
import {
  MatchImportError,
  asOfInstant,
  matchToDraft,
  parseMatchText,
  type ImportedMatch,
} from '../predictor/matchImport.ts';
import type { PredictorModel } from '../predictor/types.ts';
import type { Game } from '../domain/types.ts';

/** A pasted list of matches, with a cursor for stepping through it. */
export interface MatchQueue {
  matches: ImportedMatch[];
  index: number;
  warnings: string[];
}

export interface MatchLoadReport {
  ok: boolean;
  message: string;
  detail?: string;
}

export interface RatingsImportReport {
  ok: boolean;
  message: string;
  detail?: string;
}

export interface PredictorContextValue {
  model: PredictorModel;
  /**
   * The composition in progress. Held here rather than in the page so that
   * navigating to another tab doesn't discard it.
   */
  draft: PredictorDraft;
  setDraft: (update: PredictorDraft | ((current: PredictorDraft) => PredictorDraft)) => void;
  resetDraft: () => void;
  /** Matches pasted for backtesting, or `null` when none are loaded. */
  queue: MatchQueue | null;
  /**
   * Instant the model is scoped to, or `null` when it uses every loaded game.
   * Set from the current queue match so a backtest cannot see its own future.
   */
  asOf: number | null;
  /** Whether to cut history at the current match's kickoff. */
  asOfEnabled: boolean;
  setAsOfEnabled: (enabled: boolean) => void;
  /** Games the scoped model was built from, against the total loaded. */
  scopedGameCount: number;
  /** Parse pasted text and fill the composer with its first match. */
  loadMatches: (text: string) => MatchLoadReport;
  /** Jump to a match in the queue and fill the composer with it. */
  goToMatch: (index: number) => void;
  clearQueue: () => void;
  /** The ratings in force — an imported file, or the table shipped with the app. */
  ratings: StoredRatings;
  ratingsStatus: 'loading' | 'ready';
  importRatings: (file: File) => Promise<RatingsImportReport>;
  clearRatings: () => Promise<void>;
}

const PredictorContext = createContext<PredictorContextValue | null>(null);

export function PredictorProvider({ children }: { children: ReactNode }) {
  const { dataset } = useDataset();
  const games = dataset?.games;
  const [ratings, setRatings] = useState<StoredRatings>(bundledRatings);
  const [ratingsStatus, setRatingsStatus] = useState<'loading' | 'ready'>('loading');
  // Read straight from storage on first render, so the page never paints a
  // blank board before a restore effect runs.
  const [draft, setDraftState] = useState<PredictorDraft>(loadDraft);

  const setDraft = useCallback(
    (update: PredictorDraft | ((current: PredictorDraft) => PredictorDraft)) => {
      setDraftState((current) => {
        const next = clampScores(typeof update === 'function' ? update(current) : update);
        saveDraft(next);
        return next;
      });
    },
    [],
  );

  const resetDraft = useCallback(() => {
    clearSavedDraft();
    setDraftState(BLANK_DRAFT);
  }, []);

  // Restored from the stored text, so a reader change can never resurrect a
  // stale parsed shape.
  const [queue, setQueue] = useState<MatchQueue | null>(() => {
    const stored = loadQueue();
    if (!stored) return null;
    try {
      const { matches, warnings } = parseMatchText(stored.text);
      return { matches, warnings, index: Math.min(stored.index, matches.length - 1) };
    } catch {
      return null;
    }
  });
  const [queueText, setQueueText] = useState<string>(() => loadQueue()?.text ?? '');

  const loadMatches = useCallback((text: string): MatchLoadReport => {
    try {
      const { matches, warnings } = parseMatchText(text);
      setQueue({ matches, warnings, index: 0 });
      setQueueText(text);
      saveQueue({ text, index: 0 });
      setDraftState(matchToDraft(matches[0]!));
      saveDraft(matchToDraft(matches[0]!));
      return {
        ok: true,
        message: `Loaded ${matches.length} match${matches.length === 1 ? '' : 'es'}.`,
        detail: warnings.length ? warnings.slice(0, 3).join(' ') : undefined,
      };
    } catch (error) {
      if (error instanceof MatchImportError) {
        return { ok: false, message: error.message, detail: error.detail };
      }
      return { ok: false, message: 'Could not read that text.' };
    }
  }, []);

  const goToMatch = useCallback(
    (index: number) => {
      setQueue((current) => {
        if (!current) return current;
        const bounded = Math.min(Math.max(0, index), current.matches.length - 1);
        const next = matchToDraft(current.matches[bounded]!);
        setDraftState(next);
        saveDraft(next);
        saveQueue({ text: queueText, index: bounded });
        return { ...current, index: bounded };
      });
    },
    [queueText],
  );

  const clearQueue = useCallback(() => {
    clearSavedQueue();
    setQueue(null);
    setQueueText('');
  }, []);

  const [asOfEnabled, setAsOfEnabled] = useState(true);

  const currentMatch = queue ? (queue.matches[queue.index] ?? null) : null;
  const asOf = asOfEnabled && currentMatch ? asOfInstant(currentMatch) : null;

  const scopedGames = useMemo<readonly Game[]>(() => {
    if (!games) return [];
    return asOf === null ? games : gamesBefore(games, asOf);
  }, [games, asOf]);

  /**
   * Models keyed by cutoff, so stepping through a queue doesn't rebuild for
   * every click. A backtest walks forward through games that often share a day,
   * and revisiting one should be instant; the cache is cleared whenever the
   * underlying games or ratings change, which is what makes it safe to hold.
   */
  const modelCache = useRef(new Map<string, PredictorModel>());
  useEffect(() => {
    modelCache.current.clear();
  }, [games, ratings]);

  const model = useMemo<PredictorModel>(() => {
    if (scopedGames.length === 0) return emptyPredictorModel();
    const key = asOf === null ? 'all' : String(asOf);
    const cached = modelCache.current.get(key);
    if (cached) return cached;

    const built = buildPredictorModel(scopedGames, ratingsFromStored(ratings));
    // Bounded so a long backtest can't grow the cache without limit.
    if (modelCache.current.size >= 24) {
      const oldest = modelCache.current.keys().next().value;
      if (oldest !== undefined) modelCache.current.delete(oldest);
    }
    modelCache.current.set(key, built);
    return built;
  }, [scopedGames, asOf, ratings]);

  useEffect(() => {
    let cancelled = false;
    void loadStoredRatings().then((stored) => {
      if (cancelled) return;
      // An imported file wins; otherwise the shipped table stays in place.
      if (stored) setRatings(stored);
      setRatingsStatus('ready');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const importRatings = useCallback(async (file: File): Promise<RatingsImportReport> => {
    let text: string;
    try {
      text = await file.text();
    } catch {
      return { ok: false, message: `Could not read ${file.name}.` };
    }

    try {
      const parsed = parseRatingsCsv(text);
      if (parsed.teamsRead === 0) {
        return {
          ok: false,
          message: 'No ratings found in that file.',
          detail: parsed.warnings.join(' '),
        };
      }
      const stored = ratingsToStored(parsed.ratings, file.name);
      const persisted = await saveStoredRatings(stored);
      setRatings(stored);
      return {
        ok: true,
        message: `Loaded ratings for ${parsed.teamsRead} team${parsed.teamsRead === 1 ? '' : 's'}.`,
        detail: persisted
          ? undefined
          : 'Ratings could not be saved to browser storage, so they apply for this session only.',
      };
    } catch (error) {
      if (error instanceof RatingsParseError) {
        return { ok: false, message: error.message, detail: error.detail };
      }
      return { ok: false, message: `Could not parse ${file.name}.` };
    }
  }, []);

  /** Drop an imported file and fall back to the table shipped with the app. */
  const clearRatings = useCallback(async () => {
    await clearStoredRatings();
    setRatings(bundledRatings());
  }, []);

  const value = useMemo<PredictorContextValue>(
    () => ({
      model,
      draft,
      setDraft,
      resetDraft,
      queue,
      asOf,
      asOfEnabled,
      setAsOfEnabled,
      scopedGameCount: scopedGames.length,
      loadMatches,
      goToMatch,
      clearQueue,
      ratings,
      ratingsStatus,
      importRatings,
      clearRatings,
    }),
    [
      model,
      draft,
      setDraft,
      resetDraft,
      queue,
      asOf,
      asOfEnabled,
      scopedGames.length,
      loadMatches,
      goToMatch,
      clearQueue,
      ratings,
      ratingsStatus,
      importRatings,
      clearRatings,
    ],
  );

  return <PredictorContext.Provider value={value}>{children}</PredictorContext.Provider>;
}

export function usePredictor(): PredictorContextValue {
  const value = useContext(PredictorContext);
  if (!value) throw new Error('usePredictor must be used inside a PredictorProvider');
  return value;
}
