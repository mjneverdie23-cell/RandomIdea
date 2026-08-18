/**
 * Transparent additive-points prediction engine.
 *
 * There are no fitted weights and no black box. Each side's score is a plain
 * sum of labelled line items, and the higher total is the predicted winner:
 *
 *   win-rate base   the 5 champions' historical win rates for that team + role
 *   meta bonus      +1 per meta champion (meta = pick frequency, computed live)
 *   pocket picks    1-2 off-meta picks -> +1.5 each ; more than 2 -> -2
 *                   (halved in game one, where the read is least informative)
 *   form edge       up to +1 for the better current-season series record
 *   motivation      +0.5 must-win, -0.5 nothing to play for, -1 tank incentive
 *   fraud penalty   minus the team's inconsistency rating
 *
 * The point margin becomes a per-game probability through a logistic curve,
 * and the series/sweep probabilities follow from that by counting the ways a
 * best-of can still be won. Behaviour (throws, comebacks, deciders) and
 * early-game gold tempo are reported as plain language and deliberately do not
 * move the score — they are context for the reader, not fitted terms.
 *
 * Pure: no I/O, no React, no dates. Everything it knows arrives in the model.
 */

import { ROLES, type Champion, type Role, type Side } from '../domain/types.ts';
import { relevantEdges } from './championGraph.ts';
import { lookupRating } from './ratings.ts';
import {
  SERIES_TARGET,
  type GoldTempo,
  type GoldTempoPoint,
  type Notice,
  type PickLine,
  type Prediction,
  type PredictionInput,
  type PredictorModel,
  type Motivation,
  type SideInput,
  type SideScore,
  type StandingRow,
  type TeamBehavior,
  type WinLoss,
} from './types.ts';

/* ------------------------------------------------------------------ */
/* Point rules                                                         */
/* ------------------------------------------------------------------ */

export const META_POINT = 1.0;

/**
 * What one off-meta pick is worth, and why it beats a meta pick.
 *
 * An off-meta champion earns no meta bonus, so at parity with `META_POINT` the
 * two cancelled out exactly: four meta picks plus one pocket pick scored the
 * same as five meta picks, and the surprise factor the term exists to reward
 * was invisible in the total. Pricing a pocket pick above a meta pick makes it
 * a real edge rather than a wash.
 */
export const POCKET_POINT = 1.5;
/** Off-meta picks a team can take before the draft reads as chaos, not a plan. */
export const POCKET_MAX = 2;
export const POCKET_MANY_PENALTY = -2.0;

/**
 * How much of the pocket-pick term survives in game one.
 *
 * Opening games are the volatile ones: neither side has seen what the other
 * intends to play, so an off-meta pick there says far less about a plan than
 * the same pick in game three, where it answers something already on the
 * board. The whole term is discounted — reward and chaos penalty alike —
 * because the read is less informative, not because surprises are worth less.
 */
export const GAME_ONE_POCKET_SCALE = 0.5;

export function pocketBonusFor(offMetaCount: number, gameNumber: number): number {
  if (offMetaCount <= 0) return 0;
  const raw =
    offMetaCount <= POCKET_MAX ? offMetaCount * POCKET_POINT : POCKET_MANY_PENALTY;
  return gameNumber <= 1 ? raw * GAME_ONE_POCKET_SCALE : raw;
}
/** Logistic scale converting a point margin into a per-game probability. */
export const PROB_SCALE = 2.0;

/** Points per full (100%) series-win-rate gap, and the cap on that award. */
export const FORM_SCALE = 2.0;
export const FORM_CAP = 1.0;
/** A record below this many series is not trusted for the form edge. */
export const MIN_FORM_SERIES = 3;

/**
 * What a team's situation is worth.
 *
 * This is the one term the data cannot supply — nothing in a results export
 * knows a team is already eliminated or would rather draw a softer bracket, so
 * the user states it and the model takes them at their word. The values are
 * scaled against the form edge (max ±1.00) rather than the meta bonus, because
 * a stated circumstance should be able to tip a close matchup without ever
 * outweighing what the teams actually drafted.
 */
export const MOTIVATION_POINTS: Record<Motivation, number> = {
  normal: 0,
  'must win': 0.5,
  'nothing to play for': -0.5,
  'tank incentive': -1.0,
};

