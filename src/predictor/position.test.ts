import { describe, expect, it } from 'vitest';
import {
  MARKET_STOP_AT,
  MAX_GAME_PROB,
  PROB_CEIL,
  RISK_PROFILES,
  STAKING_SCALE,
  assessPosition,
  blend,
  kellyFraction,
  marketQuality,
  marketTaper,
  modelProbability,
  parseOdds,
  readMarket,
  stakingGameProb,
  type PositionInput,
} from './position.ts';
import { seriesWinProbability } from './engine.ts';
import type { Prediction } from './types.ts';

/** Only the fields the sizing reads; the rest of a prediction is irrelevant here. */
const prediction = (margin: number, needBlue = 2, needRed = 2) =>
  ({ margin, needBlue, needRed }) as unknown as Prediction;

const input = (over: Partial<PositionInput> = {}): PositionInput => ({
  bankroll: 1000,
  oddsBlue: 2.0,
  oddsRed: 2.0,
  modelBlue: 0.5,
  readBlue: null,
  profile: 'standard',
  ...over,
});

describe('parseOdds', () => {
  it('reads decimal odds', () => {
    expect(parseOdds('2.10')).toBeCloseTo(2.1, 10);
    expect(parseOdds(' 1.85 ')).toBeCloseTo(1.85, 10);
    expect(parseOdds('1,95')).toBeCloseTo(1.95, 10); // European decimal comma
  });

  it('reads American odds, which need a sign', () => {
    expect(parseOdds('+150')).toBeCloseTo(2.5, 10);
    expect(parseOdds('-200')).toBeCloseTo(1.5, 10);
    expect(parseOdds('+100')).toBeCloseTo(2.0, 10);
    expect(parseOdds('-100')).toBeCloseTo(2.0, 10);
  });

  it('reads fractional odds', () => {
    expect(parseOdds('5/2')).toBeCloseTo(3.5, 10);
    expect(parseOdds('1/4')).toBeCloseTo(1.25, 10);
  });

  it('treats a bare number as decimal rather than guessing', () => {
    expect(parseOdds('150')).toBe(150);
  });

  it('refuses prices that pay nothing or are malformed', () => {
    for (const bad of ['', '1', '1.0', '0.8', 'abc', '+99', '-50', '0/2', '3/0']) {
      expect(parseOdds(bad)).toBeNull();
    }
  });
});

describe('reading the market', () => {
  it('strips an even margin out of a symmetric price', () => {
    const m = readMarket(1.9, 1.9);
    expect(m.implied[0]).toBeCloseTo(1 / 1.9, 10);
    expect(m.overround).toBeCloseTo(2 / 1.9 - 1, 10);
    expect(m.fair[0]).toBeCloseTo(0.5, 10);
    expect(m.fair[1]).toBeCloseTo(0.5, 10);
    expect(m.quality).toBe('normal');
  });

  it('keeps the market view proportional when the margin is removed', () => {
    const m = readMarket(1.5, 2.6);
    expect(m.fair[0] + m.fair[1]).toBeCloseTo(1, 10);
    expect(m.fair[0] / m.fair[1]).toBeCloseTo(m.implied[0] / m.implied[1], 10);
  });

  it('grades the margin', () => {
    expect(marketQuality(-0.01)).toBe('arbitrage');
    expect(marketQuality(0.03)).toBe('tight');
    expect(marketQuality(0.06)).toBe('normal');
    expect(marketQuality(0.1)).toBe('high');
    expect(marketQuality(0.15)).toBe('very high');
  });
});

