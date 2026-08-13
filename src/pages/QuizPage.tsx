import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DraftBoard } from '../components/draft/DraftBoard.tsx';
import { GameContextBar } from '../components/GameContextBar.tsx';
import { PatchMetaPanel } from '../components/meta/PatchMetaPanel.tsx';
import { Countdown } from '../components/quiz/Countdown.tsx';
import { PredictionBar } from '../components/quiz/PredictionBar.tsx';
import { toPrompt, type Side } from '../domain/types.ts';
import { formatScore, formatSeconds } from '../lib/format.ts';
import { QUESTION_TIME_MS } from '../quiz/scoring.ts';
import { currentGame } from '../quiz/session.ts';
import { useDataset } from '../state/DatasetContext.tsx';
import { useQuiz } from '../state/QuizContext.tsx';

/** How long the reveal stays up before the next question auto-starts. */
const REVEAL_MS = 2600;

export function QuizPage() {
  const navigate = useNavigate();
  const { metaIndex } = useDataset();
  const { state, answer, next } = useQuiz();

  // `performance.now()` at the moment the live question became answerable.
  const [questionStart, setQuestionStart] = useState(() => performance.now());
  const answeredRef = useRef(false);

  const index = state?.index ?? 0;
  const phase = state?.phase ?? 'question';

  // Restart the clock whenever a new question goes live.
  useEffect(() => {
    if (phase !== 'question') return;
    answeredRef.current = false;
    setQuestionStart(performance.now());
  }, [index, phase]);

  const submit = useCallback(
    (prediction: Side | null) => {
      if (answeredRef.current) return;
      answeredRef.current = true;
      answer(prediction, performance.now() - questionStart);
    },
    [answer, questionStart],
  );

  // Auto-advance after the reveal, with a manual override on the button.
  useEffect(() => {
    if (phase !== 'reveal') return;
    const timer = setTimeout(next, REVEAL_MS);
    return () => clearTimeout(timer);
  }, [phase, index, next]);

  useEffect(() => {
    if (state?.phase === 'finished') navigate('/results', { replace: true });
  }, [state?.phase, navigate]);

  // Keyboard: B/← for blue, R/→ for red, Space/Enter to skip the reveal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (phase === 'question') {
        if (key === 'b' || key === 'arrowleft') {
          event.preventDefault();
          submit('blue');
        } else if (key === 'r' || key === 'arrowright') {
          event.preventDefault();
          submit('red');
        }
      } else if (phase === 'reveal' && (key === ' ' || key === 'enter')) {
        event.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, submit, next]);

  if (!state) {
    return (
      <div className="page">
        <div className="empty-state panel panel-pad">
          <h2>No quiz in progress</h2>
          <p>Pick a source and a length, and the first draft goes live immediately.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/setup')}>
            Set up a quiz
          </button>
        </div>
      </div>
    );
  }

  const game = currentGame(state);
  if (!game) return null;

  const revealed = phase === 'reveal';
  const lastAnswer = revealed ? state.answers[state.answers.length - 1] : null;
  const progress = ((state.index + (revealed ? 1 : 0)) / state.games.length) * 100;

  return (
    <div className="page quiz-page">
      <div className="quiz-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>

      <header className="quiz-hud">
        <div className="hud-group">
          <div className="stat">
            <span className="stat-label">Question</span>
            <span className="stat-value">
              {state.index + 1}
              <span className="hud-total">/{state.games.length}</span>
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Score</span>
            <span className="stat-value">{formatScore(state.totalScore)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Streak</span>
            <span className="stat-value">
              {state.streak}
              {state.streak >= 3 && <span className="hud-fire"> 🔥</span>}
            </span>
          </div>
        </div>

        <div className="hud-timer">
          <Countdown
            key={`${state.index}-${questionStart}`}
            startedAt={questionStart}
            durationMs={QUESTION_TIME_MS}
            frozen={revealed}
            onExpire={() => submit(null)}
          />
          <p className="hud-prompt">
            {revealed ? 'Next question incoming…' : 'Call the winner before the clock hits zero'}
          </p>
        </div>
      </header>

      <GameContextBar game={toPrompt(game)} />

      <DraftBoard
        key={game.gameId}
        game={toPrompt(game)}
        winner={revealed ? game.winner : null}
      />

      <PredictionBar
        blueTeam={game.blue.teamName}
        redTeam={game.red.teamName}
        blueTag={game.blue.tag}
        redTag={game.red.tag}
        prediction={lastAnswer?.prediction ?? null}
        winner={revealed ? game.winner : null}
        disabled={revealed}
        onPredict={submit}
      />

      {revealed && lastAnswer && (
        <div className={`verdict verdict--${lastAnswer.outcome}`} role="status">
          <div className="verdict-main">
            <span className="verdict-label">
              {lastAnswer.outcome === 'correct'
                ? 'Correct call'
                : lastAnswer.outcome === 'incorrect'
                  ? 'Wrong call'
                  : 'Out of time'}
            </span>
            <span className="verdict-detail">
              {lastAnswer.outcome === 'timeout'
                ? `${game[game.winner].teamName} won this game.`
                : `${game[game.winner].teamName} won in ${formatSeconds(lastAnswer.responseMs)} of your clock.`}
            </span>
          </div>

          <div className="verdict-score">
            <span className="verdict-points num">+{lastAnswer.score.total}</span>
            {lastAnswer.outcome === 'correct' && (
              <span className="verdict-breakdown num">
                {lastAnswer.score.base} base + {lastAnswer.score.speedBonus} speed
                {lastAnswer.score.streakBonus > 0 && ` + ${lastAnswer.score.streakBonus} streak`}
              </span>
            )}
          </div>

          <button type="button" className="btn btn-sm" onClick={next}>
            {state.index + 1 >= state.games.length ? 'See results' : 'Next'} →
          </button>
        </div>
      )}

      <PatchMetaPanel metaIndex={metaIndex} patch={game.patch} competition={game.competition} />
    </div>
  );
}
