import { useCallback, useRef, useState } from 'react';
import { assetStats } from '../assets/manifest.ts';
import { COMPETITIONS } from '../domain/competitions.ts';
import { CsvParseError } from '../data/parseCsv.ts';
import { IngestError } from '../data/ingest.ts';
import { formatCount, formatDate, formatDateTime } from '../lib/format.ts';
import { YearBar } from '../components/data/YearBar.tsx';
import type { StorageBackend } from '../storage/datasetStore.ts';
import type { YearDataset } from '../domain/types.ts';
import { useDataset, type ImportProgress, type ImportResult } from '../state/DatasetContext.tsx';
import { usePredictor, type RatingsImportReport } from '../state/PredictorContext.tsx';

type ImportState =
  | { kind: 'idle' }
  | { kind: 'busy'; progress: ImportProgress | null }
  | { kind: 'done'; result: ImportResult }
  | { kind: 'error'; message: string; detail?: string };

export function DataPage() {
  const {
    dataset,
    isDemo,
    years,
    importFiles,
    setYearEnabled,
    removeYear,
    resetToDemo,
    backend,
    persisted,
  } = useDataset();
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
        const result = await importFiles(csvFiles, (progress) =>
          setState({ kind: 'busy', progress }),
        );
        setState({ kind: 'done', result });
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
            Drop yearly match-data CSVs straight in — 2022 through the current partial season.
            Each import is filtered to the eight configured competitions and merged into its own
            season, so files add up instead of replacing each other.
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
              Several years at once is fine. Files are read in your browser — nothing is uploaded
              anywhere — and each season is saved separately.
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

      {state.kind === 'done' && <ImportReport result={state.result} />}

      <SeasonList
        years={years}
        backend={backend}
        onToggle={setYearEnabled}
        onRemove={removeYear}
      />

      {!persisted && (
        <p className="error-box">
          The import is loaded for this session but could not be saved — it will need re-importing
          after a reload. Browser storage may be full or blocked.
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

        <ImageAssetsCard />

        <TeamRatingsCard />

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

/**
 * Whether champion art and team logos are on disk.
 *
 * Without the download the app still works — champion art comes from Riot's
 * CDN and teams fall back to a monogram — but "why are there no logos?" is a
 * reasonable question, so it gets answered here rather than only in the README.
 */
/**
 * The predictor's optional ratings file.
 *
 * GlobalRank and Fraud are hand-maintained judgements that appear nowhere in an
 * Oracle's Elixir export, so this stays optional: without it the predictor
 * simply awards no rank edge and no fraud penalty, and says so in its output.
 */
function TeamRatingsCard() {
  const { ratings, importRatings, clearRatings } = usePredictor();
  const [report, setReport] = useState<RatingsImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setReport(await importRatings(file));
    setBusy(false);
  };

  return (
    <section className="panel ratings-card">
      <div className="panel-header">
        <h2>Team ratings</h2>
        {ratings ? (
          <span className="badge badge-strong">{ratings.teams.length} teams</span>
        ) : (
          <span className="badge">Optional</span>
        )}
      </div>
      <div className="panel-pad">
        <p className="dim">
          A champion-pool CSV with <code>teamName</code>, <code>GlobalRank</code> and{' '}
          <code>Fraud</code> columns. The predictor uses it for the rank edge and the fraud
          penalty; every other number it reports comes from the imported seasons.
        </p>

        <div className="ratings-summary">
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Reading…' : ratings ? 'Replace file' : 'Choose file'}
          </button>
          {ratings && (
            <>
              <span className="dim">
                {ratings.label} · imported {formatDate(ratings.importedAt)}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  void clearRatings();
                  setReport(null);
                }}
              >
                Remove
              </button>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(event) => {
              void onFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>

        {report && (
          <p className={report.ok ? 'ratings-report is-ok' : 'ratings-report is-warn'}>
            {report.message}
            {report.detail && <span className="dim"> {report.detail}</span>}
          </p>
        )}

        {ratings && ratings.teams.length > 0 && (
          <table className="ratings-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Global rank</th>
                <th>Fraud</th>
              </tr>
            </thead>
            <tbody>
              {ratings.teams.slice(0, 12).map((rating) => (
                <tr key={rating.team}>
                  <td>{rating.team}</td>
                  <td>{rating.globalRank ?? '—'}</td>
                  <td>{rating.fraud || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {ratings && ratings.teams.length > 12 && (
          <p className="dim">…and {ratings.teams.length - 12} more.</p>
        )}
      </div>
    </section>
  );
}

function ImageAssetsCard() {
  const assets = assetStats();
  const hasChampions = assets.champions > 0;
  const hasTeams = assets.teams > 0;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Image assets</h2>
        {hasChampions && hasTeams ? (
          <span className="badge badge-strong">Downloaded</span>
        ) : (
          <span className="badge badge-demo">Not downloaded</span>
        )}
      </div>
      <div className="panel-pad">
        <dl className="kv">
          <div>
            <dt>Champions</dt>
            <dd className="num">
              {hasChampions
                ? `${assets.champions} local${assets.version ? ` · patch ${assets.version}` : ''}`
                : 'none — loading from Riot’s CDN'}
            </dd>
          </div>
          <div>
            <dt>Team logos</dt>
            <dd className="num">
              {hasTeams ? `${assets.teams} local` : 'none — showing team monograms'}
            </dd>
          </div>
        </dl>

        {!(hasChampions && hasTeams) && (
          <p className="dim asset-hint">
            Run <code>npm run assets</code> to download champion art from Data Dragon and team
            logos from Leaguepedia into <code>public/assets/</code>, then restart the dev server
            (or rebuild). Team logos have no CDN fallback, so they only appear after this step.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Seasons currently stored, each with a switch.
 *
 * Also states where the data is being kept: the project folder when the dev
 * server is serving the app, browser storage otherwise. That distinction
 * matters — it is the difference between data that survives clearing site data
 * and data that doesn't.
 */
function SeasonList({
  years,
  backend,
  onToggle,
  onRemove,
}: {
  years: YearDataset[];
  backend: StorageBackend;
  onToggle: (year: string, enabled: boolean) => void;
  onRemove: (year: string) => Promise<void>;
}) {
  const enabled = years.filter((year) => year.enabled);
  const enabledGames = enabled.reduce((sum, year) => sum + year.games.length, 0);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Seasons</h2>
        <span className="dim">
          {years.length === 0
            ? 'Nothing imported yet'
            : `${enabled.length} of ${years.length} on · ${enabledGames.toLocaleString()} games in the pool`}
        </span>
      </div>

      {years.length === 0 ? (
        <p className="meta-empty">
          Import a CSV above and its games appear here, one bar per season, each with a switch.
        </p>
      ) : (
        <>
          <div className="year-list">
            {years.map((year) => (
              <YearBar
                key={year.year}
                year={year}
                onToggle={(value) => onToggle(year.year, value)}
                onRemove={() => {
                  if (window.confirm(`Delete the ${year.year} games? Re-importing brings them back.`)) {
                    void onRemove(year.year);
                  }
                }}
              />
            ))}
          </div>
          <footer className="year-foot dim">
            {backend === 'folder' ? (
              <>
                Saved to <code>data/&lt;year&gt;.json</code> in the project folder, and mirrored to
                browser storage.
              </>
            ) : backend === 'indexeddb' ? (
              <>
                Saved to browser storage. Run the app with <code>npm run dev</code> to also write{' '}
                <code>data/&lt;year&gt;.json</code> into the project folder.
              </>
            ) : (
              <>Held in memory for this session only — no storage backend accepted the data.</>
            )}
          </footer>
        </>
      )}
    </section>
  );
}

function ImportReport({ result }: { result: ImportResult }) {
  return (
    <section className="panel import-report">
      <div className="panel-header">
        <h2>Import complete</h2>
        <span className="dim">{result.label}</span>
      </div>
      <div className="panel-pad">
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">Rows read</span>
            <span className="stat-value">{result.rowsParsed.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Games kept</span>
            <span className="stat-value tone-green">{result.gamesKept.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Filtered out</span>
            <span className="stat-value">{result.rejectedByCompetition.toLocaleString()}</span>
            <span className="stat-sub dim">other competitions</span>
          </div>
          <div className="stat">
            <span className="stat-label">Incomplete</span>
            <span className="stat-value tone-amber">
              {result.rejectedIncomplete.toLocaleString()}
            </span>
            <span className="stat-sub dim">draft or winner missing</span>
          </div>
          <div className="stat">
            <span className="stat-label">Seasons</span>
            <span className="stat-value">{result.years.length}</span>
            <span className="stat-sub dim">{result.years.map((y) => y.year).join(', ')}</span>
          </div>
        </div>

        <div className="report-comps">
          {result.years.map((year) => (
            <span key={year.year} className="badge badge-strong">
              {year.year} <span className="num">{year.games.length.toLocaleString()}</span>
            </span>
          ))}
        </div>

        {result.years.some((year) => year.stats.warnings.length > 0) && (
          <details className="warnings">
            <summary>
              {formatCount(
                result.years.reduce((sum, year) => sum + year.stats.warnings.length, 0),
                'warning',
              )}
            </summary>
            <ul>
              {result.years.flatMap((year) =>
                year.stats.warnings.map((warning) => (
                  <li key={`${year.year}-${warning.code}-${warning.message}`}>
                    <span className="badge">{warning.code}</span> {warning.message}{' '}
                    <span className="dim num">×{warning.count}</span>
                  </li>
                )),
              )}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
