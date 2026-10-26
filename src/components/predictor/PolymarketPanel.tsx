import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { GammaError, gammaFetch } from '../../lib/gamma.ts';
import {
  findEvent,
  loadEvent,
  readEvent,
  slugFromLink,
  type GammaEvent,
  type LiveBoard,
  type LiveMarket,
  type OutcomeQuote,
} from '../../predictor/polymarket.ts';
import type { Prediction } from '../../predictor/types.ts';
import { readTabScoped, writeTabScoped } from '../../storage/tabScoped.ts';

/** The linked event belongs to one matchup in one tab, like the calculator's prices. */
const LINK_KEY = 'draftcall.polymarket.link.v1';
/** How often to poll is a habit, shared across tabs. */
const PREFS_KEY = 'draftcall.polymarket.prefs.v1';
const INTERVALS = [5, 10, 30, 60] as const;
const DEFAULT_EVERY = 10;
/** Prices older than this are flagged: a feed that stopped is worse than none. */
export const STALE_SECONDS = 60;

interface Link {
  teams: string;
  slug: string | null;
}

interface Prefs {
  every: number;
  paused: boolean;
}

function loadPrefs(): Prefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    return {
      every: INTERVALS.includes(parsed?.every as never) ? (parsed!.every as number) : DEFAULT_EVERY,
      paused: parsed?.paused === true,
    };
  } catch {
    return { every: DEFAULT_EVERY, paused: false };
  }
}

/** The link saved for these two teams — either way round — and nothing else's. */
function loadLink(teams: string): Link {
  try {
    const stored = JSON.parse(readTabScoped(LINK_KEY) ?? 'null') as Link | null;
    if (stored && typeof stored.teams === 'string') {
      const [a = '', b = ''] = stored.teams.split('|');
      if (stored.teams === teams || `${b}|${a}` === teams) return { teams, slug: stored.slug };
    }
  } catch {
    // Fall through to a fresh search.
  }
  return { teams, slug: null };
}

export interface PolymarketFeed {
  status: 'idle' | 'searching' | 'not-found' | 'loading' | 'live' | 'error';
  board: LiveBoard | null;
  /** Epoch ms of the last good read. */
  at: number | null;
  error: string | null;
  slug: string | null;
  every: number;
  paused: boolean;
  /** Pin an event by link or slug; false when the text holds no slug. */
  link: (text: string) => boolean;
  /** Forget the pinned event and search by team names again. */
  searchAgain: () => void;
  refresh: () => void;
  setEvery: (seconds: number) => void;
  setPaused: (paused: boolean) => void;
}

/**
 * Live Polymarket prices for the matchup in the composer.
 *
 * With both teams chosen it searches Gamma for the match once, unless a link
 * was pasted for these two teams, then reads the event every few seconds while
 * the tab is visible. A failed read keeps the last good prices on screen with
 * the error beside them; nothing is ever shown for the wrong matchup.
 */
