/**
 * Position sizing: how much of a bankroll a prediction justifies risking.
 *
 * Three questions, answered in the order a disciplined bettor asks them:
 *
 *   1. Is the price sane?      Strip the bookmaker's margin out of the two odds
 *                              and see what the market actually believes.
 *   2. What is it worth?       Turn the model's read — plus the user's own, if
 *                              they give one — into a probability, then into a
 *                              fair price and the worst price still worth taking.
 *   3. How much?               Fractional Kelly on that probability, capped, and
 *                              nothing at all below a minimum edge.
 *
 * The one decision here that matters more than the arithmetic is the first
 * input: **the probability the predictor displays is not the probability this
 * module stakes on.** The report's logistic scale (`PROB_SCALE`, 2.0) is
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
 * Pure: no I/O, no React. Probabilities are always for the blue side unless a
 * name says otherwise.
 */

import { seriesWinProbability } from './engine.ts';
import type { Prediction } from './types.ts';

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

/** Which result the odds are for. */
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
 * Combine the model with the user's own read.
 *
 * Averaged in log-odds, not in percentages: 90% and 50% should meet nearer 75%
 * than a naive 70%, because the distance from 50 to 90 is much larger in
 * evidence terms than it looks on a percentage scale.
 *
 * Equal weight by default. The user's read is the only channel for what the
 * model cannot see — a roster swap the morning of the match, a patch the
 * export has not caught up with, a player known to be ill — so it should be
 * able to move the number substantially. It should not be able to replace it.
 */
export function blend(model: number, read: number | null, readWeight = 0.5): number {
  if (read === null) return model;
  const m = clamp(model, PROB_FLOOR, PROB_CEIL);
  const r = clamp(read, PROB_FLOOR, PROB_CEIL);
  return sigmoid((1 - readWeight) * logit(m) + readWeight * logit(r));
}

/* ------------------------------------------------------------------ */
/* Odds                                                                */
/* ------------------------------------------------------------------ */

/**
 * Read odds as bookmakers write them, returned as decimal odds.
 *
 *   decimal     2.10         -> 2.10
 *   American    +150 / -200  -> 2.50 / 1.50   (a sign is required)
 *   fractional  5/2          -> 3.50
 *
 * A bare number is always decimal. That makes `150` a decimal 150.0 rather than
 * a guess at American +150 — the parsed value is shown back to the user, which
 * is a better answer to ambiguity than a heuristic that is silently wrong.
 */
export function parseOdds(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (!text) return null;

  const fraction = text.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const num = Number(fraction[1]);
    const den = Number(fraction[2]);
    return den > 0 && num > 0 ? 1 + num / den : null;
  }

  if (/^[+-]/.test(text)) {
    const american = Number(text);
    if (!Number.isFinite(american) || Math.abs(american) < 100) return null;
    return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
  }

  const decimal = Number(text);
  return Number.isFinite(decimal) && decimal > 1 ? decimal : null;
}

export type MarketQuality = 'arbitrage' | 'tight' | 'normal' | 'high' | 'very high';

/** What a two-way price says once the bookmaker's cut is taken out. */
export interface MarketRead {
  /** 1 / odds for each side — probability with the margin still in. */
  implied: [blue: number, red: number];
  /** How far the implied probabilities overshoot 100%. The bookmaker's cut. */
  overround: number;
  /** Implied probabilities scaled back to sum to 1 — the market's actual view. */
  fair: [blue: number, red: number];
  quality: MarketQuality;
}

/**
 * Margin bands for a two-way esports market.
 *
 * Sharp books run major-league match winners at 3–5%; recreational books at
 * 6–8%; anything past 10% is a price that needs a large edge just to break
 * even. Below zero the two sides sum to under 100%, which on a single book is
 * almost always a typo and across two books is an arbitrage — both worth
 * stopping for.
 */
export function marketQuality(overround: number): MarketQuality {
  if (overround < 0) return 'arbitrage';
  if (overround <= 0.04) return 'tight';
  if (overround <= 0.07) return 'normal';
  if (overround <= 0.12) return 'high';
  return 'very high';
}

