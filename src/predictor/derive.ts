/**
 * Build the predictor's model from the games already in the app.
 *
 * The original predictor shipped a batch step that turned an Oracle's Elixir
 * export into four cached artifacts (a match-data workbook, a team-info
 * workbook, a meta-champion list and a behaviour blob) and read those back at
 * launch. DraftCall already ingests the same export into `Game[]`, so all four
 * are computed here instead — no cache files, no rebuild step, and the
 * predictor reflects whichever seasons are switched on at that moment.
 *
 * Two different time scopes are used on purpose:
 *
 * - **Champion win rates** span every enabled season. How well a team plays a
 *   champion is a durable skill signal, and thin samples are the main way this
 *   model goes wrong, so it gets all the data available.
 * - **Standings and behaviour** cover the most recent season only. These are
 *   current-form reads; a 2022 record says nothing about how a team is playing
 *   now, and averaging five seasons together would wash out exactly the signal
 *   they exist to provide.
 */

import { comparePatches } from '../data/ingest.ts';
import { makeSeriesKey, partitionSeries } from '../data/stage.ts';
import {
  GOLD_CHECKPOINTS,
  ROLES,
  type Champion,
  type CompetitionId,
  type Game,
  type Role,
  type Side,
} from '../domain/types.ts';
import { anywhereKey, splitSubject } from './engine.ts';
import type {
  GoldTempo,
  PredictorModel,
  StandingRow,
  TeamBehavior,
  TeamRating,
  WinLoss,
} from './types.ts';

/** How many of the newest patches define the current meta. */
export const META_PATCH_COUNT = 2;
/** Share of games a champion must be picked in to count as meta. */
export const META_PICK_RATE = 0.05;
/** Below this many observations a rate is reported as unknown, not as a number. */
export const MIN_SAMPLE = 4;
/** Games in the recency-weighted form window. */
export const FORM_WINDOW = 8;
/** Gold lead that counts as decisive for the throw/comeback reads. */
export const DECISIVE_GOLD = 2500;

function bump(map: Map<string, WinLoss>, key: string, won: boolean): void {
  const record = map.get(key);
  if (record) {
    record.games += 1;
    if (won) record.wins += 1;
  } else {
    map.set(key, { games: 1, wins: won ? 1 : 0 });
  }
}

function rate(wins: number, total: number): number | null {
  return total >= MIN_SAMPLE ? wins / total : null;
}

/* ------------------------------------------------------------------ */
/* Champion records                                                    */
/* ------------------------------------------------------------------ */

/** Season + split, which is what "this split" means for a form read. */
export function splitKeyOf(game: Game): string {
  return `${game.season}|${game.split ?? ''}`;
}

/**
 * Which split each player and team is currently in.
 *
 * Split labels are per-league, not a shared calendar: on the same weekend the
 * LCK is in "Summer", the LPL is in "Split 3", the LEC is in "Rounds 3-4" and
 * an international event carries no split at all. Taking one global "newest
 * split" from the newest game in the file therefore left every team outside
 * that one league with no current-split record at all — measured on the 2026
 * export, only 190 of 600 lanes got a split read, and the rest silently fell
 * back to career.
 *
 * So each subject gets their own: the split their most recent game sits in.
 * With history cut at kickoff that is the split they are in as of that game,
 * and a player who transfers mid-year moves to their new league's split
 * immediately.
 */
export function currentSplits(games: readonly Game[]): Map<string, string> {
  const seenAt = new Map<string, number>();
  const splits = new Map<string, string>();

  for (const game of games) {
    const at = Date.parse(game.date);
    const key = splitKeyOf(game);
    for (const side of [game.blue, game.red] as const) {
      const subjects = [
        splitSubject('team', side.teamName),
        ...side.players.map((player) => splitSubject('player', player.playerName)),
      ];
      for (const subject of subjects) {
        if ((seenAt.get(subject) ?? -Infinity) >= at) continue;
        seenAt.set(subject, at);
        splits.set(subject, key);
      }
    }
  }
  return splits;
}

