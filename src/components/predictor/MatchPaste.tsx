import { useMemo, useState } from 'react';
import { usePredictor, type MatchLoadReport } from '../../state/PredictorContext.tsx';
import { describeMatch, unknownChampions } from '../../predictor/matchImport.ts';
import { headline } from '../../predictor/backtest.ts';
import { ROLES } from '../../domain/types.ts';
import { formatCount } from '../../lib/format.ts';

const EXAMPLE = `{
  "matches": [
    {
      "id": "LOLTMNT99_1234",
      "date": "2026-07-14",
      "competition": "LCK",
      "stage": "regular",
      "series": "BO3",
      "score": [0, 0],
      "blue": {
        "team": "T1",
        "top": "Aatrox", "jungle": "Viego", "mid": "Azir",
        "bot": "Jinx", "support": "Thresh"
      },
      "red": {
        "team": "Gen.G",
        "top": "Gnar", "jungle": "Sejuani", "mid": "Orianna",
        "bot": "Ezreal", "support": "Nautilus"
      }
    }
  ]
}`;

/**
 * Paste-to-fill, for backtesting.
 *
 * Composing a matchup by hand is fine for one prediction and hopeless for a
 * hundred, so a whole season's worth can be pasted at once and stepped through.
 * The box takes one match or a list; the navigator appears only when there is
 * more than one, so a single-match paste stays uncluttered.
 */