export function readMarket(oddsBlue: number, oddsRed: number): MarketRead {
  const implied: [number, number] = [1 / oddsBlue, 1 / oddsRed];
  const total = implied[0] + implied[1];
  return {
    implied,
    overround: total - 1,
    fair: [implied[0] / total, implied[1] / total],
    quality: marketQuality(total - 1),
  };
}

/* ------------------------------------------------------------------ */
/* Sizing                                                              */
/* ------------------------------------------------------------------ */

/**
 * Full Kelly: the bankroll fraction that maximises long-run growth *if* the
 * probability is exactly right. Negative means the bet has negative value.
 */
export function kellyFraction(p: number, odds: number): number {
  return (p * odds - 1) / (odds - 1);
}

export type RiskProfileId = 'cautious' | 'standard' | 'aggressive';

export interface RiskProfile {
  label: string;
  /** Share of full Kelly actually staked. */
  kelly: number;
  /** Hard ceiling on a single position, as a share of bankroll. */
  cap: number;
  /** Expected value per unit staked below which there is no position. */
  minEdge: number;
  blurb: string;
}

/**
 * Nobody serious stakes full Kelly on an estimated probability.
 *
 * Full Kelly is optimal only when the probability is known. Ours is estimated
 * by a model that is right about 64% of the time, and over-betting a noisy
 * edge costs far more growth than under-betting it — at twice full Kelly the
 * expected growth rate is zero. Fractional Kelly is the standard hedge against
 * that, and the minimum edge keeps model noise from being mistaken for value:
 * a 1% "edge" on a model this size is inside its error bars.
 *
 * There is deliberately no full-Kelly profile. The full figure is shown for
 * reference, not offered as a setting.
 */
export const RISK_PROFILES: Record<RiskProfileId, RiskProfile> = {
  cautious: {
    label: 'Cautious',
    kelly: 0.125,
    cap: 0.01,
    minEdge: 0.05,
    blurb: '⅛ Kelly, 1% cap, needs 5% edge',
  },
  standard: {
    label: 'Standard',
    kelly: 0.25,
    cap: 0.025,
    minEdge: 0.03,
    blurb: '¼ Kelly, 2.5% cap, needs 3% edge',
  },
  aggressive: {
    label: 'Aggressive',
    kelly: 0.5,
    cap: 0.05,
    minEdge: 0.02,
    blurb: '½ Kelly, 5% cap, needs 2% edge',
  },
};

export const DEFAULT_PROFILE: RiskProfileId = 'standard';

/** Everything the calculator knows about one side. */
export interface SideAssessment {
  side: 'blue' | 'red';
  /** Decimal odds offered, when entered. */
  odds: number | null;
  /** 1 / odds, margin included. */
  implied: number | null;
  /** The market's view with the margin removed; needs both prices. */
  marketFair: number | null;
  /** Calibrated model probability. */
  model: number;
  /** The user's read, when they gave one. */
  read: number | null;
  /** What the sizing actually uses: model and read combined, then bounded. */
  estimate: number;
  /** The price at which this side is break-even: 1 / estimate. */
  fairOdds: number;
  /** The worst price still worth taking under the chosen profile. */
  minOdds: number;
  /** Expected profit per unit staked at the offered odds. */
  ev: number | null;
  /** Estimate minus the market's fair probability, in probability units. */
  edgeVsMarket: number | null;
  /** Full Kelly at the offered odds, for reference. */
  fullKelly: number | null;
  /** The share of bankroll to stake; zero when there is no position. */
  stakeFraction: number;
  /** `stakeFraction` of the bankroll, or `null` without a bankroll. */
  stake: number | null;
  /** Whether the profile's cap, rather than Kelly, set the size. */
  capped: boolean;
  verdict: 'value' | 'thin' | 'no value' | 'no odds';
}

export type WarningTone = 'danger' | 'caution' | 'info';

export interface PositionWarning {
  tone: WarningTone;
  text: string;
}