/**
 * Champion records, keyed by the player who actually piloted the champion.
 *
 * Team-keyed records carried a departed player's results into their
 * replacement's number: swap a top laner who went 0-4 on Gnar for one who is
 * 3-4 on it and the team's Gnar record still reads 3-8. Records follow the
 * player, so a roster change is reflected immediately and a transfer takes the
 * player's history with them.
 *
 * Four maps, because the useful answer depends on what exists:
 *   - `playerSplit`   this player, this champion, in the current split
 *   - `playerCareer`  this player, this champion, across everything loaded
 *   - `teamSplit` / `teamCareer`  fallbacks for when the roster is unknown,
 *     e.g. a team with no games in the scoped window
 */
function buildChampionRecords(
  games: readonly Game[],
  splits: Map<string, string>,
): {
  playerSplit: Map<string, WinLoss>;
  playerCareer: Map<string, WinLoss>;
  teamSplit: Map<string, WinLoss>;
  teamCareer: Map<string, WinLoss>;
} {
  const playerSplit = new Map<string, WinLoss>();
  const playerCareer = new Map<string, WinLoss>();
  const teamSplit = new Map<string, WinLoss>();
  const teamCareer = new Map<string, WinLoss>();

  for (const game of games) {
    const splitKey = splitKeyOf(game);
    for (const side of [game.blue, game.red] as const) {
      const won = game.winner === side.side;
      const teamInSplit = splits.get(splitSubject('team', side.teamName)) === splitKey;
      for (const player of side.players) {
        const { role, champion, playerName } = player;
        const playerKey = anywhereKey(playerName, role, champion.id);
        const teamKey = anywhereKey(side.teamName, role, champion.id);
        bump(playerCareer, playerKey, won);
        bump(teamCareer, teamKey, won);
        if (splits.get(splitSubject('player', playerName)) === splitKey) {
          bump(playerSplit, playerKey, won);
        }
        if (teamInSplit) bump(teamSplit, teamKey, won);
      }
    }
  }
  return { playerSplit, playerCareer, teamSplit, teamCareer };
}

/* ------------------------------------------------------------------ */
/* Meta                                                                */
/* ------------------------------------------------------------------ */

/**
 * Meta = picked often enough on the newest patches, computed per role.
 *
 * This is pick-frequency meta, not win-rate meta: the question the score asks
 * is "did they draft what everyone is drafting", and a champion can be
 * contested constantly while sitting at a 48% win rate.
 */
export function deriveMeta(games: readonly Game[]): {
  metaByRole: Map<Role, Set<string>>;
  patches: string[];
} {
  const patches = [...new Set(games.map((g) => g.patch).filter((p): p is string => p !== null))].sort(
    comparePatches,
  );
  const recentPatches = patches.slice(0, META_PATCH_COUNT);
  const wanted = new Set(recentPatches);

  const recent = wanted.size ? games.filter((g) => g.patch && wanted.has(g.patch)) : games;

  const counts = new Map<Role, Map<string, number>>();
  for (const role of ROLES) counts.set(role, new Map());

  for (const game of recent) {
    for (const side of [game.blue, game.red] as const) {
      for (const player of side.players) {
        const perRole = counts.get(player.role)!;
        perRole.set(player.champion.id, (perRole.get(player.champion.id) ?? 0) + 1);
      }
    }
  }

  const metaByRole = new Map<Role, Set<string>>();
  for (const role of ROLES) {
    const keep = new Set<string>();
    // Presence per game, so a champion picked by both teams counts twice —
    // being contested on both sides is the strongest meta signal there is.
    for (const [championId, picks] of counts.get(role)!) {
      if (recent.length > 0 && picks / recent.length >= META_PICK_RATE) keep.add(championId);
    }
    metaByRole.set(role, keep);
  }

  return { metaByRole, patches: recentPatches };
}

/* ------------------------------------------------------------------ */
/* Series reconstruction                                               */
/* ------------------------------------------------------------------ */