describe('the staking probability', () => {
  it('is even at a level margin and symmetric', () => {
    expect(stakingGameProb(0)).toBeCloseTo(0.5, 10);
    expect(stakingGameProb(2) + stakingGameProb(-2)).toBeCloseTo(1, 10);
  });

  it('is less confident than the report for the same margin', () => {
    // The report uses a scale of 2.0; this is the whole point of the module.
    const report = 1 / (1 + Math.exp(-3 / 2));
    expect(stakingGameProb(3)).toBeLessThan(report);
    expect(stakingGameProb(3)).toBeCloseTo(1 / (1 + Math.exp(-3 / STAKING_SCALE)), 10);
  });

  it('never claims more than the ceiling for one game', () => {
    expect(stakingGameProb(50)).toBe(MAX_GAME_PROB);
    expect(stakingGameProb(-50)).toBeCloseTo(1 - MAX_GAME_PROB, 10);
  });

  it('carries a series price through the best-of arithmetic', () => {
    const game = stakingGameProb(2);
    expect(modelProbability(prediction(2, 2, 2), 'series')).toBeCloseTo(
      seriesWinProbability(game, 2, 2),
      10,
    );
    expect(modelProbability(prediction(2, 2, 2), 'game')).toBeCloseTo(game, 10);
    // A best-of-one is its game.
    expect(modelProbability(prediction(2, 1, 1), 'series')).toBeCloseTo(game, 10);
  });

  it('has nothing to say about a series already decided', () => {
    expect(modelProbability(prediction(2, 0, 2), 'series')).toBeNull();
    expect(modelProbability(prediction(2, 2, 0), 'series')).toBeNull();
  });
});

describe('blend', () => {
  it('returns the model untouched without a read', () => {
    expect(blend(0.62, null)).toBe(0.62);
  });

  it('averages in log-odds, not percentages', () => {
    // logit(0.8) = ln 4; halfway to 0 is ln 2, which is 2/3.
    expect(blend(0.8, 0.5)).toBeCloseTo(2 / 3, 10);
    expect(blend(0.8, 0.5)).not.toBeCloseTo(0.65, 3);
  });

  it('agrees with itself', () => {
    expect(blend(0.7, 0.7)).toBeCloseTo(0.7, 10);
  });
});

describe('kelly', () => {
  it('matches the textbook fraction', () => {
    expect(kellyFraction(0.55, 2)).toBeCloseTo(0.1, 10);
    expect(kellyFraction(0.5, 2)).toBeCloseTo(0, 10);
    expect(kellyFraction(0.4, 2)).toBeLessThan(0);
  });
});

