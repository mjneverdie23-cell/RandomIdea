import { useMemo, useState } from 'react';
import { usePredictor, type MatchLoadReport } from '../../state/PredictorContext.tsx';
import { describeMatch, unknownChampions } from '../../predictor/matchImport.ts';
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
            Paste one matchup or a whole list to step through. Nothing about who won is
            read, so a backtest can&rsquo;t mark its own homework.
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
              Series score left at 0–0: in a best-of-three a 1–0 says who won game one,
              which is the result a backtest must not see. Set it yourself if you want
              series odds rather than this game&rsquo;s.
            </p>
          )}

          {missing.length > 0 && (
            <p className="paste-report is-warn">
              Not in the loaded seasons: {missing.join(', ')}. Those lanes score a neutral
              50% rather than a real record.
            </p>
          )}

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
