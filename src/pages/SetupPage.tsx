import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COMPETITIONS } from '../domain/competitions.ts';
import { formatCount } from '../lib/format.ts';
import {
  ALL_PERIOD,
  DEFAULT_MODE,
  DEFAULT_QUESTION_COUNT,
  MIXED_SOURCE,
  MODE_BLURB,
  MODE_LABEL,
  periodLabel,
  QUESTION_COUNTS,
  samePeriod,
  scopeLabel,
  sourceKey,
  sourceLabel,
  type QuestionCount,
  type QuestionSource,
  type QuizMode,
  type QuizPeriod,
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
  const [period, setPeriod] = useState<QuizPeriod>(ALL_PERIOD);
  const [questionCount, setQuestionCount] = useState<QuestionCount>(DEFAULT_QUESTION_COUNT);
  const [mode, setMode] = useState<QuizMode>(DEFAULT_MODE);
  const [seed, setSeed] = useState(randomSeed);
  const [error, setError] = useState<string | null>(null);

  const poolSize = availableFor(availability, source, period);
  const canStart = poolSize >= questionCount;
  const scope = scopeLabel(source, period);

  // Both axes restate each other: the competition counts reflect the chosen
  // season, and the season counts reflect the chosen competition.
  const competitionRows = useMemo(
    () =>
      COMPETITIONS.map((competition) => ({
        ...competition,
        count: availableFor(availability, { kind: 'single', competition: competition.id }, period),
        // All-time count, which decides whether the chip is selectable at all.
        // A competition with games somewhere stays clickable even when the
        // chosen split has none of them — otherwise picking `Split 1` would
        // lock the LCK out of the page with no way back.
        everCount: availability.perCompetition[competition.id],
      })),
    [availability, period],
  );

  const selectedYear = period.kind === 'all' ? null : period.year;
  /**
   * Splits the chosen source actually played that year.
   *
   * Every region names its splits differently — `Rounds 1-2`, `Split 1`,
   * `Winter` — so the unfiltered list across all leagues is long and mostly
   * irrelevant once a league is picked. Empty ones are dropped rather than
   * shown disabled.
   */
  const splitsForYear = useMemo(() => {
    if (selectedYear === null) return [];
    const all = availability.seasons.find((season) => season.year === selectedYear)?.splits ?? [];
    return all.filter(
      (split) => availableFor(availability, source, { kind: 'split', year: selectedYear, split }) > 0,
    );
  }, [availability, selectedYear, source]);

  const handleStart = () => {
    setError(null);
    try {
      start(dataset?.games ?? [], { source, period, questionCount, mode, seed });
      navigate('/quiz');
    } catch (cause) {
      setError(
        cause instanceof QuizGenerationError
          ? cause.message
          : 'Could not build a quiz from the loaded data.',
      );
    }
  };

  /** A narrower pool auto-trims the length to something that still fits. */
  const fitLength = (available: number) => {
    if (questionCount <= available) return;
    const fallback = [...QUESTION_COUNTS].reverse().find((count) => count <= available);
    if (fallback) setQuestionCount(fallback);
  };

  /**
   * Switching league can strand the split — the LCK never played a `Split 1`.
   * Fall back to the whole year rather than leaving an empty selection.
   */
  const chooseSource = (next: QuestionSource) => {
    setSource(next);
    let nextPeriod = period;
    if (period.kind === 'split' && availableFor(availability, next, period) === 0) {
      nextPeriod = { kind: 'year', year: period.year };
      if (availableFor(availability, next, nextPeriod) === 0) nextPeriod = ALL_PERIOD;
      setPeriod(nextPeriod);
    }
    fitLength(availableFor(availability, next, nextPeriod));
  };

  const choosePeriod = (next: QuizPeriod) => {
    setPeriod(next);
    fitLength(availableFor(availability, source, next));
  };

  /** Switching season keeps the split only when the new season also has it. */
  const chooseYear = (year: string) => {
    const splits = availability.seasons.find((season) => season.year === year)?.splits ?? [];
    const keep = period.kind === 'split' && splits.includes(period.split);
    choosePeriod(keep ? { kind: 'split', year, split: period.split } : { kind: 'year', year });
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
          <span className="dim">{formatCount(poolSize, 'eligible game')}</span>
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
              <span className="chip-count">{availableFor(availability, MIXED_SOURCE, period)}</span>
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
                  disabled={competition.everCount === 0}
                  onClick={() =>
                    chooseSource({ kind: 'single', competition: competition.id })
                  }
                  title={
                    competition.everCount === 0
                      ? 'No games from this competition in the loaded dataset'
                      : competition.count === 0
                        ? `No ${competition.short} games in ${periodLabel(period)} — picking it will widen the season`
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
          <h2>2 · Season</h2>
          <span className="dim">{periodLabel(period)}</span>
        </div>
        <div className="panel-pad">
          <div className="chip-row setup-competitions">
            <button
              type="button"
              className={`chip${period.kind === 'all' ? ' is-active' : ''}`}
              aria-pressed={period.kind === 'all'}
              disabled={availability.total === 0}
              onClick={() => choosePeriod(ALL_PERIOD)}
            >
              All seasons
              <span className="chip-count">{availableFor(availability, source, ALL_PERIOD)}</span>
            </button>
            {availability.seasons.map((season) => {
              const count = availableFor(availability, source, {
                kind: 'year',
                year: season.year,
              });
              return (
                <button
                  key={season.year}
                  type="button"
                  className={`chip${selectedYear === season.year ? ' is-active' : ''}`}
                  aria-pressed={selectedYear === season.year}
                  disabled={count === 0}
                  onClick={() => chooseYear(season.year)}
                  title={
                    count === 0
                      ? `No ${sourceLabel(source)} games from ${season.year}`
                      : `${count} eligible games`
                  }
                >
                  {season.year}
                  <span className="chip-count">{count}</span>
                </button>
              );
            })}
          </div>

          {selectedYear !== null && splitsForYear.length > 0 && (
            <div className="chip-row setup-competitions">
              <button
                type="button"
                className={`chip${period.kind === 'year' ? ' is-active' : ''}`}
                aria-pressed={period.kind === 'year'}
                onClick={() => choosePeriod({ kind: 'year', year: selectedYear })}
              >
                Whole year
                <span className="chip-count">
                  {availableFor(availability, source, { kind: 'year', year: selectedYear })}
                </span>
              </button>
              {splitsForYear.map((split) => {
                const candidate: QuizPeriod = { kind: 'split', year: selectedYear, split };
                const count = availableFor(availability, source, candidate);
                return (
                  <button
                    key={split}
                    type="button"
                    className={`chip${samePeriod(period, candidate) ? ' is-active' : ''}`}
                    style={{ ['--chip-accent' as string]: 'var(--violet)' }}
                    aria-pressed={samePeriod(period, candidate)}
                    onClick={() => choosePeriod(candidate)}
                    title={`${count} eligible games`}
                  >
                    {split}
                    <span className="chip-count">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          <p className="field-hint">
            {period.kind === 'all'
              ? 'Every season loaded. Narrow to one split if you would rather be tested on a single meta than on four years of them.'
              : period.kind === 'year'
                ? `All of ${period.year}, including events with no split of their own such as Worlds and MSI.`
                : `${period.year} ${period.split} only — one patch cycle, one pick pool.`}
          </p>
        </div>
      </section>

      <section className="panel setup-block">
        <div className="panel-header">
          <h2>3 · Question style</h2>
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
          <h2>4 · Length</h2>
          <span className="dim">{scope}</span>
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
                  poolSize < count ? `Only ${poolSize} eligible games in ${scope}` : undefined
                }
              >
                {count} questions
              </button>
            ))}
          </div>
          {!canStart && (
            <p className="setup-warning">
              {scope} only has {formatCount(poolSize, 'eligible game')}. Pick a shorter run, a
              wider season, or a different source.
            </p>
          )}
        </div>
      </section>

      <section className="panel setup-block">
        <div className="panel-header">
          <h2>5 · Identity</h2>
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
          {sourceKey(source) === 'MIXED' ? 'Mixed' : sourceLabel(source)}
          {period.kind !== 'all' && ` · ${periodLabel(period)}`} · {MODE_LABEL[mode]}
        </button>
      </div>
    </div>
  );
}
