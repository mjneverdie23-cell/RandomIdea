import { useEffect, useMemo, useRef, useState } from 'react';
import aliasFile from '../../../scripts/lolesports-aliases.json';
import {
  liveMatches,
  readEventDetails,
  snapTeamName,
  teamsFromSeasons,
  type MatchListing,
} from '../../../scripts/lib/lolesports.mjs';
import { FeedError, lolApi, lolWindow } from '../../lib/lolesportsClient.ts';
import { liveGame, readLive, type LiveRead } from '../../predictor/liveDraft.ts';
import { useDataset } from '../../state/DatasetContext.tsx';
import { usePredictor } from '../../state/PredictorContext.tsx';
import { readTabScoped, writeTabScoped } from '../../storage/tabScoped.ts';

/** The followed match belongs to this tab, and survives a reload. */
const FOLLOW_KEY = 'draftcall.livedraft.v1';
const EVERY_SECONDS = 10;

interface Follow {
  matchId: string;
  label: string;
}

/** Aliases from `scripts/lolesports-aliases.json`, the same file `npm run draft:live` reads. */
const ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries((aliasFile as { teams?: Record<string, string> }).teams ?? {}).filter(([key]) => !key.startsWith('_')),
);

function loadFollow(): Follow | null {
  try {
    const parsed = JSON.parse(readTabScoped(FOLLOW_KEY) ?? 'null') as Follow | null;
    return parsed && typeof parsed.matchId === 'string' ? { matchId: parsed.matchId, label: String(parsed.label ?? '') } : null;
  } catch {
    return null;
  }
}

const gold = (value: number | null) => (value === null ? '—' : `${(value / 1000).toFixed(1)}k`);
const pair = (values: [number | null, number | null], format: (value: number | null) => string = (v) => String(v ?? '—')) =>
  `${format(values[0])} – ${format(values[1])}`;

/**
 * Follow a match on LoL Esports and keep the composer filled from it.
 *
 * Shown only in Live mode, where the feed is in charge of the composer: every
 * few seconds it reads the match, and the live game's stats window once one is
 * in progress, and fills the composer whenever what it should hold changes — a
 * new game, the champions arriving. Switching to Manual unmounts it, which
 * stops the reads; the followed match is kept, so switching back picks it up
 * again and refills the composer straight away.
 */
