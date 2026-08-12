import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { COMPETITIONS } from '../domain/competitions.ts';
import {
  filterEntries,
  leaderboardRepository,
  rankEntries,
  type LeaderboardEntry,
  type LeaderboardFilters,
} from '../leaderboard/repository.ts';
import { formatPercent, formatRelative, formatScore, formatSeconds } from '../lib/format.ts';
import { QUESTION_COUNTS } from '../quiz/config.ts';
import { usePlayerName } from '../state/usePlayerName.ts';

export function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [filters, setFilters] = useState<LeaderboardFilters>({
    questionCount: null,
    sourceKey: null,
  });
  const [name] = usePlayerName();

  const load = useCallback(() => {
    void leaderboardRepository.list().then(setEntries);
  }, []);

  useEffect(load, [load]);

  const ranked = useMemo(
    () => (entries ? rankEntries(filterEntries(entries, filters)) : []),
    [entries, filters],
  );

  const clearAll = () => {
    if (!window.confirm('Delete every saved run from this device?')) return;
    void leaderboardRepository.clear().then(load);
  };

  return (
    <div className="page leaderboard-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Global ranking</p>
          <h1>Leaderboard</h1>
          <p className="page-sub">
            Every completed run, ranked by score. Ties break on accuracy, then on the faster
            average answer.
          </p>
        </div>
        {entries !== null && entries.length > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={clearAll}>
            Clear board
          </button>
        )}
      </header>

      <section className="panel filter-bar">
        <div className="filter-group">
          <span className="stat-label">Length</span>
          <div className="chip-row">
            <FilterChip
              active={filters.questionCount === null}
              onClick={() => setFilters((f) => ({ ...f, questionCount: null }))}
            >
              Any
            </FilterChip>
            {QUESTION_COUNTS.map((count) => (
              <FilterChip
                key={count}
                active={filters.questionCount === count}
                onClick={() => setFilters((f) => ({ ...f, questionCount: count }))}
              >
                {count}
              </FilterChip>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="stat-label">Source</span>
          <div className="chip-row">
            <FilterChip
              active={filters.sourceKey === null}
              onClick={() => setFilters((f) => ({ ...f, sourceKey: null }))}
            >
              Any
            </FilterChip>
            <FilterChip
              active={filters.sourceKey === 'MIXED'}
              onClick={() => setFilters((f) => ({ ...f, sourceKey: 'MIXED' }))}
            >
              Mixed
            </FilterChip>
            {COMPETITIONS.map((competition) => (
              <FilterChip
                key={competition.id}
                active={filters.sourceKey === competition.id}
                accent={competition.accent}
                onClick={() => setFilters((f) => ({ ...f, sourceKey: competition.id }))}
              >
                {competition.short}
              </FilterChip>
            ))}
          </div>
        </div>
      </section>

      {entries === null ? (
        <div className="empty-state">
          <span className="spinner" aria-hidden="true" />
        </div>
      ) : ranked.length === 0 ? (
        <div className="empty-state panel panel-pad">
          <h2>{entries.length === 0 ? 'No runs yet' : 'Nothing matches these filters'}</h2>
          <p>
            {entries.length === 0
              ? 'Finish a quiz and your score lands here automatically.'
              : 'Loosen the filters, or set a score in this bracket yourself.'}
          </p>
          <Link className="btn btn-primary" to="/setup">
            Play a run
          </Link>
        </div>
      ) : (
        <div className="panel board-wrap">
          <table className="board">
            <thead>
              <tr>
                <th scope="col" className="board-rank">
                  #
                </th>
                <th scope="col">Player</th>
                <th scope="col" className="board-num">
                  Score
                </th>
                <th scope="col" className="board-num">
                  Length
                </th>
                <th scope="col" className="board-num">
                  Accuracy
                </th>
                <th scope="col" className="board-num">
                  Avg time
                </th>
                <th scope="col" className="board-num">
                  Streak
                </th>
                <th scope="col">Source</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((entry, index) => {
                const isMe = entry.username.toLowerCase() === name.trim().toLowerCase();
                return (
                  <tr
                    key={entry.id}
                    className={`${index < 3 ? `board-top board-top-${index + 1}` : ''}${isMe ? ' is-me' : ''}`}
                  >
                    <td className="board-rank num">{index + 1}</td>
                    <td>
                      <span className="board-player">{entry.username}</span>
                      {entry.demoData && (
                        <span className="badge badge-demo board-demo">Demo</span>
                      )}
                    </td>
                    <td className="board-num num board-score">{formatScore(entry.score)}</td>
                    <td className="board-num num">{entry.questionCount}</td>
                    <td className="board-num num">{formatPercent(entry.accuracy)}</td>
                    <td className="board-num num">{formatSeconds(entry.averageResponseMs)}</td>
                    <td className="board-num num">{entry.bestStreak}</td>
                    <td>
                      <span className="badge">{entry.sourceLabel}</span>
                    </td>
                    <td className="dim">{formatRelative(entry.date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`chip chip-sm${active ? ' is-active' : ''}`}
      style={accent ? { ['--chip-accent' as string]: accent } : undefined}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