interface SeriesRun {
  competition: CompetitionId;
  games: Game[];
  teams: [string, string];
}

function seriesRuns(games: readonly Game[]): SeriesRun[] {
  const members = games.map((game) => ({
    gameId: game.gameId,
    seriesKey: makeSeriesKey({
      competition: game.competition,
      season: game.season,
      split: game.split,
      playoffs: game.stage.kind !== 'regular',
      teamA: game.blue.teamName,
      teamB: game.red.teamName,
    }),
    gameNumber: game.gameNumber,
    timestamp: Date.parse(game.date),
    game,
  }));

  const runs: SeriesRun[] = [];
  for (const run of partitionSeries(members)) {
    const ordered = run.map((m) => m.game);
    const first = ordered[0];
    if (!first) continue;
    runs.push({
      competition: first.competition,
      games: ordered,
      teams: [first.blue.teamName, first.red.teamName],
    });
  }
  return runs;
}

/** Games each team won inside one series. */
function seriesTally(run: SeriesRun): Map<string, number> {
  const wins = new Map<string, number>([
    [run.teams[0], 0],
    [run.teams[1], 0],
  ]);
  for (const game of run.games) {
    const winner = game.winner === 'blue' ? game.blue.teamName : game.red.teamName;
    wins.set(winner, (wins.get(winner) ?? 0) + 1);
  }
  return wins;
}

/* ------------------------------------------------------------------ */
/* Standings                                                           */
/* ------------------------------------------------------------------ */

interface StandingAcc {
  seriesWon: number;
  seriesLost: number;
  gamesWon: number;
  gamesLost: number;
  sequence: string[];
}

function blankStanding(): StandingAcc {
  return { seriesWon: 0, seriesLost: 0, gamesWon: 0, gamesLost: 0, sequence: [] };
}

/** Current run of the same result, e.g. `3W`. */
export function streakOf(sequence: readonly string[]): string {
  if (sequence.length === 0) return '';
  const last = sequence[sequence.length - 1]!;
  let n = 0;
  for (let i = sequence.length - 1; i >= 0 && sequence[i] === last; i -= 1) n += 1;
  return `${n}${last}`;
}

function rankRows(scope: Map<string, StandingAcc>): Map<string, StandingRow> {
  const pct = (w: number, l: number): number => (w + l > 0 ? w / (w + l) : 0);
  const rows = [...scope.entries()].map(([team, acc]) => ({
    team,
    rank: 0,
    seriesWon: acc.seriesWon,
    seriesLost: acc.seriesLost,
    seriesPct: pct(acc.seriesWon, acc.seriesLost),
    gamesWon: acc.gamesWon,
    gamesLost: acc.gamesLost,
    gamePct: pct(acc.gamesWon, acc.gamesLost),
    streak: streakOf(acc.sequence),
  }));

  rows.sort(
    (a, b) => b.seriesPct - a.seriesPct || b.gamePct - a.gamePct || b.seriesWon - a.seriesWon,
  );
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return new Map(rows.map((row) => [row.team.toLowerCase(), row]));
}