export interface PositionInput {
  bankroll: number | null;
  oddsBlue: number | null;
  oddsRed: number | null;
  /** Calibrated model probability that blue takes the market. */
  modelBlue: number;
  /** The user's own probability that blue takes it, or `null`. */
  readBlue: number | null;
  profile: RiskProfileId;
  /** Lanes across both drafts whose win rate rests on under `THIN_RECORD_GAMES`. */
  thinLanes?: number;
}

/** Why nothing is being sized, when that is the answer. */
export type SizingBlock = 'no market' | 'arbitrage' | 'far from market';

export interface PositionAssessment {
  profile: RiskProfile;
  market: MarketRead | null;
  /** Points between the estimate and the market's no-vig view; `null` without both prices. */
  distance: number | null;
  /** Share of the profile's normal size kept after the distance taper. */
  taper: number;
  /** Set when the inputs, not the match, decide that there is no position. */
  blocked: SizingBlock | null;
  blue: SideAssessment;
  red: SideAssessment;
  /** The side worth taking, or `null` when neither is. */
  pick: SideAssessment | null;
  warnings: PositionWarning[];
}

/** Model and read disagreeing by more than this is worth saying out loud. */
export const READ_DISAGREEMENT = 0.2;

/**
 * How far from the market an estimate may sit before the size is cut, and
 * before nothing is sized at all.
 *
 * A liquid major-league market is the best estimate of the result available —
 * it aggregates every model, every scout and every bettor willing to put money
 * behind a view. A public model's value is in small, systematic deviations
 * from it, never in large ones. So distance from the market is treated as
 * evidence *against* the estimate:
 *
 *   under 15 points   full size for the profile
 *   15 to 25 points   size tapers linearly to zero
 *   over 25 points    nothing is sized — check the inputs
 *
 * Past 25 points the explanation is almost always mundane: the series score
 * was not updated, the price is for the series while the market is set to
 * the game (or the reverse), a price was typed onto the wrong team, or the
 * model is leaning on a handful of 0-for-3 records. Treated like the
 * arbitrage check: a sanity test on the inputs, not a view on the match.
 */
export const MARKET_TAPER_FROM = 0.15;
export const MARKET_STOP_AT = 0.25;

/** A lane's win rate resting on fewer games than this is noise, not a record. */
export const THIN_RECORD_GAMES = 5;
/** Thin lanes, across both drafts, before the model's read deserves a warning. */
export const THIN_MODEL_LANES = 4;

/** The share of the profile's size kept at a given distance from the market. */
export function marketTaper(distance: number): number {
  if (distance <= MARKET_TAPER_FROM) return 1;
  if (distance >= MARKET_STOP_AT) return 0;
  return (MARKET_STOP_AT - distance) / (MARKET_STOP_AT - MARKET_TAPER_FROM);
}