export function usePolymarket(blue: string | null, red: string | null): PolymarketFeed {
  const teams = blue && red ? `${blue}|${red}` : '';
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [link, setLink] = useState<Link>(() => loadLink(teams));
  const [event, setEvent] = useState<{ teams: string; data: GammaEvent } | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<PolymarketFeed['status']>('idle');
  const [searchToken, setSearchToken] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const latest = useRef(0);

  // A new matchup takes its own link, during render, so the old event is never shown against it.
  if (link.teams !== teams) {
    setLink(loadLink(teams));
    setEvent(null);
    setAt(null);
    setError(null);
    setStatus('idle');
  }

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Not persisting is fine.
    }
  }, [prefs]);
  useEffect(() => {
    if (link.teams) writeTabScoped(LINK_KEY, JSON.stringify(link));
  }, [link]);

  // Find the event by team names when nothing is linked.
  useEffect(() => {
    if (!blue || !red || link.slug || prefs.paused) return;
    let cancelled = false;
    setStatus('searching');
    setError(null);
    findEvent(gammaFetch, blue, red, Date.now())
      .then((found) => {
        if (cancelled) return;
        if (found) setLink({ teams: `${blue}|${red}`, slug: found.slug });
        else setStatus('not-found');
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setError(reason instanceof GammaError ? reason.message : 'Polymarket search failed.');
      });
    return () => {
      cancelled = true;
    };
  }, [blue, red, link.slug, prefs.paused, searchToken]);

  // Read the linked event now, then every few seconds while the tab is visible.
  useEffect(() => {
    if (!blue || !red || !link.slug || prefs.paused) return;
    const slug = link.slug;
    const forTeams = `${blue}|${red}`;
    let stopped = false;
    const read = async () => {
      if (stopped || (typeof document !== 'undefined' && document.hidden)) return;
      const request = ++latest.current;
      try {
        const data = await loadEvent(gammaFetch, slug);
        if (stopped || request !== latest.current) return;
        if (!data) {
          setStatus('error');
          setError(`Polymarket has no event "${slug}".`);
          return;
        }
        setEvent({ teams: forTeams, data });
        setAt(Date.now());
        setError(null);
        setStatus('live');
      } catch (reason) {
        if (stopped || request !== latest.current) return;
        setError(reason instanceof GammaError ? reason.message : 'Could not read Polymarket.');
        setStatus((current) => (current === 'live' ? 'live' : 'error'));
      }
    };
    setStatus((current) => (current === 'live' ? current : 'loading'));
    void read();
    const timer = window.setInterval(() => void read(), prefs.every * 1000);
    const onVisible = () => {
      if (!document.hidden) void read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [blue, red, link.slug, prefs.paused, prefs.every, refreshToken]);

  const board = useMemo(
    () => (event && blue && red && event.teams === teams ? readEvent(event.data, blue, red) : null),
    [event, blue, red, teams],
  );

  const pin = useCallback(
    (text: string) => {
      const slug = slugFromLink(text);
      if (!slug || !teams) return false;
      setLink({ teams, slug });
      setEvent(null);
      setAt(null);
      setStatus('loading');
      // The same slug again still means "read it now".
      setRefreshToken((token) => token + 1);
      return true;
    },
    [teams],
  );

  return {
    status: prefs.paused ? 'idle' : status,
    board,
    at,
    error,
    slug: link.slug,
    every: prefs.every,
    paused: prefs.paused,
    link: pin,
    searchAgain: () => {
      setLink({ teams, slug: null });
      setEvent(null);
      setAt(null);
      setSearchToken((token) => token + 1);
    },
    refresh: () => setRefreshToken((token) => token + 1),
    setEvery: (every) => setPrefs((current) => ({ ...current, every })),
    setPaused: (paused) => setPrefs((current) => ({ ...current, paused })),
  };
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

const cents = (p: number | null | undefined) => (p == null ? '—' : `${Math.round(p * 1000) / 10}¢`);
const fair = (p: number) => `${Math.round(p * 100)}¢`;
const signedCents = (p: number) => `${p >= 0 ? '+' : '−'}${Math.abs(Math.round(p * 100))}¢`;
const money = (x: number | null) =>
  x == null ? '—' : x >= 1000 ? `$${(x / 1000).toFixed(x >= 100_000 ? 0 : 1)}k` : `$${Math.round(x)}`;

/** Seconds since the last read, ticking. */
function useAge(at: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [at]);
  return at === null ? null : Math.max(0, Math.round((now - at) / 1000));
}

export function PolymarketPanel({
  feed,
  blueTeam,
  redTeam,
  prediction,
  gameNumber,
}: {
  feed: PolymarketFeed;
  blueTeam: string;
  redTeam: string;
  prediction: Prediction;
  gameNumber: number;
}) {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const age = useAge(feed.at);
  const board = feed.board;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const ok = feed.link(text);
    setBad(!ok);
    if (ok) setText('');
  };

  let line: React.ReactNode;
  if (feed.paused) line = 'Paused';
  else if (feed.status === 'searching') line = 'Looking for the match…';
  else if (feed.status === 'loading') line = 'Reading prices…';
  else if (feed.status === 'not-found') line = 'No open match found';
  else if (board && age !== null) {
    line = (
      <span className={`pm-live${age > STALE_SECONDS ? ' is-stale' : ''}`}>
        <span className="pm-dot" aria-hidden="true" />
        {age > STALE_SECONDS ? `Stale — last read ${age}s ago` : `Live · read ${age}s ago`} · every {feed.every}s
      </span>
    );
  } else if (feed.status === 'error') line = 'Not connected';
  else line = 'Waiting for both teams';

  return (
    <section className="panel polymarket-panel" aria-label="Polymarket odds">
      <div className="panel-header">
        <h2>Polymarket</h2>
        <span className="dim" role="status">
          {line}
        </span>
      </div>
      <div className="panel-pad">
        <div className="pm-bar">
          <form className="pm-link" onSubmit={submit}>
            <input
              className={`input${bad ? ' is-invalid' : ''}`}
              placeholder="Paste the match link from polymarket.com"
              aria-label="Polymarket match link"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setBad(false);
              }}
            />
            <button type="submit" className="btn btn-ghost" disabled={!text.trim()}>
              Link
            </button>
          </form>
          <div className="pm-actions">
            {feed.slug && (
              <button type="button" className="btn btn-ghost" onClick={feed.searchAgain}>
                Search again
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={feed.refresh} disabled={!feed.slug || feed.paused}>
              Refresh
            </button>
            <button type="button" className="btn btn-ghost" aria-pressed={feed.paused} onClick={() => feed.setPaused(!feed.paused)}>
              {feed.paused ? 'Resume' : 'Pause'}
            </button>
            <label className="pm-every">
              <span className="dim">Every</span>
              <select className="select" value={feed.every} onChange={(event) => feed.setEvery(Number(event.target.value))}>
                {INTERVALS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds}s
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {bad && <p className="pm-note is-error">That doesn&apos;t look like a Polymarket link or event slug.</p>}
        {feed.error && <p className="pm-note is-error">{feed.error}</p>}
        {feed.status === 'not-found' && !feed.paused && (
          <p className="pm-note dim">
            No open Polymarket match for {blueTeam} vs {redTeam} turned up. Open the match on polymarket.com and
            paste its link above.
          </p>
        )}
        {board && (
          <Board board={board} blueTeam={blueTeam} redTeam={redTeam} prediction={prediction} gameNumber={gameNumber} />
        )}
      </div>
    </section>
  );
}

