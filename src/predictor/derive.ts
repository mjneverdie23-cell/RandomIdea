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
import { primaryClass, type ChampionClass } from './championClasses.ts';
import type {
  GoldTempo,
  ChampionScaling,
  ClassProfile,
  EarlyGoldProfile,
  PredictorModel,
  ScalingRead,
  StandingRow,
  TeamBehavior,
  TeamRating,
  WinLoss,
} from './types.ts';

/** How many of the newest patches define the current meta. */
export const META_PATCH_COUNT = 2;
/** Share of games a champion must be picked in to count as meta. */
export const META_PICK_RATE = 0.05;
/**
 * Appearances — picks or bans — a champion needs before a rate means anything.
 *
 * A percentage is not evidence on its own. The window is the two newest
 * patches, and on the day a patch ships that can be very few games: measured
 * across the 2026 season, a cutoff landing just after a patch drop gave a
 * 37-game window, where the 5% bar works out to under two picks and any
 * champion picked twice in a role reads as meta — noise deciding a full point
 * on each side.
 *
 * Widening the window instead would have traded the problem for a worse one,
 * dragging a patch nobody plays any more into the read. This binds only where
 * the window is genuinely thin: across the same season it changed the meta pool
 * in 1 of 28 weekly windows — the degenerate one — and left the rest untouched.
 */
export const META_MIN_PICKS = 4;
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
 * The role a champion is actually played in, across everything scoped.
 *
 * Bans arrive as a flat list with no role attached, so to count them per role
 * they have to be attributed to one. Taken over the whole scoped window rather
 * than the meta window, because a champion's role is stable and the wider
 * sample makes the attribution steadier.
 */
function mainRoles(games: readonly Game[]): Map<string, Role> {
  const tally = new Map<string, Map<Role, number>>();
  for (const game of games) {
    for (const side of [game.blue, game.red] as const) {
      for (const player of side.players) {
        const perRole = tally.get(player.champion.id) ?? new Map<Role, number>();
        perRole.set(player.role, (perRole.get(player.role) ?? 0) + 1);
        tally.set(player.champion.id, perRole);
      }
    }
  }

  const main = new Map<string, Role>();
  for (const [championId, perRole] of tally) {
    let best: Role | null = null;
    let count = -1;
    for (const [role, n] of perRole) {
      if (n > count) {
        best = role;
        count = n;
      }
    }
    if (best) main.set(championId, best);
  }
  return main;
}

/**
 * Meta = contested often enough on the newest patches, computed per role.
 *
 * This is presence meta, not win-rate meta: the question the score asks is "did
 * they draft what everyone is fighting over", and a champion can be contested
 * constantly while sitting at a 48% win rate.
 *
 * **Presence is picks plus bans.** Counting picks alone got this exactly
 * backwards for the champions teams respect most: on patch 16.15 Poppy was
 * picked 8 times and banned 113 — the single most contested champion in the
 * game — and read as *off-meta*, so a team that managed to get her through was
 * credited a pocket-pick surprise bonus for taking her. A champion nobody is
 * allowed to play is not a surprise, it is the definition of the meta. Qiyana
 * was the same shape at 4 picks and 5 bans.
 *
 * Bans carry no role in the data, so each is attributed to the role that
 * champion is actually played in.
 *
 * The window is the two newest patches, which is what keeps the read current,
 * and a champion needs both a high enough rate and `META_MIN_PICKS` actual
 * appearances — a percentage over a handful of games is not evidence.
 */