function deriveStandings(runs: readonly SeriesRun[]): {
  byCompetition: Map<CompetitionId, Map<string, StandingRow>>;
  overall: Map<string, StandingRow>;
} {
  const perCompetition = new Map<CompetitionId, Map<string, StandingAcc>>();
  const overall = new Map<string, StandingAcc>();

  const ordered = [...runs].sort(
    (a, b) => Date.parse(a.games[0]!.date) - Date.parse(b.games[0]!.date),
  );

  for (const run of ordered) {
    const wins = seriesTally(run);
    const [teamA, teamB] = run.teams;
    const winsA = wins.get(teamA) ?? 0;
    const winsB = wins.get(teamB) ?? 0;
    if (winsA === 0 && winsB === 0) continue;
    const winner = winsA > winsB ? teamA : teamB;

    let competitionScope = perCompetition.get(run.competition);
    if (!competitionScope) {
      competitionScope = new Map();
      perCompetition.set(run.competition, competitionScope);
    }

    for (const scope of [competitionScope, overall]) {
      for (const [team, own, against] of [
        [teamA, winsA, winsB],
        [teamB, winsB, winsA],
      ] as const) {
        let acc = scope.get(team);
        if (!acc) {
          acc = blankStanding();
          scope.set(team, acc);
        }
        acc.gamesWon += own;
        acc.gamesLost += against;
        if (team === winner) {
          acc.seriesWon += 1;
          acc.sequence.push('W');
        } else {
          acc.seriesLost += 1;
          acc.sequence.push('L');
        }
      }
    }
  }

  const byCompetition = new Map<CompetitionId, Map<string, StandingRow>>();
  for (const [competition, scope] of perCompetition) {
    byCompetition.set(competition, rankRows(scope));
  }
  return { byCompetition, overall: rankRows(overall) };
}

/* ------------------------------------------------------------------ */
/* Behaviour                                                           */
/* ------------------------------------------------------------------ */

interface TeamGame {
  timestamp: number;
  side: Side;
  won: boolean;
  peakGold: number | null;
  troughGold: number | null;
}

interface SeriesAcc {
  matchPointWon: number;
  matchPointSeen: number;
  deciderWon: number;
  deciderSeen: number;
  chokeWon: number;
  chokeSeen: number;
  game1Won: number;
  game1Seen: number;
}

function blankSeriesAcc(): SeriesAcc {
  return {
    matchPointWon: 0,
    matchPointSeen: 0,
    deciderWon: 0,
    deciderSeen: 0,
    chokeWon: 0,
    chokeSeen: 0,
    game1Won: 0,
    game1Seen: 0,
  };
}

