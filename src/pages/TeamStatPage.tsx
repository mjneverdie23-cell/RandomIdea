import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChampionArt } from '../components/ChampionArt.tsx';
import { GameTimeRange, GoldLeadChart, WinsByLength } from '../components/teamstats/TeamCharts.tsx';
import { competitionLabel, competitionShort } from '../domain/competitions.ts';
import { ROLE_LABEL, ROLE_SHORT, type CompetitionId } from '../domain/types.ts';
import { formatCount, formatDate, formatDuration } from '../lib/format.ts';
import { archetypeLabel } from '../predictor/championArchetypes.ts';
import { deriveArchetypeProfiles, metaByPatch } from '../predictor/derive.ts';
import {
  currentTeamSeason,
  teamOptions,
  teamSeasons,
  teamStats,
  type ChampionUse,
  type GameLength,
  type PlayerStats,
  type TeamOption,
  type TeamStats,
} from '../predictor/teamStats.ts';
import type { PocketProfile } from '../predictor/types.ts';
import { useDataset } from '../state/DatasetContext.tsx';

const TEAM_KEY = 'draftcall.teamstat.team.v1';
const ALL_SEASONS = 'all';

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');
const gold = (value: number | null) => (value === null ? '—' : Math.round(value).toLocaleString());
const signedGold = (value: number | null) =>
  value === null ? '—' : `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value)).toLocaleString()}`;

