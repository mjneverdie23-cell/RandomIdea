import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChampionLabel } from '../components/ChampionLabel.tsx';
import { ChampionLookup } from '../components/tournament/ChampionLookup.tsx';
import { GoldGraph } from '../components/tournament/GoldGraph.tsx';
import { ROLES, ROLE_LABEL, ROLE_SHORT, type Champion, type Game, type Role, type TeamObjectives } from '../domain/types.ts';
import { formatCount, formatDate, formatDuration } from '../lib/format.ts';
import { decodePicks, encodePicks, rolePools, type LookupQuery } from '../predictor/championLookup.ts';
import { buildPredictorModel, isPocketPick, metaByPatch } from '../predictor/derive.ts';
import { ratingsFromStored, type StoredRatings } from '../predictor/ratings.ts';
import {
  BIG_UPSET,
  TOSS_UP,
  callTournament,
  championsByRole,
  contestedChampions,
  gameCall,
  goldStory,
  pocketSummary,
  seriesCall,
  stageGames,
  tournamentGames,
  tournamentOptions,
  tournamentRecords,
  tournamentStructure,
  type Call,
  type ChampionLine,
  type ContestedLine,
  type EventSeries,
  type GameCall,
  type GoldStory,
  type PocketSummary,
  type StageOption,
  type TournamentOption,
  type TournamentRecords,
  type Verdict,
} from '../predictor/tournament.ts';
import type { PatchMeta } from '../predictor/types.ts';
import { useDataset } from '../state/DatasetContext.tsx';
import { usePredictor } from '../state/PredictorContext.tsx';

const TOURNAMENT_KEY = 'draftcall.tournament.v1';

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');
const percent = (probability: number) => `${Math.round(probability * 100)}%`;
const amount = (value: number) => Math.abs(Math.round(value)).toLocaleString();
const at = (minute: number) => (Number.isInteger(minute) ? `${minute} min` : formatDuration(Math.round(minute * 60)));
const winnerName = (game: Game) => (game.winner === 'blue' ? game.blue : game.red).teamName;
const loserName = (game: Game) => (game.winner === 'blue' ? game.red : game.blue).teamName;

const VERDICT_LABEL: Record<Verdict, string> = {
  expected: 'As expected',
  upset: 'Upset',
  'big upset': 'Big upset',
  'toss-up': 'Toss-up',
};

