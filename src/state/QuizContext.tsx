import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';
import { generateQuiz } from '../quiz/generator.ts';
import {
  createQuizState,
  quizReducer,
  summarize,
  type QuizAction,
  type QuizState,
  type QuizSummary,
} from '../quiz/session.ts';
import type { QuizConfig } from '../quiz/config.ts';
import type { Game, Side } from '../domain/types.ts';

interface QuizContextValue {
  state: QuizState | null;
  summary: QuizSummary | null;
  /** Builds a quiz from the given games. Throws `QuizGenerationError`. */
  start: (games: readonly Game[], config: QuizConfig) => void;
  answer: (prediction: Side | null, responseMs: number) => void;
  next: () => void;
  reset: () => void;
  /** True once the run has been written to the leaderboard. */
  submitted: boolean;
  markSubmitted: () => void;
}

const QuizContext = createContext<QuizContextValue | null>(null);

type ReducerState = QuizState | null;
type ReducerAction = QuizAction | { type: 'init'; state: QuizState } | { type: 'reset' };

function reducer(state: ReducerState, action: ReducerAction): ReducerState {
  if (action.type === 'init') return action.state;
  if (action.type === 'reset') return null;
  return state ? quizReducer(state, action) : state;
}

export function QuizProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, null);
  const [submitted, setSubmitted] = useState(false);

  const start = useCallback((games: readonly Game[], config: QuizConfig) => {
    const generated = generateQuiz(games, config);
    setSubmitted(false);
    dispatch({ type: 'init', state: createQuizState(generated.config, generated.games) });
  }, []);

  const answer = useCallback((prediction: Side | null, responseMs: number) => {
    dispatch({ type: 'answer', prediction, responseMs });
  }, []);

  const next = useCallback(() => dispatch({ type: 'next' }), []);

  const reset = useCallback(() => {
    setSubmitted(false);
    dispatch({ type: 'reset' });
  }, []);

  const summary = useMemo(
    () => (state && state.phase === 'finished' ? summarize(state) : null),
    [state],
  );

  const value = useMemo<QuizContextValue>(
    () => ({
      state,
      summary,
      start,
      answer,
      next,
      reset,
      submitted,
      markSubmitted: () => setSubmitted(true),
    }),
    [state, summary, start, answer, next, reset, submitted],
  );

  return <QuizContext.Provider value={value}>{children}</QuizContext.Provider>;
}

export function useQuiz(): QuizContextValue {
  const context = useContext(QuizContext);
  if (!context) throw new Error('useQuiz must be used inside a <QuizProvider>.');
  return context;
}
