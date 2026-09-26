/**
 * Position sizing for a match priced in cents: a share of a team pays $1 if it
 * wins, so a 40¢ price is the market saying 40%.
 *
 * Four questions, answered in the order a disciplined trader asks them:
 *
 *   1. Is the price sane?   The two prices for one match add up to 100¢, or a
 *                           little more (the spread). Under 100¢ is a typo.
 *   2. What is it worth?    The model's probability, blended with how sure the
 *                           user says they are, is the fair price. The most
 *                           worth paying is that minus a safety margin.
 *   3. How much do we trust it?
 *                           Conviction: whether the model and the user both see
 *                           value at this price, how much data the draft rests
 *                           on, and how far the estimate sits from the market.
 *   4. How much?            Quarter Kelly times conviction, never more than 5%
 *                           of the bankroll times the same conviction.
 *
 * Nothing here is a setting. The size comes out of the inputs.
 *
 * The one decision that matters more than the arithmetic is the model input:
 * **the probability the predictor displays is not the probability this module
 * stakes on.** The report's logistic scale (`PROB_SCALE`, 2.0) is
 * overconfident. Measured on 3,692 games from March 2025 to September 2026:
 *
 *   report says   favourite actually won
 *     55%           55.0%
 *     65%           58.7%
 *     75%           65.7%
 *     85%           72.5%
 *     93%           77.1%
 *
 * Kelly stakes in proportion to claimed edge, so an overconfident probability
 * makes it bet hardest precisely where it is most wrong — the fastest way to
 * lose a bankroll with a model that is right 64% of the time. At a scale of
 * 3.75 the same games line up within a point or two from 55% to 85%.
 *
 * 3.75 is the log-loss optimum rather than the Brier one (3.6). Kelly maximises
 * expected log-wealth, and log-loss is the scoring rule that matches it, so it
 * is the calibration a staking decision should be tuned to. It is also the
 * slightly more conservative of the two.
 *
 * Pure: no I/O, no React. Probabilities and prices are fractions of $1 (0.40
 * is 40¢), for the blue side unless a name says otherwise.
 */

import { seriesWinProbability } from './engine.ts';
import type { GoldSwing, GoldSwingPoint, Prediction } from './types.ts';

export type Side = 'blue' | 'red';

/* ------------------------------------------------------------------ */
/* Calibration                                                         */
/* ------------------------------------------------------------------ */

/** Logistic scale for staking. See the module note for the measurement. */
export const STAKING_SCALE = 3.75;

/**
 * Ceiling on a single game's probability.
 *
 * Even calibrated, the model's rare 90%+ calls won about 70% of the time — on
 * a sample of eleven to fifteen games, which is exactly the regime where
 * nobody should trust a number enough to stake on it. Reaching 85% already
 * needs a margin of about 6.5 points, so this binds seldom and only where it
 * should.
 */
export const MAX_GAME_PROB = 0.85;

/** Bounds on any probability the sizing uses, whatever produced it. */
export const PROB_FLOOR = 0.05;
export const PROB_CEIL = 0.95;

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Blue's chance of winning this game, re-scaled for staking. */
export function stakingGameProb(margin: number): number {
  return clamp(sigmoid(margin / STAKING_SCALE), 1 - MAX_GAME_PROB, MAX_GAME_PROB);
}

/** Which result the prices are for. */
export type Market = 'series' | 'game';

/**
 * Blue's calibrated chance of taking the market.
 *
 * A series price follows from the per-game one by the same best-of arithmetic
 * the report uses, applied to the calibrated probability rather than the
 * displayed one. Returns `null` once the series is already decided — there is
 * no position to take on a result that has happened.
 */
export function modelProbability(prediction: Prediction, market: Market): number | null {
  const game = stakingGameProb(prediction.margin);
  if (market === 'game') return game;
  if (prediction.needBlue <= 0 || prediction.needRed <= 0) return null;
  return seriesWinProbability(game, prediction.needBlue, prediction.needRed);
}

