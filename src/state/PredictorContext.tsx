/**
 * Predictor state.
 *
 * The model is derived from whichever seasons are switched on, and rebuilding
 * it is the expensive part (tens of milliseconds over a few thousand games),
 * so it is memoized against the game list and the ratings table. A single
 * prediction costs about two milliseconds, which is why the page recomputes on
 * every change instead of hiding behind a Predict button.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDataset } from './DatasetContext.tsx';
import { buildPredictorModel, emptyPredictorModel } from '../predictor/derive.ts';
import {
  RatingsParseError,
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
  loadDraft,
  saveDraft,
  type PredictorDraft,
} from '../predictor/draft.ts';
import type { PredictorModel } from '../predictor/types.ts';

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
  /** Metadata for the loaded ratings file, or `null` when none is loaded. */
  ratings: StoredRatings | null;
  ratingsStatus: 'loading' | 'ready';
  importRatings: (file: File) => Promise<RatingsImportReport>;
  clearRatings: () => Promise<void>;
}

const PredictorContext = createContext<PredictorContextValue | null>(null);

export function PredictorProvider({ children }: { children: ReactNode }) {
  const { dataset } = useDataset();
  const [ratings, setRatings] = useState<StoredRatings | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    void loadStoredRatings().then((stored) => {
      if (cancelled) return;
      setRatings(stored);
      setRatingsStatus('ready');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const games = dataset?.games;

  const model = useMemo<PredictorModel>(() => {
    if (!games || games.length === 0) return emptyPredictorModel();
    return buildPredictorModel(games, ratingsFromStored(ratings));
  }, [games, ratings]);

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

  const clearRatings = useCallback(async () => {
    await clearStoredRatings();
    setRatings(null);
  }, []);

  const value = useMemo<PredictorContextValue>(
    () => ({
      model,
      draft,
      setDraft,
      resetDraft,
      ratings,
      ratingsStatus,
      importRatings,
      clearRatings,
    }),
    [model, draft, setDraft, resetDraft, ratings, ratingsStatus, importRatings, clearRatings],
  );

  return <PredictorContext.Provider value={value}>{children}</PredictorContext.Provider>;
}

export function usePredictor(): PredictorContextValue {
  const value = useContext(PredictorContext);
  if (!value) throw new Error('usePredictor must be used inside a PredictorProvider');
  return value;
}
