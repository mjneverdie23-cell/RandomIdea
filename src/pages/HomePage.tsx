import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DraftBoard } from '../components/draft/DraftBoard.tsx';
import { GameContextBar } from '../components/GameContextBar.tsx';
import { COMPETITIONS, competitionShort } from '../domain/competitions.ts';
import { toPrompt } from '../domain/types.ts';
import { leaderboardRepository, personalBest, rankEntries } from '../leaderboard/repository.ts';
import type { LeaderboardEntry } from '../leaderboard/repository.ts';
import { formatCount, formatDate, formatPercent, formatScore } from '../lib/format.ts';
import { MIXED_SOURCE, type QuestionCount } from '../quiz/config.ts';
import { eligibleGames } from '../quiz/generator.ts';
import { createRng, randomSeed } from '../quiz/rng.ts';
import { MAX_QUESTION_SCORE, QUESTION_TIME_MS } from '../quiz/scoring.ts';
import { useDataset } from '../state/DatasetContext.tsx';
import { useQuiz } from '../state/QuizContext.tsx';
import { usePlayerName } from '../state/usePlayerName.ts';

export function HomePage() {
  const navigate = useNavigate();
  const { dataset, availability, isDemo } = useDataset();
  const { start } = useQuiz();
  const [name] = usePlayerName();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    void leaderboardRepository.list().then(setEntries);
  }, []);

  // One random eligible draft as a hero preview — winner never rendered.
  const featured = useMemo(() => {
    const pool = eligibleGames(dataset?.games ?? []);
    return createRng(`featured-${dataset?.importedAt ?? 'none'}`).pick(pool) ?? null;
  }, [dataset]);

  const best = useMemo(() => personalBest(entries, name), [entries, name]);
  const topRun = useMemo(() => rankEntries(entries)[0] ?? null, [entries]);

  const quickStart = (questionCount: QuestionCount) => {
    start(dataset?.games ?? [], {
      source: MIXED_SOURCE,
      questionCount,
      seed: randomSeed(),
    });
    navigate('/quiz');
  };

  const canQuickStart = (count: number) => availability.total >= count;

  return (
    <div className="page home-page">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Pro draft prediction</p>
          <h1 className="hero-title">
            Read the draft.
            <br />
            Call the winner.
          </h1>
          <p className="hero-sub">
            Real professional games from the LCK, LEC, LCS, LPL, Worlds, First Stand, MSI and EWC,
            served as whole matchups — game 1 through the decider. You get the bans, the picks, the
            rosters and the patch, and {QUESTION_TIME_MS / 1000} seconds to call it. Answer faster,
            score higher.
          </p>

          <div className="hero-actions">
            <Link className="btn btn-primary btn-lg" to="/setup">
              Configure a run
            </Link>
            <button
              type="button"
              className="btn btn-lg"
              disabled={!canQuickStart(10)}
              onClick={() => quickStart(10)}
            >
              Quick play · 10 mixed
            </button>
          </div>

          <dl className="hero-facts">
            <div>
              <dt>Games loaded</dt>
              <dd className="num">{availability.total.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Max per question</dt>
              <dd className="num">{MAX_QUESTION_SCORE}</dd>
            </div>
            <div>
              <dt>Clock</dt>
              <dd className="num">{QUESTION_TIME_MS / 1000}s</dd>
            </div>
          </dl>
        </div>

        <div className="hero-preview">
          {featured ? (
            <>
              <div className="hero-preview-head">
                <span className="eyebrow">Sample draft</span>
                <span className="dim">Winner hidden — this is what a question looks like</span>
              </div>
              <GameContextBar game={toPrompt(featured)} />
              <DraftBoard game={toPrompt(featured)} compact />
            </>
          ) : (
            <div className="empty-state">
              <p>No eligible games loaded yet.</p>
              <Link className="btn" to="/data">
                Import a CSV
              </Link>
            </div>
          )}
        </div>
      </section>

      {isDemo && (
        <section className="panel demo-callout">
          <div>
            <h2>You’re on synthetic demo data</h2>
            <p className="dim">
              These drafts and results are generated for development — recognizable teams and
              players, invented games. Drop an Oracle’s Elixir CSV on the Data page to play real
              matches.
            </p>
          </div>
          <Link className="btn btn-primary" to="/data">
            Import real data
          </Link>
        </section>
      )}

      <div className="home-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Quick start</h2>
            <span className="dim">Mixed competitions</span>
          </div>
          <div className="panel-pad quick-grid">
            {([10, 25, 50] as QuestionCount[]).map((count) => (
              <button
                key={count}
                type="button"
                className="quick-card"
                disabled={!canQuickStart(count)}
                onClick={() => quickStart(count)}
              >
                <span className="quick-count num">{count}</span>
                <span className="quick-label">questions</span>
                <span className="quick-max num dim">
                  up to {formatScore(count * MAX_QUESTION_SCORE)} pts
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Your best</h2>
            <Link className="dim" to="/leaderboard">
              Full board →
            </Link>
          </div>
          <div className="panel-pad">
            {best ? (
              <div className="best-run">
                <div className="stat">
                  <span className="stat-label">Best score</span>
                  <span className="stat-value">{formatScore(best.score)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Accuracy</span>
                  <span className="stat-value">{formatPercent(best.accuracy)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Run</span>
                  <span className="stat-value">{best.questionCount}</span>
                  <span className="stat-sub dim">{best.sourceLabel}</span>
                </div>
              </div>
            ) : (
              <p className="dim">
                No runs recorded for <strong>{name}</strong> yet. The first one sets the bar.
              </p>
            )}
            {topRun && (
              <p className="top-run dim">
                Board leader: <strong>{topRun.username}</strong> with{' '}
                <span className="num">{formatScore(topRun.score)}</span> ({topRun.questionCount}{' '}
                questions, {topRun.sourceLabel})
              </p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Loaded dataset</h2>
            <Link className="dim" to="/data">
              Manage →
            </Link>
          </div>
          <div className="panel-pad">
            <div className="comp-bars">
              {COMPETITIONS.map((competition) => {
                const count = availability.perCompetition[competition.id];
                const share = availability.total ? (count / availability.total) * 100 : 0;
                return (
                  <div key={competition.id} className="comp-bar">
                    <span className="comp-bar-name">{competitionShort(competition.id)}</span>
                    <div className="comp-bar-track">
                      <span
                        style={{
                          width: `${share}%`,
                          background: competition.accent,
                        }}
                      />
                    </div>
                    <span className="comp-bar-count num">{count.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
            {dataset?.stats.dateRange && (
              <p className="dim dataset-range">
                {formatDate(dataset.stats.dateRange.from)} – {formatDate(dataset.stats.dateRange.to)}{' '}
                · {formatCount(dataset.stats.patches.length, 'patch', 'patches')}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
