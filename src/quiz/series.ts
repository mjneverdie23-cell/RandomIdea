/**
 * Matchups.
 *
 * The quiz serves whole series rather than unrelated games: pick a matchup —
 * say T1 vs Gen.G — and play its games in order, game 1 through the last one.
 * That mirrors how the games were actually played, and it makes later games
 * genuinely readable, because by then you have seen how the earlier ones went.
 *
 * Series boundaries come from `partitionSeries` in `src/data/stage.ts`, the
 * same definition ingestion uses to infer best-of, so the two never disagree.
 */

import { makeSeriesKey, partitionSeries, type SeriesMember } from '../data/stage.ts';
import type { CompetitionId, Game, SeriesFormat } from '../domain/types.ts';

export interface Series {
  key: string;
  competition: CompetitionId;
  /** Games in play order (game 1 first). */
  games: Game[];
  /** Team names in the order they appear in game 1 (blue, red). */
  teams: [string, string];
  /** Kick-off time of the first game. */
  date: string;
  format: SeriesFormat;
}

interface Member extends SeriesMember {
  game: Game;
}

/** Stable series key for a game, ignoring which side each team was on. */
export function seriesKeyOf(game: Game): string {
  return makeSeriesKey({
    competition: game.competition,
    season: game.season,
    split: game.split,
    playoffs: game.stage.kind !== 'regular',
    teamA: game.blue.teamName,
    teamB: game.red.teamName,
  });
}

/** Group games into matchups, each ordered game 1 → last game. */
export function groupIntoSeries(games: readonly Game[]): Series[] {
  const members: Member[] = games.map((game) => ({
    game,
    gameId: game.gameId,
    seriesKey: seriesKeyOf(game),
    gameNumber: game.gameNumber,
    timestamp: Date.parse(game.date),
  }));

  return partitionSeries(members).map((run) => {
    const ordered = run.map((member) => member.game);
    const first = ordered[0]!;
    return {
      // Runs of the same matchup need distinct keys — the first game's id is
      // unique and stable, so it disambiguates repeat meetings.
      key: `${first.gameId}`,
      competition: first.competition,
      games: ordered,
      teams: [first.blue.teamName, first.red.teamName],
      date: first.date,
      format: first.seriesFormat,
    };
  });
}

/** Where a question sits inside its matchup. */
export interface SeriesPosition {
  /** 1-based index of the matchup within the quiz. */
  seriesIndex: number;
  /** How many matchups the quiz covers. */
  seriesCount: number;
  /** 1-based position of this game inside its matchup. */
  gameInSeries: number;
  /** How many games of this matchup the quiz includes. */
  seriesLength: number;
}

/**
 * Recover matchup boundaries from the quiz's flat game list.
 *
 * The generator emits each series contiguously, so a new matchup starts
 * wherever the teams change or the game counter stops climbing — the latter
 * catching the case where the same two teams meet twice back to back.
 */
export function describeSeriesRuns(games: readonly Game[]): SeriesPosition[] {
  const starts: number[] = [];
  for (let i = 0; i < games.length; i += 1) {
    const game = games[i]!;
    const previous = i > 0 ? games[i - 1]! : null;
    const newSeries =
      previous === null ||
      seriesKeyOf(previous) !== seriesKeyOf(game) ||
      game.gameNumber <= previous.gameNumber;
    if (newSeries) starts.push(i);
  }

  const positions: SeriesPosition[] = [];
  for (let s = 0; s < starts.length; s += 1) {
    const from = starts[s]!;
    const to = s + 1 < starts.length ? starts[s + 1]! : games.length;
    for (let i = from; i < to; i += 1) {
      positions.push({
        seriesIndex: s + 1,
        seriesCount: starts.length,
        gameInSeries: i - from + 1,
        seriesLength: to - from,
      });
    }
  }
  return positions;
}

/**
 * Series score going into the game at `index`, as wins per team name.
 *
 * Only counts games earlier in the same matchup, all of which the player has
 * already been shown and had revealed — so this leaks nothing.
 */
export function seriesScoreBefore(
  games: readonly Game[],
  positions: readonly SeriesPosition[],
  index: number,
): { team: string; wins: number }[] {
  const position = positions[index];
  const game = games[index];
  if (!position || !game) return [];

  const start = index - (position.gameInSeries - 1);
  const wins = new Map<string, number>([
    [game.blue.teamName, 0],
    [game.red.teamName, 0],
  ]);

  for (let i = start; i < index; i += 1) {
    const earlier = games[i]!;
    const winner = earlier[earlier.winner].teamName;
    wins.set(winner, (wins.get(winner) ?? 0) + 1);
  }
  return [...wins].map(([team, count]) => ({ team, wins: count }));
}
