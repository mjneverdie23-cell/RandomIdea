import { useMemo } from 'react';
import { ROLES, ROLE_LABEL, ROLE_SHORT, type Champion, type Game, type Role } from '../../domain/types.ts';
import { formatDate, formatDuration } from '../../lib/format.ts';
import {
  championReport,
  chosenRoles,
  draftsWith,
  pairRecords,
  rolePools,
  summarize,
  type ChampionReport,
  type DraftHit,
  type DraftSummary,
  type LookupPicks,
  type Partner,
  type WinLoss,
} from '../../predictor/championLookup.ts';
import type { EventSeries } from '../../predictor/tournament.ts';
import { ChampionArt } from '../ChampionArt.tsx';
import { ChampionLabel } from '../ChampionLabel.tsx';
import { SearchSelect, type SearchOption } from '../predictor/SearchSelect.tsx';

type Pools = Record<Role, { champion: Champion; picks: number }[]>;

const pct = (record: WinLoss) => (record.games ? `${Math.round((record.wins / record.games) * 100)}%` : '—');
const wl = (record: WinLoss) => `${record.wins}–${record.games - record.wins}`;
const signedGold = (value: number | null) =>
  value === null ? '—' : `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value)).toLocaleString()}`;

/** Rows per list on a champion card; the rest are behind a fold. */
const LIST_ROWS = 5;
const RECENT = 10;

/**
 * Half a draft on the left — a champion per role, any of them optional — and
 * on the right how each did in its role in the chosen tournament stage, and
 * how they did when one team drafted them together.
 */
