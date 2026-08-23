import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DraftBoard } from '../components/draft/DraftBoard.tsx';
import { GameContextBar } from '../components/GameContextBar.tsx';
import { PatchMetaPanel } from '../components/meta/PatchMetaPanel.tsx';
import { PredictionBar } from '../components/quiz/PredictionBar.tsx';
import { toPrompt, type Game, type Side } from '../domain/types.ts';
import {
  awardFor,
  BLIND_HINTS,
  BLIND_LEVELS,
  BlindLadderError,
  blindReducer,
  buildLadder,
  createBlindRun,
  currentBlindGame,
  currentLevel,
  HINT_COST,
  hintUnlocked,
  HINT_LABEL,
  lastResult,
  LEVEL_BLURB,
  LEVEL_LABEL,
  LEVEL_POINTS,
  MAX_BLIND_SCORE,
  rateGames,
  rungsCleared,
  type BlindRun,
} from '../quiz/blind.ts';
import { blindBoardRepository, clearedLabel, entryFromRun } from '../leaderboard/blindBoard.ts';
import { useDataset } from '../state/DatasetContext.tsx';
import { usePlayerName } from '../state/usePlayerName.ts';

/** A fresh ladder each run, so restarting is not the same four games again. */
const newSeed = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function BlindPage() {
  const navigate = useNavigate();
  const { dataset, isDemo, metaIndex } = useDataset();
  const games = dataset?.games;
  const [playerName] = usePlayerName();

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
  const revealing = run.status === 'revealing';
  const finished = run.status === 'finished';
  const result = lastResult(run);

  const call = useCallback(
    (prediction: Side | null) => {
      if (prediction === null || run.status !== 'playing') return;
      dispatch({ type: 'answer', prediction });
    },
    [run.status],
  );

  /*
   * Record the run once, the moment it finishes. A ref rather than state
   * because writing the board must not itself trigger a render that could
   * write it again.
   */
  const recorded = useRef<BlindRun | null>(null);
  useEffect(() => {
    if (!finished || recorded.current === run) return;
    recorded.current = run;
    void blindBoardRepository.add(entryFromRun(run, playerName, isDemo));
  }, [finished, run, playerName, isDemo]);

  // B/← blue, R/→ red, H for a hint.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (run.status === 'revealing' && (key === ' ' || key === 'enter')) {
        event.preventDefault();
        dispatch({ type: 'next' });
        return;
      }
      if (run.status !== 'playing') return;
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
  }, [call, run.status]);

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
          {BLIND_LEVELS.map((rung, index) => {
            const played = run.results[index];
            return (
              <span
                key={rung}
                role="listitem"
                className={
                  'blind-rung' +
                  (played?.correct ? ' is-cleared' : '') +
                  (played && !played.correct ? ' is-failed' : '') +
                  (index === run.level && !finished ? ' is-current' : '')
                }
              >
                {LEVEL_LABEL[rung]}
                <span className="blind-rung-pts">{LEVEL_POINTS[rung]}</span>
              </span>
            );
          })}
        </div>
        <div className="blind-hud-right">
          <div className="stat">
            <span className="stat-label">Score</span>
            <span className="stat-value">{run.score}</span>
          </div>
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

      {!finished && (
        <div className="blind-brief">
          <h1>
            {LEVEL_LABEL[level]}
            <span className="dim"> · {LEVEL_BLURB[level]}</span>
          </h1>
          <p className="dim">
            Worth <strong>{awardFor(level, run.hints)}</strong> points
            {run.hints > 0 && ` after ${run.hints} hint${run.hints === 1 ? '' : 's'}`}
            {run.hints === 0 &&
              `, less ${Math.round(HINT_COST * 100)}% for each hint you spend.`}
            {run.hints > 0 && ` (of ${LEVEL_POINTS[level]}).`} A wrong call costs this level
            only — the run carries on either way.
          </p>
        </div>
      )}

      {!finished && (
        <>
          <GameContextBar
            game={toPrompt(game)}
            revealEvent={revealEvent || revealing}
            revealPatch={revealMeta || revealing}
          />

          <DraftBoard
            key={game.gameId}
            game={toPrompt(game)}
            winner={revealing ? game.winner : null}
            anonymous={!revealTeams && !revealing}
          />

          <PredictionBar
            blueTeam={revealTeams || revealing ? game.blue.teamName : 'Blue Side'}
            redTeam={revealTeams || revealing ? game.red.teamName : 'Red Side'}
            blueTag={revealTeams || revealing ? game.blue.tag : 'BLU'}
            redTag={revealTeams || revealing ? game.red.tag : 'RED'}
            prediction={revealing ? (result?.call ?? null) : null}
            winner={revealing ? game.winner : null}
            disabled={revealing}
            onPredict={call}
          />
        </>
      )}

      {revealing && result && (
        <section
          className={`blind-reveal blind-reveal--${result.correct ? 'correct' : 'wrong'}`}
          role="status"
        >
          <div className="blind-reveal-main">
            <span className="blind-reveal-label">
              {result.correct ? 'Read it right' : 'Wrong call'}
            </span>
            <span className="dim">
              {game[game.winner].teamName} won.
              {!result.correct && ' No points this level — the run continues.'}
            </span>
          </div>
          <span className="blind-reveal-points num">+{result.points}</span>
          <button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'next' })}>
            {run.level + 1 >= BLIND_LEVELS.length ? 'Finish' : 'Next level'} →
          </button>
        </section>
      )}

      {run.status === 'playing' && (
        <section className="blind-hints">
          <div className="blind-hints-head">
            <h2>Hints</h2>
            <span className="dim">
              {run.hints}/{BLIND_HINTS.length} taken · each costs{' '}
              {Math.round(HINT_COST * 100)}% of this level
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
                      −{LEVEL_POINTS[level] - awardFor(level, index + 1)} pts
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {finished && (
        <section className="blind-over" role="alertdialog" aria-label="Run complete">
          <span className="blind-over-eyebrow">Run complete</span>
          <h2 className="num">{run.score}</h2>
          <p>
            {rungsCleared(run)} of {BLIND_LEVELS.length} read correctly
            {run.results.some((r) => r.correct) && ` (${clearedLabel(
              run.results.filter((r) => r.correct).map((r) => r.level),
            )})`}
            , {run.hintsTotal} hint{run.hintsTotal === 1 ? '' : 's'} spent. Out of{' '}
            {MAX_BLIND_SCORE}.
          </p>

          <ol className="blind-recap">
            {run.results.map((entry) => (
              <li key={entry.level} className={entry.correct ? 'is-correct' : 'is-wrong'}>
                <span className="blind-recap-mark">{entry.correct ? '✓' : '✗'}</span>
                <span className="blind-recap-level">{LEVEL_LABEL[entry.level]}</span>
                <span className="dim">
                  {entry.hints > 0 ? `${entry.hints} hint${entry.hints === 1 ? '' : 's'}` : 'no hints'}
                </span>
                <span className="blind-recap-pts num">+{entry.points}</span>
              </li>
            ))}
          </ol>

          <p className="dim">Saved to the blind board as {playerName}.</p>
          <div className="blind-over-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={restart}>
              Play again
            </button>
            <Link className="btn btn-lg" to="/leaderboard">
              Leaderboard
            </Link>
            <button type="button" className="btn btn-lg" onClick={() => navigate('/')}>
              Home
            </button>
          </div>
        </section>
      )}

      {(revealMeta || revealing) && !finished && (
        <PatchMetaPanel metaIndex={metaIndex} patch={game.patch} competition={game.competition} />
      )}
    </div>
  );
}
