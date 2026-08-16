import { TeamLogo } from '../TeamLogo.tsx';
import type { Game } from '../../domain/types.ts';
import { seriesScoreBefore, type SeriesPosition } from '../../quiz/series.ts';

interface SeriesStatusProps {
  games: readonly Game[];
  positions: readonly SeriesPosition[];
  index: number;
}

/**
 * Where this game sits in its matchup, and the series score so far.
 *
 * The score only counts earlier games of the same series, every one of which
 * the player has already answered and had revealed — so it tells them nothing
 * they haven't seen, while giving later games of a series the context a real
 * viewer would have.
 */
export function SeriesStatus({ games, positions, index }: SeriesStatusProps) {
  const position = positions[index];
  const game = games[index];
  if (!position || !game) return null;

  const score = seriesScoreBefore(games, positions, index);
  const opening = position.gameInSeries === 1;

  return (
    <div className="series-status">
      <span className="series-badge">
        {opening ? 'New matchup' : `Game ${position.gameInSeries} of ${position.seriesLength}`}
      </span>

      <span className="series-teams">
        <TeamLogo teamName={game.blue.teamName} tag={game.blue.tag} size="sm" />
        <strong>{game.blue.teamName}</strong>
        <span className="dim">vs</span>
        <strong>{game.red.teamName}</strong>
        <TeamLogo teamName={game.red.teamName} tag={game.red.tag} size="sm" />
      </span>

      <span className="series-score dim">
        {opening ? (
          position.seriesLength > 1 ? (
            `${position.seriesLength} games in this quiz`
          ) : (
            'Single game'
          )
        ) : (
          <>
            Series so far{' '}
            {score.map((entry, i) => (
              <span key={entry.team}>
                {i > 0 && <span className="dim"> – </span>}
                <strong className="num">{entry.wins}</strong> {entry.team}
              </span>
            ))}
          </>
        )}
      </span>
    </div>
  );
}