function deriveBehavior(games: readonly Game[], runs: readonly SeriesRun[]): Map<string, TeamBehavior> {
  const perTeam = new Map<string, TeamGame[]>();
  const displayName = new Map<string, string>();

  for (const game of games) {
    const timestamp = Date.parse(game.date);
    for (const side of [game.blue, game.red] as const) {
      const key = side.teamName.toLowerCase();
      displayName.set(key, side.teamName);
      const bucket = perTeam.get(key) ?? [];
      bucket.push({
        timestamp,
        side: side.side,
        won: game.winner === side.side,
        peakGold: side.goldDiff?.peak ?? null,
        troughGold: side.goldDiff?.trough ?? null,
      });
      perTeam.set(key, bucket);
    }
  }

  const seriesAcc = new Map<string, SeriesAcc>();
  const accFor = (team: string): SeriesAcc => {
    const key = team.toLowerCase();
    let acc = seriesAcc.get(key);
    if (!acc) {
      acc = blankSeriesAcc();
      seriesAcc.set(key, acc);
    }
    return acc;
  };

  for (const run of runs) {
    const [teamA, teamB] = run.teams;
    const ordered = [...run.games].sort(
      (a, b) => Date.parse(a.date) - Date.parse(b.date) || a.gameNumber - b.gameNumber,
    );

    // A best-of-5 is decided at 3 wins; anything shorter at 2.
    const target = ordered.some((g) => g.seriesFormat === 'BO5' || g.gameNumber >= 4) ? 3 : 2;

    const wins = new Map<string, number>([
      [teamA, 0],
      [teamB, 0],
    ]);
    let previousWinner: string | null = null;

    for (const game of ordered) {
      const winner = game.winner === 'blue' ? game.blue.teamName : game.red.teamName;
      if (!wins.has(winner)) continue;

      if (game.gameNumber === 1) {
        for (const team of [teamA, teamB]) {
          const acc = accFor(team);
          acc.game1Seen += 1;
          if (team === winner) acc.game1Won += 1;
        }
      }

      // Anyone one win from taking the series is closing it out this game.
      for (const team of [teamA, teamB]) {
        if (wins.get(team) === target - 1) {
          const acc = accFor(team);
          acc.matchPointSeen += 1;
          if (team === winner) acc.matchPointWon += 1;
        }
      }

      if (wins.get(teamA) === target - 1 && wins.get(teamB) === target - 1) {
        for (const team of [teamA, teamB]) {
          const acc = accFor(team);
          acc.deciderSeen += 1;
          if (team === winner) acc.deciderWon += 1;
        }
      }

      // Game 5 for the side that just dropped game 4 from a 2-1 lead.
      if (target === 3 && game.gameNumber === 5 && previousWinner !== null) {
        const gameFourLoser: string = previousWinner === teamA ? teamB : teamA;
        const acc = accFor(gameFourLoser);
        acc.chokeSeen += 1;
        if (gameFourLoser === winner) acc.chokeWon += 1;
      }

      wins.set(winner, (wins.get(winner) ?? 0) + 1);
      previousWinner = winner;
    }
  }

  const behavior = new Map<string, TeamBehavior>();
  for (const [key, entries] of perTeam) {
    entries.sort((a, b) => a.timestamp - b.timestamp);
    const results: number[] = entries.map((entry) => (entry.won ? 1 : 0));
    const total = results.length;

    const tail = results.slice(-FORM_WINDOW);
    let weighted: number | null = null;
    if (tail.length) {
      let numerator = 0;
      let denominator = 0;
      tail.forEach((result, index) => {
        const weight = index + 1;
        numerator += result * weight;
        denominator += weight;
      });
      weighted = numerator / denominator;
    }

    const blue = entries.filter((e) => e.side === 'blue');
    const red = entries.filter((e) => e.side === 'red');

    const withGold = entries.filter((e) => e.peakGold !== null && e.troughGold !== null);
    const bigLeads = withGold.filter((e) => e.peakGold! >= DECISIVE_GOLD);
    const deficits = withGold.filter((e) => e.troughGold! <= -DECISIVE_GOLD);

    const afterLoss: number[] = [];
    for (let i = 0; i < total - 1; i += 1) {
      if (results[i] === 0) afterLoss.push(results[i + 1]!);
    }

    const acc = seriesAcc.get(key) ?? blankSeriesAcc();

    behavior.set(key, {
      games: total,
      winRate: rate(
        results.reduce((sum, r) => sum + r, 0),
        total,
      ),
      recentForm: weighted,
      blueWinRate: rate(blue.filter((e) => e.won).length, blue.length),
      redWinRate: rate(red.filter((e) => e.won).length, red.length),
      throwRate: rate(bigLeads.filter((e) => !e.won).length, bigLeads.length),
      throwSample: bigLeads.length,
      comebackRate: rate(deficits.filter((e) => e.won).length, deficits.length),
      comebackSample: deficits.length,
      bouncebackRate: rate(
        afterLoss.reduce((sum, r) => sum + r, 0),
        afterLoss.length,
      ),
      deciderRate: rate(acc.deciderWon, acc.deciderSeen),
      matchPointCloseRate: rate(acc.matchPointWon, acc.matchPointSeen),
      // Two attempts is a thin sample, but choking a 2-1 lead is rare enough
      // that waiting for four would report nothing for almost every team.
      chokeRate: acc.chokeSeen >= 2 ? acc.chokeWon / acc.chokeSeen : null,
      chokeSample: acc.chokeSeen,
      game1Rate: rate(acc.game1Won, acc.game1Seen),
    });
  }

  return behavior;
}

/* ------------------------------------------------------------------ */
/* Early-game gold tempo                                               */
/* ------------------------------------------------------------------ */

/** Games at a mark below which a tempo read is not worth reporting. */
export const MIN_TEMPO_SAMPLE = 5;

/**
 * How far ahead or behind each team usually is at every minute mark.
 *
 * Averaged rather than summed, because teams play different numbers of games,
 * and paired with the share of games spent ahead so a lopsided stomp can't
 * pass for a habit. Marks a game never reached contribute nothing — a 22-minute
 * win is silent about the 25-minute mark rather than counting as a zero, which
 * would drag every fast-winning team toward neutral.
 */