describe('assessPosition', () => {
  it('passes on a fair price', () => {
    const a = assessPosition(input());
    expect(a.pick).toBeNull();
    expect(a.blue.verdict).toBe('no value');
    expect(a.blue.stakeFraction).toBe(0);
    expect(a.blue.stake).toBe(0);
  });

  it('sizes a clear edge at a quarter Kelly', () => {
    // 60% at evens: EV +20%, full Kelly 20%, a quarter is 5% — above the cap.
    const a = assessPosition(input({ modelBlue: 0.6, oddsRed: 1.8 }));
    expect(a.pick?.side).toBe('blue');
    expect(a.blue.ev).toBeCloseTo(0.2, 10);
    expect(a.blue.fullKelly).toBeCloseTo(0.2, 10);
    expect(a.blue.stakeFraction).toBeCloseTo(RISK_PROFILES.standard.cap, 10);
    expect(a.blue.capped).toBe(true);
    expect(a.blue.stake).toBe(25);
  });

  it('uses Kelly rather than the cap when Kelly is smaller', () => {
    // 54% at 2.0: EV 8%, full Kelly 8%, a quarter is 2% — under the 2.5% cap.
    const a = assessPosition(input({ modelBlue: 0.54, oddsRed: 1.8 }));
    expect(a.blue.stakeFraction).toBeCloseTo(0.02, 10);
    expect(a.blue.capped).toBe(false);
    expect(a.blue.stake).toBe(20);
  });

  it('refuses an edge too thin to beat model error', () => {
    // 51% at evens is +2% EV — positive, but under standard's 3% bar.
    const a = assessPosition(input({ modelBlue: 0.51, oddsRed: 1.9 }));
    expect(a.blue.ev).toBeCloseTo(0.02, 10);
    expect(a.blue.verdict).toBe('thin');
    expect(a.pick).toBeNull();
    // ...which the aggressive profile, needing only 2%, will take.
    const b = assessPosition(input({ modelBlue: 0.51, oddsRed: 1.9, profile: 'aggressive' }));
    expect(b.pick?.side).toBe('blue');
  });

  it('prices the fair and minimum odds from the estimate', () => {
    const a = assessPosition(input({ modelBlue: 0.6 }));
    expect(a.blue.fairOdds).toBeCloseTo(1 / 0.6, 10);
    expect(a.blue.minOdds).toBeCloseTo(1.03 / 0.6, 10);
    // At exactly the minimum odds the edge is exactly the requirement.
    const at = assessPosition(input({ modelBlue: 0.6, oddsBlue: 1.03 / 0.6, oddsRed: 2.2 }));
    expect(at.market?.quality).not.toBe('arbitrage');
    expect(at.blue.ev).toBeCloseTo(RISK_PROFILES.standard.minEdge, 10);
  });

  it('can recommend the underdog', () => {
    // Model says 45% on red, market offers 2.6 (38%): real value on the dog.
    const a = assessPosition(input({ modelBlue: 0.55, oddsBlue: 1.5, oddsRed: 2.6 }));
    expect(a.pick?.side).toBe('red');
    expect(a.red.ev).toBeCloseTo(0.45 * 2.6 - 1, 10);
  });

  it('is symmetric under swapping the sides', () => {
    const a = assessPosition(input({ modelBlue: 0.6, oddsBlue: 1.9, oddsRed: 2.1, readBlue: 0.65 }));
    const b = assessPosition(input({ modelBlue: 0.4, oddsBlue: 2.1, oddsRed: 1.9, readBlue: 0.35 }));
    expect(a.blue.estimate).toBeCloseTo(b.red.estimate, 10);
    expect(a.blue.stakeFraction).toBeCloseTo(b.red.stakeFraction, 10);
    expect(a.pick?.side).toBe('blue');
    expect(b.pick?.side).toBe('red');
  });

  it('lets the read move the estimate', () => {
    const model = assessPosition(input({ modelBlue: 0.55, oddsRed: 1.8 }));
    const withRead = assessPosition(input({ modelBlue: 0.55, readBlue: 0.7, oddsRed: 1.8 }));
    expect(withRead.blue.estimate).toBeGreaterThan(model.blue.estimate);
    expect(withRead.blue.read).toBe(0.7);
    expect(withRead.red.read).toBeCloseTo(0.3, 10);
  });

  it('bounds the estimate however confident the inputs are', () => {
    const a = assessPosition(input({ modelBlue: 0.99, readBlue: 0.99 }));
    expect(a.blue.estimate).toBeLessThanOrEqual(PROB_CEIL);
  });

  it('stakes exactly the profile cap when Kelly would go further', () => {
    // 58% at 2.2 with the market 14 points away: inside the band, and a full
    // Kelly of 23% that every profile's fraction pushes past its cap.
    for (const profile of ['cautious', 'standard', 'aggressive'] as const) {
      const a = assessPosition(input({ modelBlue: 0.58, oddsBlue: 2.2, oddsRed: 1.7, profile }));
      expect(a.taper).toBe(1);
      expect(a.blue.capped).toBe(true);
      expect(a.blue.stakeFraction).toBeCloseTo(RISK_PROFILES[profile].cap, 10);
    }
  });

  it('prices one side but sizes nothing until both are in', () => {
    // A market can't be validated from one side: no margin, no sanity check.
    const a = assessPosition(input({ modelBlue: 0.6, oddsRed: null }));
    expect(a.market).toBeNull();
    expect(a.blocked).toBe('no market');
    expect(a.blue.ev).toBeCloseTo(0.2, 10); // still shown
    expect(a.blue.stakeFraction).toBe(0);
    expect(a.red.verdict).toBe('no odds');
    expect(a.pick).toBeNull();
  });

  it('gives a fraction but no amount without a bankroll', () => {
    const a = assessPosition(input({ modelBlue: 0.6, oddsRed: 1.8, bankroll: null }));
    expect(a.blue.stakeFraction).toBeGreaterThan(0);
    expect(a.blue.stake).toBeNull();
    expect(a.warnings.some((w) => w.tone === 'info')).toBe(true);
  });
});