export function MatchPaste() {
  const {
    queue,
    loadMatches,
    goToMatch,
    clearQueue,
    model,
    asOf,
    asOfEnabled,
    setAsOfEnabled,
    scopedGameCount,
  } = usePredictor();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<MatchLoadReport | null>(null);

  const knownChampionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const role of ROLES) {
      for (const champion of model.championsByRole.get(role) ?? []) ids.add(champion.id);
    }
    return ids;
  }, [model]);

  const current = queue ? queue.matches[queue.index] : null;
  const missing = current ? unknownChampions(current, knownChampionIds) : [];

  const submit = () => {
    const result = loadMatches(text);
    setReport(result);
    if (result.ok) {
      setText('');
      setOpen(false);
    }
  };

  return (
    <section className="paste-panel">
      <header className="paste-head">
        <div>
          <h2>Load matches</h2>
          <p className="dim">
            Paste one matchup or a whole list to step through. The result of the game
            being predicted is never read — only the series score going into it, which
            is what anyone would know beforehand.
          </p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide' : queue ? 'Paste more' : 'Paste matches'}
        </button>
      </header>

      {open && (
        <div className="paste-body">
          <label className="sr-only" htmlFor="match-paste">
            Matches to load
          </label>
          <textarea
            id="match-paste"
            className="paste-input"
            spellCheck={false}
            rows={10}
            value={text}
            placeholder={EXAMPLE}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="paste-actions">
            <button type="button" className="btn btn-primary" disabled={!text.trim()} onClick={submit}>
              Load
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setText(EXAMPLE)}>
              Insert example
            </button>
            <span className="dim paste-hint">
              Keys are read loosely — <code>jng</code>, <code>jungle</code> and{' '}
              <code>jgl</code> all work, quotes and trailing commas are optional, and{' '}
              <code>//</code> comments are ignored.
            </span>
          </div>
        </div>
      )}

      {report && (
        <p className={report.ok ? 'paste-report is-ok' : 'paste-report is-warn'}>
          {report.message}
          {report.detail && <span className="dim"> {report.detail}</span>}
        </p>
      )}

      {queue && current && (
        <div className="queue">
          <div className="queue-nav">
            <button
              type="button"
              className="btn btn-sm"
              disabled={queue.index === 0}
              onClick={() => goToMatch(queue.index - 1)}
            >
              ← Previous
            </button>
            <span className="queue-position">
              {queue.index + 1} / {queue.matches.length}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={queue.index >= queue.matches.length - 1}
              onClick={() => goToMatch(queue.index + 1)}
            >
              Next →
            </button>
            <button type="button" className="btn btn-sm" onClick={clearQueue}>
              Clear
            </button>
          </div>

          <div className="queue-current">
            <strong>{describeMatch(current)}</strong>
            {current.competitionRaw && (
              <span className="dim">
                {' '}
                · {current.competition ?? `${current.competitionRaw} (unrecognized)`}
              </span>
            )}
          </div>

          <label className="queue-asof">
            <input
              type="checkbox"
              checked={asOfEnabled}
              onChange={(event) => setAsOfEnabled(event.target.checked)}
            />
            <span>
              <strong>Only use history up to this game</strong>
              {asOf !== null ? (
                <span className="dim">
                  {' '}
                  — {formatCount(scopedGameCount, 'game')} played before{' '}
                  {new Date(asOf).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
              ) : (
                <span className="dim">
                  {' '}
                  — off: every loaded game feeds the model, including ones played after
                  this one
                </span>
              )}
            </span>
          </label>

          {queue.matches.length > 1 && (
            <label className="queue-scrub">
              <span className="sr-only">Jump to match</span>
              <input
                type="range"
                min={0}
                max={queue.matches.length - 1}
                value={queue.index}
                onChange={(event) => goToMatch(Number(event.target.value))}
              />
            </label>
          )}

          {current.gameNumber > 1 && current.scoreBlue + current.scoreRed === 0 && (
            <p className="dim queue-note">
              No series score came with this match, so the series odds treat it as 0–0.
              Set it yourself, or re-export with a script that carries the running score.
            </p>
          )}

          {missing.length > 0 && (
            <p className="paste-report is-warn">
              Not in the loaded seasons: {missing.join(', ')}. Those lanes score a neutral
              50% rather than a real record.
            </p>
          )}

          <BacktestPanel />

          {queue.warnings.length > 0 && (
            <details className="queue-warnings">
              <summary>
                {queue.warnings.length} note{queue.warnings.length === 1 ? '' : 's'} from the
                paste
              </summary>
              <ul>
                {queue.warnings.slice(0, 20).map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Score the whole queue at once and print the record.
 *
 * Stepping through a hundred matches by hand to see whether the model is any
 * good is the kind of work nobody does twice, so this does it in one pass and
 * reports the tally. History is always cut at each match's kickoff here,
 * whatever the switch above says — a batch graded against a model that has
 * already seen the results would be a lookup table, not a backtest.
 */
function BacktestPanel() {
  const { backtest, backtestProgress, runBacktest, cancelBacktest, goToMatch } = usePredictor();
  const [showAll, setShowAll] = useState(false);
  const running = backtestProgress !== null;

  return (
    <div className="backtest">
      <div className="backtest-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={running}
          onClick={runBacktest}
        >
          {running ? 'Running…' : backtest ? 'Run again' : 'Backtest all matches'}
        </button>
        {running && (
          <>
            <progress value={backtestProgress.done} max={backtestProgress.total} />
            <span className="dim">
              {backtestProgress.done} / {backtestProgress.total}
            </span>
            <button type="button" className="btn btn-sm" onClick={cancelBacktest}>
              Cancel
            </button>
          </>
        )}
        {!running && !backtest && (
          <span className="dim paste-hint">
            Scores every match against the result in your loaded seasons. History is cut
            at each kickoff, so no match can see its own outcome.
          </span>
        )}
      </div>

      {backtest && !running && (
        <div className="backtest-result">
          <p className="backtest-headline">{headline(backtest)}</p>

          {backtest.blueSideAccuracy !== null && backtest.accuracy !== null && (
            // Without something to compare against, an accuracy is unreadable.
            <p
              className={`backtest-baseline${
                backtest.accuracy < backtest.blueSideAccuracy ? ' is-behind' : ''
              }`}
            >
              Always picking blue side would have scored{' '}
              {(backtest.blueSideAccuracy * 100).toFixed(1)}%
              {backtest.accuracy < backtest.blueSideAccuracy
                ? ' — the model is behind that.'
                : '.'}
            </p>
          )}

          <p className="dim backtest-sub">
            {backtest.graded} of {backtest.total} graded
            {backtest.skipped > 0 && (
              <>
                {' — '}
                {backtest.skippedBy
                  .map((entry) => `${entry.count} ${entry.reason}`)
                  .join(', ')}
              </>
            )}
            {backtest.brier !== null && (
              <>
                {' · Brier '}
                {backtest.brier.toFixed(3)}{' '}
                <span title="0.25 is what calling every game a coin flip scores; lower is better.">
                  (coin flip = 0.250)
                </span>
              </>
            )}
          </p>

          {backtest.bands.length > 0 && (
            <table className="backtest-bands">
              <thead>
                <tr>
                  <th>Model said</th>
                  <th>Games</th>
                  <th>Right</th>
                  <th>Actually</th>
                </tr>
              </thead>
              <tbody>
                {backtest.bands.map((band) => (
                  <tr key={band.label}>
                    <td>{band.label}</td>
                    <td>{band.graded}</td>
                    <td>
                      {band.right}/{band.graded}
                    </td>
                    <td>{((band.right / band.graded) * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <details
            className="backtest-detail"
            onToggle={(event) => setShowAll(event.currentTarget.open)}
          >
            <summary>Every call</summary>
            {showAll && (
              <ol className="backtest-list">
                {backtest.outcomes.map((outcome) => (
                  <li
                    key={outcome.index}
                    className={
                      outcome.correct === null
                        ? 'is-skipped'
                        : outcome.correct
                          ? 'is-right'
                          : 'is-wrong'
                    }
                  >
                    <button type="button" onClick={() => goToMatch(outcome.index)}>
                      <span className="backtest-mark">
                        {outcome.correct === null ? '–' : outcome.correct ? '✓' : '✗'}
                      </span>
                      <span className="backtest-label">{outcome.label}</span>
                      {outcome.correct === null ? (
                        <span className="dim">{outcome.reason}</span>
                      ) : (
                        <span className="dim">
                          said {outcome.predicted}
                          {outcome.confidence !== null &&
                            ` ${(outcome.confidence * 100).toFixed(0)}%`}
                          {!outcome.correct && ` · won ${outcome.actual}`}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </details>
        </div>
      )}
    </div>
  );
}