/**
 * Combine the model with how sure the user is.
 *
 * Averaged in log-odds, not in percentages: 90% and 50% should meet nearer 75%
 * than a naive 70%, because the distance from 50 to 90 is much larger in
 * evidence terms than it looks on a percentage scale.
 *
 * Equal weight. The user is the only channel for what the model cannot see — a
 * roster swap the morning of the match, a patch the export has not caught up
 * with, a player known to be ill — so they should be able to move the number
 * substantially. They should not be able to replace it: people who say "90%
 * sure" are right far less often than 90% of the time.
 */
export function blend(model: number, user: number | null, userWeight = 0.5): number {
  if (user === null) return model;
  const m = clamp(model, PROB_FLOOR, PROB_CEIL);
  const u = clamp(user, PROB_FLOOR, PROB_CEIL);
  return sigmoid((1 - userWeight) * logit(m) + userWeight * logit(u));
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/**
 * Read a price in cents, returned as a fraction of $1.
 *
 *   40, 40¢, 40c   -> 0.40
 *   62.5           -> 0.625
 *   0.40, $0.40    -> 0.40   (under 1, or with a $, is read as dollars)
 *
 * Anything at or past 100¢, or at or below zero, is not a price for a side
 * that can still lose.
 */
export function parseCents(raw: string): number | null {
  let text = raw.trim().replace(',', '.').replace(/\s+/g, '');
  if (!text) return null;
  const dollars = text.startsWith('$');
  text = text.replace(/^\$/, '').replace(/(¢|c)$/i, '');
  if (!/^\d*\.?\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return null;
  const price = dollars || value < 1 ? value : value / 100;
  return price > 0 && price < 1 ? price : null;
}

/**
 * How sure the user is that their pick wins, as a fraction: 50 to 100 percent.
 * Under 50 would mean they think the other team wins, which is the other pick.
 */
export function parseSureness(raw: string): number | null {
  const text = raw.trim().replace(',', '.').replace(/%$/, '').trim();
  if (!text || !/^\d*\.?\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= 50 && value <= 100 ? value / 100 : null;
}

/** The user's probability that blue wins, from their pick and sureness. */
export function userProbability(pick: Side | null, sureness: number | null): number | null {
  if (pick === null || sureness === null) return null;
  return pick === 'blue' ? sureness : 1 - sureness;
}

/* ------------------------------------------------------------------ */
/* Market                                                              */
/* ------------------------------------------------------------------ */

export type SpreadQuality = 'crossed' | 'tight' | 'normal' | 'wide';

export interface MarketRead {
  /** The two prices, one of them possibly assumed. */
  prices: [blue: number, red: number];
  /** How far the two prices overshoot $1. The cost of crossing both sides. */
  spread: number;
  /** Prices scaled back to sum to $1 — the market's actual view. */
  fair: [blue: number, red: number];
  quality: SpreadQuality;
}

/**
 * Spread bands for a two-way match market in cents.
 *
 * A liquid major-league match trades 1–2¢ wide; a thin one 3–5¢; past that the
 * price on screen may not be one anyone will fill. Under 100¢ the two sides
 * can't both be real prices — one of them is a typo.
 */
export function spreadQuality(spread: number): SpreadQuality {
  // Float noise: 40¢ + 60¢ must read as exactly 100¢.
  const cents = Math.round(spread * 1000) / 10;
  if (cents < 0) return 'crossed';
  if (cents <= 2) return 'tight';
  if (cents <= 5) return 'normal';
  return 'wide';
}

export function readMarket(priceBlue: number, priceRed: number): MarketRead {
  const total = priceBlue + priceRed;
  return {
    prices: [priceBlue, priceRed],
    spread: total - 1,
    fair: [priceBlue / total, priceRed / total],
    quality: spreadQuality(total - 1),
  };
}

/* ------------------------------------------------------------------ */
/* Sizing                                                              */
/* ------------------------------------------------------------------ */

/**
 * Full Kelly for a share bought at `price` that pays $1: the bankroll fraction
 * that maximises long-run growth *if* `p` is exactly right. Negative means the
 * share is worth less than it costs.
 */
export function kellyFraction(p: number, price: number): number {
  return (p - price) / (1 - price);
}

/**
 * The safety margin, in cents per share, a price must sit under the estimate.
 *
 * Measured in cents rather than as a return because the model's error is in
 * probability: a 3-point miss costs the same 3¢ whether the share is 30¢ or
 * 70¢. Anything thinner than this is inside the model's own noise.
 */
export const MIN_EDGE = 0.03;

/**
 * Share of full Kelly staked at full conviction.
 *
 * Full Kelly is optimal only when the probability is known. Ours is estimated
 * by a model that is right about 64% of the time, and over-betting a noisy
 * edge costs far more growth than under-betting it — at twice full Kelly the
 * expected growth rate is zero. A quarter keeps about half the growth for a
 * small fraction of the swings.
 */
export const BASE_KELLY = 0.25;

/** The most of a bankroll one position may take, at full conviction. */
export const MAX_STAKE = 0.05;

/** What each doubt about the estimate does to the size. */
export const DOUBT_FACTOR = 0.5;

/**
 * How far from the market an estimate may sit before the size is cut, and
 * before nothing is sized at all.
 *
 * A liquid major-league market is the best estimate of the result available —
 * it aggregates every model, every scout and every trader willing to put money
 * behind a view. A model's value is in small, systematic deviations from it,
 * never in large ones. So distance from the market is treated as evidence
 * *against* the estimate:
 *
 *   under 15 points   full size
 *   15 to 25 points   size tapers linearly to zero
 *   over 25 points    nothing is sized — check the inputs
 *
 * Past 25 points the explanation is almost always mundane: the series score
 * was not updated, the price is for the series while the market is set to the
 * game (or the reverse), a price was typed onto the wrong team, the model is
 * leaning on a handful of 0-for-3 records — or the user is far surer than
 * anyone should be.
 */
export const MARKET_TAPER_FROM = 0.15;
export const MARKET_STOP_AT = 0.25;

/** A lane's win rate resting on fewer games than this is noise, not a record. */
export const THIN_RECORD_GAMES = 5;
/** Thin lanes, across both drafts, before the model's read is doubted. */
export const THIN_MODEL_LANES = 4;

/** The share of the size kept at a given distance from the market. */
export function marketTaper(distance: number): number {
  if (distance <= MARKET_TAPER_FROM) return 1;
  if (distance >= MARKET_STOP_AT) return 0;
  return (MARKET_STOP_AT - distance) / (MARKET_STOP_AT - MARKET_TAPER_FROM);
}

/**
 * How much the estimate is trusted on one side, 0 to 1. The size is Kelly
 * scaled by this, and so is the cap.
 */
export interface Conviction {
  /**
   * 1 when every source consulted sees value at this price; halved when the
   * model and the user split — one says the share is cheap, the other doesn't.
   */
  agreement: number;
  /** 1, or halved when the draft rests on thin records. */
  data: number;
  /** 1 down to 0 as the estimate moves from 15 to 25 points off the market. */
  market: number;
  value: number;
}

/** Everything the calculator knows about one side. */
export interface SideAssessment {
  side: Side;
  /** The price used: entered, or assumed as 100¢ minus the other side. */
  price: number | null;
  assumed: boolean;
  /** The market's view with the spread removed. */
  marketFair: number | null;
  /** Calibrated model probability. */
  model: number;
  /** The user's probability, when they picked a winner and said how sure. */
  user: number | null;
  /** What the sizing uses: model and user blended, then bounded. The fair price. */
  estimate: number;
  /** The most worth paying: fair price minus the safety margin. */
  maxPrice: number;
  /** Estimate minus price, in dollars per share. */
  edge: number | null;
  /** Expected profit per dollar spent at the price. */
  ev: number | null;
  /** Full Kelly at the price, for reference. */
  fullKelly: number | null;
  /** Whether the price clears the safety margin. */
  value: boolean;
  conviction: Conviction;
  /** The share of the bankroll to put on; zero when there is no position. */
  stakeFraction: number;
  /** `stakeFraction` of the bankroll, or `null` without a bankroll. */
  stake: number | null;
  /** Whether the cap, rather than Kelly, set the size. */
  capped: boolean;
}

export interface PositionInput {
  bankroll: number | null;
  priceBlue: number | null;
  priceRed: number | null;
  /** Calibrated model probability that blue takes the market. */
  modelBlue: number;
  /** The user's probability that blue takes it, or `null`. */
  userBlue: number | null;
  /** Lanes across both drafts whose win rate rests on under `THIN_RECORD_GAMES`. */
  thinLanes?: number;
  /** The user's own ceiling: no share is bought above this price. `null` for none. */
  maxEntry?: number | null;
  /** The side the user says wins, so a wait is planned on their team. */
  pick?: Side | null;
}

/** Why the answer is to wait rather than buy now. */
export type WaitReason =
  /** The price is over the user's own ceiling. */
  | 'limit'
  /** The price is over what the estimate says it is worth. */
  | 'edge';

/** The single answer the calculator gives. */
export type Decision =
  | { kind: 'no price' }
  | { kind: 'crossed'; total: number }
  | { kind: 'too far'; distance: number }
  | { kind: 'buy'; side: Side }
  | {
      kind: 'wait';
      side: Side;
      /** The price to wait for: the lower of the user's ceiling and the limit, in whole cents. */
      target: number;
      reason: WaitReason;
      /**
       * What the calculator would size at the target, with the market then at
       * that price. Zero when the target sits too far from the estimate to
       * size at all — the price only gets there if the game has changed.
       */
      stakeFraction: number;
      stake: number | null;
    };

export interface PositionAssessment {
  market: MarketRead | null;
  /** Points between the estimate and the market's view; `null` without a price. */
  distance: number | null;
  blue: SideAssessment;
  red: SideAssessment;
  decision: Decision;
  /** Short reasons the size is what it is, most important first. */
  notes: string[];
}

const cents = (p: number) => `${Math.round(p * 100)}¢`;
/** Whole cents, rounded down: a limit is never quoted above what clears the edge. */
const floorCents = (p: number) => Math.floor(p * 100 + 1e-6) / 100;

interface Sizing {
  conviction: Conviction;
  stakeFraction: number;
  capped: boolean;
}

/**
 * The stake for one side at one price, given where the market is.
 *
 * Shared by the price on screen and the price a wait is aiming for, so the
 * amount shown for a target is exactly what the calculator will say when the
 * price actually gets there.
 */
function sizeAt(args: {
  estimate: number;
  model: number;
  user: number | null;
  price: number;
  marketFair: number;
  marketFactor: number;
  thin: boolean;
  value: boolean;
  sane: boolean;
}): Sizing {
  const { estimate, model, user, price, marketFair, marketFactor, thin, value, sane } = args;
  // The model and the user each either see value at this price or don't.
  // Only the blend is traded, but a split between them is a doubt.
  const split = user !== null && model > marketFair !== user > marketFair;
  const conviction: Conviction = {
    agreement: split ? DOUBT_FACTOR : 1,
    data: thin ? DOUBT_FACTOR : 1,
    market: marketFactor,
    value: 0,
  };
  conviction.value = conviction.agreement * conviction.data * conviction.market;

  const takes = value && sane;
  const kellySize = BASE_KELLY * kellyFraction(estimate, price);
  return {
    conviction,
    stakeFraction: takes ? Math.min(kellySize, MAX_STAKE) * conviction.value : 0,
    capped: takes && kellySize > MAX_STAKE,
  };
}

/** Whether a price clears the safety margin, to a tenth of a cent so float noise can't decide it. */
const clears = (estimate: number, price: number) =>
  Math.round((estimate - price) * 1000) >= Math.round(MIN_EDGE * 1000) && estimate > price;

export function assessPosition(input: PositionInput): PositionAssessment {
  const bankroll = input.bankroll !== null && input.bankroll > 0 ? input.bankroll : null;
  const estimateBlue = clamp(blend(input.modelBlue, input.userBlue), PROB_FLOOR, PROB_CEIL);
  const maxEntry = input.maxEntry ?? null;
  const amount = (fraction: number) =>
    bankroll === null ? null : Math.round(fraction * bankroll * 100) / 100;

  // One price is enough: the other side of a two-way market is its complement.
  const priceBlue = input.priceBlue ?? (input.priceRed === null ? null : 1 - input.priceRed);
  const priceRed = input.priceRed ?? (input.priceBlue === null ? null : 1 - input.priceBlue);
  const market = priceBlue !== null && priceRed !== null ? readMarket(priceBlue, priceRed) : null;

  // Distance is the same from either side of a two-way market.
  const distance = market ? Math.abs(estimateBlue - market.fair[0]) : null;
  const marketFactor = distance === null ? 0 : marketTaper(distance);
  const thin = (input.thinLanes ?? 0) >= THIN_MODEL_LANES;
  const sane = market !== null && market.quality !== 'crossed' && marketFactor > 0;

  const side = (which: Side): SideAssessment => {
    const isBlue = which === 'blue';
    const price = isBlue ? priceBlue : priceRed;
    const estimate = isBlue ? estimateBlue : 1 - estimateBlue;
    const model = isBlue ? input.modelBlue : 1 - input.modelBlue;
    const user = input.userBlue === null ? null : isBlue ? input.userBlue : 1 - input.userBlue;
    const marketFair = market ? market.fair[isBlue ? 0 : 1] : null;

    const base = {
      side: which,
      price,
      assumed: price !== null && (isBlue ? input.priceBlue : input.priceRed) === null,
      marketFair,
      model,
      user,
      estimate,
      maxPrice: estimate - MIN_EDGE,
    };
    if (price === null || marketFair === null) {
      return {
        ...base,
        edge: null,
        ev: null,
        fullKelly: null,
        value: false,
        conviction: { agreement: 1, data: thin ? DOUBT_FACTOR : 1, market: 0, value: 0 },
        stakeFraction: 0,
        stake: null,
        capped: false,
      };
    }

    const value = clears(estimate, price);
    const sizing = sizeAt({ estimate, model, user, price, marketFair, marketFactor, thin, value, sane });
    return {
      ...base,
      edge: estimate - price,
      ev: estimate / price - 1,
      fullKelly: kellyFraction(estimate, price),
      value,
      ...sizing,
      stake: amount(sizing.stakeFraction),
    };
  };

  const blue = side('blue');
  const red = side('red');
  const sides = { blue, red };

  let decision: Decision;
  if (market === null) decision = { kind: 'no price' };
  else if (market.quality === 'crossed') decision = { kind: 'crossed', total: 1 + market.spread };
  else if (marketFactor === 0) decision = { kind: 'too far', distance: distance! };
  else {
    // With the two prices summing to at least $1, at most one side can clear
    // the margin.
    const value = [blue, red].find((s) => s.stakeFraction > 0);
    if (value && (maxEntry === null || value.price! <= maxEntry + 1e-9)) {
      decision = { kind: 'buy', side: value.side };
    } else {
      // Wait on the side worth owning: the one with value over the ceiling,
      // else the user's pick, else the estimate's favourite.
      const waitSide: Side =
        value?.side ?? input.pick ?? (estimateBlue >= 0.5 ? 'blue' : 'red');
      const s = sides[waitSide];
      const target = floorCents(Math.min(maxEntry ?? 1, s.maxPrice));
      // At the target the market has moved there too: the other side is its complement.
      const atTarget = sizeAt({
        estimate: s.estimate,
        model: s.model,
        user: s.user,
        price: target,
        marketFair: target,
        marketFactor: marketTaper(Math.abs(s.estimate - target)),
        thin,
        value: clears(s.estimate, target),
        sane: true,
      });
      decision = {
        kind: 'wait',
        side: waitSide,
        target,
        reason: maxEntry !== null && s.price! > maxEntry + 1e-9 ? 'limit' : 'edge',
        stakeFraction: atTarget.stakeFraction,
        stake: amount(atTarget.stakeFraction),
      };
    }
  }

  const notes: string[] = [];
  if (decision.kind === 'buy') {
    const s = sides[decision.side];
    if (s.conviction.agreement < 1) {
      notes.push(
        s.model > s.marketFair!
          ? `halved — your pick says ${cents(s.price!)} is too much`
          : `halved — the model says ${cents(s.price!)} is too much (it has ${cents(s.model)})`,
      );
    }
    if (thin) notes.push(`halved — ${input.thinLanes} of 10 picks rest on under ${THIN_RECORD_GAMES} games`);
    if (marketFactor < 1) {
      notes.push(`cut to ${Math.round(marketFactor * 100)}% — ${Math.round(distance! * 100)} pts off the market`);
    }
    if (bankroll === null) notes.push('add a bankroll for the amount');
  }
  if (market?.quality === 'wide') notes.push(`wide spread (${Math.round(market.spread * 100)}¢) — check the price fills`);

  return { market, distance, blue, red, decision, notes };
}

/* ------------------------------------------------------------------ */
/* When to watch                                                       */
/* ------------------------------------------------------------------ */

/**
 * Games of league average a team's spike rate is shrunk toward. A team with 15
 * games at a mark is mostly league; one with 150 is mostly itself.
 */
export const SWING_PRIOR_GAMES = 20;
/** Games at a mark before a team's spike rate there is considered at all. */
export const MIN_SWING_SAMPLE = 10;
/** Deficit games before a team's own comeback rate is used over the league's. */
export const MIN_DIP_SAMPLE = 5;

/** When the other team is likeliest to take a real lead, and what that means for yours. */
export interface SpikeWatch {
  minute: number;
  /** The other team's share of games a real lead up at that mark. */
  rate: number;
  /** Games of theirs that reached the mark. */
  sample: number;
  leagueRate: number;
  /** How often your team still won from a real deficit at that mark. */
  comeback: number | null;
  comebackSample: number;
  /** The comeback rate is the league's, because your team's record there is too thin. */
  comebackIsLeague: boolean;
}

/**
 * The mark at which a team takes a real gold lead most unusually often.
 *
 * Compared with the league rather than read raw: every team is more often
 * ahead at 25 minutes than at 10, simply because leads grow, so the raw peak is
 * nearly always the last mark and says nothing about the team. The rate is
 * shrunk toward the league first, so a 3-of-12 start can't outrank 48-of-150.
 *
 * The comeback rate matters as much as the timing. A price that falls because
 * the other side is 1,500g up is mostly the market being right — league-wide,
 * that lead at 15 minutes wins 81% of the time — so a dip on a real lead is not
 * the discount it looks like.
 */
export function spikeWatch(
  opponent: GoldSwing | undefined,
  ours: GoldSwing | undefined,
  league: GoldSwing,
): SpikeWatch | null {
  if (!opponent) return null;
  let best: { point: GoldSwingPoint; leagueRate: number; lift: number } | null = null;
  for (const point of opponent) {
    const base = league.find((l) => l.minute === point.minute);
    if (!base || base.spikes === 0 || point.sample < MIN_SWING_SAMPLE) continue;
    const leagueRate = base.spikes / base.sample;
    const shrunk = (point.spikes + SWING_PRIOR_GAMES * leagueRate) / (point.sample + SWING_PRIOR_GAMES);
    const lift = shrunk / leagueRate;
    if (!best || lift > best.lift) best = { point, leagueRate, lift };
  }
  if (!best) return null;

  const { minute } = best.point;
  const own = ours?.find((p) => p.minute === minute);
  const base = league.find((l) => l.minute === minute)!;
  const useOwn = own !== undefined && own.dips >= MIN_DIP_SAMPLE;
  const dips = useOwn ? own.dips : base.dips;
  const dipWins = useOwn ? own.dipWins : base.dipWins;
  return {
    minute,
    rate: best.point.spikes / best.point.sample,
    sample: best.point.sample,
    leagueRate: best.leagueRate,
    comeback: dips > 0 ? dipWins / dips : null,
    comebackSample: dips,
    comebackIsLeague: !useOwn,
  };
}
