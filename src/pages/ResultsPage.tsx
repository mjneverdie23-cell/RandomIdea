import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DraftBoard } from '../components/draft/DraftBoard.tsx';
import { GameContextBar } from '../components/GameContextBar.tsx';
import { competitionShort } from '../domain/competitions.ts';
import { toPrompt } from '../domain/types.ts';
import { leaderboardRepository } from '../leaderboard/repository.ts';
import { formatPercent, formatScore, formatSeconds } from '../lib/format.ts';
import { sourceKey, sourceLabel } from '../quiz/config.ts';
import { MAX_QUESTION_SCORE } from '../quiz/scoring.ts';
import { useQuiz } from '../state/QuizContext.tsx';
import { usePlayerName } from '../state/usePlayerName.ts';
import { useDataset } from '../state/DatasetContext.tsx';

export function ResultsPage() {
  const navigate = useNavigate();
  const { state, summary, reset, submitted, markSubmitted } = useQuiz();
  const { isDemo } = useDataset();
  const [name] = usePlayerName();
  const [saveError, setSaveError] = useState<string | null>(null);

  // Record the run exactly once, when the results screen first renders.
  // The ref does the real guarding: `submitted` is state, so it hasn't
  // updated yet when StrictMode immediately re-runs this effect on mount.
  const recordedRef = useRef(false);
  useEffect(() => {
    if (!state || !summary || submitted || recordedRef.current) return;
    recordedRef.current = true;
    markSubmitted();
    void leaderboardRepository
      .add({
        username: name,
        score: summary.totalScore,
        questionCount: summary.questionCount,
        accuracy: summary.accuracy,
        correct: summary.correct,
        incorrect: summary.incorrect,
        timeouts: summary.timeouts,
        bestStreak: summary.bestStreak,
        averageResponseMs: summary.averageResponseMs,
        sourceKey: sourceKey(state.config.source),
        sourceLabel: sourceLabel(state.config.source),
        date: new Date().toISOString(),
        seed: state.config.seed,
        demoData: isDemo,
      })
      .catch(() => setSaveError('Could not save this run to the leaderboard.'));
  }, [state, summary, submitted, markSubmitted, name, isDemo]);

  const reviewRows = useMemo(() => {
    if (!state) return [];
    return state.games.map((game, index) => ({ game, answer: state.answers[index] ?? null }));
  }, [state]);

  if (!state || !summary) {
    return (
      <div className="page">
        <div className="empty-state panel panel-pad">
          <h2>No finished run to show</h2>
          <p>Play a quiz and your breakdown lands here.</p>
          <Link className="btn btn-primary" to="/setup">
            Set up a quiz
          </Link>
        </div>
      </div>
    );
  }

  const playAgain = () => {
    reset();
    navigate('/setup');
  };

  return (
    <div className="page results-page">
      <section className={`results-hero panel rating-${summary.rating.tone}`}>
        <div className="results-hero-main">
          <p className="eyebrow">Final score</p>
          <p className="results-score num">{formatScore(summary.totalScore)}</p>
          <p className="results-max num dim">
            of {formatScore(summary.questionCount * MAX_QUESTION_SCORE)} possible ·{' '}
            {summary.efficiency}% efficiency
          </p>
          <p className="results-rating">{summary.rating.label}</p>
          <p className="dim">{summary.rating.blurb}</p>
        </div>

        <div className="results-hero-stats stat-grid">
          <Stat label="Accuracy" value={formatPercent(summary.accuracy)} />
          <Stat label="Correct" value={String(summary.correct)} tone="green" />
          <Stat label="Incorrect" value={String(summary.incorrect)} tone="red" />
          <Stat label="Timeouts" value={String(summary.timeouts)} tone="amber" />
          <Stat label="Avg answer" value={formatSeconds(summary.averageResponseMs)} />
          <Stat label="Fastest" value={formatSeconds(summary.fastestResponseMs)} />
          <Stat label="Best streak" value={String(summary.bestStreak)} />
          <Stat
            label="Best competition"
            value={
              summary.bestCompetition
                ? competitionShort(summary.bestCompetition.competition)
                : sourceLabel(state.config.source)
            }
            sub={
              summary.bestCompetition
                ? `${formatPercent(summary.bestCompetition.accuracy)} over ${summary.bestCompetition.questions}`
                : undefined
            }
          />
        </div>
      </section>

      {saveError && <p className="error-box">{saveError}</p>}

      <div className="results-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={playAgain}>
          Play again
        </button>
        <Link className="btn btn-lg" to="/leaderboard">
          View leaderboard
        </Link>
        <span className="dim results-seed num">
          Seed {state.config.seed} · {sourceLabel(state.config.source)} ·{' '}
          {summary.questionCount} questions
        </span>
      </div>

      {summary.byCompetition.length > 1 && (
        <section className="panel">
          <div className="panel-header">
            <h2>By competition</h2>
          </div>
          <div className="panel-pad breakdown-grid">
            {summary.byCompetition.map((entry) => (
              <div key={entry.competition} className="breakdown-row">
                <span className="breakdown-name">{competitionShort(entry.competition)}</span>
                <div className="breakdown-bar">
                  <span style={{ width: `${entry.accuracy}%` }} />
                </div>
                <span className="breakdown-value num">
                  {entry.correct}/{entry.questions} · {formatScore(entry.score)} pts
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <h2>Question review</h2>
          <span className="dim">Open a row to see the full draft</span>
        </div>
        <div className="review-list">
          {reviewRows.map(({ game, answer }, index) => {
            const outcome = answer?.outcome ?? 'timeout';
            return (
              <details key={game.gameId} className={`review-row review-row--${outcome}`}>
                <summary>
                  <span className="review-index num">{String(index + 1).padStart(2, '0')}</span>
                  <span className={`review-outcome review-outcome--${outcome}`}>
                    {outcome === 'correct' ? 'Correct' : outcome === 'incorrect' ? 'Wrong' : 'Timeout'}
                  </span>
                  <span className="review-matchup">
                    <span className="blue-text">{game.blue.teamName}</span>
                    <span className="dim"> vs </span>
                    <span className="red-text">{game.red.teamName}</span>
                  </span>
                  <span className="review-meta dim">
                    {competitionShort(game.competition)} · {game.patch ? `P${game.patch}` : 'no patch'}
                  </span>
                  <span className="review-call">
                    Winner <strong>{game.winner === 'blue' ? 'Blue' : 'Red'}</strong>
                    <span className="dim">
                      {' '}
                      · you said{' '}
                      {answer?.prediction ? (answer.prediction === 'blue' ? 'Blue' : 'Red') : '—'}
                    </span>
                  </span>
                  <span className="review-time num dim">{formatSeconds(answer?.responseMs ?? null)}</span>
                  <span className={`review-points num${(answer?.score.total ?? 0) > 0 ? ' is-positive' : ''}`}>
                    +{answer?.score.total ?? 0}
                  </span>
                </summary>
                <div className="review-detail">
                  <GameContextBar game={toPrompt(game)} />
                  <DraftBoard game={toPrompt(game)} winner={game.winner} compact />
                </div>
              </details>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'green' | 'red' | 'amber';
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value${tone ? ` tone-${tone}` : ''}`}>{value}</span>
      {sub && <span className="stat-sub dim">{sub}</span>}
    </div>
  );
}