export function deriveMeta(games: readonly Game[]): {
  metaByRole: Map<Role, Set<string>>;
  /** Pick rate alone, reported so the split between picks and bans is visible. */
  pickRateByRole: Map<Role, Map<string, number>>;
  /** Picks plus bans over window games — the number the meta test uses. */
  presenceRateByRole: Map<Role, Map<string, number>>;
  patches: string[];
  windowGames: number;
} {
  const patches = [...new Set(games.map((g) => g.patch).filter((p): p is string => p !== null))].sort(
    comparePatches,
  );
  const recentPatches = patches.slice(0, META_PATCH_COUNT);
  const wanted = new Set(recentPatches);

  const recent = wanted.size ? games.filter((g) => g.patch && wanted.has(g.patch)) : games;

  const role = mainRoles(games);
  const picks = new Map<Role, Map<string, number>>();
  const presence = new Map<Role, Map<string, number>>();
  for (const r of ROLES) {
    picks.set(r, new Map());
    presence.set(r, new Map());
  }

  const bump = (map: Map<Role, Map<string, number>>, r: Role, championId: string) => {
    const perRole = map.get(r)!;
    perRole.set(championId, (perRole.get(championId) ?? 0) + 1);
  };

  for (const game of recent) {
    for (const side of [game.blue, game.red] as const) {
      // Counted per side, so a champion contested by both teams counts twice —
      // being fought over on both sides is the strongest meta signal there is.
      for (const player of side.players) {
        bump(picks, player.role, player.champion.id);
        bump(presence, player.role, player.champion.id);
      }
      for (const ban of side.bans) {
        // A ban only lands somewhere if the champion was actually played in
        // the window; one nobody picked at all has no role to file it under.
        const banRole = role.get(ban.id);
        if (banRole) bump(presence, banRole, ban.id);
      }
    }
  }

  const metaByRole = new Map<Role, Set<string>>();
  const pickRateByRole = new Map<Role, Map<string, number>>();
  const presenceRateByRole = new Map<Role, Map<string, number>>();
  for (const r of ROLES) {
    const keep = new Set<string>();
    const pickRates = new Map<string, number>();
    const presenceRates = new Map<string, number>();

    for (const [championId, count] of picks.get(r)!) {
      if (recent.length > 0) pickRates.set(championId, count / recent.length);
    }
    for (const [championId, count] of presence.get(r)!) {
      if (recent.length === 0) continue;
      const rate = count / recent.length;
      presenceRates.set(championId, rate);
      if (rate >= META_PICK_RATE && count >= META_MIN_PICKS) keep.add(championId);
    }

    metaByRole.set(r, keep);
    pickRateByRole.set(r, pickRates);
    presenceRateByRole.set(r, presenceRates);
  }

  return {
    metaByRole,
    pickRateByRole,
    presenceRateByRole,
    patches: recentPatches,
    windowGames: recent.length,
  };
}

/* ------------------------------------------------------------------ */
/* Champion scaling                                                    */
/* ------------------------------------------------------------------ */

/** Games a champion needs in *each* length bucket before it is classified. */
export const SCALING_MIN_BUCKET = 12;
/**
 * Win-rate gap between long and short games that earns a label.
 *
 * Five points is roughly the quartile of the observed spread, so this labels
 * the tails and leaves the middle alone. It is deliberately not a claim that
 * every champion either side of the line is meaningfully different from even —
 * see the caveat on `deriveScaling`.
 */
export const SCALING_DELTA = 0.05;
/** Where the short and long buckets are cut, as quantiles of game length. */
export const SCALING_SHORT_QUANTILE = 0.3;
export const SCALING_LONG_QUANTILE = 0.7;

/**
 * Does a champion get better or worse the longer the game runs?
 *
 * Computed, not hand-listed: split every game with a recorded duration into a
 * short bucket and a long bucket at the 30th and 70th percentiles of *this*
 * dataset, and compare each champion's win rate across the two. A champion that
 * wins more when the game goes long is scored as late-game.
 *
 * Using the dataset's own quantiles rather than a fixed "30 minutes" matters,
 * because average game length moves with the patch — the 2026 file runs a
 * 32-minute median, and a hardcoded cut would drift with it.
 *
 * **This is a noisy measure and the label should be read as descriptive.** The
 * median champion's gap is −0.1 points and the quartiles sit at ±5, so the cut
 * is labelling the tails of a spread that is mostly binomial noise: at 12-40
 * games per bucket a 5-point gap is well inside what chance produces. It lines
 * up with intuition often enough to be worth showing — Azir, Kalista, Aphelios,
 * Corki and Yorick come out late; LeBlanc, Qiyana, Olaf and Caitlyn come out
 * early — but a single champion's label is not evidence about that champion.
 * It is reported to the reader and, deliberately, scores nothing.
 */
