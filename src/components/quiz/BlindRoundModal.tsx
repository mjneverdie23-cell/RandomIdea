import { useEffect, useRef } from 'react';
import { TeamLogo } from '../TeamLogo.tsx';
import type { Game } from '../../domain/types.ts';
import {
  chartAxis,
  LEVEL_LABEL,
  timeChart,
  type BlindResult,
  type BlindRun,
} from '../../quiz/blind.ts';
import { formatSeconds } from '../../lib/format.ts';

interface BlindRoundModalProps {
  run: BlindRun;
  result: BlindResult;
  game: Game;
  /** Whether this was the last rung, which changes the button. */
  last: boolean;
  onContinue: () => void;
}

/**
 * What comes up when a round ends: the answer, and how long every call took.
 *
 * A modal rather than a strip under the board because the round is genuinely
 * over — there is nothing left to read on the draft, and the next question is a
 * different game. Holding the player here until they dismiss it is the point.
 */
export function BlindRoundModal({ run, result, game, last, onContinue }: BlindRoundModalProps) {
  const continueRef = useRef<HTMLButtonElement>(null);
  const winner = game[game.winner];
  const loser = game[game.winner === 'blue' ? 'red' : 'blue'];

  // Focus the only action, so Enter works and a screen reader lands somewhere
  // useful rather than at the top of the page behind the overlay.
  useEffect(() => {
    continueRef.current?.focus();
  }, []);

  const chart = timeChart(run);
  const axis = chartAxis(chart);

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className={`modal blind-round blind-round--${result.correct ? 'correct' : 'wrong'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="blind-round-title"
      >
        <header className="blind-round-head">
          <span className="blind-round-eyebrow">{LEVEL_LABEL[result.level]} · round over</span>
          <h2 id="blind-round-title">
            {result.correct ? 'Read it right' : result.call === null ? 'Out of time' : 'Wrong call'}
          </h2>
        </header>

        <div className="blind-answer">
          <span className="blind-answer-label">The winner was</span>
          <div className="blind-answer-teams">
            <span className={`blind-answer-team is-winner is-${winner.side}`}>
              <TeamLogo teamName={winner.teamName} tag={winner.tag} size="sm" />
              <strong>{winner.teamName}</strong>
            </span>
            <span className="dim">beat</span>
            <span className={`blind-answer-team is-${loser.side}`}>
              <TeamLogo teamName={loser.teamName} tag={loser.tag} size="sm" />
              {loser.teamName}
            </span>
          </div>
          <span className="dim">
            {result.call === null
              ? 'No call made before the clock ran out.'
              : `You called ${result.call === 'blue' ? 'blue' : 'red'} side, in ${formatSeconds(result.elapsedMs)}.`}
          </span>
        </div>

        <div className="blind-round-score">
          <span className="num">+{result.points}</span>
          {result.correct && result.speedBonus > 0 && (
            <span className="dim">{result.speedBonus} of it for speed</span>
          )}
          {!result.correct && <span className="dim">Nothing this round — the run carries on</span>}
        </div>

        <figure className="blind-chart">
          <figcaption>
            Seconds taken, by level
            <span className="dim"> · tallest bar is {axis}s</span>
          </figcaption>
          <div className="blind-chart-plot">
            {chart.map((point) => {
              // A floor so a one-second round is still a visible bar.
              const height =
                point.seconds === null ? 0 : Math.max(6, (point.seconds / axis) * 100);
              return (
                <div className="blind-chart-col" key={point.level}>
                  <span className="blind-chart-value">
                    {point.seconds === null ? '' : `${point.seconds}s`}
                  </span>
                  <div className="blind-chart-track">
                    <span
                      className={
                        'blind-chart-bar' +
                        (point.seconds === null
                          ? ' is-empty'
                          : point.correct
                            ? ' is-correct'
                            : point.timedOut
                              ? ' is-timeout'
                              : ' is-wrong')
                      }
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <span className="blind-chart-label">{LEVEL_LABEL[point.level]}</span>
                </div>
              );
            })}
          </div>
        </figure>

        <button
          ref={continueRef}
          type="button"
          className="btn btn-primary btn-lg"
          onClick={onContinue}
        >
          {last ? 'See your run' : 'Next level'} →
        </button>
      </section>
    </div>
  );
}
