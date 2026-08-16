import { useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDataset } from '../state/DatasetContext.tsx';
import { usePredictor } from '../state/PredictorContext.tsx';
import { DraftComposer } from '../components/predictor/DraftComposer.tsx';
import { PredictionReport } from '../components/predictor/PredictionReport.tsx';
import { predict } from '../predictor/engine.ts';
import { lookupRating } from '../predictor/ratings.ts';
import { PREDICTABLE_STAGES, STAGE_LABEL, formatFor } from '../predictor/formats.ts';
import { gameNumberOf, swapDraftSides, type DraftSide } from '../predictor/draft.ts';
import { COMPETITIONS } from '../domain/competitions.ts';
import type { CompetitionId, Side, StageKind } from '../domain/types.ts';
import { SERIES_TARGET, type SeriesLength, type WinRequirement } from '../predictor/types.ts';
import { formatCount } from '../lib/format.ts';

const SERIES_LENGTHS: SeriesLength[] = ['BO1', 'BO3', 'BO5'];

export function PredictorPage() {
  const { dataset, isDemo } = useDataset();
  const { model, ratings, draft, setDraft, resetDraft } = usePredictor();
  const { blue, red, stage, seriesLength, seriesTouched, scoreBlue, scoreRed, winRequirement } =
    draft;

  /** Competitions that actually have games loaded. */
  const availableCompetitions = useMemo(
    () => COMPETITIONS.filter((competition) => model.teamsByCompetition.has(competition.id)),
    [model],
  );

  // Suggest the format for the chosen competition + stage until the user
  // overrides it themselves, after which their choice stands.
  useEffect(() => {
    if (seriesTouched) return;
    const suggested = formatFor(blue.competition, stage).series;
    setDraft((current) =>
      current.seriesTouched || current.seriesLength === suggested
        ? current
        : { ...current, seriesLength: suggested },
    );
  }, [blue.competition, stage, seriesTouched, setDraft]);

  const target = SERIES_TARGET[seriesLength];
  const gameNumber = gameNumberOf(draft);

  const updateSide = useCallback(
    (side: Side, change: (current: DraftSide) => DraftSide) => {
      setDraft((current) => ({ ...current, [side]: change(current[side]) }));
    },
    [setDraft],
  );

  const teamsFor = useCallback(
    (competition: CompetitionId | null): string[] =>
      competition ? (model.teamsByCompetition.get(competition) ?? []) : model.allTeams,
    [model],
  );

  const ready = blue.team !== null && red.team !== null;

  /** Teams in this matchup the ratings table has no entry for. */
  const unratedTeams = useMemo(
    () =>
      [blue.team, red.team].filter(
        (team): team is string => team !== null && lookupRating(model.ratings, team) === null,
      ),
    [blue.team, red.team, model.ratings],
  );

  const prediction = useMemo(() => {
    if (!ready) return null;
    return predict(model, {
      blue: {
        competition: blue.competition,
        team: blue.team!,
        champions: blue.champions,
        motivation: blue.motivation,
      },
      red: {
        competition: red.competition,
        team: red.team!,
        champions: red.champions,
        motivation: red.motivation,
      },
      stage,
      seriesLength,
      gameNumber,
      scoreBlue,
      scoreRed,
      previousWinner: null,
      winRequirement,
    });
  }, [
    ready,
    model,
    blue,
    red,
    stage,
    seriesLength,
    gameNumber,
    scoreBlue,
    scoreRed,
    winRequirement,
  ]);

  if (!dataset || dataset.games.length === 0) {
    return (
      <div className="page">
        <div className="empty-state">
          <h1>Predictor</h1>
          <p>No games are loaded, so there is nothing to predict from.</p>
          <Link className="btn btn-primary" to="/data">
            Import a season
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page predictor-page">
      <header className="page-head">
        <div>
          <h1>Predictor</h1>
          <p className="dim">
            Build a draft and read the point tally. Every number below comes from the{' '}
            {formatCount(model.gamesAnalyzed, 'game')} you have loaded
            {model.metaPatches.length > 0 &&
              `, with meta taken from patch ${model.metaPatches.join(' and ')}`}
            .
          </p>
        </div>
        <div className="page-head-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setDraft(swapDraftSides)}
          >
            Swap sides
          </button>
          <button type="button" className="btn btn-sm" onClick={resetDraft}>
            Reset
          </button>
        </div>
      </header>

      {isDemo && (
        <p className="predictor-demo-note">
          These are synthetic demo games. Import a real Oracle’s Elixir export on the{' '}
          <Link to="/data">Data</Link> tab for predictions that mean anything.
        </p>
      )}

      <section className="context-bar" aria-label="Series context">
        <label className="field">
          <span className="field-label">Blue competition</span>
          <select
            className="select"
            value={blue.competition ?? ''}
            onChange={(event) => {
              const value = (event.target.value || null) as CompetitionId | null;
              updateSide('blue', (side) => ({ ...side, competition: value, team: null }));
            }}
          >
            <option value="">All competitions</option>
            {availableCompetitions.map((competition) => (
              <option key={competition.id} value={competition.id}>
                {competition.short}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Red competition</span>
          <select
            className="select"
            value={red.competition ?? ''}
            onChange={(event) => {
              const value = (event.target.value || null) as CompetitionId | null;
              updateSide('red', (side) => ({ ...side, competition: value, team: null }));
            }}
          >
            <option value="">All competitions</option>
            {availableCompetitions.map((competition) => (
              <option key={competition.id} value={competition.id}>
                {competition.short}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Stage</span>
          <select
            className="select"
            value={stage}
            onChange={(event) =>
              setDraft((current) => ({ ...current, stage: event.target.value as StageKind }))
            }
          >
            {PREDICTABLE_STAGES.map((kind) => (
              <option key={kind} value={kind}>
                {STAGE_LABEL[kind]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Series</span>
          <select
            className="select"
            value={seriesLength}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                seriesLength: event.target.value as SeriesLength,
                seriesTouched: true,
              }))
            }
          >
            {SERIES_LENGTHS.map((length) => (
              <option key={length} value={length}>
                {length.replace('BO', 'Best of ')}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field-label">Series score</span>
          <div className="score-input">
            <ScoreStepper
              label="Blue score"
              value={scoreBlue}
              max={target - 1}
              tone="blue"
              onChange={(value) => setDraft((current) => ({ ...current, scoreBlue: value }))}
            />
            <span className="score-dash">–</span>
            <ScoreStepper
              label="Red score"
              value={scoreRed}
              max={target - 1}
              tone="red"
              onChange={(value) => setDraft((current) => ({ ...current, scoreRed: value }))}
            />
          </div>
        </div>

        <div className="field">
          <span className="field-label">Game</span>
          <output className="game-number">{gameNumber}</output>
        </div>

        <label className="field">
          <span className="field-label">Show</span>
          <select
            className="select"
            value={winRequirement}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                winRequirement: event.target.value as WinRequirement,
              }))
            }
          >
            <option value="series">Series odds</option>
            <option value="sweep">Series + sweep odds</option>
          </select>
        </label>
      </section>

      <div className="composer-board">
        <DraftComposer
          side="blue"
          model={model}
          competition={blue.competition}
          team={blue.team}
          champions={blue.champions}
          opposingChampions={red.champions}
          motivation={blue.motivation}
          teamOptions={teamsFor(blue.competition)}
          onTeamChange={(team) => updateSide('blue', (side) => ({ ...side, team }))}
          onChampionChange={(index, champion) =>
            updateSide('blue', (side) => ({
              ...side,
              champions: side.champions.map((entry, i) => (i === index ? champion : entry)),
            }))
          }
          onMotivationChange={(motivation) => updateSide('blue', (side) => ({ ...side, motivation }))}
        />

        <div className="composer-divider">
          <span className="composer-vs">VS</span>
        </div>

        <DraftComposer
          side="red"
          model={model}
          competition={red.competition}
          team={red.team}
          champions={red.champions}
          opposingChampions={blue.champions}
          motivation={red.motivation}
          teamOptions={teamsFor(red.competition)}
          onTeamChange={(team) => updateSide('red', (side) => ({ ...side, team }))}
          onChampionChange={(index, champion) =>
            updateSide('red', (side) => ({
              ...side,
              champions: side.champions.map((entry, i) => (i === index ? champion : entry)),
            }))
          }
          onMotivationChange={(motivation) => updateSide('red', (side) => ({ ...side, motivation }))}
        />
      </div>

      {prediction ? (
        <PredictionReport
          prediction={prediction}
          blueTeam={blue.team ?? ''}
          redTeam={red.team ?? ''}
          showSweep={winRequirement === 'sweep'}
          formSeason={model.formSeason}
          ratingsLabel={ratings.label}
          unratedTeams={unratedTeams}
        />
      ) : (
        <div className="empty-state">
          <p>Pick a team on each side to see the prediction. It updates as you draft.</p>
        </div>
      )}
    </div>
  );
}

interface ScoreStepperProps {
  label: string;
  value: number;
  max: number;
  tone: 'blue' | 'red';
  onChange: (value: number) => void;
}

function ScoreStepper({ label, value, max, tone, onChange }: ScoreStepperProps) {
  return (
    <span className={`stepper stepper--${tone}`}>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        −
      </button>
      <output aria-label={label}>{value}</output>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </span>
  );
}
