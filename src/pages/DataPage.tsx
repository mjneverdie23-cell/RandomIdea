import { useCallback, useRef, useState } from 'react';
import { COMPETITIONS } from '../domain/competitions.ts';
import { CsvParseError } from '../data/parseCsv.ts';
import { IngestError } from '../data/ingest.ts';
import { formatCount, formatDate, formatDateTime } from '../lib/format.ts';
import { useDataset, type ImportProgress } from '../state/DatasetContext.tsx';
import type { DatasetStats } from '../domain/types.ts';

type ImportState =
  | { kind: 'idle' }
  | { kind: 'busy'; progress: ImportProgress | null }
  | { kind: 'done'; stats: DatasetStats; label: string }
  | { kind: 'error'; message: string; detail?: string };

export function DataPage() {
  const { dataset, isDemo, importFiles, resetToDemo, persisted } = useDataset();
  const [state, setState] = useState<ImportState>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const runImport = useCallback(
    async (files: File[]) => {
      const csvFiles = files.filter((file) => /\.(csv|txt)$/i.test(file.name));
      if (csvFiles.length === 0) {
        setState({ kind: 'error', message: 'Please choose a .csv file.' });
        return;
      }
      setState({ kind: 'busy', progress: null });
      try {
        const next = await importFiles(csvFiles, (progress) =>
          setState({ kind: 'busy', progress }),
        );
        setState({ kind: 'done', stats: next.stats, label: next.source.label });
      } catch (cause) {
        if (cause instanceof IngestError || cause instanceof CsvParseError) {
          setState({ kind: 'error', message: cause.message, detail: cause.detail });
        } else {
          setState({
            kind: 'error',
            message: 'Import failed.',
            detail: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    },
    [importFiles],
  );

  return (
    <div className="page data-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Data</p>
          <h1>Oracle’s Elixir import</h1>
          <p className="page-sub">
            Drop a yearly match-data CSV straight in. Rows are grouped into games, filtered to the
            eight configured competitions, and normalized — nothing else needs configuring.
          </p>
        </div>
      </header>

      <section
        className={`dropzone${dragging ? ' is-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void runImport([...event.dataTransfer.files]);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          multiple
          className="sr-only"
          onChange={(event) => {
            void runImport([...(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />

        {state.kind === 'busy' ? (
          <div className="dropzone-busy">
            <span className="spinner" aria-hidden="true" />
            <p>
              {state.progress?.phase === 'normalizing'
                ? 'Building games from rows…'
                : state.progress?.phase === 'saving'
                  ? 'Saving dataset…'
                  : `Reading ${state.progress?.fileName ?? 'file'}…`}
            </p>
            {state.progress && (
              <>
                <div className="progress-track">
                  <span style={{ width: `${Math.round((state.progress.fraction ?? 0) * 100)}%` }} />
                </div>
                <p className="dim num">{state.progress.rows.toLocaleString()} rows</p>
              </>
            )}
          </div>
        ) : (
          <>
            <h2>Drop CSV files here</h2>
            <p className="dim">
              Multiple years can be imported at once. Files are read in your browser — nothing is
              uploaded anywhere.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()}>
              Choose files
            </button>
          </>
        )}
      </section>

      {state.kind === 'error' && (
        <div className="error-box">
          <strong>{state.message}</strong>
          {state.detail && <p className="dim">{state.detail}</p>}
        </div>
      )}

      {state.kind === 'done' && <ImportReport stats={state.stats} label={state.label} />}

      {!persisted && (
        <p className="error-box">
          The dataset is loaded for this session but could not be saved to browser storage — it
          will need re-importing after a reload.
        </p>
      )}

      <div className="data-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Current dataset</h2>
            {isDemo ? (
              <span className="badge badge-demo">Synthetic demo</span>
            ) : (
              <span className="badge badge-strong">Imported</span>
            )}
          </div>
          <div className="panel-pad">
            {dataset ? (
              <>
                <dl className="kv">
                  <div>
                    <dt>Source</dt>
                    <dd>{dataset.source.label}</dd>
                  </div>
                  <div>
                    <dt>Games</dt>
                    <dd className="num">{dataset.games.length.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Loaded</dt>
                    <dd>{formatDateTime(dataset.importedAt)}</dd>
                  </div>
                  {dataset.stats.dateRange && (
                    <div>
                      <dt>Date range</dt>
                      <dd>
                        {formatDate(dataset.stats.dateRange.from)} –{' '}
                        {formatDate(dataset.stats.dateRange.to)}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Patches</dt>
                    <dd className="num">{dataset.stats.patches.slice(0, 12).join(', ') || '—'}</dd>
                  </div>
                </dl>
                {!isDemo && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      void resetToDemo();
                      setState({ kind: 'idle' });
                    }}
                  >
                    Discard and return to demo data
                  </button>
                )}
              </>
            ) : (
              <p className="dim">No dataset loaded.</p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Competition filter</h2>
          </div>
          <div className="panel-pad">
            <p className="dim">
              Only these competitions enter the quiz pool. Everything else in the file — academy,
              challenger and development leagues included — is discarded during ingestion.
            </p>
            <ul className="comp-list">
              {COMPETITIONS.map((competition) => (
                <li key={competition.id}>
                  <span className="comp-dot" style={{ background: competition.accent }} />
                  <strong>{competition.short}</strong>
                  <span className="dim"> · {competition.label}</span>
                  <span className="dim comp-aliases">{competition.aliases.slice(0, 3).join(', ')}</span>
                </li>
              ))}
            </ul>
            <p className="dim comp-note">
              Matching is alias- and pattern-based, so casing and season labels in the{' '}
              <code>league</code> column don’t matter. Edit{' '}
              <code>src/domain/competitions.ts</code> to change the list.
            </p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Expected columns</h2>
          </div>
          <div className="panel-pad">
            <p className="dim">
              The standard Oracle’s Elixir layout — 12 rows per game, 10 players plus 2 team rows.
              Header casing and punctuation are normalized on read.
            </p>
            <ul className="col-list">
              <li>
                <strong>Required</strong>
                <span className="num">gameid, league, champion, result</span>
              </li>
              <li>
                <strong>Draft</strong>
                <span className="num">participantid, side, position, playername, teamname, ban1–ban5</span>
              </li>
              <li>
                <strong>Context</strong>
                <span className="num">date, year, split, playoffs, patch, game, gamelength</span>
              </li>
              <li>
                <strong>Optional</strong>
                <span className="num">stage/round, bestof, playerid, teamid, datacompleteness</span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

function ImportReport({ stats, label }: { stats: DatasetStats; label: string }) {
  return (
    <section className="panel import-report">
      <div className="panel-header">
        <h2>Import complete</h2>
        <span className="dim">{label}</span>
      </div>
      <div className="panel-pad">
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">Rows read</span>
            <span className="stat-value">{stats.rowsParsed.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Games found</span>
            <span className="stat-value">{stats.gamesBuilt.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Games kept</span>
            <span className="stat-value tone-green">{stats.gamesKept.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Filtered out</span>
            <span className="stat-value">{stats.rejectedByCompetition.toLocaleString()}</span>
            <span className="stat-sub dim">other competitions</span>
          </div>
          <div className="stat">
            <span className="stat-label">Incomplete</span>
            <span className="stat-value tone-amber">{stats.rejectedIncomplete.toLocaleString()}</span>
            <span className="stat-sub dim">draft or winner missing</span>
          </div>
        </div>

        <div className="report-comps">
          {Object.entries(stats.perCompetition)
            .sort((a, b) => b[1] - a[1])
            .map(([competition, count]) => (
              <span key={competition} className="badge badge-strong">
                {competition} <span className="num">{count.toLocaleString()}</span>
              </span>
            ))}
        </div>

        {stats.warnings.length > 0 && (
          <details className="warnings">
            <summary>{formatCount(stats.warnings.length, 'warning')}</summary>
            <ul>
              {stats.warnings.map((warning) => (
                <li key={`${warning.code}-${warning.message}`}>
                  <span className="badge">{warning.code}</span> {warning.message}{' '}
                  <span className="dim num">×{warning.count}</span>
                  {warning.sample && <span className="dim"> (e.g. {warning.sample})</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