describe('warnings', () => {
  const texts = (a: ReturnType<typeof assessPosition>) => a.warnings.map((w) => w.text).join(' ');

  it('stops on a book under 100%', () => {
    const a = assessPosition(input({ oddsBlue: 2.2, oddsRed: 2.2 }));
    expect(a.market?.quality).toBe('arbitrage');
    expect(a.warnings[0]?.tone).toBe('danger');
  });

  it('flags a heavy margin', () => {
    const a = assessPosition(input({ oddsBlue: 1.7, oddsRed: 1.7 }));
    expect(texts(a)).toMatch(/bookmaker is taking/);
  });

  it('flags a read that fights the model', () => {
    const a = assessPosition(input({ modelBlue: 0.4, readBlue: 0.75 }));
    expect(texts(a)).toMatch(/disagree by 35 points/);
  });

  it('flags a model reading the draft from very little', () => {
    const a = assessPosition(input({ thinLanes: 6 }));
    expect(texts(a)).toMatch(/6 of the 10 lanes rest on fewer than 5 games/);
  });
});

describe('distance from the market', () => {
  it('keeps full size near the market and tapers to nothing', () => {
    expect(marketTaper(0.05)).toBe(1);
    expect(marketTaper(0.15)).toBe(1);
    expect(marketTaper(0.2)).toBeCloseTo(0.5, 10);
    expect(marketTaper(0.25)).toBe(0);
    expect(marketTaper(0.4)).toBe(0);
  });

  it('cuts the size inside the band, and says so', () => {
    // 64% against a no-vig 44%: 20 points out, half size.
    const a = assessPosition(input({ modelBlue: 0.64, oddsBlue: 2.2, oddsRed: 1.7 }));
    expect(a.distance).toBeCloseTo(0.2, 1);
    expect(a.taper).toBeGreaterThan(0);
    expect(a.taper).toBeLessThan(1);
    expect(a.pick?.side).toBe('blue');
    const full = Math.min(0.25 * a.blue.fullKelly!, RISK_PROFILES.standard.cap);
    expect(a.blue.stakeFraction).toBeCloseTo(full * a.taper, 10);
    expect(a.warnings.map((w) => w.text).join(' ')).toMatch(/cut to \d+% of normal/);
  });

  it('refuses to size an estimate that far from a sharp market', () => {
    // The case that surfaced this rule, from a real LCK draft: the model had
    // T1 at 4% for the series, the price had them at 60%. A +123% "edge" at
    // the full cap was on offer. It is an input problem, not a bet.
    const a = assessPosition(input({ modelBlue: 0.043, oddsBlue: 1.6, oddsRed: 2.35 }));
    expect(a.distance!).toBeGreaterThan(MARKET_STOP_AT);
    expect(a.blocked).toBe('far from market');
    expect(a.pick).toBeNull();
    expect(a.blue.stakeFraction).toBe(0);
    expect(a.red.stakeFraction).toBe(0);
    // The value is still shown, so the user can see why it was refused.
    expect(a.red.verdict).toBe('value');
    expect(a.warnings[0]?.tone).toBe('danger');
    expect(a.warnings[0]?.text).toMatch(/points apart/);
  });

  it('checks the arbitrage before the distance', () => {
    const a = assessPosition(input({ modelBlue: 0.9, oddsBlue: 2.2, oddsRed: 2.2 }));
    expect(a.blocked).toBe('arbitrage');
  });
});