export function deriveScaling(games: readonly Game[]): {
  scalingByChampion: Map<string, ScalingRead>;
  shortCutSeconds: number | null;
  longCutSeconds: number | null;
} {
  const timed = games.filter((game) => game.durationSeconds !== null);
  if (timed.length < SCALING_MIN_BUCKET * 2) {
    return { scalingByChampion: new Map(), shortCutSeconds: null, longCutSeconds: null };
  }

  const lengths = timed.map((game) => game.durationSeconds!).sort((a, b) => a - b);
  const at = (q: number) => lengths[Math.floor(q * (lengths.length - 1))]!;
  const shortCut = at(SCALING_SHORT_QUANTILE);
  const longCut = at(SCALING_LONG_QUANTILE);

  interface Bucket {
    shortWins: number;
    shortGames: number;
    longWins: number;
    longGames: number;
  }
  const tally = new Map<string, Bucket>();

  // No spread to split — every game the same length tells us nothing.
  if (shortCut >= longCut) {
    return { scalingByChampion: new Map(), shortCutSeconds: shortCut, longCutSeconds: longCut };
  }

  for (const game of timed) {
    const seconds = game.durationSeconds!;
    // Inclusive on both ends: game lengths cluster on whole seconds, and an
    // exclusive test drops every game sitting exactly on a cut — which for a
    // coarse distribution can be all of them.
    const long = seconds >= longCut;
    if (!long && seconds > shortCut) continue;

    for (const side of [game.blue, game.red] as const) {
      const won = game.winner === side.side;
      for (const player of side.players) {
        const bucket = tally.get(player.champion.id) ?? {
          shortWins: 0,
          shortGames: 0,
          longWins: 0,
          longGames: 0,
        };
        if (long) {
          bucket.longGames += 1;
          if (won) bucket.longWins += 1;
        } else {
          bucket.shortGames += 1;
          if (won) bucket.shortWins += 1;
        }
        tally.set(player.champion.id, bucket);
      }
    }
  }

  const scalingByChampion = new Map<string, ScalingRead>();
  for (const [championId, bucket] of tally) {
    if (bucket.shortGames < SCALING_MIN_BUCKET || bucket.longGames < SCALING_MIN_BUCKET) continue;
    const shortRate = bucket.shortWins / bucket.shortGames;
    const longRate = bucket.longWins / bucket.longGames;
    const delta = longRate - shortRate;
    const type: ChampionScaling =
      delta >= SCALING_DELTA ? 'late' : delta <= -SCALING_DELTA ? 'early' : 'balanced';
    scalingByChampion.set(championId, {
      type,
      delta,
      shortRate,
      longRate,
      shortGames: bucket.shortGames,
      longGames: bucket.longGames,
    });
  }

  return { scalingByChampion, shortCutSeconds: shortCut, longCutSeconds: longCut };
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
/* Player champion-class profiles                                      */
/* ------------------------------------------------------------------ */

/** Games a player needs before their class profile is worth reporting. */
export const MIN_CLASS_PROFILE = 15;
/** How many classes count as "what this player usually drafts". */
export const FAVOURITE_CLASSES = 2;

/**
 * What each player usually drafts, by champion class.
 *
 * Faker is mostly mages; a Zed game is unusual for him and a Zed game for
 * Chovy is not. That is real, legible information about a draft, and the
 * per-lane breakdown says so.
 *
 * **It is reported and deliberately not scored.** Backtested over the full
 * 2026 season, a deduction for picking outside a player's two most-played
 * classes never helped: flat penalties from 0.1 to 0.8 scored −1 to −7 games,
 * grading the deduction by how unusual the pick was scored −5 to −23, and
 * restricting it to the one bucket that loses (two off-type picks, 45.0% over
 * 211 sides) gave 0, −3, +1, −1 across four sizes. A wrong-sign control that
 * *rewarded* off-type picks also lost 13 games, which is what a term made of
 * noise looks like from both directions.
 *
 * The reason is redundancy rather than the idea being wrong. A player picking
 * outside their comfort classes usually has no record on that champion, and the
 * win-rate base already prices exactly that — either as the prepared-surprise
 * 1.00 or the neutral 0.50, both far from their 60-70% on a comfort pick. The
 * class profile is mostly restating what the biggest term already knows.
 */
export function deriveClassProfiles(games: readonly Game[]): Map<string, ClassProfile> {
  const counts = new Map<string, Map<ChampionClass, number>>();

  for (const game of games) {
    for (const side of [game.blue, game.red] as const) {
      for (const player of side.players) {
        const klass = primaryClass(player.champion);
        if (!klass) continue;
        const key = player.playerName.toLowerCase();
        const perClass = counts.get(key) ?? new Map<ChampionClass, number>();
        perClass.set(klass, (perClass.get(klass) ?? 0) + 1);
        counts.set(key, perClass);
      }
    }
  }

  const profiles = new Map<string, ClassProfile>();
  for (const [player, perClass] of counts) {
    const games_ = [...perClass.values()].reduce((a, b) => a + b, 0);
    if (games_ < MIN_CLASS_PROFILE) continue;
    const ranked = [...perClass.entries()].sort((a, b) => b[1] - a[1]);
    profiles.set(player, {
      games: games_,
      shares: new Map(ranked.map(([klass, n]) => [klass, n / games_])),
      favourites: ranked.slice(0, FAVOURITE_CLASSES).map(([klass]) => klass),
    });
  }
  return profiles;
}

/* ------------------------------------------------------------------ */
/* Early gold window                                                   */
/* ------------------------------------------------------------------ */

/**
 * The checkpoints that make up "the early game".
 *
 * Oracle's Elixir carries gold differences at 10, 15, 20 and 25 minutes and
 * **nothing earlier** — there is no `golddiffat5` column in the export. So an
 * early window nominally running from 5 minutes is, in this data, the 10- and
 * 15-minute marks. Derived from `GOLD_CHECKPOINTS` rather than written out, so
 * a future export carrying a 5-minute column is picked up by changing the bound
 * in one place.
 */
export const EARLY_GOLD_MAX_MINUTE = 15;
export const EARLY_GOLD_MINUTES = GOLD_CHECKPOINTS.filter(
  (minute) => minute <= EARLY_GOLD_MAX_MINUTE,
);

/**
 * Gold inside which neither team really leads.
 *
 * Without a band, "leading" and "behind" are strict complements and reporting
 * both says nothing the ahead-rate did not already say. Measured on the 2026
 * export, ±500g covers 30% of team-games at 10 minutes — roughly the flattest
 * third, and about one kill plus a wave. It covers only 17% at 15 minutes,
 * which is not a flaw in the band: by then games have genuinely diverged.
 */
export const GOLD_LEVEL_BAND = 500;

/** Deficit that counts as a bad start worth measuring a recovery from. */
export const COMEBACK_DEFICIT = 1800;

/** Deficit games a team needs before its comeback rate is reported. */
export const MIN_COMEBACK_SAMPLE = 5;

/**
 * Early lead/behind shares, and what a team does after a bad start.
 *
 * Two separate reads on the same games. The shares pool every early checkpoint,
 * so a team with 40 games contributes up to 80 observations and "ahead 60% of
 * the early game" means across the window rather than at one snapshot.
 *
 * The comeback figures are conditional on having been `COMEBACK_DEFICIT` down
 * at one of those marks, and are deliberately two numbers: the share that won
 * at all, and the stricter share that clawed back to an actual gold lead *and*
 * won. The gap between them is teams that stabilised and won late without the
 * checkpoints ever showing them ahead — the last mark is 25 minutes, and plenty
 * of games are decided after it.
 */
export function deriveEarlyGold(games: readonly Game[]): Map<string, EarlyGoldProfile> {
  interface Bucket {
    lead: number;
    behind: number;
    level: number;
    sample: number;
    deficits: number;
    deficitWins: number;
    comebacks: number;
  }
  const perTeam = new Map<string, Bucket>();
  const earlyIndexes = GOLD_CHECKPOINTS.map((minute, index) => ({ minute, index })).filter(
    ({ minute }) => minute <= EARLY_GOLD_MAX_MINUTE,
  );

  for (const game of games) {
    for (const side of [game.blue, game.red] as const) {
      const checkpoints = side.goldDiff?.checkpoints;
      if (!checkpoints) continue;

      const key = side.teamName.toLowerCase();
      const bucket = perTeam.get(key) ?? {
        lead: 0,
        behind: 0,
        level: 0,
        sample: 0,
        deficits: 0,
        deficitWins: 0,
        comebacks: 0,
      };

      const early: number[] = [];
      for (const { index } of earlyIndexes) {
        const diff = checkpoints[index];
        if (diff === null || diff === undefined) continue;
        early.push(diff);
        bucket.sample += 1;
        if (diff > GOLD_LEVEL_BAND) bucket.lead += 1;
        else if (diff < -GOLD_LEVEL_BAND) bucket.behind += 1;
        else bucket.level += 1;
      }

      if (early.length > 0 && Math.min(...early) <= -COMEBACK_DEFICIT) {
        bucket.deficits += 1;
        const won = game.winner === side.side;
        if (won) bucket.deficitWins += 1;
        // A lead after the window is what "turned it around" means; a game that
        // ends before the next mark simply never gets the chance to show one.
        const recovered = checkpoints.some(
          (diff, index) =>
            index >= earlyIndexes.length && diff !== null && diff !== undefined && diff > 0,
        );
        if (won && recovered) bucket.comebacks += 1;
      }

      perTeam.set(key, bucket);
    }
  }

  const profiles = new Map<string, EarlyGoldProfile>();
  for (const [team, bucket] of perTeam) {
    if (bucket.sample < MIN_TEMPO_SAMPLE) continue;
    const enough = bucket.deficits >= MIN_COMEBACK_SAMPLE;
    profiles.set(team, {
      minutes: [...EARLY_GOLD_MINUTES],
      sample: bucket.sample,
      leadRate: bucket.lead / bucket.sample,
      behindRate: bucket.behind / bucket.sample,
      levelRate: bucket.level / bucket.sample,
      deficitGold: COMEBACK_DEFICIT,
      deficitSample: bucket.deficits,
      deficitWinRate: enough ? bucket.deficitWins / bucket.deficits : null,
      comebackRate: enough ? bucket.comebacks / bucket.deficits : null,
    });
  }
  return profiles;
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
  const { metaByRole, pickRateByRole, presenceRateByRole, patches, windowGames } = deriveMeta(games);
  const { scalingByChampion, shortCutSeconds, longCutSeconds } = deriveScaling(games);

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
    pickRateByRole,
    presenceRateByRole,
    metaPatches: patches,
    metaWindowGames: windowGames,
    metaPickRateThreshold: META_PICK_RATE,
    scalingByChampion,
    scalingShortSeconds: shortCutSeconds,
    scalingLongSeconds: longCutSeconds,
    behavior: deriveBehavior(formGames, runs),
    goldTempo: deriveGoldTempo(formGames),
    earlyGold: deriveEarlyGold(formGames),
    // Class preference is a durable habit, so it reads all scoped history.
    classProfiles: deriveClassProfiles(games),
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
  const pickRateByRole = new Map<Role, Map<string, number>>();
  const presenceRateByRole = new Map<Role, Map<string, number>>();
  const championsByRole = new Map<Role, Champion[]>();
  for (const role of ROLES) {
    metaByRole.set(role, new Set());
    pickRateByRole.set(role, new Map());
    presenceRateByRole.set(role, new Map());
    championsByRole.set(role, []);
  }
  return {
    playerSplitRecord: new Map(),
    playerCareerRecord: new Map(),
    teamSplitRecord: new Map(),
    teamCareerRecord: new Map(),
    currentSplitOf: new Map(),
    metaByRole,
    pickRateByRole,
    presenceRateByRole,
    metaPatches: [],
    metaWindowGames: 0,
    metaPickRateThreshold: META_PICK_RATE,
    scalingByChampion: new Map(),
    scalingShortSeconds: null,
    scalingLongSeconds: null,
    behavior: new Map(),
    goldTempo: new Map(),
    earlyGold: new Map(),
    classProfiles: new Map(),
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