function loadKey(): string | null {
  try {
    return localStorage.getItem(TOURNAMENT_KEY);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* The Predictor's calls, scored once per tournament and kept           */
/* ------------------------------------------------------------------ */

/** Per dataset, per ratings table, per tournament — any change of either starts afresh. */
const callCache = new WeakMap<readonly Game[], WeakMap<StoredRatings, Map<string, Map<string, GameCall>>>>();

function cachedCalls(games: readonly Game[], ratings: StoredRatings, key: string) {
  return callCache.get(games)?.get(ratings)?.get(key) ?? null;
}

function storeCalls(games: readonly Game[], ratings: StoredRatings, key: string, calls: Map<string, GameCall>) {
  const byRatings = callCache.get(games) ?? new WeakMap();
  callCache.set(games, byRatings);
  const byKey = byRatings.get(ratings) ?? new Map();
  byRatings.set(ratings, byKey);
  byKey.set(key, calls);
}

interface CallState {
  calls: Map<string, GameCall> | null;
  progress: { done: number; total: number } | null;
}

function useTournamentCalls(
  games: readonly Game[],
  key: string,
  series: EventSeries[],
  ratings: StoredRatings,
  ready: boolean,
): CallState {
  const [state, setState] = useState<CallState & { key: string }>({ key: '', calls: null, progress: null });
  const cached = cachedCalls(games, ratings, key);

  useEffect(() => {
    if (!ready || !key || series.length === 0 || cachedCalls(games, ratings, key)) return;
    let cancelled = false;
    const ratingMap = ratingsFromStored(ratings);
    setState({ key, calls: null, progress: { done: 0, total: 1 } });
    void callTournament(games, series, (history) => buildPredictorModel(history, ratingMap), {
      cancelled: () => cancelled,
      onProgress: (done, total) => {
        if (!cancelled) setState({ key, calls: null, progress: { done, total } });
      },
    }).then((calls) => {
      if (cancelled || !calls) return;
      storeCalls(games, ratings, key, calls);
      setState({ key, calls, progress: null });
    });
    return () => {
      cancelled = true;
    };
  }, [games, key, series, ratings, ready]);

  if (cached) return { calls: cached, progress: null };
  return state.key === key ? state : { calls: null, progress: null };
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

/**
 * Tournament: one event at a time, stage by stage. What was drafted in each
 * lane, the pocket picks, which results the Predictor saw coming, and every
 * game's gold — biggest leads, comebacks and when they happened.
 */
export function TournamentPage() {
  const { dataset } = useDataset();
  const games = useMemo(() => dataset?.games ?? [], [dataset]);
  const { ratings, ratingsStatus } = usePredictor();
  const [params, setParams] = useSearchParams();

  const options = useMemo(() => tournamentOptions(games), [games]);
  const wanted = params.get('t') ?? loadKey();
  const option = options.find((entry) => entry.key === wanted) ?? options[0] ?? null;
  const key = option?.key ?? '';

  const eventGames = useMemo(() => (key ? tournamentGames(games, key) : []), [games, key]);
  const structure = useMemo(() => tournamentStructure(eventGames), [eventGames]);
  const stage = structure.stages.find((entry) => entry.id === params.get('stage')) ?? structure.stages[0] ?? null;
  // What a patch's meta was is judged across every loaded game, not just this event's.
  const meta = useMemo(() => metaByPatch(games), [games]);
  const { calls, progress } = useTournamentCalls(games, key, structure.series, ratings, ratingsStatus === 'ready');
  // The lookup offers every champion seen in each role, not only this event's.
  const pools = useMemo(() => rolePools(games), [games]);

  // The lookup's champions and team ride along in the link, so they survive a
  // change of stage or tournament and a shared link opens on the same lookup.
  const lookup = useMemo<LookupQuery>(
    () => ({ picks: decodePicks(params.get('picks')), team: params.get('team') || null }),
    [params],
  );
  const go = (t: string, stageId: string | undefined, next: LookupQuery) => {
    const encoded = encodePicks(next.picks);
    setParams(
      {
        t,
        ...(stageId && stageId !== 'all' ? { stage: stageId } : {}),
        ...(next.team ? { team: next.team } : {}),
        ...(encoded ? { picks: encoded } : {}),
      },
      { replace: true },
    );
  };
  const chooseTournament = (next: string) => {
    try {
      localStorage.setItem(TOURNAMENT_KEY, next);
    } catch {
      // Remembering the tournament is a convenience.
    }
    go(next, undefined, lookup);
  };
  const chooseStage = (id: string) => go(key, id, lookup);
  const chooseLookup = (next: LookupQuery) => go(key, stage?.id, next);

  return (
    <div className="page tournament-page">
      <header className="page-head">
        <div>
          <h1>Tournament</h1>
          <p className="page-sub">
            One event, stage by stage: the champions each lane played, the pocket picks, which
            results the Predictor saw coming and which it didn&apos;t, and every game&apos;s gold —
            the biggest leads, the comebacks and when they happened.
          </p>
        </div>
      </header>

      <section className="context-bar tournament-controls">
        <label className="field">
          <span className="field-label">Tournament</span>
          <TournamentSelect options={options} value={key} onChange={chooseTournament} />
        </label>
        {option && (
          <span className="dim tournament-dates">
            {formatDate(new Date(option.first).toISOString())} – {formatDate(new Date(option.last).toISOString())} ·{' '}
            {formatCount(option.games, 'game')}
          </span>
        )}
      </section>

      {!option || !stage ? (
        <div className="empty-state">
          <p>Load some games on the Data page to see a tournament.</p>
        </div>
      ) : (
        <>
          <StagePicker stages={structure.stages} value={stage.id} onChange={chooseStage} />
          <StageReport
            key={`${key}|${stage.id}`}
            stage={stage}
            scope={`${option.label} · ${stage.section === 'Event' ? stage.label : `${stage.section} ${stage.label}`}`}
            meta={meta}
            calls={calls}
            progress={progress}
            pools={pools}
            lookup={lookup}
            onLookup={chooseLookup}
          />
        </>
      )}
    </div>
  );
}

function TournamentSelect({
  options,
  value,
  onChange,
}: {
  options: TournamentOption[];
  value: string;
  onChange: (key: string) => void;
}) {
  const groups: [string, TournamentOption[]][] = [
    ['International', options.filter((option) => option.international)],
    ['Leagues', options.filter((option) => !option.international && option.competition !== 'OTHER')],
    ['Other events', options.filter((option) => option.competition === 'OTHER')],
  ];
  return (
    <select id="tournament-select" className="select" value={value} onChange={(event) => onChange(event.target.value)}>
      {groups
        .filter(([, list]) => list.length > 0)
        .map(([label, list]) => (
          <optgroup key={label} label={label}>
            {list.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label} ({option.games})
              </option>
            ))}
          </optgroup>
        ))}
    </select>
  );
}

