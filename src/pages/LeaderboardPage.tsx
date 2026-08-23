import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { COMPETITIONS } from '../domain/competitions.ts';
import {
  categoryKey,
  filterEntries,
  leaderboardRepository,
  rankEntries,
  summarizeCategories,
  LEADERBOARD_CATEGORIES,
  type LeaderboardCategory,
  type LeaderboardEntry,
  type LeaderboardFilters,
} from '../leaderboard/repository.ts';
import {
  blindBoardRepository,
  blindPersonalBest,
  clearedLabel,
  rankBlindEntries,
  type BlindBoardEntry,
} from '../leaderboard/blindBoard.ts';
import { BLIND_LEVELS, MAX_BLIND_SCORE } from '../quiz/blind.ts';
import { formatPercent, formatRelative, formatScore, formatSeconds } from '../lib/format.ts';
import { MODE_LABEL, QUESTION_COUNTS, type QuizMode } from '../quiz/config.ts';
import { MAX_QUESTION_SCORE } from '../quiz/scoring.ts';
import { usePlayerName } from '../state/usePlayerName.ts';

export function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [filters, setFilters] = useState<LeaderboardFilters>({
    questionCount: null,
    sourceKey: null,
    mode: null,
  });
  const [name] = usePlayerName();

  const [blind, setBlind] = useState<BlindBoardEntry[] | null>(null);

  const load = useCallback(() => {
    void leaderboardRepository.list().then(setEntries);
    void blindBoardRepository.list().then(setBlind);
  }, []);

  useEffect(load, [load]);

  const ranked = useMemo(
    () => (entries ? rankEntries(filterEntries(entries, filters)) : []),
    [entries, filters],
  );

  const categories = useMemo(
    () => summarizeCategories(entries ?? [], LEADERBOARD_CATEGORIES, name),
    [entries, name],
  );

  /* Scores only compare within one style and one length. */
  const scoped = filters.mode !== null && filters.questionCount !== null;

  const selectCategory = (category: LeaderboardCategory) =>
    setFilters((current) => ({
      ...current,
      mode: category.mode,
      questionCount: category.questionCount,
    }));

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
            Every style and length keeps its own board — a 50-question run can score five times
            what a 10-question run can, so they are never ranked against each other. Within a
            board, ties break on accuracy, then on the faster average answer.
          </p>
        </div>
        {entries !== null && entries.length > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={clearAll}>
            Clear board
          </button>
        )}
      </header>

      <BlindBoard entries={blind} name={name} onClear={() => void blindBoardRepository.clear().then(load)} />

      <section className="panel">
        <div className="panel-header">
          <h2>Records</h2>
          <span className="dim">Best run in each style and length</span>
        </div>
        <div className="panel-pad record-grid">
          {categories.map((summary) => {
            const key = categoryKey(summary.category);
            const active =
              filters.mode === summary.category.mode &&
              filters.questionCount === summary.category.questionCount;
            return (
              <button
                key={key}
                type="button"
                className={`record-card${active ? ' is-active' : ''}`}
                onClick={() => selectCategory(summary.category)}
                aria-pressed={active}
              >
                <span className="record-head">
                  <span className="record-mode">{MODE_LABEL[summary.category.mode]}</span>
                  <span className="record-length num">{summary.category.questionCount}Q</span>
                </span>

                {summary.leader ? (
                  <>
                    <span className="record-score num">{formatScore(summary.leader.score)}</span>
                    <span className="record-holder">{summary.leader.username}</span>
                    <span className="record-meta dim num">
                      {formatPercent(summary.leader.accuracy)} ·{' '}
                      {formatSeconds(summary.leader.averageResponseMs)} · max{' '}
                      {formatScore(summary.category.questionCount * MAX_QUESTION_SCORE)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="record-score record-empty">—</span>
                    <span className="record-holder dim">Unclaimed</span>
                    <span className="record-meta dim">Be the first to set a score</span>
                  </>
                )}

                <span className="record-you dim">
                  {summary.personal
                    ? `You: ${formatScore(summary.personal.score)} · #${summary.personalRank} of ${summary.runs}`
                    : `${summary.runs} run${summary.runs === 1 ? '' : 's'} recorded`}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel filter-bar">
        <div className="filter-group">
          <span className="stat-label">Style</span>
          <div className="chip-row">
            <FilterChip
              active={filters.mode === null}
              onClick={() => setFilters((f) => ({ ...f, mode: null }))}
            >
              Any
            </FilterChip>
            {(['matchups', 'games'] as QuizMode[]).map((mode) => (
              <FilterChip
                key={mode}
                active={filters.mode === mode}
                accent="var(--violet)"
                onClick={() => setFilters((f) => ({ ...f, mode }))}
              >
                {MODE_LABEL[mode]}
              </FilterChip>
            ))}
          </div>
        </div>

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
        <>
          {!scoped && (
            <p className="board-note">
              Showing runs across{' '}
              {filters.mode === null && filters.questionCount === null
                ? 'every style and length'
                : filters.mode === null
                  ? 'both styles'
                  : 'all lengths'}
              . Positions here mix categories that aren’t comparable — pick a record card above
              for a true ranking.
            </p>
          )}
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
                  <th scope="col">Style</th>
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
                      <td>
                        <span className="badge">{entry.mode ? MODE_LABEL[entry.mode] : '—'}</span>
                      </td>
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
        </>
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

/**
 * Blind mode's board.
 *
 * Kept apart from the quiz boards above rather than folded in as another
 * category: the two modes score different things, and a run of four fixed
 * questions has no length, no clock and no streak to rank by.
 */
function BlindBoard({
  entries,
  name,
  onClear,
}: {
  entries: BlindBoardEntry[] | null;
  name: string;
  onClear: () => void;
}) {
  const ranked = useMemo(() => (entries ? rankBlindEntries(entries) : []), [entries]);
  const mine = useMemo(() => (entries ? blindPersonalBest(entries, name) : null), [entries, name]);
  const myRank = mine ? ranked.findIndex((entry) => entry.id === mine.id) + 1 : null;

  return (
    <section className="panel blind-board">
      <div className="panel-header">
        <h2>Blind mode</h2>
        <span className="dim">
          Four levels, {MAX_BLIND_SCORE} points for reading them all fast and unaided
        </span>
        {ranked.length > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      {entries === null ? (
        <div className="panel-pad dim">Loading…</div>
      ) : ranked.length === 0 ? (
        <div className="panel-pad empty-state">
          <p>No blind runs yet.</p>
          <Link className="btn btn-primary" to="/blind">
            Play blind mode
          </Link>
        </div>
      ) : (
        <>
          {mine && myRank && (
            <p className="panel-pad dim blind-board-personal">
              Your best: <strong>{mine.score}</strong> — #{myRank} of {ranked.length}.
            </p>
          )}
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
                    Levels
                  </th>
                  <th scope="col">Read correctly</th>
                  <th scope="col" className="board-num">
                    Hints
                  </th>
                  <th scope="col" className="board-num">
                    Time
                  </th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {ranked.slice(0, 25).map((entry, index) => (
                  <tr
                    key={entry.id}
                    className={`${index < 3 ? `board-top board-top-${index + 1}` : ''}${
                      entry.id === mine?.id ? ' is-me' : ''
                    }`}
                  >
                    <td className="board-rank num">{index + 1}</td>
                    <td>
                      <span className="board-player">{entry.username}</span>
                      {entry.demoData && <span className="badge badge-demo board-demo">Demo</span>}
                    </td>
                    <td className="board-num num board-score">{entry.score}</td>
                    <td className="board-num num">
                      {entry.cleared}/{BLIND_LEVELS.length}
                    </td>
                    <td>
                      <span className="badge">{clearedLabel(entry.levelsCleared)}</span>
                    </td>
                    <td className="board-num num">{entry.hints}</td>
                    <td className="board-num num">
                      {entry.timeMs === undefined ? '—' : formatSeconds(entry.timeMs)}
                    </td>
                    <td className="dim">{formatRelative(entry.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