/**
 * Win rate credited when a team has never played the champion in that role.
 *
 * A pro pulling out a champion with no recorded history is not a coin flip —
 * it is a prepared pick. Nobody first-times something on stage; it has been
 * scrimmed, it is aimed at this opponent, and the other side has no film on
 * it. Knight's Swain at MSI is the case this exists for. Credited full value
 * rather than the 0.5 an absent record used to produce.
 *
 * The one place to watch: with history cut at kickoff, an early-season backtest
 * has little recorded play, so many lanes qualify and the base inflates for
 * both sides at once.
 */
export const UNPLAYED_WIN_RATE = 1.0;

/**
 * Side credited with first pick in the draft notice.
 *
 * Standard tournament draft gives blue the opening pick and red the last one,
 * so this is set against the rulebook on purpose — it matches the predictor
 * this was ported from, which is what the app's users expect to read. One
 * constant so the notice can be flipped without hunting through prose.
 */
export const FIRST_PICK_SIDE: Side = 'red';

/* ------------------------------------------------------------------ */
/* Probability                                                         */
/* ------------------------------------------------------------------ */

/**
 * Probability of winning `needSelf` more games before the opponent wins
 * `needOpp`, given a fixed per-game probability. This is the negative binomial
 * tail: sum over the number of games the opponent takes along the way.
 */
export function seriesWinProbability(p: number, needSelf: number, needOpp: number): number {
  if (needSelf <= 0) return 1;
  if (needOpp <= 0) return 0;
  let total = 0;
  for (let k = 0; k < needOpp; k += 1) {
    total += binomial(needSelf - 1 + k, k) * p ** needSelf * (1 - p) ** k;
  }
  return total;
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i += 1) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