function Quote({ quote }: { quote: OutcomeQuote | null }) {
  if (!quote) return <span className="dim">—</span>;
  return (
    <span className="pm-quote">
      <strong>{cents(quote.buy)}</strong>
      <span className="dim">sell {cents(quote.sell)}</span>
    </span>
  );
}

function Board({
  board,
  blueTeam,
  redTeam,
  prediction,
  gameNumber,
}: {
  board: LiveBoard;
  blueTeam: string;
  redTeam: string;
  prediction: Prediction;
  gameNumber: number;
}) {
  const start = board.event.start ? new Date(board.event.start) : null;
  const rows: { market: LiveMarket; model: number | null; current: boolean }[] = [
    ...(board.series ? [{ market: board.series, model: prediction.seriesProbBlue, current: false }] : []),
    ...board.games.map((market) => {
      const current = market.kind.kind === 'game' && market.kind.game === gameNumber;
      return { market, model: current ? prediction.gameProbBlue : null, current };
    }),
  ];

  /** The better of the two edges: the model's fair price minus what a share costs. */
  const edge = (market: LiveMarket, model: number | null) => {
    if (model === null) return null;
    const options = [
      { team: blueTeam, value: market.blue?.buy != null ? model - market.blue.buy : null },
      { team: redTeam, value: market.red?.buy != null ? 1 - model - market.red.buy : null },
    ].filter((option): option is { team: string; value: number } => option.value !== null);
    return options.sort((a, b) => b.value - a.value)[0] ?? null;
  };

  return (
    <>
      <p className="pm-event">
        <a href={board.event.url} target="_blank" rel="noreferrer">
          {board.event.title}
        </a>
        {start && !Number.isNaN(start.getTime()) && (
          <span className="dim">
            {' '}
            · {start.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {board.event.closed && <span className="dim"> · settled</span>}
      </p>
      {rows.length === 0 ? (
        <p className="pm-note dim">This event has no winner markets for {blueTeam} and {redTeam}.</p>
      ) : (
        <div className="pm-table-wrap">
          <table className="team-stat-table pm-table">
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col" className="pm-team is-blue">
                  {blueTeam}
                </th>
                <th scope="col" className="pm-team is-red">
                  {redTeam}
                </th>
                <th scope="col">Model</th>
                <th scope="col">Edge</th>
                <th scope="col">Volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ market, model, current }) => {
                const best = edge(market, model);
                return (
                  <tr key={market.id} className={`${current ? 'is-current' : ''}${market.open ? '' : ' is-closed'}`}>
                    <th scope="row">
                      {market.label}
                      {current && <span className="pm-tag">now</span>}
                      {!market.open && <span className="pm-tag is-muted">closed</span>}
                    </th>
                    <td>
                      <Quote quote={market.blue} />
                    </td>
                    <td>
                      <Quote quote={market.red} />
                    </td>
                    <td>{model === null ? <span className="dim">—</span> : `${fair(model)} · ${fair(1 - model)}`}</td>
                    <td className={best && best.value > 0 ? 'pm-edge is-positive' : 'pm-edge'}>
                      {best ? `${signedCents(best.value)} ${best.team}` : <span className="dim">—</span>}
                    </td>
                    <td>{money(market.volume)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {board.other.length > 0 && (
        <details className="pm-other">
          <summary>Other markets ({board.other.length})</summary>
          <ul>
            {board.other.map((market) => (
              <li key={market.id}>
                <span>{market.label}</span>
                <span className="dim">
                  {market.outcomes.map((outcome) => `${outcome.name} ${cents(outcome.buy)}`).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="pm-note dim">
        Buy is the best ask, sell the best bid, as Polymarket&apos;s Gamma API last reported them — it can trail the
        live order book by a few seconds. Model is the Predictor&apos;s fair price for each team; edge is the better
        of fair price minus buy price, shown on the series and on the game being drafted.
      </p>
    </>
  );
}
