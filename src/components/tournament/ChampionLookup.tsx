import { useMemo } from 'react';
import { ROLES, ROLE_LABEL, ROLE_SHORT, type Champion, type Game, type Role } from '../../domain/types.ts';
import { formatDate, formatDuration } from '../../lib/format.ts';
import {
  championReport,
  chosenRoles,
  draftsWith,
  lookupTeams,
  pairRecords,
  rolePools,
  summarize,
  teamLookup,
  type BanLine,
  type ChampionReport,
  type DraftHit,
  type DraftSummary,
  type LookupPicks,
  type LookupQuery,
  type Partner,
  type TeamLookup,
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
 * Half a draft on the left — a team and a champion per role, all optional —
 * and on the right how each champion did in its role in the chosen tournament
 * stage, and how they did when one team drafted them together. A team narrows
 * all of it to that team's drafts, and on its own shows the team's profile.
 */
export function ChampionLookup({
  games,
  allPools,
  query,
  onChange,
  scope,
  roundOf,
}: {
  /** The games in scope: the selected tournament stage. */
  games: Game[];
  /** Every champion seen in each role across the loaded data, so any can be looked up. */
  allPools: Pools;
  query: LookupQuery;
  onChange: (query: LookupQuery) => void;
  /** e.g. `Worlds 2025 · Whole event`. */
  scope: string;
  roundOf: Map<string, EventSeries>;
}) {
  const { picks, team } = query;
  const here = useMemo(() => rolePools(games), [games]);
  const teams = useMemo(() => lookupTeams(games), [games]);
  const profile = useMemo(() => (team ? teamLookup(games, team) : null), [games, team]);
  const roles = chosenRoles(picks);
  const championOf = (role: Role, id: string): Champion =>
    here[role].find((entry) => entry.champion.id === id)?.champion ??
    allPools[role].find((entry) => entry.champion.id === id)?.champion ?? { id, name: id };
  const setPicks = (next: LookupPicks) => onChange({ picks: next, team });

  const reports = useMemo(
    () => chosenRoles(picks).map((role) => championReport(games, role, picks[role]!, team)),
    [games, picks, team],
  );
  const together = useMemo(
    () => (chosenRoles(picks).length >= 2 ? summarize(draftsWith(games, picks, team)) : null),
    [games, picks, team],
  );
  const pairs = useMemo(() => (chosenRoles(picks).length >= 3 ? pairRecords(games, picks, team) : []), [games, picks, team]);
  // The team's spelling in the data, and its tag for the slot hints.
  const teamName = profile?.team ?? team;
  const teamTag = profile?.hits[0]?.side.tag ?? teamName;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Champion and team lookup</h2>
        <span className="dim">
          {scope} · {games.length} games
        </span>
      </div>
      <div className="panel-pad lookup">
        <div className="lookup-slots" role="group" aria-label="Team and champions by role">
          <TeamSlot teams={teams} value={team} label={teamName} onChange={(next) => onChange({ picks, team: next })} />
          {ROLES.map((role) => (
            <LookupSlot
              key={role}
              role={role}
              value={picks[role] ?? null}
              champion={picks[role] ? championOf(role, picks[role]!) : null}
              theirs={profile ? profile.roles[role] : null}
              teamTag={teamTag}
              here={here[role]}
              everywhere={allPools[role]}
              taken={new Set(ROLES.filter((other) => other !== role && picks[other]).map((other) => picks[other]!))}
              onChange={(id) => {
                const next = { ...picks };
                if (id) next[role] = id;
                else delete next[role];
                setPicks(next);
              }}
            />
          ))}
          {(roles.length > 0 || team) && (
            <button type="button" className="btn btn-ghost lookup-clear" onClick={() => onChange({ picks: {}, team: null })}>
              Clear all
            </button>
          )}
        </div>

        <div className="lookup-results">
          {roles.length === 0 && !profile ? (
            <p className="lookup-empty dim">
              Pick a champion for any role — one, two or all five. Each one shows how it did in that
              role in {scope}, and two or more show how they did when one team drafted them together.
              Pick a team to see its profile, or to narrow the champions to that team&apos;s drafts.
            </p>
          ) : (
            <>
              {profile && <TeamCard profile={profile} scope={scope} roundOf={roundOf} />}
              {together && (
                <TogetherCard
                  roles={roles}
                  picks={picks}
                  championOf={championOf}
                  summary={together}
                  pairs={pairs}
                  scope={scope}
                  team={teamName}
                  roundOf={roundOf}
                />
              )}
              {reports.map((report) => (
                <ChampionCard
                  key={report.role}
                  report={report}
                  champion={championOf(report.role, picks[report.role]!)}
                  scope={scope}
                  team={teamName}
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

function TeamSlot({
  teams,
  value,
  label,
  onChange,
}: {
  teams: { team: string; games: number }[];
  value: string | null;
  label: string | null;
  onChange: (team: string | null) => void;
}) {
  const options = useMemo<SearchOption[]>(
    () => teams.map((entry) => ({ value: entry.team, label: entry.team, hint: `${entry.games} games` })),
    [teams],
  );
  // A team picked in another stage keeps its name even where it didn't play.
  const selected = value ? (teams.find((entry) => entry.team.toLowerCase() === value.toLowerCase())?.team ?? value) : null;
  return (
    <div className={`lookup-slot lookup-slot--team${value ? ' is-filled' : ''}`}>
      <span className="role-chip">TEAM</span>
      <SearchSelect
        label="Team"
        value={selected}
        valueLabel={label ?? undefined}
        options={options}
        onChange={onChange}
        placeholder="Any team…"
      />
    </div>
  );
}

function LookupSlot({
  role,
  value,
  champion,
  theirs,
  teamTag,
  here,
  everywhere,
  taken,
  onChange,
}: {
  role: Role;
  value: string | null;
  champion: Champion | null;
  /** The chosen team's champions in this role, when a team is chosen. */
  theirs: Partner[] | null;
  teamTag: string | null;
  here: { champion: Champion; picks: number }[];
  everywhere: { champion: Champion; picks: number }[];
  taken: ReadonlySet<string>;
  onChange: (id: string | null) => void;
}) {
  // The chosen team's champions first, then everything played in this role in
  // scope, with games; then every other champion seen in the role, so an
  // unplayed pick can still be checked.
  const options = useMemo<SearchOption[]>(() => {
    const seen = new Set<string>();
    const tiers = [
      ...(theirs ?? []).map((entry) => ({ champion: entry.champion, hint: `${entry.games} by ${teamTag}` })),
      ...here.map((entry) => ({ champion: entry.champion, hint: `${entry.picks} here` })),
      ...everywhere.map((entry) => ({ champion: entry.champion, hint: 'not played here' })),
    ];
    const options: SearchOption[] = [];
    for (const { champion: option, hint } of tiers) {
      if (seen.has(option.id)) continue;
      seen.add(option.id);
      if (option.id !== value && taken.has(option.id)) continue;
      options.push({ value: option.id, label: option.name, hint });
    }
    return options;
  }, [theirs, teamTag, here, everywhere, taken, value]);

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
  team,
  roundOf,
}: {
  roles: Role[];
  picks: LookupPicks;
  championOf: (role: Role, id: string) => Champion;
  summary: DraftSummary;
  pairs: ReturnType<typeof pairRecords>;
  scope: string;
  team: string | null;
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
        <h3>{team ? `Together for ${team}` : 'Together'}</h3>
        <span className="dim">{roles.map((role) => `${name(role)} ${ROLE_SHORT[role].toLowerCase()}`).join(' + ')}</span>
      </header>

      {summary.games === 0 ? (
        <p className="lookup-empty dim">
          {team ? `${team} never drafted` : 'No team drafted'} all of these together in {scope}.
        </p>
      ) : (
        <>
          <SummaryStats summary={summary} />
          {summary.games < 3 && <p className="lookup-note dim">Only {summary.games === 1 ? 'one game' : 'two games'} — a small sample.</p>}
          {!team && (
            <p className="lookup-teams">
              <span className="stat-label">Drafted by</span>{' '}
              {summary.teams.map((entry) => `${entry.team} ${wl(entry)}`).join(' · ')}
            </p>
          )}
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

function TeamCard({ profile, scope, roundOf }: { profile: TeamLookup; scope: string; roundOf: Map<string, EventSeries> }) {
  return (
    <article className="lookup-card lookup-card--team">
      <header className="lookup-card-head">
        <h3>{profile.team}</h3>
        <span className="dim">in {scope}</span>
      </header>
      {profile.games === 0 ? (
        <p className="lookup-empty dim">
          {profile.team} didn&apos;t play in {scope}.
        </p>
      ) : (
        <>
          <SummaryStats summary={profile} />
          <Recent hits={profile.hits} roundOf={roundOf} />
          <div className="lookup-lists">
            {ROLES.map((role) => (
              <LookupList key={role} title={`${ROLE_LABEL[role]} picks`} rows={partnerRows(profile.roles[role], false)} />
            ))}
            <LookupList title="Banned by them" rows={banRows(profile.bannedBy)} />
            <LookupList title="Banned against them" rows={banRows(profile.bannedAgainst)} />
            <LookupList
              title="Against"
              rows={profile.opponents.map((entry) => ({
                key: entry.team,
                label: <span>{entry.team}</span>,
                values: recordValues(entry),
              }))}
            />
          </div>
        </>
      )}
    </article>
  );
}

function ChampionCard({
  report,
  champion,
  scope,
  team,
  roundOf,
}: {
  report: ChampionReport;
  champion: Champion;
  scope: string;
  team: string | null;
  roundOf: Map<string, EventSeries>;
}) {
  const role = ROLE_LABEL[report.role].toLowerCase();
  return (
    <article className="lookup-card">
      <header className="lookup-card-head">
        <ChampionLabel id={champion.id} name={champion.name} />
        <span className="role-chip">{ROLE_SHORT[report.role]}</span>
        {report.team && team ? (
          <span className="dim">
            {team} picked it in {report.team.picked} of {report.team.games} games · {team} banned it{' '}
            {report.team.bannedBy}× · opponents banned it {report.team.bannedAgainst}×
          </span>
        ) : (
          <span className="dim">
            banned {report.bans} · presence {Math.round(report.presence * 100)}%
          </span>
        )}
      </header>

      {report.games === 0 ? (
        <p className="lookup-empty dim">
          {team ? `${team} didn't pick it as ${role}` : `Not picked as ${role}`} in {scope}.
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
                values: recordValues(line),
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
  /** The two right-hand columns: a record and its win rate, or a count. */
  values: [string, string];
}

const recordValues = (record: WinLoss): [string, string] => [wl(record), pct(record)];

function partnerRows(partners: Partner[], showRole = true): Row[] {
  return partners.map((partner) => ({
    key: `${partner.role}|${partner.champion.id}`,
    label: (
      <span className="lookup-partner">
        <ChampionLabel id={partner.champion.id} name={partner.champion.name} />
        {showRole && <span className="dim">{ROLE_SHORT[partner.role]}</span>}
      </span>
    ),
    values: recordValues(partner),
  }));
}

function banRows(bans: BanLine[]): Row[] {
  return bans.map((line) => ({
    key: line.champion.id,
    label: <ChampionLabel id={line.champion.id} name={line.champion.name} />,
    values: [String(line.count), ''],
  }));
}

function LookupList({ title, rows }: { title: string; rows: Row[] }) {
  const line = (row: Row) => (
    <li key={row.key}>
      {row.label}
      <span className="num">{row.values[0]}</span>
      <span className="num dim">{row.values[1]}</span>
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