function logistic(margin: number): number {
  return 1 / (1 + Math.exp(-margin / PROB_SCALE));
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export function recordKey(competition: string, team: string, role: Role, championId: string): string {
  return `${competition}|${team.toLowerCase()}|${role}|${championId}`;
}

export function anywhereKey(team: string, role: Role, championId: string): string {
  return `${team.toLowerCase()}|${role}|${championId}`;
}

export interface WinRateRead {
  winRate: number;
  note: string;
  scope: 'competition' | 'anywhere' | 'none';
}

/**
 * Historical win rate for one team on one champion in one role.
 *
 * The selected competition is the primary scope, because how a team plays at
 * Worlds is not how they play in their home league. When they have simply
 * never played that champion there, we widen to their full history rather than
 * dropping straight to the unplayed case — an international event otherwise
 * treats a champion the team plays constantly at home as brand new. Only a
 * champion with no record anywhere counts as a first-time pick. The scope that
 * produced the number is reported so the UI can show it.
 */
export function championWinRate(
  model: PredictorModel,
  competition: string | null,
  team: string,
  champion: Champion,
  role: Role,
): WinRateRead {
  const scoped = competition
    ? model.championRecord.get(recordKey(competition, team, role, champion.id))
    : undefined;
  if (scoped && scoped.games > 0) {
    return { winRate: scoped.wins / scoped.games, note: describe(scoped), scope: 'competition' };
  }

  const anywhere = model.championRecordAnywhere.get(anywhereKey(team, role, champion.id));
  if (anywhere && anywhere.games > 0) {
    return {
      winRate: anywhere.wins / anywhere.games,
      note: `${describe(anywhere)} · all competitions`,
      scope: 'anywhere',
    };
  }

  return {
    winRate: UNPLAYED_WIN_RATE,
    note: 'no recorded games — first-time pick',
    scope: 'none',
  };
}

function describe(record: WinLoss): string {
  const pct = Math.round((record.wins / record.games) * 100);
  return `${record.wins}W/${record.games} (${pct}%)`;
}

export function isMeta(model: PredictorModel, champion: Champion, role: Role): boolean {
  return model.metaByRole.get(role)?.has(champion.id) ?? false;
}

/** Standings row for a team, preferring the competition table. */
export function standingFor(
  model: PredictorModel,
  competition: string | null,
  team: string,
): StandingRow | null {
  const key = team.toLowerCase();
  if (competition) {
    const row = model.standingsByCompetition.get(competition as never)?.get(key);
    if (row) return row;
  }
  return model.standingsOverall.get(key) ?? null;
}

/** Series win rate for the form edge, only when the sample is big enough. */
function usableForm(model: PredictorModel, competition: string | null, team: string): number | null {
  const key = team.toLowerCase();
  const scoped = competition
    ? model.standingsByCompetition.get(competition as never)?.get(key)
    : undefined;
  if (scoped && scoped.seriesWon + scoped.seriesLost >= MIN_FORM_SERIES) return scoped.seriesPct;

  const overall = model.standingsOverall.get(key);
  if (overall && overall.seriesWon + overall.seriesLost >= MIN_FORM_SERIES) return overall.seriesPct;
  return null;
}

/* ------------------------------------------------------------------ */
/* Per-side tally                                                      */
/* ------------------------------------------------------------------ */

function scoreSide(
  model: PredictorModel,
  input: SideInput,
  opposing: SideInput,
  gameNumber: number,
): SideScore {
  const own = input.champions.filter((c): c is Champion => c !== null);
  const against = opposing.champions.filter((c): c is Champion => c !== null);
  const roster = model.rosters.get(input.team.toLowerCase()) ?? {};

  const picks: PickLine[] = [];
  let winRateBase = 0;
  let metaCount = 0;

  ROLES.forEach((role, index) => {
    const champion = input.champions[index];
    if (!champion) return;
    const read = championWinRate(model, input.competition, input.team, champion, role);
    const meta = isMeta(model, champion, role);
    winRateBase += read.winRate;
    if (meta) metaCount += 1;

    const edges = relevantEdges(champion, own, against);
    picks.push({
      role,
      champion,
      player: roster[role] ?? null,
      winRate: read.winRate,
      note: read.note,
      scope: read.scope,
      meta,
      ...edges,
    });
  });

  // Five neutral lanes would otherwise be worth the same as five 100% lanes.
  winRateBase = Math.min(winRateBase, ROLES.length);

  const offMetaCount = picks.length - metaCount;
  const pocketBonus = pocketBonusFor(offMetaCount, gameNumber);

  const fraudPenalty = lookupRating(model.ratings, input.team)?.fraud ?? 0;

  return {
    team: input.team,
    picks,
    winRateBase,
    metaCount,
    metaBonus: metaCount * META_POINT,
    offMetaCount,
    pocketBonus,
    formEdge: 0,
    motivationBonus: MOTIVATION_POINTS[input.motivation] ?? 0,
    fraudPenalty,
    total: 0,
  };
}

function finalizeTotal(score: SideScore): number {
  return (
    score.winRateBase +
    score.metaBonus +
    score.pocketBonus +
    score.formEdge +
    score.motivationBonus -
    score.fraudPenalty
  );
}

/* ------------------------------------------------------------------ */
/* Behaviour narration                                                 */
/* ------------------------------------------------------------------ */

const pct = (value: number): string => `${Math.round(value * 100)}%`;

export function behaviorTendencies(behavior: TeamBehavior | undefined): string[] {
  if (!behavior) return ['No games in the loaded seasons for a behavioural read.'];
  const out: string[] = [];

  const { recentForm } = behavior;
  if (recentForm !== null) {
    if (recentForm >= 0.6) out.push(`In strong recent form (${pct(recentForm)} weighted).`);
    else if (recentForm <= 0.4) out.push(`Struggling lately (${pct(recentForm)} weighted form).`);
    else out.push(`Middling recent form (${pct(recentForm)}).`);
  }

  const { blueWinRate: blue, redWinRate: red } = behavior;
  if (blue !== null && red !== null && Math.abs(blue - red) >= 0.12) {
    const stronger = blue > red ? 'blue' : 'red';
    out.push(`Clearly stronger on ${stronger} side (${pct(blue)} blue vs ${pct(red)} red).`);
  }

  if (behavior.throwRate !== null && behavior.throwSample >= 3) {
    if (behavior.throwRate >= 0.25) {
      out.push(
        `Prone to throwing leads (lost ${pct(behavior.throwRate)} of ${behavior.throwSample} games while well ahead).`,
      );
    } else if (behavior.throwRate <= 0.1) {
      out.push(`Rarely throws a lead (${pct(behavior.throwRate)} of ${behavior.throwSample}).`);
    }
  }

  if (behavior.comebackRate !== null && behavior.comebackSample >= 3) {
    if (behavior.comebackRate >= 0.4) {
      out.push(
        `Dangerous from behind (won ${pct(behavior.comebackRate)} of ${behavior.comebackSample} games down big).`,
      );
    } else if (behavior.comebackRate <= 0.15) {
      out.push(
        `Weak from behind (won only ${pct(behavior.comebackRate)} of ${behavior.comebackSample} deficits).`,
      );
    }
  }

  if (behavior.bouncebackRate !== null) {
    if (behavior.bouncebackRate >= 0.6) {
      out.push(`Bounces back well after a loss (${pct(behavior.bouncebackRate)} next game).`);
    } else if (behavior.bouncebackRate <= 0.4) {
      out.push(`Tends to tilt after a loss (${pct(behavior.bouncebackRate)} next game).`);
    }
  }

  if (behavior.chokeRate !== null && behavior.chokeSample >= 2) {
    out.push(
      `Game 5 after dropping game 4 from 2-1 up: won ${pct(behavior.chokeRate)} of ${behavior.chokeSample}.`,
    );
  }

  if (behavior.deciderRate !== null) {
    if (behavior.deciderRate >= 0.6) out.push(`Clutch in deciders (${pct(behavior.deciderRate)}).`);
    else if (behavior.deciderRate <= 0.4) out.push(`Shaky in deciders (${pct(behavior.deciderRate)}).`);
  }

  if (out.length === 0) out.push('Not enough games yet for a clear behavioural read.');
  return out;
}

/* ------------------------------------------------------------------ */
/* Scouting notices                                                    */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Early-game gold tempo                                               */
/* ------------------------------------------------------------------ */

/** Average gold swing below which a team is just even, not early-game strong. */
export const TEMPO_NOTABLE_GOLD = 200;
/** Share of games ahead that separates a habit from an even split. */
export const TEMPO_NOTABLE_RATE = 0.56;
/** Gap between two teams' averages worth calling out as an edge. */
export const TEMPO_EDGE_GOLD = 300;

const goldText = (value: number): string => {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString('en-US')}g`;
};

/** The mark that best describes the early game, preferring 10 minutes. */
export function earlyPoint(tempo: GoldTempo | undefined): GoldTempoPoint | null {
  if (!tempo || tempo.length === 0) return null;
  return tempo.find((point) => point.minute === 10) ?? tempo[0] ?? null;
}

function describeTempo(team: string, point: GoldTempoPoint): string {
  const head = `${team}: ${goldText(point.averageDiff)} on average at ${point.minute} min, ahead in ${pct(
    point.aheadRate,
  )} of ${point.sample} games`;

  const strongLead = point.averageDiff >= TEMPO_NOTABLE_GOLD && point.aheadRate >= TEMPO_NOTABLE_RATE;
  const strongDeficit =
    point.averageDiff <= -TEMPO_NOTABLE_GOLD && point.aheadRate <= 1 - TEMPO_NOTABLE_RATE;

  if (strongLead) return `${head} — tend to lead early.`;
  if (strongDeficit) return `${head} — tend to fall behind early.`;
  // A big average with a middling ahead-rate is a few blowouts, not a pattern.
  if (Math.abs(point.averageDiff) >= TEMPO_NOTABLE_GOLD) {
    return `${head} — swingy starts rather than a consistent one.`;
  }
  return `${head} — even out of the gate.`;
}

/**
 * Per-team early-game gold reads, plus the head-to-head edge between them.
 *
 * Reported, never scored: this describes how a team usually opens, not how the
 * draft on screen will open, and folding it into the tally would double-count
 * the strength already priced into the win-rate base.
 */
function goldTempoNotices(model: PredictorModel, input: PredictionInput): Notice[] {
  const notices: Notice[] = [];
  const points: Partial<Record<Side, GoldTempoPoint>> = {};

  for (const side of ['blue', 'red'] as const) {
    const entry = input[side];
    const point = earlyPoint(model.goldTempo.get(entry.team.toLowerCase()));
    if (!point) continue;
    points[side] = point;
    notices.push({
      kind: 'gold',
      side,
      text: describeTempo(entry.team, point),
      warning: point.averageDiff <= -TEMPO_NOTABLE_GOLD && point.aheadRate <= 1 - TEMPO_NOTABLE_RATE,
    });
  }

  const bluePoint = points.blue;
  const redPoint = points.red;
  if (bluePoint && redPoint && bluePoint.minute === redPoint.minute) {
    const gap = bluePoint.averageDiff - redPoint.averageDiff;
    if (Math.abs(gap) >= TEMPO_EDGE_GOLD) {
      const faster = gap > 0 ? input.blue.team : input.red.team;
      notices.push({
        kind: 'gold',
        side: gap > 0 ? 'blue' : 'red',
        text:
          `Early game at ${bluePoint.minute} min: ${input.blue.team} ${goldText(bluePoint.averageDiff)} vs ` +
          `${input.red.team} ${goldText(redPoint.averageDiff)} — ${faster} open ${goldText(
            Math.abs(gap),
          ).replace('+', '')} stronger.`,
      });
    }
  }

  return notices;
}

function buildNotices(
  model: PredictorModel,
  input: PredictionInput,
  blue: SideScore,
  red: SideScore,
): Notice[] {
  const notices: Notice[] = [];
  const blueBehavior = model.behavior.get(input.blue.team.toLowerCase());
  const redBehavior = model.behavior.get(input.red.team.toLowerCase());

  // Which side is credited with first pick is a deliberate product choice, not
  // a reading of the rulebook: standard tournament draft gives blue the opening
  // pick and red the last one. This app credits red, matching the predictor it
  // was ported from. Flip `FIRST_PICK_SIDE` to change it everywhere.
  const firstPick = FIRST_PICK_SIDE;
  const lastPick: Side = firstPick === 'red' ? 'blue' : 'red';
  const firstPickTeam = input[firstPick].team;
  const lastPickTeam = input[lastPick].team;
  const firstPickBehavior = firstPick === 'blue' ? blueBehavior : redBehavior;
  const sideWinRate =
    firstPick === 'blue' ? firstPickBehavior?.blueWinRate : firstPickBehavior?.redWinRate;

  notices.push({
    kind: 'first-pick',
    side: firstPick,
    text:
      `First pick belongs to ${firstPickTeam} on ${firstPick} side; ` +
      `${lastPickTeam} have last pick on ${lastPick}.` +
      (sideWinRate !== null && sideWinRate !== undefined
        ? ` ${firstPickTeam} win ${pct(sideWinRate)} on ${firstPick}.`
        : ''),
  });

  notices.push(...goldTempoNotices(model, input));

  for (const side of ['blue', 'red'] as const) {
    const entry = input[side];
    const row = standingFor(model, entry.competition, entry.team);
    if (!row) continue;
    notices.push({
      kind: 'standings',
      side,
      text:
        `${entry.team}: standings #${row.rank} — ${row.seriesWon}-${row.seriesLost} series ` +
        `(${pct(row.seriesPct)})${row.streak ? `, streak ${row.streak}` : ''}.`,
    });
  }

  const gameOne = input.gameNumber <= 1;
  for (const [side, score] of [
    ['blue', blue],
    ['red', red],
  ] as const) {
    if (score.picks.length === 0) continue;
    if (score.offMetaCount === 0) {
      notices.push({ kind: 'draft', side, text: `${score.team}: full-meta draft, no surprise picks.` });
    } else if (score.offMetaCount <= 2) {
      notices.push({
        kind: 'draft',
        side,
        text:
          `${score.team}: ${score.offMetaCount} pocket pick(s) — surprise factor ` +
          `(${signed(score.pocketBonus)}${gameOne ? ', halved in game one' : ''}).`,
      });
    } else {
      notices.push({
        kind: 'draft',
        side,
        warning: true,
        text:
          `${score.team}: ${score.offMetaCount} off-meta picks — chaotic, high-risk draft ` +
          `(${signed(score.pocketBonus)}${gameOne ? ', halved in game one' : ''}).`,
      });
    }
  }

  for (const [side, score] of [
    ['blue', blue],
    ['red', red],
  ] as const) {
    if (score.fraudPenalty > 0) {
      notices.push({
        kind: 'reliability',
        side,
        warning: true,
        text: `${score.team}: flagged for inconsistency (${signed(-score.fraudPenalty)}).`,
      });
    }
  }

  const target = SERIES_TARGET[input.seriesLength];
  if (target > 1) {
    const { scoreBlue, scoreRed } = input;
    if (scoreBlue === target - 1 && scoreRed === target - 1) {
      notices.push({
        kind: 'series',
        side: null,
        warning: true,
        text: `Series decider (${scoreBlue}-${scoreRed}) — win or go home for both.`,
      });
    } else if (scoreBlue === target - 1) {
      notices.push({
        kind: 'series',
        side: 'blue',
        text: `${input.blue.team} on match point (${scoreBlue}-${scoreRed}).`,
      });
    } else if (scoreRed === target - 1) {
      notices.push({
        kind: 'series',
        side: 'red',
        text: `${input.red.team} on match point (${scoreRed}-${scoreBlue}).`,
      });
    }
  }

  for (const side of ['blue', 'red'] as const) {
    const entry = input[side];
    if (entry.motivation === 'normal') continue;
    const points = signed(MOTIVATION_POINTS[entry.motivation]);
    if (entry.motivation === 'tank incentive') {
      notices.push({
        kind: 'motivation',
        side,
        warning: true,
        text: `${entry.team}: tank incentive — winning may draw a harder next opponent (${points}).`,
      });
    } else if (entry.motivation === 'must win') {
      notices.push({
        kind: 'motivation',
        side,
        text: `${entry.team}: must-win — expect full effort (${points}).`,
      });
    } else {
      notices.push({
        kind: 'motivation',
        side,
        warning: true,
        text: `${entry.team}: little to play for — coasting risk (${points}).`,
      });
    }
  }

  const blueForm = blueBehavior?.recentForm;
  const redForm = redBehavior?.recentForm;
  if (
    blueForm !== null &&
    blueForm !== undefined &&
    redForm !== null &&
    redForm !== undefined &&
    Math.abs(blueForm - redForm) >= 0.15
  ) {
    const hotter = blueForm > redForm ? input.blue.team : input.red.team;
    notices.push({
      kind: 'form',
      side: blueForm > redForm ? 'blue' : 'red',
      text: `Form edge: ${hotter} enter in better recent form.`,
    });
  }

  return notices;
}