export function LiveDraftPanel({ onFollowingChange }: { onFollowingChange?: (following: boolean) => void }) {
  const { dataset } = useDataset();
  const { setDraft } = usePredictor();
  const games = useMemo(() => dataset?.games ?? [], [dataset]);
  const known = useMemo(() => teamsFromSeasons([{ games }]), [games]);

  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; matches: MatchListing[]; error: string | null }>({
    status: 'idle',
    matches: [],
    error: null,
  });
  const [follow, setFollow] = useState<Follow | null>(loadFollow);
  const [read, setRead] = useState<LiveRead | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const applied = useRef<string | null>(null);
  const [filledAt, setFilledAt] = useState<number | null>(null);

  useEffect(() => writeTabScoped(FOLLOW_KEY, JSON.stringify(follow)), [follow]);
  useEffect(() => onFollowingChange?.(follow !== null), [follow, onFollowingChange]);

  const fill = (next: LiveRead) => {
    if (!next.composer || !next.fingerprint) return;
    setDraft(next.composer);
    applied.current = next.fingerprint;
    setFilledAt(Date.now());
  };
  const fillRef = useRef(fill);
  fillRef.current = fill;

  const findMatches = async () => {
    setOpen(true);
    setList((current) => ({ ...current, status: 'loading', error: null }));
    try {
      const matches = liveMatches(await lolApi('getLive'));
      // Matches between teams in your data first: those are the ones the Predictor can read.
      const fits = (match: MatchListing) =>
        match.teams.every((team) => snapTeamName(team.name, team.code, known, ALIASES).via !== null);
      setList({ status: 'ready', matches: [...matches].sort((a, b) => Number(fits(b)) - Number(fits(a))), error: null });
    } catch (reason) {
      setList({ status: 'error', matches: [], error: reason instanceof FeedError ? reason.message : 'Could not load live matches.' });
    }
  };

  // Read the followed match now, then every few seconds while the tab is visible.
  useEffect(() => {
    if (!follow) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      if (stopped || document.hidden) return;
      try {
        const detailsJson = await lolApi('getEventDetails', { id: follow.matchId });
        // Switched to Manual (or stopped) while that was in flight: read nothing more.
        if (stopped) return;
        const details = readEventDetails(detailsJson);
        const game = details ? liveGame(details) : null;
        const windowJson = game ? await lolWindow(game.id) : null;
        if (stopped) return;
        const next = readLive(detailsJson, windowJson, known, ALIASES);
        if (!next) {
          setError('LoL Esports has no details for that match.');
          return;
        }
        setRead(next);
        setAt(Date.now());
        setError(null);
        if (next.fingerprint && next.fingerprint !== applied.current) fillRef.current(next);
        if (next.state === 'finished' && timer !== undefined) window.clearInterval(timer);
      } catch (reason) {
        if (!stopped) setError(reason instanceof FeedError ? reason.message : 'Could not read the match.');
      }
    };
    void tick();
    timer = window.setInterval(() => void tick(), EVERY_SECONDS * 1000);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [follow, known]);

  const start = (match: MatchListing) => {
    const [a, b] = match.teams;
    applied.current = null;
    setRead(null);
    setAt(null);
    setFilledAt(null);
    setError(null);
    setOpen(false);
    setFollow({
      matchId: match.matchId,
      label: `${match.league?.name ?? 'Match'} · ${a?.name ?? '?'} vs ${b?.name ?? '?'}${match.bestOf ? ` · BO${match.bestOf}` : ''}`,
    });
  };

  const stop = () => {
    setFollow(null);
    setRead(null);
    setAt(null);
    setError(null);
    applied.current = null;
  };

  return (
    <section className="paste-panel live-draft" aria-label="Live draft">
      <header className="paste-head">
        <div>
          <h2>Live draft</h2>
          <p className="dim">
            Follow a match on LoL Esports. The teams, series score and game fill in as soon as a game starts; the
            champions as soon as it loads — the feed doesn&apos;t show champion select pick by pick.
          </p>
        </div>
        {follow ? (
          <button type="button" className="btn btn-sm" onClick={stop}>
            Stop following
          </button>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => void findMatches()}>
            {open ? 'Refresh' : 'Find live matches'}
          </button>
        )}
      </header>

      {!follow && open && (
        <div className="live-draft-body">
          {list.status === 'loading' && <p className="dim">Looking for live matches…</p>}
          {list.status === 'error' && <p className="pm-note is-error">{list.error}</p>}
          {list.status === 'ready' && list.matches.length === 0 && (
            <p className="dim">Nothing is live on LoL Esports right now.</p>
          )}
          {list.matches.length > 0 && (
            <ul className="live-draft-list">
              {list.matches.map((match) => {
                const [a, b] = match.teams;
                const unknown = match.teams.filter((team) => snapTeamName(team.name, team.code, known, ALIASES).via === null);
                return (
                  <li key={match.matchId}>
                    <span className="live-draft-league">{match.league?.name ?? '—'}</span>
                    <span className="live-draft-teams">
                      <strong>{a?.name}</strong> <span className="num">{a?.wins ?? 0}–{b?.wins ?? 0}</span> <strong>{b?.name}</strong>
                      {match.bestOf && <span className="dim"> · BO{match.bestOf}</span>}
                      {match.blockName && <span className="dim"> · {match.blockName}</span>}
                    </span>
                    {unknown.length > 0 && (
                      <span className="dim live-draft-unknown">not in your data: {unknown.map((team) => team.name).join(', ')}</span>
                    )}
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => start(match)}>
                      Follow
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {follow && (
        <div className="live-draft-body">
          <p className="live-draft-following">
            <span className="pm-dot" aria-hidden="true" /> Following <strong>{follow.label}</strong>
          </p>
          <p className="live-draft-state" role="status">
            {describe(read, at)}
          </p>
          {read?.inGame && read.game && read.state === 'drafted' && (
            <p className="live-draft-ingame dim">
              In game, {read.composer?.blue.team ?? 'blue'} – {read.composer?.red.team ?? 'red'}: gold{' '}
              {pair(read.inGame.gold, gold)} · kills {pair(read.inGame.kills)} · towers {pair(read.inGame.towers)}
            </p>
          )}
          {error && <p className="pm-note is-error">{error}</p>}
          {read && read.warnings.length > 0 && (
            <ul className="live-draft-warnings">
              {read.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {filledAt && (
            <p className="live-draft-actions dim">Composer filled at {new Date(filledAt).toLocaleTimeString()}.</p>
          )}
        </div>
      )}
    </section>
  );
}

function describe(read: LiveRead | null, at: number | null): string {
  if (!read || at === null) return 'Reading the match…';
  const [a, b] = read.details.teams;
  const score = `${a?.name ?? '?'} ${a?.wins ?? 0}–${b?.wins ?? 0} ${b?.name ?? '?'}`;
  switch (read.state) {
    case 'drafted':
      return `Game ${read.game?.number} is live, champions in · series ${score}`;
    case 'loading':
      return `Game ${read.game?.number} is live — champions appear when it loads · series ${score}`;
    case 'waiting':
      return `Waiting for game ${read.next} · series ${score}`;
    case 'finished':
      return `Series over · ${score}`;
  }
}