function deriveGoldTempo(games: readonly Game[]): Map<string, GoldTempo> {
  interface Bucket {
    total: number;
    ahead: number;
    sample: number;
  }
  const perTeam = new Map<string, Map<number, Bucket>>();

  for (const game of games) {
    for (const side of [game.blue, game.red] as const) {
      const checkpoints = side.goldDiff?.checkpoints;
      if (!checkpoints) continue;

      const key = side.teamName.toLowerCase();
      let marks = perTeam.get(key);
      if (!marks) {
        marks = new Map();
        perTeam.set(key, marks);
      }

      GOLD_CHECKPOINTS.forEach((minute, index) => {
        const diff = checkpoints[index];
        if (diff === null || diff === undefined) return;
        const bucket = marks.get(minute) ?? { total: 0, ahead: 0, sample: 0 };
        bucket.total += diff;
        if (diff > 0) bucket.ahead += 1;
        bucket.sample += 1;
        marks.set(minute, bucket);
      });
    }
  }

  const tempo = new Map<string, GoldTempo>();
  for (const [team, marks] of perTeam) {
    const points: GoldTempo = [];
    for (const minute of GOLD_CHECKPOINTS) {
      const bucket = marks.get(minute);
      if (!bucket || bucket.sample < MIN_TEMPO_SAMPLE) continue;
      points.push({
        minute,
        sample: bucket.sample,
        averageDiff: bucket.total / bucket.sample,
        aheadRate: bucket.ahead / bucket.sample,
      });
    }
    if (points.length) tempo.set(team, points);
  }
  return tempo;
}

/* ------------------------------------------------------------------ */
/* Rosters, teams, champion pools                                      */
/* ------------------------------------------------------------------ */

/** Starters, taken from each team's most recent game. */
function deriveRosters(games: readonly Game[]): Map<string, Partial<Record<Role, string>>> {
  const rosters = new Map<string, Partial<Record<Role, string>>>();
  const seenAt = new Map<string, number>();

  for (const game of games) {
    const timestamp = Date.parse(game.date);
    for (const side of [game.blue, game.red] as const) {
      const key = side.teamName.toLowerCase();
      if ((seenAt.get(key) ?? -Infinity) >= timestamp) continue;
      seenAt.set(key, timestamp);
      const roster: Partial<Record<Role, string>> = {};
      for (const player of side.players) roster[player.role] = player.playerName;
      rosters.set(key, roster);
    }
  }
  return rosters;
}

function deriveTeams(games: readonly Game[]): {
  byCompetition: Map<CompetitionId, string[]>;
  all: string[];
} {
  const byCompetition = new Map<CompetitionId, Set<string>>();
  const all = new Set<string>();

  for (const game of games) {
    let bucket = byCompetition.get(game.competition);
    if (!bucket) {
      bucket = new Set();
      byCompetition.set(game.competition, bucket);
    }
    for (const side of [game.blue, game.red] as const) {
      bucket.add(side.teamName);
      all.add(side.teamName);
    }
  }

  const sorted = new Map<CompetitionId, string[]>();
  for (const [competition, teams] of byCompetition) {
    sorted.set(competition, [...teams].sort((a, b) => a.localeCompare(b)));
  }
  return { byCompetition: sorted, all: [...all].sort((a, b) => a.localeCompare(b)) };
}

/**
 * Champions to offer per role, ordered by how often they are actually picked
 * there. Derived rather than hardcoded, so a new champion becomes selectable
 * as soon as it shows up in an imported season.
 */