function loadTeam(): string {
  try {
    return localStorage.getItem(TEAM_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Team Stat: one team's playstyle and numbers, from every loaded game.
 *
 * Wider than what the Predictor shows for a matchup — game time, team gold by
 * minute, each player's style and champion pool, and how the team does when it
 * goes off-meta. Pocket picks are judged against the meta of the patch each
 * game was played on, so a champion that has since become meta is not counted
 * as a pocket in games where it was one, and the reverse.
 */
export function TeamStatPage() {
  const { dataset } = useDataset();
  const games = useMemo(() => dataset?.games ?? [], [dataset]);
  const [params, setParams] = useSearchParams();

  const options = useMemo(() => teamOptions(games), [games]);
  const meta = useMemo(() => metaByPatch(games), [games]);

  const wanted = params.get('team') ?? loadTeam();
  const team =
    options.find((option) => option.name.toLowerCase() === wanted.toLowerCase())?.name ??
    // Nothing chosen yet: start on the team with the most games.
    [...options].sort((a, b) => b.games - a.games)[0]?.name ??
    '';

  const seasons = useMemo(() => teamSeasons(team, games), [team, games]);
  const defaultSeason = useMemo(() => currentTeamSeason(team, games), [team, games]);
  const [seasonChoice, setSeasonChoice] = useState<{ team: string; season: string } | null>(null);
  // A season picked for another team doesn't carry over; each team starts on its newest.
  const season =
    seasonChoice && seasonChoice.team === team && (seasonChoice.season === ALL_SEASONS || seasons.includes(seasonChoice.season))
      ? seasonChoice.season
      : (defaultSeason ?? ALL_SEASONS);

  const scoped = useMemo(
    () => (season === ALL_SEASONS ? games : games.filter((game) => game.season === season)),
    [games, season],
  );
  const styles = useMemo(() => deriveArchetypeProfiles(scoped), [scoped]);
  const stats = useMemo(
    () => (team ? teamStats(team, scoped, meta, styles) : null),
    [team, scoped, meta, styles],
  );

  const chooseTeam = (name: string) => {
    try {
      localStorage.setItem(TEAM_KEY, name);
    } catch {
      // Remembering the team is a convenience.
    }
    setParams(name ? { team: name } : {}, { replace: true });
  };

  return (
    <div className="page team-stat-page">
      <header className="page-head">
        <div>
          <h1>Team Stat</h1>
          <p className="page-sub">
            How a team plays: game time, gold by minute, each player&apos;s style and champion
            pool, and what happens when it drafts a pocket pick. Every number comes from the{' '}
            {formatCount(games.length, 'game')} you have loaded.
          </p>
        </div>
      </header>

      <section className="context-bar team-stat-controls">
        <label className="field">
          <span className="field-label">Team</span>
          <TeamSelect options={options} value={team} onChange={chooseTeam} />
        </label>
        <label className="field">
          <span className="field-label">Season</span>
          <select
            id="team-stat-season"
            className="select"
            value={season}
            onChange={(event) => setSeasonChoice({ team, season: event.target.value })}
          >
            {seasons.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
            <option value={ALL_SEASONS}>All seasons</option>
          </select>
        </label>
      </section>

      {!stats ? (
        <div className="empty-state">
          <p>{team ? `No ${team} games in ${season}.` : 'Load some games on the Data page to see team stats.'}</p>
        </div>
      ) : (
        <TeamReport stats={stats} />
      )}
    </div>
  );
}

function TeamSelect({
  options,
  value,
  onChange,
}: {
  options: TeamOption[];
  value: string;
  onChange: (name: string) => void;
}) {
  // Grouped by home league, the leagues with the most teams first.
  const groups = useMemo(() => {
    const byHome = new Map<CompetitionId | null, TeamOption[]>();
    for (const option of options) {
      const list = byHome.get(option.home) ?? [];
      list.push(option);
      byHome.set(option.home, list);
    }
    return [...byHome].sort((a, b) => b[1].length - a[1].length);
  }, [options]);

  return (
    <select id="team-stat-team" className="select" value={value} onChange={(event) => onChange(event.target.value)}>
      {groups.map(([home, list]) => (
        <optgroup key={home ?? 'none'} label={home ? competitionLabel(home) : 'Other'}>
          {list.map((option) => (
            <option key={option.name} value={option.name}>
              {option.name} ({option.games})
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function TeamReport({ stats }: { stats: TeamStats }) {
  const { pocket } = stats;
  const current = stats.players.filter((player) => player.current);
  const others = stats.players.filter((player) => !player.current);

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <h2>{stats.team}</h2>
          <span className="team-stat-comps">
            {stats.competitions.map((comp) => (
              <span key={comp.id} className="badge">
                {competitionShort(comp.id)} <span className="num">{comp.games}</span>
              </span>
            ))}
          </span>
        </div>
        <div className="panel-pad stat-grid">
          <Stat label="Games" value={`${stats.wins}–${stats.games - stats.wins}`} sub={`${pct(stats.wins, stats.games)} won`} />
          <Stat
            label="Average game time"
            value={formatDuration(stats.duration.all.average)}
            sub={`wins ${formatDuration(stats.duration.wins.average)} · losses ${formatDuration(stats.duration.losses.average)}`}
          />
          <Stat
            label="End-of-game gold"
            value={gold(stats.endGold.average)}
            sub={stats.endGold.perMinute === null ? 'not in this data' : `${gold(stats.endGold.perMinute)} per minute`}
          />
          <Stat
            label="Pocket picks"
            value={pocket.games ? (pocket.pocketPicks / pocket.games).toFixed(2) : '—'}
            sub={`per game · in ${pct(pocket.pocketGames, pocket.games)} of drafts`}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Game time</h2>
          <span className="dim">{formatCount(stats.duration.all.sample, 'game')} with a recorded length</span>
        </div>
        <div className="panel-pad team-stat-time">
          <div className="team-stat-tiles">
            <div className="team-stat-tilegroup">
              <h3>All games</h3>
              <div className="stat-grid">
                <Stat label="Average" value={formatDuration(stats.duration.all.average)} />
                <Stat label="Shortest" value={formatDuration(stats.duration.all.shortest?.seconds ?? null)} sub={gameNote(stats.duration.all.shortest)} />
                <Stat label="Longest" value={formatDuration(stats.duration.all.longest?.seconds ?? null)} sub={gameNote(stats.duration.all.longest)} />
              </div>
            </div>
            <div className="team-stat-tilegroup">
              <h3>Wins</h3>
              <div className="stat-grid">
                <Stat label="Average win" value={formatDuration(stats.duration.wins.average)} sub={`${stats.duration.wins.sample} wins`} />
                <Stat label="Fastest win" value={formatDuration(stats.duration.wins.shortest?.seconds ?? null)} sub={gameNote(stats.duration.wins.shortest)} />
                <Stat label="Longest win" value={formatDuration(stats.duration.wins.longest?.seconds ?? null)} sub={gameNote(stats.duration.wins.longest)} />
              </div>
            </div>
          </div>
          <GameTimeRange
            rows={[
              { label: 'All games', summary: stats.duration.all },
              { label: 'Wins', summary: stats.duration.wins },
              { label: 'Losses', summary: stats.duration.losses },
            ]}
          />
          <WinsByLength buckets={stats.lengthBuckets} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Gold by minute</h2>
          <span className="dim">team gold, and lead or deficit against the opponent</span>
        </div>
        <div className="panel-pad">
          <GoldLeadChart marks={stats.gold} />
          <table className="team-stat-table">
            <thead>
              <tr>
                <th scope="col">Minute</th>
                <th scope="col">Team gold</th>
                <th scope="col">Lead / deficit</th>
                <th scope="col">Games</th>
              </tr>
            </thead>
            <tbody>
              <tr className="is-missing">
                <th scope="row">5</th>
                <td colSpan={3}>not recorded — Oracle&apos;s Elixir has no 5-minute gold</td>
              </tr>
              {stats.gold.map((mark) => (
                <tr key={mark.minute}>
                  <th scope="row">{mark.minute}</th>
                  <td>{gold(mark.gold)}</td>
                  <td className={mark.diff === null ? '' : mark.diff >= 0 ? 'is-pos' : 'is-neg'}>{signedGold(mark.diff)}</td>
                  <td>{mark.sample}</td>
                </tr>
              ))}
              <tr className="is-missing">
                <th scope="row">30</th>
                <td colSpan={3}>not recorded — the last mark in the export is 25 minutes</td>
              </tr>
            </tbody>
          </table>
          {stats.goldMissing > 0 && (
            <p className="team-stat-note dim">
              {formatCount(stats.goldMissing, 'game')} imported before team gold was captured still
              count toward the lead/deficit column. Re-import the CSV on the Data page to fill in team
              gold for them.
            </p>
          )}
        </div>
      </section>

      <PocketPanel pocket={pocket} champions={stats.pocketChampions} />

      <section className="panel">
        <div className="panel-header">
          <h2>Players</h2>
          <span className="dim">newest lineup · style is the archetype each player drafts most</span>
        </div>
        <div className="panel-pad team-stat-players">
          {current.map((player) => (
            <PlayerCard key={`${player.player}|${player.role}`} player={player} />
          ))}
        </div>
        {others.length > 0 && (
          <details className="team-stat-others">
            <summary>Also played for {stats.team} ({others.length})</summary>
            <div className="panel-pad team-stat-players">
              {others.map((player) => (
                <PlayerCard key={`${player.player}|${player.role}`} player={player} />
              ))}
            </div>
          </details>
        )}
      </section>
    </>
  );
}

/** Which game a shortest/longest figure was: opponent, date, result. */
function gameNote(game: GameLength | null): string | undefined {
  if (!game) return undefined;
  return `vs ${game.opponent} · ${formatDate(game.date)} · ${game.won ? 'won' : 'lost'}`;
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

function PocketPanel({ pocket, champions }: { pocket: PocketProfile; champions: ChampionUse[] }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Pocket picks</h2>
        <span className="dim">off the meta of the patch each game was played on</span>
      </div>
      <div className="panel-pad">
        <div className="stat-grid">
          <Stat
            label="Drafts with a pocket pick"
            value={pct(pocket.pocketGames, pocket.games)}
            sub={`${pocket.pocketGames} of ${pocket.games} games`}
          />
          <Stat
            label="Win rate with a pocket pick"
            value={pct(pocket.pocketWins, pocket.pocketGames)}
            sub={`all-meta drafts ${pct(pocket.metaWins, pocket.metaGames)} (${pocket.metaGames})`}
          />
          <Stat
            label="Game time with a pocket pick"
            value={formatDuration(pocket.pocketSeconds)}
            sub={`all-meta drafts ${formatDuration(pocket.metaSeconds)}`}
          />
        </div>
        {champions.length > 0 ? (
          <table className="team-stat-table team-stat-pockets">
            <thead>
              <tr>
                <th scope="col">Pocket pick</th>
                <th scope="col">Role</th>
                <th scope="col">Player</th>
                <th scope="col">Games</th>
                <th scope="col">Won</th>
                <th scope="col">Avg time</th>
              </tr>
            </thead>
            <tbody>
              {champions.slice(0, 12).map((use) => (
                <tr key={`${use.role}|${use.championId}`}>
                  <th scope="row">
                    <ChampionLabel id={use.championId} name={use.name} />
                  </th>
                  <td>{ROLE_SHORT[use.role]}</td>
                  <td>{use.players.join(', ')}</td>
                  <td>{use.games}</td>
                  <td>{pct(use.wins, use.games)}</td>
                  <td>{formatDuration(use.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="team-stat-note dim">No pocket picks in these games — every pick was meta for its patch.</p>
        )}
        <p className="team-stat-note dim">
          A pick is a pocket pick when it was off the meta of its own patch — contested (picked or
          banned) in under 5% of games over that patch and the one before, the same rule the
          Predictor uses. A champion that is meta today can count as a pocket in older games, and
          the reverse.
        </p>
      </div>
    </section>
  );
}

function PlayerCard({ player }: { player: PlayerStats }) {
  const style = player.style;
  const shares = style ? [...style.shares].slice(0, 3) : [];
  return (
    <article className="team-stat-player">
      <header>
        <span className="role-chip">{ROLE_SHORT[player.role]}</span>
        <strong>{player.player}</strong>
        <span className="dim">
          {ROLE_LABEL[player.role]} · {player.games} games · {pct(player.wins, player.games)} won
        </span>
      </header>
      <p className="team-stat-style">
        {style?.favourite ? (
          <>
            Plays <strong>{archetypeLabel(style.favourite)}</strong>
            {shares.length > 1 && (
              <span className="dim">
                {' '}
                ({shares.map(([archetype, share]) => `${archetypeLabel(archetype)} ${Math.round(share * 100)}%`).join(' · ')})
              </span>
            )}
          </>
        ) : (
          <span className="dim">Too few games in this role for a style read.</span>
        )}
      </p>
      <p className="team-stat-pocketline dim">
        Pocket picks {pct(player.pocketPicks, player.judged)} of games
        {player.pocketPicks > 0 && ` · won ${pct(player.pocketWins, player.pocketPicks)}`}
      </p>
      <ul className="team-stat-pool">
        {player.champions.slice(0, 8).map((use) => (
          <li key={use.championId} className={use.pocketGames > 0 ? 'has-pocket' : undefined}>
            <ChampionLabel id={use.championId} name={use.name} />
            <span className="num">
              {use.games} · {pct(use.wins, use.games)}
            </span>
            {use.pocketGames > 0 && <span className="team-stat-tag">pocket ×{use.pocketGames}</span>}
          </li>
        ))}
      </ul>
    </article>
  );
}

function ChampionLabel({ id, name }: { id: string; name: string }) {
  const champion = { id, name };
  return (
    <span className="team-stat-champ">
      <span className="team-stat-icon">
        <ChampionArt champion={champion} variant="icon" />
      </span>
      {name}
    </span>
  );
}
