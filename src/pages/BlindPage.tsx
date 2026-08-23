import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DraftBoard } from '../components/draft/DraftBoard.tsx';
import { GameContextBar } from '../components/GameContextBar.tsx';
import { PatchMetaPanel } from '../components/meta/PatchMetaPanel.tsx';
import { PredictionBar } from '../components/quiz/PredictionBar.tsx';
import { toPrompt, type Game, type Side } from '../domain/types.ts';
import {
  BLIND_HINTS,
  BLIND_LEVELS,
  BlindLadderError,
  blindReducer,
  buildLadder,
  createBlindRun,
  currentBlindGame,
  currentLevel,
  hintUnlocked,
  HINT_LABEL,
  LEVEL_BLURB,
  LEVEL_LABEL,
  rateGames,
  rungsCleared,
  type BlindRun,
} from '../quiz/blind.ts';
import { useDataset } from '../state/DatasetContext.tsx';

/** A fresh ladder each run, so restarting is not the same four games again. */
const newSeed = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function BlindPage() {
  const navigate = useNavigate();
  const { dataset, metaIndex } = useDataset();
  const games = dataset?.games;

  const rated = useMemo(() => rateGames(games ?? []), [games]);
  const [seed, setSeed] = useState(newSeed);

  const ladder = useMemo<{ games: Game[] } | { error: string }>(() => {
    try {
      return { games: buildLadder(rated, seed) };
    } catch (error) {
      return {
        error:
          error instanceof BlindLadderError
            ? error.message
            : 'Could not build a ladder from the loaded games.',
      };
    }
  }, [rated, seed]);

  const failed = 'error' in ladder;
  const [run, dispatch] = useReducer(
    blindReducer,
    failed ? [] : ladder.games,
    createBlindRun as (games: Game[]) => BlindRun,
  );

  // A new ladder (new seed, or a dataset change) replaces the run in flight.
  const [ladderKey, setLadderKey] = useState(() => (failed ? '' : ladder.games[0]?.gameId));
  const currentKey = failed ? '' : ladder.games[0]?.gameId;
  if (ladderKey !== currentKey && !failed) {
    setLadderKey(currentKey);
    dispatch({ type: 'restart', games: ladder.games });
  }

  const restart = useCallback(() => setSeed(newSeed()), []);

  const game = currentBlindGame(run);
  const level = currentLevel(run);
  const over = run.status !== 'playing';

  const call = useCallback(
    (prediction: Side | null) => {
      if (prediction === null || over) return;
      dispatch({ type: 'answer', prediction });
    },
    [over],
  );

  // B/← blue, R/→ red, H for a hint.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || over) return;
      const key = event.key.toLowerCase();
      if (key === 'b' || key === 'arrowleft') {
        event.preventDefault();
        call('blue');
      } else if (key === 'r' || key === 'arrowright') {
        event.preventDefault();
        call('red');
      } else if (key === 'h') {
        event.preventDefault();
        dispatch({ type: 'hint' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [call, over]);

  if (failed) {
    return (
      <div className="page">
        <div className="empty-state panel panel-pad">
          <h2>Not enough games for blind mode</h2>
          <p>{ladder.error}</p>
          <Link className="btn btn-primary" to="/data">
            Import a season
          </Link>
        </div>
      </div>
    );
  }

  if (!game) return null;

  const revealTeams = hintUnlocked('teams', run.hints);
  const revealMeta = hintUnlocked('meta', run.hints);
  const revealEvent = hintUnlocked('event', run.hints);

  return (
    <div className="page blind-page">
      <header className="blind-hud">
        <div className="blind-rungs" role="list" aria-label="Levels">
          {BLIND_LEVELS.map((rung, index) => (
            <span
              key={rung}
              role="listitem"
              className={
                'blind-rung' +
                (index < rungsCleared(run) ? ' is-cleared' : '') +
                (index === run.level && !over ? ' is-current' : '') +
                (index === run.level && run.status === 'lost' ? ' is-failed' : '')
              }
            >
              {LEVEL_LABEL[rung]}
            </span>
          ))}
        </div>
        <div className="blind-hud-right">
          <div className="stat">
            <span className="stat-label">Cleared</span>
            <span className="stat-value">
              {rungsCleared(run)}
              <span className="hud-total">/{BLIND_LEVELS.length}</span>
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Hints</span>
            <span className="stat-value">{run.hintsTotal}</span>
          </div>
        </div>
      </header>

      <div className="blind-brief">
        <h1>
          {LEVEL_LABEL[level]}
          <span className="dim"> · {LEVEL_BLURB[level]}</span>
        </h1>
        <p className="dim">
          The bans, the picks and the league. Nothing else — call the winner, or spend a hint.
        </p>
      </div>

      <GameContextBar
        game={toPrompt(game)}
        revealEvent={revealEvent}
        revealPatch={revealMeta}
      />

      <DraftBoard
        key={game.gameId}
        game={toPrompt(game)}
        winner={over ? game.winner : null}
        anonymous={!revealTeams}
      />

      <PredictionBar
        blueTeam={revealTeams ? game.blue.teamName : 'Blue Side'}
        redTeam={revealTeams ? game.red.teamName : 'Red Side'}
        blueTag={revealTeams ? game.blue.tag : 'BLU'}
        redTag={revealTeams ? game.red.tag : 'RED'}
        prediction={over ? run.lastCall : null}
        winner={over ? game.winner : null}
        disabled={over}
        onPredict={call}
      />

      {!over && (
        <section className="blind-hints">
          <div className="blind-hints-head">
            <h2>Hints</h2>
            <span className="dim">
              {run.hints}/{BLIND_HINTS.length} taken on this level
            </span>
          </div>
          <ol className="blind-hint-list">
            {BLIND_HINTS.map((hint, index) => {
              const taken = index < run.hints;
              const nextUp = index === run.hints;
              return (
                <li key={hint} className={taken ? 'is-taken' : undefined}>
                  <span className="blind-hint-num">{index + 1}</span>
                  <span className="blind-hint-text">{HINT_LABEL[hint]}</span>
                  {taken ? (
                    <span className="blind-hint-state">revealed</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!nextUp}
                      onClick={() => dispatch({ type: 'hint' })}
                    >
                      Reveal
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {over && (
        <section
          className={`blind-over blind-over--${run.status}`}
          role="alertdialog"
          aria-label={run.status === 'won' ? 'Run complete' : 'Run over'}
        >
          <h2>{run.status === 'won' ? 'You cleared every level' : 'You lost'}</h2>
          <p>
            {run.status === 'won'
              ? `All ${BLIND_LEVELS.length} levels, ${run.hintsTotal} hint${run.hintsTotal === 1 ? '' : 's'} spent.`
              : `${game[game.winner].teamName} won this one. You cleared ${rungsCleared(run)} of ${BLIND_LEVELS.length}` +
                ` on ${LEVEL_LABEL[level].toLowerCase()}.`}
          </p>
          <div className="blind-over-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={restart}>
              Restart
            </button>
            <button type="button" className="btn btn-lg" onClick={() => navigate('/')}>
              Home
            </button>
          </div>
        </section>
      )}

      {revealMeta && (
        <PatchMetaPanel metaIndex={metaIndex} patch={game.patch} competition={game.competition} />
      )}
    </div>
  );
}