function deriveChampionPools(games: readonly Game[]): Map<Role, Champion[]> {
  const counts = new Map<Role, Map<string, { champion: Champion; picks: number }>>();
  for (const role of ROLES) counts.set(role, new Map());

  for (const game of games) {
    for (const side of [game.blue, game.red] as const) {
      for (const player of side.players) {
        const perRole = counts.get(player.role)!;
        const entry = perRole.get(player.champion.id);
        if (entry) entry.picks += 1;
        else perRole.set(player.champion.id, { champion: player.champion, picks: 1 });
      }
    }
  }

  const pools = new Map<Role, Champion[]>();
  for (const role of ROLES) {
    const entries = [...counts.get(role)!.values()];
    entries.sort((a, b) => b.picks - a.picks || a.champion.name.localeCompare(b.champion.name));
    pools.set(
      role,
      entries.map((entry) => entry.champion),
    );
  }
  return pools;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/** Most recent season present, which scopes the current-form reads. */
export function latestSeason(games: readonly Game[]): string | null {
  let latest: string | null = null;
  for (const game of games) {
    if (latest === null || game.season > latest) latest = game.season;
  }
  return latest;
}

export function buildPredictorModel(
  games: readonly Game[],
  ratings: Map<string, TeamRating> = new Map(),
): PredictorModel {
  const splits = currentSplits(games);
  const records = buildChampionRecords(games, splits);
  const { metaByRole, patches } = deriveMeta(games);

  const formSeason = latestSeason(games);
  const formGames = formSeason ? games.filter((game) => game.season === formSeason) : games;
  const runs = seriesRuns(formGames);

  const { byCompetition: standingsByCompetition, overall: standingsOverall } = deriveStandings(runs);
  const { byCompetition: teamsByCompetition, all: allTeams } = deriveTeams(games);

  return {
    playerSplitRecord: records.playerSplit,
    playerCareerRecord: records.playerCareer,
    teamSplitRecord: records.teamSplit,
    teamCareerRecord: records.teamCareer,
    currentSplitOf: splits,
    metaByRole,
    metaPatches: patches,
    metaPickRateThreshold: META_PICK_RATE,
    behavior: deriveBehavior(formGames, runs),
    goldTempo: deriveGoldTempo(formGames),
    standingsByCompetition,
    standingsOverall,
    formSeason,
    rosters: deriveRosters(games),
    teamsByCompetition,
    allTeams,
    championsByRole: deriveChampionPools(games),
    ratings,
    gamesAnalyzed: games.length,
  };
}

/** An empty model, so the page can render before any data is loaded. */
export function emptyPredictorModel(): PredictorModel {
  const metaByRole = new Map<Role, Set<string>>();
  const championsByRole = new Map<Role, Champion[]>();
  for (const role of ROLES) {
    metaByRole.set(role, new Set());
    championsByRole.set(role, []);
  }
  return {
    playerSplitRecord: new Map(),
    playerCareerRecord: new Map(),
    teamSplitRecord: new Map(),
    teamCareerRecord: new Map(),
    currentSplitOf: new Map(),
    metaByRole,
    metaPatches: [],
    metaPickRateThreshold: META_PICK_RATE,
    behavior: new Map(),
    goldTempo: new Map(),
    standingsByCompetition: new Map(),
    standingsOverall: new Map(),
    formSeason: null,
    rosters: new Map(),
    teamsByCompetition: new Map(),
    allTeams: [],
    championsByRole,
    ratings: new Map(),
    gamesAnalyzed: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Point-in-time scoping                                               */
/* ------------------------------------------------------------------ */

/**
 * Games that had already been played at a given instant.
 *
 * Backtesting against a model built from the whole season is the classic
 * lookahead mistake: predicting a July game while the champion win rates,
 * standings and meta already contain August. Cutting the history at kickoff is
 * what makes a backtest mean anything.
 *
 * `games` arrives newest-first, so the cut is a binary search for the first
 * game strictly older than the cutoff and a single slice — no full scan per
 * match, which matters when stepping through hundreds of them.
 */
export function gamesBefore(games: readonly Game[], cutoff: number): Game[] {
  let low = 0;
  let high = games.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (Date.parse(games[mid]!.date) < cutoff) high = mid;
    else low = mid + 1;
  }
  return games.slice(low);
}