export function ChampionLookup({
  games,
  allPools,
  picks,
  onChange,
  scope,
  roundOf,
}: {
  /** The games in scope: the selected tournament stage. */
  games: Game[];
  /** Every champion seen in each role across the loaded data, so any can be looked up. */
  allPools: Pools;
  picks: LookupPicks;
  onChange: (picks: LookupPicks) => void;
  /** e.g. `Worlds 2025 · Whole event`. */
  scope: string;
  roundOf: Map<string, EventSeries>;
}) {
  const here = useMemo(() => rolePools(games), [games]);
  const roles = chosenRoles(picks);
  const championOf = (role: Role, id: string): Champion =>
    here[role].find((entry) => entry.champion.id === id)?.champion ??
    allPools[role].find((entry) => entry.champion.id === id)?.champion ?? { id, name: id };

  const reports = useMemo(
    () => chosenRoles(picks).map((role) => championReport(games, role, picks[role]!)),
    [games, picks],
  );
  const together = useMemo(() => (chosenRoles(picks).length >= 2 ? summarize(draftsWith(games, picks)) : null), [games, picks]);
  const pairs = useMemo(() => (chosenRoles(picks).length >= 3 ? pairRecords(games, picks) : []), [games, picks]);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Champion lookup</h2>
        <span className="dim">
          {scope} · {games.length} games
        </span>
      </div>
      <div className="panel-pad lookup">
        <div className="lookup-slots" role="group" aria-label="Champions by role">
          {ROLES.map((role) => (
            <LookupSlot
              key={role}
              role={role}
              value={picks[role] ?? null}
              champion={picks[role] ? championOf(role, picks[role]!) : null}
              here={here[role]}
              everywhere={allPools[role]}
              taken={new Set(ROLES.filter((other) => other !== role && picks[other]).map((other) => picks[other]!))}
              onChange={(id) => {
                const next = { ...picks };
                if (id) next[role] = id;
                else delete next[role];
                onChange(next);
              }}
            />
          ))}
          {roles.length > 0 && (
            <button type="button" className="btn btn-ghost lookup-clear" onClick={() => onChange({})}>
              Clear all
            </button>
          )}
        </div>

        <div className="lookup-results">
          {roles.length === 0 ? (
            <p className="lookup-empty dim">
              Pick a champion for any role — one, two or all five. Each one shows how it did in that
              role in {scope}, and two or more show how they did when one team drafted them together.
            </p>
          ) : (
            <>
              {together && (
                <TogetherCard
                  roles={roles}
                  picks={picks}
                  championOf={championOf}
                  summary={together}
                  pairs={pairs}
                  scope={scope}
                  roundOf={roundOf}
                />
              )}
              {reports.map((report) => (
                <ChampionCard
                  key={report.role}
                  report={report}
                  champion={championOf(report.role, picks[report.role]!)}
                  scope={scope}
                  roundOf={roundOf}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function LookupSlot({
  role,
  value,
  champion,
  here,
  everywhere,
  taken,
  onChange,
}: {
  role: Role;
  value: string | null;
  champion: Champion | null;
  here: { champion: Champion; picks: number }[];
  everywhere: { champion: Champion; picks: number }[];
  taken: ReadonlySet<string>;
  onChange: (id: string | null) => void;
}) {
  // Champions played in this role in scope first, with their games; then every
  // other champion seen in the role, so an unplayed pick can still be checked.
  const options = useMemo<SearchOption[]>(() => {
    const seen = new Set(here.map((entry) => entry.champion.id));
    return [
      ...here.map((entry) => ({ value: entry.champion.id, label: entry.champion.name, hint: `${entry.picks} here` })),
      ...everywhere
        .filter((entry) => !seen.has(entry.champion.id))
        .map((entry) => ({ value: entry.champion.id, label: entry.champion.name, hint: 'not played here' })),
    ].filter((option) => option.value === value || !taken.has(option.value));
  }, [here, everywhere, taken, value]);

  return (
    <div className={`lookup-slot${champion ? ' is-filled' : ''}`}>
      <span className="role-chip" title={ROLE_LABEL[role]}>
        {ROLE_SHORT[role]}
      </span>
      <SearchSelect
        label={`${ROLE_LABEL[role]} champion`}
        value={value}
        valueLabel={champion?.name}
        options={options}
        onChange={onChange}
        placeholder={`${ROLE_LABEL[role]}…`}
        adornment={
          champion ? (
            <span className="team-stat-icon">
              <ChampionArt champion={champion} variant="icon" />
            </span>
          ) : undefined
        }
      />
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="lookup-mini">
      <span className="stat-label">{label}</span>
      <span className="lookup-mini-value">{value}</span>
      {sub && <span className="dim">{sub}</span>}
    </div>
  );
}

function SummaryStats({ summary }: { summary: DraftSummary }) {
  return (
    <div className="lookup-minis">
      <Mini label="Record" value={wl(summary)} sub={`${pct(summary)} won`} />
      <Mini label="Game time" value={formatDuration(summary.averageSeconds)} sub="average" />
      <Mini label="Gold @15" value={signedGold(summary.gold15)} sub="average lead" />
      <Mini label="Blue / red" value={`${wl(summary.sides.blue)} · ${wl(summary.sides.red)}`} sub="by side" />
    </div>
  );
}

function Recent({ hits, roundOf }: { hits: DraftHit[]; roundOf: Map<string, EventSeries> }) {
  return (
    <div className="lookup-recent-row">
      <span className="stat-label">Recent, newest first</span>
      <ol className="lookup-recent" aria-label="Recent results, newest first">
      {hits.slice(0, RECENT).map((hit) => (
        <li
          key={`${hit.game.gameId}|${hit.side.side}`}
          className={hit.won ? 'is-win' : 'is-loss'}
          title={`${formatDate(hit.game.date)} · ${roundOf.get(hit.game.gameId)?.round ?? ''} · ${hit.side.teamName} vs ${hit.opponent.teamName}`}
        >
          {hit.won ? 'W' : 'L'}
        </li>
      ))}
      </ol>
    </div>
  );
}

function TogetherCard({
  roles,
  picks,
  championOf,
  summary,
  pairs,
  scope,
  roundOf,
}: {
  roles: Role[];
  picks: LookupPicks;
  championOf: (role: Role, id: string) => Champion;
  summary: DraftSummary;
  pairs: ReturnType<typeof pairRecords>;
  scope: string;
  roundOf: Map<string, EventSeries>;
}) {
  const name = (role: Role) => championOf(role, picks[role]!).name;
  return (
    <article className="lookup-card lookup-card--together">
      <header className="lookup-card-head">
        <span className="lookup-icons">
          {roles.map((role) => (
            <span key={role} className="team-stat-icon" title={`${name(role)} ${ROLE_LABEL[role]}`}>
              <ChampionArt champion={championOf(role, picks[role]!)} variant="icon" />
            </span>
          ))}
        </span>
        <h3>Together</h3>
        <span className="dim">{roles.map((role) => `${name(role)} ${ROLE_SHORT[role].toLowerCase()}`).join(' + ')}</span>
      </header>

      {summary.games === 0 ? (
        <p className="lookup-empty dim">No team drafted all of these together in {scope}.</p>
      ) : (
        <>
          <SummaryStats summary={summary} />
          {summary.games < 3 && <p className="lookup-note dim">Only {summary.games === 1 ? 'one game' : 'two games'} — a small sample.</p>}
          <p className="lookup-teams">
            <span className="stat-label">Drafted by</span>{' '}
            {summary.teams.map((team) => `${team.team} ${wl(team)}`).join(' · ')}
          </p>
          <ol className="lookup-games">
            {summary.hits.map((hit) => {
              const rest = hit.side.players
                .filter((player) => !roles.includes(player.role))
                .map((player) => player.champion.name);
              return (
                <li key={`${hit.game.gameId}|${hit.side.side}`}>
                  <span className={`lookup-result ${hit.won ? 'is-win' : 'is-loss'}`}>{hit.won ? 'W' : 'L'}</span>
                  <span>
                    <strong>{hit.side.teamName}</strong> vs {hit.opponent.teamName}
                    {rest.length > 0 && <span className="dim"> · with {rest.join(', ')}</span>}
                  </span>
                  <span className="dim">
                    {roundOf.get(hit.game.gameId)?.round ?? ''} · {formatDate(hit.game.date)} · {formatDuration(hit.game.durationSeconds)}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {pairs.length > 0 && (
        <table className="team-stat-table lookup-pairs">
          <thead>
            <tr>
              <th scope="col">Pair</th>
              <th scope="col">Games</th>
              <th scope="col">W–L</th>
              <th scope="col">Won</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((pair) => (
              <tr key={pair.roles.join('|')}>
                <th scope="row">
                  {name(pair.roles[0])} + {name(pair.roles[1])}
                </th>
                <td>{pair.games}</td>
                <td>{wl(pair)}</td>
                <td>{pct(pair)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}

function ChampionCard({
  report,
  champion,
  scope,
  roundOf,
}: {
  report: ChampionReport;
  champion: Champion;
  scope: string;
  roundOf: Map<string, EventSeries>;
}) {
  return (
    <article className="lookup-card">
      <header className="lookup-card-head">
        <ChampionLabel id={champion.id} name={champion.name} />
        <span className="role-chip">{ROLE_SHORT[report.role]}</span>
        <span className="dim">
          banned {report.bans} · presence {Math.round(report.presence * 100)}%
        </span>
      </header>

      {report.games === 0 ? (
        <p className="lookup-empty dim">
          Not picked as {ROLE_LABEL[report.role].toLowerCase()} in {scope}.
        </p>
      ) : (
        <>
          <SummaryStats summary={report} />
          <Recent hits={report.hits} roundOf={roundOf} />
          <div className="lookup-lists">
            <LookupList
              title="Best players"
              rows={report.players.map((line) => ({
                key: `${line.team}|${line.player}`,
                label: (
                  <span>
                    <strong>{line.player}</strong> <span className="dim">{line.team}</span>
                  </span>
                ),
                record: line,
              }))}
            />
            <LookupList title="Best with" rows={partnerRows(report.teammates)} />
            <LookupList title="Struggles against" rows={partnerRows(report.counters)} />
            <LookupList title="Lane opponents · worst first" rows={partnerRows(report.lane, false)} />
          </div>
        </>
      )}
    </article>
  );
}

interface Row {
  key: string;
  label: React.ReactNode;
  record: WinLoss;
}

function partnerRows(partners: Partner[], showRole = true): Row[] {
  return partners.map((partner) => ({
    key: `${partner.role}|${partner.champion.id}`,
    label: (
      <span className="lookup-partner">
        <ChampionLabel id={partner.champion.id} name={partner.champion.name} />
        {showRole && <span className="dim">{ROLE_SHORT[partner.role]}</span>}
      </span>
    ),
    record: partner,
  }));
}

function LookupList({ title, rows }: { title: string; rows: Row[] }) {
  const line = (row: Row) => (
    <li key={row.key}>
      {row.label}
      <span className="num">{wl(row.record)}</span>
      <span className="num dim">{pct(row.record)}</span>
    </li>
  );
  return (
    <div className="lookup-list">
      <h4 className="tournament-subhead">{title}</h4>
      {rows.length === 0 ? (
        <p className="dim lookup-note">—</p>
      ) : (
        <>
          <ol>{rows.slice(0, LIST_ROWS).map(line)}</ol>
          {rows.length > LIST_ROWS && (
            <details className="tournament-more">
              <summary>All {rows.length}</summary>
              <ol>{rows.slice(LIST_ROWS).map(line)}</ol>
            </details>
          )}
        </>
      )}
    </div>
  );
}