export function assessPosition(input: PositionInput): PositionAssessment {
  const profile = RISK_PROFILES[input.profile];
  const bankroll = input.bankroll !== null && input.bankroll > 0 ? input.bankroll : null;

  const estimateBlue = clamp(blend(input.modelBlue, input.readBlue), PROB_FLOOR, PROB_CEIL);
  const market =
    input.oddsBlue !== null && input.oddsRed !== null
      ? readMarket(input.oddsBlue, input.oddsRed)
      : null;

  // Distance is the same from either side of a two-way market.
  const distance = market ? Math.abs(estimateBlue - market.fair[0]) : null;
  const taper = distance === null ? 0 : marketTaper(distance);
  const blocked: SizingBlock | null =
    market === null
      ? 'no market'
      : market.quality === 'arbitrage'
        ? 'arbitrage'
        : taper === 0
          ? 'far from market'
          : null;

  const side = (which: 'blue' | 'red'): SideAssessment => {
    const isBlue = which === 'blue';
    const odds = isBlue ? input.oddsBlue : input.oddsRed;
    const estimate = isBlue ? estimateBlue : 1 - estimateBlue;
    const model = isBlue ? input.modelBlue : 1 - input.modelBlue;
    const read = input.readBlue === null ? null : isBlue ? input.readBlue : 1 - input.readBlue;
    const marketFair = market ? market.fair[isBlue ? 0 : 1] : null;

    const base = {
      side: which,
      odds,
      implied: odds === null ? null : 1 / odds,
      marketFair,
      model,
      read,
      estimate,
      fairOdds: 1 / estimate,
      minOdds: (1 + profile.minEdge) / estimate,
      edgeVsMarket: marketFair === null ? null : estimate - marketFair,
    };
    if (odds === null) {
      return {
        ...base,
        ev: null,
        fullKelly: null,
        stakeFraction: 0,
        stake: null,
        capped: false,
        verdict: 'no odds',
      };
    }

    const ev = estimate * odds - 1;
    const fullKelly = kellyFraction(estimate, odds);
    const edge = ev >= profile.minEdge && fullKelly > 0;
    // Value on paper is not a position while the inputs are in doubt.
    const takes = edge && blocked === null;
    const sized = takes ? profile.kelly * fullKelly : 0;
    const stakeFraction = Math.min(sized, profile.cap) * (takes ? taper : 0);
    return {
      ...base,
      ev,
      fullKelly,
      stakeFraction,
      stake: bankroll === null ? null : Math.round(stakeFraction * bankroll * 100) / 100,
      capped: takes && sized > profile.cap,
      verdict: edge ? 'value' : ev > 0 ? 'thin' : 'no value',
    };
  };

  const blue = side('blue');
  const red = side('red');
  const candidates = blocked === null ? [blue, red].filter((s) => s.verdict === 'value') : [];
  // Both sides can only show value when the book is under 100% — an
  // arbitrage or a typo. Take the better one, and let the warning do the talking.
  const pick = candidates.sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0))[0] ?? null;

  const warnings: PositionWarning[] = [];
  if (market?.quality === 'arbitrage') {
    warnings.push({
      tone: 'danger',
      text:
        `The two prices imply ${((1 + market.overround) * 100).toFixed(1)}% in total — under 100%. ` +
        'On one book that is almost always a typo; across two it is an arbitrage. Check the odds before anything else.',
    });
  } else if (market && (market.quality === 'high' || market.quality === 'very high')) {
    warnings.push({
      tone: 'caution',
      text:
        `The bookmaker is taking ${(market.overround * 100).toFixed(1)}%. ` +
        'Sharp books price major-league matches at 3–5%; this one needs a much bigger edge to be worth anything.',
    });
  }

  if (input.readBlue !== null && Math.abs(input.readBlue - input.modelBlue) > READ_DISAGREEMENT) {
    warnings.push({
      tone: 'caution',
      text:
        `Your read and the model disagree by ${Math.round(Math.abs(input.readBlue - input.modelBlue) * 100)} points. ` +
        'One of you knows something the other does not — worth being sure which before sizing on the blend.',
    });
  }

  if (blocked === 'far from market' && distance !== null) {
    warnings.push({
      tone: 'danger',
      text:
        `The estimate and the market are ${Math.round(distance * 100)} points apart. That is not an edge — ` +
        'it almost always means the series score, the market (series or game) or a price is entered wrong, ' +
        `or the model is leaning on a few thin records. Nothing is sized past ${Math.round(MARKET_STOP_AT * 100)} points.`,
    });
  } else if (distance !== null && taper < 1) {
    warnings.push({
      tone: 'caution',
      text:
        `The estimate is ${Math.round(distance * 100)} points from the market, so the size is cut to ` +
        `${Math.round(taper * 100)}% of normal. The further from a sharp market, the likelier you are the one who is wrong.`,
    });
  }

  if ((input.thinLanes ?? 0) >= THIN_MODEL_LANES) {
    warnings.push({
      tone: 'caution',
      text:
        `${input.thinLanes} of the 10 lanes rest on fewer than ${THIN_RECORD_GAMES} games each, ` +
        'so the model is reading this draft from very little.',
    });
  }

  if (bankroll === null) {
    warnings.push({ tone: 'info', text: 'Enter a bankroll to turn the stake into an amount.' });
  }

  return { profile, market, distance, taper, blocked, blue, red, pick, warnings };
}