/**
 * Signed point value for prose.
 *
 * Several terms carry quarter- and half-points — a 1.5 pocket bonus, a 0.25
 * fraud rating — so this keeps whatever precision the number actually has
 * rather than rounding it. Rounding to whole points reported a +1.5 bonus as
 * "+2" and a 0.25 penalty as "-0".
 */
function signed(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded)}`;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function predict(model: PredictorModel, input: PredictionInput): Prediction {
  const blue = scoreSide(model, input.blue, input.red, input.gameNumber);
  const red = scoreSide(model, input.red, input.blue, input.gameNumber);

  const blueForm = usableForm(model, input.blue.competition, input.blue.team);
  const redForm = usableForm(model, input.red.competition, input.red.team);
  let formNote = 'standings unavailable or too few series — no form edge';
  if (blueForm !== null && redForm !== null) {
    const gap = blueForm - redForm;
    if (gap > 0) blue.formEdge = Math.min(FORM_CAP, gap * FORM_SCALE);
    else if (gap < 0) red.formEdge = Math.min(FORM_CAP, -gap * FORM_SCALE);
    formNote =
      `series form ${pct(blueForm)} vs ${pct(redForm)} → ` +
      `+${Math.max(blue.formEdge, red.formEdge).toFixed(2)} to the better record`;
  }

  blue.total = finalizeTotal(blue);
  red.total = finalizeTotal(red);

  const margin = blue.total - red.total;
  const gameProbBlue = logistic(margin);
  const gameProbRed = 1 - gameProbBlue;

  const seriesTarget = SERIES_TARGET[input.seriesLength];
  const needBlue = Math.max(0, seriesTarget - input.scoreBlue);
  const needRed = Math.max(0, seriesTarget - input.scoreRed);

  const seriesProbBlue =
    seriesTarget === 1 ? gameProbBlue : seriesWinProbability(gameProbBlue, needBlue, needRed);
  const seriesProbRed = 1 - seriesProbBlue;

  const sweepProbBlue = needBlue > 0 ? gameProbBlue ** needBlue : 1;
  const sweepProbRed = needRed > 0 ? gameProbRed ** needRed : 1;

  const EPSILON = 1e-9;
  const favourite: Side | null = margin > EPSILON ? 'blue' : margin < -EPSILON ? 'red' : null;

  return {
    blue,
    red,
    margin,
    favourite,
    gameProbBlue,
    gameProbRed,
    seriesProbBlue,
    seriesProbRed,
    sweepProbBlue,
    sweepProbRed,
    needBlue,
    needRed,
    seriesTarget,
    formNote,
    tendencyBlue: behaviorTendencies(model.behavior.get(input.blue.team.toLowerCase())),
    tendencyRed: behaviorTendencies(model.behavior.get(input.red.team.toLowerCase())),
    notices: buildNotices(model, input, blue, red),
  };
}
