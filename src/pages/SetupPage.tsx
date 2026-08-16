import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COMPETITIONS } from '../domain/competitions.ts';
import { formatCount } from '../lib/format.ts';
import {
  DEFAULT_MODE,
  DEFAULT_QUESTION_COUNT,
  MIXED_SOURCE,
  MODE_BLURB,
  MODE_LABEL,
  QUESTION_COUNTS,
  sourceKey,
  sourceLabel,
  type QuestionCount,
  type QuestionSource,
  type QuizMode,
} from '../quiz/config.ts';
import { availableFor, QuizGenerationError } from '../quiz/generator.ts';
import { randomSeed } from '../quiz/rng.ts';
import { QUESTION_TIME_MS, SCORING } from '../quiz/scoring.ts';
import { useDataset } from '../state/DatasetContext.tsx';
import { useQuiz } from '../state/QuizContext.tsx';
import { usePlayerName } from '../state/usePlayerName.ts';

export function SetupPage() {
  const navigate = useNavigate();
  const { dataset, availability, isDemo } = useDataset();
  const { start } = useQuiz();
  const [name, setName] = usePlayerName();

  const [source, setSource] = useState<QuestionSource>(MIXED_SOURCE);
  const [questionCount, setQuestionCount] = useState<QuestionCount>(DEFAULT_QUESTION_COUNT);
  const [mode, setMode] = useState<QuizMode>(DEFAULT_MODE);
  const [seed, setSeed] = useState(randomSeed);
  const [error, setError] = useState<string | null>(null);

  const poolSize = availableFor(availability, source);
  const canStart = poolSize >= questionCount;

  const competitionRows = useMemo(
    () =>
      COMPETITIONS.map((competition) => ({
        ...competition,
        count: availability.perCompetition[competition.id],
      })),
    [availability],
  );

  const handleStart = () => {
    setError(null);
    try {
      start(dataset?.games ?? [], { source, questionCount, mode, seed });
      navigate('/quiz');
    } catch (cause) {
      setError(
        cause instanceof QuizGenerationError
          ? cause.message
          : 'Could not build a quiz from the loaded data.',
      );
    }
  };

  /** Selecting a source with a small pool auto-trims the length to fit. */
  const chooseSource = (next: QuestionSource) => {
    setSource(next);
    const available = availableFor(availability, next);
    if (questionCount > available) {
      const fallback = [...QUESTION_COUNTS].reverse().find((count) => count <= available);
      if (fallback) setQuestionCount(fallback);
    }
  };

  return (
    <div className="page setup-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Quiz setup</p>
          <h1>Build your run</h1>
          <p className="page-sub">
            {QUESTION_TIME_MS / 1000} seconds a draft. Faster correct calls are worth more;
            timeouts are worth nothing.
          </p>
        </div>
        {isDemo && (
          <span className="badge badge-demo">
            Demo data — import a real Oracle’s Elixir CSV on the Data page
          </span>
        )}
      </header>

      <section className="panel setup-block">
        <div className="panel-header">
          <h2>1 · Question source</h2>
          <span className="dim">{formatCount(availability.total, 'eligible game')}</span>
        </div>
        <div className="panel-pad">
          <div className="chip-row">
            <button
              type="button"
              className={`chip${source.kind === 'mixed' ? ' is-active' : ''}`}
              aria-pressed={source.kind === 'mixed'}
              disabled={availability.total === 0}
              onClick={() => chooseSource(MIXED_SOURCE)}
            >
              Mixed — all competitions
              <span className="chip-count">{availability.total}</span>
            </button>
          </div>

          <div className="chip-row setup-competitions">
            {competitionRows.map((competition) => {
              const active =
                source.kind === 'single' && source.competition === competition.id;
              return (
                <button
                  key={competition.id}
                  type="button"
                  className={`chip${active ? ' is-active' : ''}`}
                  style={{ ['--chip-accent' as string]: competition.accent }}
                  aria-pressed={active}
                  disabled={competition.count === 0}
                  onClick={() =>
                    chooseSource({ kind: 'single', competition: competition.id })
                  }
                  title={
                    competition.count === 0
                      ? 'No games from this competition in the loaded dataset'
                      : `${competition.count} eligible games`
                  }
                >
                  {competition.short}
                  <span className="chip-count">{competition.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="panel setup-block">
        <div className="panel-header">
          <h2>2 · Question style</h2>
          <span className="dim">{MODE_BLURB[mode]}</span>
        </div>
        <div className="panel-pad">
          <div className="chip-row">
            {(['matchups', 'games'] as QuizMode[]).map((option) => (
              <button
                key={option}
                type="button"
                className={`chip chip-lg${mode === option ? ' is-active' : ''}`}
                style={{ ['--chip-accent' as string]: 'var(--violet)' }}
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
                title={MODE_BLURB[option]}
              >
                {MODE_LABEL[option]}
              </button>
            ))}
          </div>
          <p className="field-hint">
            {mode === 'matchups'
              ? 'A drawn series plays out in order — game 1 through the decider — with the series score shown as you go.'
              : 'Every question is an unrelated game, drawn from anywhere in the pool.'}
          </p>
        </div>
      </section>

      <section className="panel setup-block">
        <div className="panel-header">
          <h2>3 · Length</h2>
          <span className="dim">{sourceLabel(source)}</span>
        </div>
        <div className="panel-pad">
          <div className="chip-row">
            {QUESTION_COUNTS.map((count) => (
              <button
                key={count}
                type="button"
                className={`chip chip-lg${questionCount === count ? ' is-active' : ''}`}
                aria-pressed={questionCount === count}
                disabled={poolSize < count}
                onClick={() => setQuestionCount(count)}
                title={
                  poolSize < count
                    ? `Only ${poolSize} eligible games in ${sourceLabel(source)}`
                    : undefined
                }
              >
                {count} questions
              </button>
            ))}
          </div>
          {!canStart && (
            <p className="setup-warning">
              {sourceLabel(source)} only has {formatCount(poolSize, 'eligible game')}. Pick a
              shorter run or a different source.
            </p>
          )}
        </div>
      </section>

      <section className="panel setup-block">
        <div className="panel-header">
          <h2>4 · Identity</h2>
        </div>
        <div className="panel-pad setup-identity">
          <label className="field">
            <span className="stat-label">Leaderboard name</span>
            <input
              className="input"
              value={name}
              maxLength={24}
              onChange={(event) => setName(event.target.value)}
              placeholder="Summoner"
            />
          </label>
          <label className="field">
            <span className="stat-label">Quiz seed</span>
            <div className="seed-row">
              <input
                className="input num"
                value={seed}
                onChange={(event) => setSeed(event.target.value.toUpperCase().slice(0, 16))}
              />
              <button type="button" className="btn btn-sm" onClick={() => setSeed(randomSeed())}>
                Reroll
              </button>
            </div>
            <span className="field-hint">
              Same seed + same dataset = same questions, in the same order.
            </span>
          </label>
        </div>
      </section>

      {error && <p className="error-box">{error}</p>}

      <div className="setup-launch">
        <div className="setup-rules">
          <span className="eyebrow">Scoring</span>
          <p>
            <strong>{SCORING.base}</strong> for a correct call, plus up to{' '}
            <strong>{SCORING.maxSpeedBonus}</strong> speed bonus scaled by the time left on the{' '}
            {QUESTION_TIME_MS / 1000}s clock, plus <strong>{SCORING.streakBonusPerStep}</strong> per
            answer in your streak (max {SCORING.maxStreakBonus}). Wrong calls and timeouts score
            zero.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={!canStart}
          onClick={handleStart}
        >
          Start {questionCount}-question run ·{' '}
          {sourceKey(source) === 'MIXED' ? 'Mixed' : sourceLabel(source)} · {MODE_LABEL[mode]}
        </button>
      </div>
    </div>
  );
}