function StagePicker({ stages, value, onChange }: { stages: StageOption[]; value: string; onChange: (id: string) => void }) {
  const sections: [string, StageOption[]][] = [];
  for (const stage of stages) {
    const last = sections.at(-1);
    if (last && last[0] === stage.section) last[1].push(stage);
    else sections.push([stage.section, [stage]]);
  }
  return (
    <nav className="panel panel-pad tournament-stages" aria-label="Stage">
      {sections.map(([section, list]) => (
        <div key={section} className="tournament-stage-group">
          <span className="tournament-stage-label">{section}</span>
          <div className="chip-row">
            {list.map((stage) => (
              <button
                key={stage.id}
                type="button"
                className="chip chip-sm"
                aria-pressed={stage.id === value}
                onClick={() => onChange(stage.id)}
              >
                {stage.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* One stage                                                           */
/* ------------------------------------------------------------------ */

function StageReport({
  stage,
  scope,
  meta,
  calls,
  progress,
  pools,
  lookup,
  onLookup,
}: {
  stage: StageOption;
  scope: string;
  meta: ReadonlyMap<string, PatchMeta>;
  calls: Map<string, GameCall> | null;
  progress: { done: number; total: number } | null;
  pools: Record<Role, { champion: Champion; picks: number }[]>;
  lookup: LookupQuery;
  onLookup: (lookup: LookupQuery) => void;
}) {
  const games = useMemo(() => stageGames(stage), [stage]);
  const records = useMemo(() => tournamentRecords(games), [games]);
  const lanes = useMemo(() => championsByRole(games), [games]);
  const contested = useMemo(() => contestedChampions(games), [games]);
  const pockets = useMemo(() => pocketSummary(games, meta), [games, meta]);
  const roundOf = useMemo(() => {
    const map = new Map<string, EventSeries>();
    for (const entry of stage.series) for (const game of entry.games) map.set(game.gameId, entry);
    return map;
  }, [stage]);

  if (games.length === 0) {
    return (
      <div className="empty-state">
        <p>No games in this stage yet.</p>
      </div>
    );
  }

  const teams = new Set(games.flatMap((game) => [game.blue.teamName.toLowerCase(), game.red.teamName.toLowerCase()]));
  const patches = [...new Set(games.map((game) => game.patch).filter(Boolean))];

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <h2>{stage.section === 'Event' ? stage.label : `${stage.section} · ${stage.label}`}</h2>
          <span className="dim">{patches.length ? `Patch ${patches.join(', ')}` : 'patch not recorded'}</span>
        </div>
        <div className="panel-pad stat-grid">
          <Stat label="Series" value={String(stage.series.length)} sub={formatCount(games.length, 'game')} />
          <Stat label="Teams" value={String(teams.size)} />
          <Stat label="Blue side won" value={pct(records.blueWins, records.games)} sub={`${records.blueWins} of ${records.games} games`} />
          <Stat label="Average game time" value={formatDuration(records.averageSeconds)} />
        </div>
      </section>

      <ChampionLookup games={games} allPools={pools} query={lookup} onChange={onLookup} scope={scope} roundOf={roundOf} />
      <CallsPanel stage={stage} calls={calls} progress={progress} />
      <LanesPanel lanes={lanes} />
      <BansPanel contested={contested} games={games.length} />
      <PocketPanel pockets={pockets} />
      <RecordsPanel records={records} roundOf={roundOf} />
      <GamesPanel stage={stage} calls={calls} meta={meta} />
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub dim">{sub}</span>}
    </div>
  );
}

const roundLabel = (entry: EventSeries) => (entry.pool ? `${entry.round} · ${entry.pool} pool` : entry.round);
const scoreline = (entry: EventSeries) => `${Math.max(...entry.wins)}–${Math.min(...entry.wins)}`;

/* ------------------------------------------------------------------ */
/* Expected and unexpected                                             */
/* ------------------------------------------------------------------ */

function CallsPanel({
  stage,
  calls,
  progress,
}: {
  stage: StageOption;
  calls: Map<string, GameCall> | null;
  progress: { done: number; total: number } | null;
}) {
  const header = (
    <div className="panel-header">
      <h2>Expected and unexpected</h2>
      <span className="dim">the Predictor&apos;s call before each game, from earlier games only</span>
    </div>
  );
  if (!calls) {
    return (
      <section className="panel">
        {header}
        <div className="panel-pad">
          <p className="tournament-progress" role="status">
            <span className="spinner" aria-hidden="true" />
            {progress
              ? `Scoring match day ${progress.done} of ${progress.total} from the games before it…`
              : 'Getting the Predictor ready…'}
          </p>
        </div>
      </section>
    );
  }

  const seriesCalls = stage.series
    .map((entry) => ({ entry, call: seriesCall(entry, calls) }))
    .filter((row): row is { entry: EventSeries; call: Call } => row.call !== null);
  const gameCalls = stage.series
    .flatMap((entry) => entry.games.map((game) => ({ entry, game, call: gameCall(game, calls.get(game.gameId)) })))
    .filter((row): row is { entry: EventSeries; game: Game; call: Call } => row.call !== null);

  const isUpset = (verdict: Verdict) => verdict === 'upset' || verdict === 'big upset';
  const seriesRight = seriesCalls.filter(({ entry, call }) => entry.winner?.toLowerCase() === call.favourite.toLowerCase());
  const gamesRight = gameCalls.filter(({ game, call }) => winnerName(game).toLowerCase() === call.favourite.toLowerCase());
  const upsets = seriesCalls.filter(({ call }) => isUpset(call.verdict)).sort((a, b) => b.call.probability - a.call.probability);
  const expected = seriesCalls.filter(({ call }) => call.verdict === 'expected').sort((a, b) => b.call.probability - a.call.probability);
  const tossUps = seriesCalls.filter(({ call }) => call.verdict === 'toss-up');
  const gameUpsets = gameCalls.filter(({ call }) => isUpset(call.verdict)).sort((a, b) => b.call.probability - a.call.probability);

  return (
    <section className="panel">
      {header}
      <div className="panel-pad">
        <div className="stat-grid">
          <Stat label="Series called" value={pct(seriesRight.length, seriesCalls.length)} sub={`${seriesRight.length} of ${seriesCalls.length} finished series`} />
          <Stat label="Games called" value={pct(gamesRight.length, gameCalls.length)} sub={`${gamesRight.length} of ${gameCalls.length} games`} />
          <Stat
            label="Upsets"
            value={String(upsets.length)}
            sub={`${upsets.filter(({ call }) => call.verdict === 'big upset').length} big · favourite ${percent(BIG_UPSET)}+`}
          />
          <Stat label="Toss-ups" value={String(tossUps.length)} sub={`under ${percent(TOSS_UP)} either way`} />
        </div>

        <div className="tournament-calls">
          <div>
            <h3 className="tournament-subhead">Upsets</h3>
            {upsets.length ? (
              <ul className="call-list">
                {upsets.map(({ entry, call }) => (
                  <SeriesCallRow key={entry.id} entry={entry} call={call} />
                ))}
              </ul>
            ) : (
              <p className="team-stat-note dim">No series went against the Predictor&apos;s favourite.</p>
            )}
          </div>
          <div>
            <h3 className="tournament-subhead">Games that went the other way</h3>
            {gameUpsets.length ? (
              <ul className="call-list">
                {gameUpsets.slice(0, 8).map(({ entry, game, call }) => (
                  <li key={game.gameId} className="call-row">
                    <VerdictBadge verdict={call.verdict} />
                    <span>
                      <strong>{winnerName(game)}</strong> beat {loserName(game)} in game {game.gameNumber}
                    </span>
                    <span className="dim">
                      Predictor had {call.favourite} {percent(call.probability)} · {roundLabel(entry)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="team-stat-note dim">Every game went the favourite&apos;s way, or was a toss-up.</p>
            )}
          </div>
        </div>

        {expected.length > 0 && (
          <details className="team-stat-others">
            <summary>As expected ({expected.length})</summary>
            <ul className="call-list">
              {expected.map(({ entry, call }) => (
                <SeriesCallRow key={entry.id} entry={entry} call={call} />
              ))}
            </ul>
          </details>
        )}
        <p className="team-stat-note dim">
          Each game is scored by the Predictor with both drafts, the stage, the best-of and the series
          score going in, from a model built only out of games played before that match day. A series
          call is its chance to win the series once the game-1 draft was in. Under {percent(TOSS_UP)} is
          a toss-up; an upset at {percent(BIG_UPSET)} or more is a big upset. Team ratings are the table
          the Predictor is using now.
        </p>
      </div>
    </section>
  );
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span className={`call-badge call-badge--${verdict.replace(' ', '-')}`}>{VERDICT_LABEL[verdict]}</span>;
}

function SeriesCallRow({ entry, call }: { entry: EventSeries; call: Call }) {
  const loser = entry.teams.find((team) => team !== entry.winner) ?? '';
  return (
    <li className="call-row">
      <VerdictBadge verdict={call.verdict} />
      <span>
        <strong>{entry.winner}</strong> beat {loser} {scoreline(entry)}
      </span>
      <span className="dim">
        Predictor had {call.favourite} {percent(call.probability)} · {roundLabel(entry)}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Champions                                                           */
/* ------------------------------------------------------------------ */

const LANE_ROWS = 6;

function LanesPanel({ lanes }: { lanes: Record<Role, ChampionLine[]> }) {
  // One scale across every lane, so a bar means the same number of games everywhere.
  const most = Math.max(1, ...ROLES.map((role) => lanes[role][0]?.picks ?? 0));
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Most played by lane</h2>
        <span className="dim">games picked · wins–losses</span>
      </div>
      <div className="panel-pad tournament-lanes">
        {ROLES.map((role) => (
          <div key={role} className="tournament-lane">
            <h3 className="tournament-subhead">
              {ROLE_LABEL[role]} <span className="dim">· {formatCount(lanes[role].length, 'champion')}</span>
            </h3>
            <ChampionBars lines={lanes[role].slice(0, LANE_ROWS)} most={most} />
            {lanes[role].length > LANE_ROWS && (
              <details className="tournament-more">
                <summary>All {lanes[role].length}</summary>
                <ChampionBars lines={lanes[role].slice(LANE_ROWS)} most={most} />
              </details>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ChampionBars({ lines, most }: { lines: ChampionLine[]; most: number }) {
  return (
    <ol className="champ-bars">
      {lines.map((line) => (
        <li key={line.champion.id} title={line.players.map((player) => `${player.name} (${player.team}) ×${player.games}`).join(', ')}>
          <ChampionLabel id={line.champion.id} name={line.champion.name} />
          <span className="champ-bar" aria-hidden="true">
            <span style={{ width: `${(line.picks / most) * 100}%` }} />
          </span>
          <span className="num">{line.picks}</span>
          <span className="dim num">
            {line.wins}–{line.picks - line.wins}
          </span>
        </li>
      ))}
    </ol>
  );
}

const BAN_ROWS = 10;

function BansPanel({ contested, games }: { contested: ContestedLine[]; games: number }) {
  const banned = contested.filter((line) => line.bans > 0).slice(0, BAN_ROWS);
  const present = [...contested].sort((a, b) => b.presence - a.presence || b.picks - a.picks).slice(0, BAN_ROWS);
  const mostBans = Math.max(1, banned[0]?.bans ?? 0);
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Bans and presence</h2>
        <span className="dim">presence is picked or banned, out of {formatCount(games, 'game')}</span>
      </div>
      <div className="panel-pad tournament-pair">
        <div>
          <h3 className="tournament-subhead">Most banned</h3>
          <ol className="champ-bars">
            {banned.map((line) => (
              <li key={line.champion.id}>
                <ChampionLabel id={line.champion.id} name={line.champion.name} />
                <span className="champ-bar" aria-hidden="true">
                  <span style={{ width: `${(line.bans / mostBans) * 100}%` }} />
                </span>
                <span className="num">{line.bans}</span>
                <span className="dim num">{percent(line.presence)}</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3 className="tournament-subhead">Highest presence</h3>
          <ol className="champ-bars">
            {present.map((line) => (
              <li key={line.champion.id}>
                <ChampionLabel id={line.champion.id} name={line.champion.name} />
                <span className="champ-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(1, line.presence) * 100}%` }} />
                </span>
                <span className="num">{percent(line.presence)}</span>
                <span className="dim num">
                  {line.picks}p {line.bans}b
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function PocketPanel({ pockets }: { pockets: PocketSummary }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Pocket picks</h2>
        <span className="dim">off the meta of the patch each game was played on</span>
      </div>
      <div className="panel-pad">
        <div className="stat-grid">
          <Stat label="Drafts with a pocket pick" value={pct(pockets.pocketDrafts, pockets.judged)} sub={`${pockets.pocketDrafts} of ${pockets.judged} drafts`} />
          <Stat
            label="Won with a pocket pick"
            value={pct(pockets.pocketWins, pockets.pocketDrafts)}
            sub={`all-meta drafts ${pct(pockets.metaWins, pockets.metaDrafts)} (${pockets.metaDrafts})`}
          />
        </div>
        {pockets.lines.length ? (
          <table className="team-stat-table team-stat-pockets">
            <thead>
              <tr>
                <th scope="col">Pocket pick</th>
                <th scope="col">Role</th>
                <th scope="col">Played by</th>
                <th scope="col">Games</th>
                <th scope="col">W–L</th>
              </tr>
            </thead>
            <tbody>
              {pockets.lines.map((line) => (
                <tr key={`${line.role}|${line.champion.id}`}>
                  <th scope="row">
                    <ChampionLabel id={line.champion.id} name={line.champion.name} />
                  </th>
                  <td>{ROLE_SHORT[line.role]}</td>
                  <td>{line.players.map((player) => `${player.name} (${player.team})`).join(', ')}</td>
                  <td>{line.picks}</td>
                  <td>
                    {line.wins}–{line.picks - line.wins}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="team-stat-note dim">No pocket picks in this stage — every pick was meta for its patch.</p>
        )}
        <p className="team-stat-note dim">
          A pick is a pocket pick when it was contested (picked or banned) in under 5% of games over its
          patch and the one before, across every loaded league — the same rule as the Predictor and Team
          Stat.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

function RecordsPanel({ records, roundOf }: { records: TournamentRecords; roundOf: Map<string, EventSeries> }) {
  const where = (game: Game) => {
    const entry = roundOf.get(game.gameId);
    return `${entry ? `${entry.round} · ` : ''}${formatDate(game.date)}`;
  };
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Records</h2>
        <span className="dim">gold read at 10, 15, 20, 25 minutes and at the end</span>
      </div>
      <div className="panel-pad tournament-records">
        <div>
          <h3 className="tournament-subhead">Biggest comebacks</h3>
          {records.comebacks.length ? (
            <ol className="record-list">
              {records.comebacks.map((moment) => (
                <li key={moment.game.gameId}>
                  <strong className="num">{amount(moment.amount)}</strong>
                  <span>
                    <strong>{moment.team}</strong> came back from {amount(moment.amount)} down at {at(moment.minute)} vs{' '}
                    {moment.opponent}
                  </span>
                  <span className="dim">{where(moment.game)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="team-stat-note dim">No winner trailed at a recorded mark.</p>
          )}
        </div>
        <div>
          <h3 className="tournament-subhead">Biggest leads at 15 minutes</h3>
          <ol className="record-list">
            {records.leadsAt15.map((moment) => (
              <li key={moment.game.gameId}>
                <strong className="num">+{amount(moment.amount)}</strong>
                <span>
                  <strong>{moment.team}</strong> vs {moment.opponent} — {moment.held ? 'won' : 'thrown, lost'}
                </span>
                <span className="dim">{where(moment.game)}</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3 className="tournament-subhead">Fastest and longest</h3>
          <ol className="record-list">
            {[...records.fastest, ...records.longest.filter((game) => !records.fastest.includes(game))].map((game, index) => (
              <li key={game.gameId}>
                <strong className="num">{formatDuration(game.durationSeconds)}</strong>
                <span>
                  {index < records.fastest.length ? 'Fast' : 'Long'}: <strong>{winnerName(game)}</strong> over {loserName(game)}
                </span>
                <span className="dim">{where(game)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Every series and game                                               */
/* ------------------------------------------------------------------ */

function GamesPanel({
  stage,
  calls,
  meta,
}: {
  stage: StageOption;
  calls: Map<string, GameCall> | null;
  meta: ReadonlyMap<string, PatchMeta>;
}) {
  const groups: [string, EventSeries[]][] = [];
  for (const entry of stage.series) {
    const group = groups.find(([round]) => round === entry.round);
    if (group) group[1].push(entry);
    else groups.push([entry.round, [entry]]);
  }
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Series and games</h2>
        <span className="dim">open a series for each game&apos;s draft, gold graph and numbers</span>
      </div>
      <div className="panel-pad tournament-series">
        {groups.map(([round, list]) => (
          <div key={round}>
            <h3 className="tournament-subhead">{round}</h3>
            {list.map((entry) => (
              <SeriesRow key={entry.id} entry={entry} calls={calls} meta={meta} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function SeriesRow({
  entry,
  calls,
  meta,
}: {
  entry: EventSeries;
  calls: Map<string, GameCall> | null;
  meta: ReadonlyMap<string, PatchMeta>;
}) {
  // Gold graphs are drawn only once a series is opened; a Worlds has hundreds.
  const [open, setOpen] = useState(false);
  const call = calls ? seriesCall(entry, calls) : null;
  const [a, b] = entry.teams;
  return (
    <details className="series-row" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {entry.pool && <span className="series-pool">{entry.pool} pool</span>}
        <span className="series-teams">
          <span className={entry.winner === a ? 'is-winner' : undefined}>{a}</span>
          <span className="num series-score">
            {entry.wins[0]}–{entry.wins[1]}
          </span>
          <span className={entry.winner === b ? 'is-winner' : undefined}>{b}</span>
        </span>
        {call && <VerdictBadge verdict={call.verdict} />}
        {call && (
          <span className="dim series-call">
            {call.favourite} {percent(call.probability)}
          </span>
        )}
        <span className="dim series-date">{formatDate(entry.games[0]!.date)}</span>
      </summary>
      {open && (
        <div className="series-games">
          {entry.games.map((game) => (
            <GameCard key={game.gameId} game={game} call={calls?.get(game.gameId)} meta={meta} />
          ))}
        </div>
      )}
    </details>
  );
}

function GameCard({ game, call, meta }: { game: Game; call: GameCall | undefined; meta: ReadonlyMap<string, PatchMeta> }) {
  const story = goldStory(game);
  const verdict = gameCall(game, call);
  return (
    <article className="game-card">
      <header className="game-card-head">
        <strong>Game {game.gameNumber}</strong>
        <span>
          <strong>{winnerName(game)}</strong> won · {formatDuration(game.durationSeconds)}
          {game.patch && ` · Patch ${game.patch}`}
        </span>
        {verdict && (
          <span className="dim">
            Predictor: {verdict.favourite} {percent(verdict.probability)} <VerdictBadge verdict={verdict.verdict} />
          </span>
        )}
      </header>
      <DraftRows game={game} meta={meta} />
      {story ? (
        <>
          <GoldGraph game={game} story={story} />
          <GoldNotes game={game} story={story} />
        </>
      ) : (
        <p className="team-stat-note dim">No gold recorded for this game.</p>
      )}
      <Objectives game={game} />
    </article>
  );
}

function DraftRows({ game, meta }: { game: Game; meta: ReadonlyMap<string, PatchMeta> }) {
  return (
    <div className="draft-rows">
      {[game.blue, game.red].map((side) => (
        <div key={side.side} className={`draft-row draft-row--${side.side}`}>
          <span className="draft-team">
            {side.teamName}
            {side.side === game.winner && <span className="draft-win">Won</span>}
          </span>
          <ul>
            {ROLES.map((role) => {
              const slot = side.players.find((player) => player.role === role);
              if (!slot) return null;
              const pocket = isPocketPick(meta, game, role, slot.champion.id) === true;
              return (
                <li
                  key={role}
                  className={pocket ? 'is-pocket' : undefined}
                  title={`${ROLE_LABEL[role]} · ${slot.playerName}${pocket ? ' · pocket pick' : ''}`}
                >
                  <ChampionLabel id={slot.champion.id} name={slot.champion.name} />
                  <span className="dim">
                    {ROLE_SHORT[role]} · {slot.playerName}
                  </span>
                  {pocket && <span className="team-stat-tag">pocket</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function GoldNotes({ game, story }: { game: Game; story: GoldStory }) {
  const lead = (side: 'blue' | 'red') => {
    const moment = story.biggestLead[side];
    const team = game[side].teamName;
    return moment ? `${team} +${amount(moment.amount)} at ${at(moment.minute)}` : `${team} never led`;
  };
  return (
    <ul className="gold-notes">
      <li>
        <span className="gold-notes-label">Biggest lead</span>
        {lead('blue')} · {lead('red')}
      </li>
      <li>
        <span className="gold-notes-label">Comeback</span>
        {story.comeback
          ? `${winnerName(game)} came back from ${amount(story.comeback.amount)} down at ${at(story.comeback.minute)}`
          : `${winnerName(game)} never trailed at a recorded mark`}
      </li>
      {story.endDiff !== null && (
        <li>
          <span className="gold-notes-label">Gap at the end</span>
          {winnerName(game)} {story.endDiff >= 0 ? '+' : '−'}
          {amount(story.endDiff)}
        </li>
      )}
    </ul>
  );
}

const OBJECTIVE_ROWS: [keyof TeamObjectives, string][] = [
  ['kills', 'Kills'],
  ['towers', 'Towers'],
  ['dragons', 'Dragons'],
  ['barons', 'Barons'],
  ['voidGrubs', 'Void grubs'],
  ['heralds', 'Heralds'],
  ['inhibitors', 'Inhibitors'],
];
const FIRSTS: [keyof TeamObjectives, string][] = [
  ['firstBlood', 'First blood'],
  ['firstTower', 'First tower'],
  ['firstDragon', 'First dragon'],
  ['firstBaron', 'First Baron'],
];

function Objectives({ game }: { game: Game }) {
  const blue = game.blue.objectives;
  const red = game.red.objectives;
  if (blue === undefined && red === undefined) {
    return (
      <p className="team-stat-note dim">
        Kills, towers and dragons weren&apos;t captured when this season was imported. Re-import its
        CSV on the Data page to fill them in.
      </p>
    );
  }
  if (!blue || !red) return null;
  const rows = OBJECTIVE_ROWS.filter(([field]) => blue[field] !== null || red[field] !== null);
  const firsts = FIRSTS.map(([field, label]) => {
    const team = blue[field] === true ? game.blue.teamName : red[field] === true ? game.red.teamName : null;
    return { label, team };
  }).filter((entry) => entry.team);
  return (
    <div className="game-objectives">
      <table className="team-stat-table">
        <thead>
          <tr>
            <th scope="col">Took</th>
            <th scope="col">{game.blue.teamName}</th>
            <th scope="col">{game.red.teamName}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([field, label]) => {
            const b = blue[field] as number | null;
            const r = red[field] as number | null;
            return (
              <tr key={field}>
                <th scope="row">{label}</th>
                <td className={b !== null && r !== null && b > r ? 'is-lead' : undefined}>{b ?? '—'}</td>
                <td className={b !== null && r !== null && r > b ? 'is-lead' : undefined}>{r ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {firsts.length > 0 && (
        <ul className="gold-notes">
          {firsts.map(({ label, team }) => (
            <li key={label}>
              <span className="gold-notes-label">{label}</span>
              {team}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
