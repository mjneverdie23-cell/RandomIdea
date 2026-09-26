import { describe, expect, it } from 'vitest';
import {
  BASE_KELLY,
  MAX_GAME_PROB,
  MAX_STAKE,
  MIN_EDGE,
  PROB_CEIL,
  STAKING_SCALE,
  assessPosition,
  blend,
  kellyFraction,
  marketTaper,
  modelProbability,
  parseCents,
  parseSureness,
  readMarket,
  spikeWatch,
  spreadQuality,
  stakingGameProb,
  userProbability,
  type PositionInput,
} from './position.ts';
import { seriesWinProbability } from './engine.ts';
import type { GoldSwing, Prediction } from './types.ts';

/** Only the fields the sizing reads; the rest of a prediction is irrelevant here. */
const prediction = (margin: number, needBlue = 2, needRed = 2) =>
  ({ margin, needBlue, needRed }) as unknown as Prediction;

const input = (over: Partial<PositionInput> = {}): PositionInput => ({
  bankroll: 1000,
  priceBlue: 0.5,
  priceRed: 0.5,
  modelBlue: 0.5,
  userBlue: null,
  ...over,
});

describe('parseCents', () => {
  it('reads cents however they are written', () => {
    expect(parseCents('40')).toBeCloseTo(0.4, 10);
    expect(parseCents('40¢')).toBeCloseTo(0.4, 10);
    expect(parseCents('40c')).toBeCloseTo(0.4, 10);
    expect(parseCents(' 40 c ')).toBeCloseTo(0.4, 10);
    expect(parseCents('62.5')).toBeCloseTo(0.625, 10);
    expect(parseCents('40,5')).toBeCloseTo(0.405, 10);
    expect(parseCents('1')).toBeCloseTo(0.01, 10);
    expect(parseCents('99.9')).toBeCloseTo(0.999, 10);
  });

  it('reads a price under 1, or with a dollar sign, as dollars', () => {
    expect(parseCents('0.40')).toBeCloseTo(0.4, 10);
    expect(parseCents('$0.40')).toBeCloseTo(0.4, 10);
    expect(parseCents('.4')).toBeCloseTo(0.4, 10);
  });

  it('refuses anything that is not a price for a side that can still lose', () => {
    for (const bad of ['', '0', '100', '120', '-5', 'abc', '$1', '40%', '4O']) {
      expect(parseCents(bad)).toBeNull();
    }
  });
});

describe('sureness', () => {
  it('reads 50 to 100 percent', () => {
    expect(parseSureness('90')).toBeCloseTo(0.9, 10);
    expect(parseSureness('90%')).toBeCloseTo(0.9, 10);
    expect(parseSureness('72.5')).toBeCloseTo(0.725, 10);
    expect(parseSureness('50')).toBeCloseTo(0.5, 10);
    expect(parseSureness('100')).toBe(1);
  });

  it('refuses under 50 — that is a pick for the other team', () => {
    for (const bad of ['49', '101', '', 'abc', '-60']) expect(parseSureness(bad)).toBeNull();
  });

  it('turns a pick and a sureness into blue’s probability', () => {
    expect(userProbability('blue', 0.9)).toBeCloseTo(0.9, 10);
    expect(userProbability('red', 0.9)).toBeCloseTo(0.1, 10);
    expect(userProbability(null, 0.9)).toBeNull();
    expect(userProbability('blue', null)).toBeNull();
  });
});

describe('reading the market', () => {
  it('reads two prices that sum to $1 as the market’s view', () => {
    const m = readMarket(0.4, 0.6);
    expect(m.spread).toBeCloseTo(0, 10);
    expect(m.fair[0]).toBeCloseTo(0.4, 10);
    expect(m.quality).toBe('tight');
  });

  it('takes the spread out proportionally', () => {
    const m = readMarket(0.42, 0.61);
    expect(m.spread).toBeCloseTo(0.03, 10);
    expect(m.fair[0]).toBeCloseTo(0.42 / 1.03, 10);
    expect(m.fair[0] + m.fair[1]).toBeCloseTo(1, 10);
    expect(m.quality).toBe('normal');
  });

  it('grades the spread', () => {
    expect(readMarket(0.45, 0.5).quality).toBe('crossed');
    expect(readMarket(0.51, 0.51).quality).toBe('tight');
    expect(spreadQuality(0.05)).toBe('normal');
    expect(readMarket(0.5, 0.58).quality).toBe('wide');
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
  it('returns the model untouched without the user', () => {
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

describe('kelly for a share that pays $1', () => {
  it('is the edge over what is left to win', () => {
    expect(kellyFraction(0.6, 0.5)).toBeCloseTo(0.2, 10);
    expect(kellyFraction(0.7, 0.6)).toBeCloseTo(0.25, 10);
    expect(kellyFraction(0.5, 0.5)).toBeCloseTo(0, 10);
    expect(kellyFraction(0.4, 0.5)).toBeLessThan(0);
  });
});

describe('assessPosition', () => {
  it('waits at a fair price', () => {
    const a = assessPosition(input());
    expect(a.decision).toMatchObject({ kind: 'wait', reason: 'edge', target: 0.47 });
    expect(a.blue.stakeFraction).toBe(0);
    expect(a.red.stakeFraction).toBe(0);
  });

  it('sizes a clear edge, and the cap binds before quarter Kelly does', () => {
    const a = assessPosition(input({ modelBlue: 0.7, priceBlue: 0.6, priceRed: 0.4 }));
    expect(a.decision).toEqual({ kind: 'buy', side: 'blue' });
    expect(a.blue.edge).toBeCloseTo(0.1, 10);
    expect(a.blue.fullKelly).toBeCloseTo(0.25, 10);
    // Quarter Kelly would be 6.25%; one position never takes more than 5%.
    expect(a.blue.stakeFraction).toBeCloseTo(MAX_STAKE, 10);
    expect(a.blue.stake).toBe(50);
    expect(a.blue.capped).toBe(true);
    expect(a.notes).toEqual([]);
  });

  it('stakes quarter Kelly under the cap', () => {
    const a = assessPosition(input({ modelBlue: 0.58, priceBlue: 0.52, priceRed: 0.48 }));
    // Edge 6¢ on a 52¢ share: full Kelly 12.5%, a quarter of it 3.125%.
    expect(a.blue.stakeFraction).toBeCloseTo(BASE_KELLY * 0.125, 10);
    expect(a.blue.stake).toBe(31.25);
    expect(a.blue.capped).toBe(false);
  });

  it('refuses an edge thinner than the safety margin', () => {
    const a = assessPosition(input({ modelBlue: 0.54, priceBlue: 0.52, priceRed: 0.48 }));
    expect(a.decision).toMatchObject({ kind: 'wait', side: 'blue', reason: 'edge', target: 0.51 });
    expect(a.blue.value).toBe(false);
    expect(a.blue.maxPrice).toBeCloseTo(0.54 - MIN_EDGE, 10);
  });

  it('takes a price sitting exactly on the limit', () => {
    const a = assessPosition(input({ modelBlue: 0.55, priceBlue: 0.52, priceRed: 0.48 }));
    expect(a.blue.value).toBe(true);
    expect(a.blue.stakeFraction).toBeCloseTo(BASE_KELLY * (0.03 / 0.48), 10);
  });

  it('fills in the other side from one price', () => {
    const one = assessPosition(input({ modelBlue: 0.7, priceBlue: 0.6, priceRed: null }));
    expect(one.red.price).toBeCloseTo(0.4, 10);
    expect(one.red.assumed).toBe(true);
    expect(one.blue.assumed).toBe(false);
    expect(one.decision).toEqual({ kind: 'buy', side: 'blue' });

    const other = assessPosition(input({ modelBlue: 0.7, priceBlue: null, priceRed: 0.4 }));
    expect(other.blue.price).toBeCloseTo(0.6, 10);
    expect(other.blue.assumed).toBe(true);
  });

  it('gives the fair price and the limit before any price is in', () => {
    const a = assessPosition(input({ modelBlue: 0.7, priceBlue: null, priceRed: null }));
    expect(a.decision.kind).toBe('no price');
    expect(a.blue.estimate).toBeCloseTo(0.7, 10);
    expect(a.blue.maxPrice).toBeCloseTo(0.67, 10);
    expect(a.red.maxPrice).toBeCloseTo(0.27, 10);
    expect(a.blue.stakeFraction).toBe(0);
  });

  it('buys an underdog priced under its chance', () => {
    const a = assessPosition(input({ modelBlue: 0.45, priceBlue: 0.35, priceRed: 0.67 }));
    expect(a.decision).toEqual({ kind: 'buy', side: 'blue' });
    expect(a.blue.stakeFraction).toBeCloseTo(BASE_KELLY * (0.1 / 0.65), 10);
    expect(a.blue.stake).toBe(38.46);
  });

  it('is symmetric in the sides', () => {
    const a = assessPosition(input({ modelBlue: 0.7, priceBlue: 0.6, priceRed: 0.4 }));
    const b = assessPosition(input({ modelBlue: 0.3, priceBlue: 0.4, priceRed: 0.6 }));
    expect(b.decision).toEqual({ kind: 'buy', side: 'red' });
    expect(b.red.stakeFraction).toBeCloseTo(a.blue.stakeFraction, 10);
  });

  it('bounds the estimate however sure the user is', () => {
    const a = assessPosition(input({ modelBlue: 0.85, userBlue: 1 }));
    expect(a.blue.estimate).toBeLessThanOrEqual(PROB_CEIL);
  });
});

describe('how sure the user is', () => {
  const base = { modelBlue: 0.56, priceBlue: 0.52, priceRed: 0.48 };

  it('moves the estimate and with it the size', () => {
    const alone = assessPosition(input(base));
    const fairlySure = assessPosition(input({ ...base, userBlue: 0.6 }));
    const verySure = assessPosition(input({ ...base, userBlue: 0.7 }));

    expect(fairlySure.blue.estimate).toBeCloseTo(blend(0.56, 0.6), 10);
    expect(alone.blue.stakeFraction).toBeLessThan(fairlySure.blue.stakeFraction);
    expect(fairlySure.blue.stakeFraction).toBeLessThan(verySure.blue.stakeFraction);
    expect(verySure.blue.stakeFraction).toBeCloseTo(MAX_STAKE, 10);
    expect(verySure.blue.conviction.agreement).toBe(1);
  });

  it('halves the size when only the user sees value', () => {
    // Model has blue 58% at 52¢; the user is 70% sure red wins. The blend puts
    // red's value at 57¢ against a 48¢ price — but the model alone says red is
    // not worth 48¢.
    const a = assessPosition(input({ modelBlue: 0.58, priceBlue: 0.52, priceRed: 0.48, userBlue: 0.3 }));
    expect(a.decision).toEqual({ kind: 'buy', side: 'red' });
    expect(a.red.conviction.agreement).toBe(0.5);
    const full = BASE_KELLY * kellyFraction(a.red.estimate, 0.48);
    expect(a.red.stakeFraction).toBeCloseTo(0.5 * Math.min(full, MAX_STAKE), 10);
    expect(a.notes[0]).toMatch(/the model says 48¢ is too much/);
  });

  it('halves the size when only the model sees value', () => {
    // Model says blue at 62% against 52¢; the user is only 51% sure — under the price.
    const a = assessPosition(input({ modelBlue: 0.62, priceBlue: 0.52, priceRed: 0.48, userBlue: 0.51 }));
    expect(a.decision).toEqual({ kind: 'buy', side: 'blue' });
    expect(a.blue.conviction.agreement).toBe(0.5);
    expect(a.notes[0]).toMatch(/your pick says 52¢ is too much/);
  });
});

describe('conviction', () => {
  it('halves the size on a draft with thin records', () => {
    const a = assessPosition(input({ modelBlue: 0.7, priceBlue: 0.6, priceRed: 0.4, thinLanes: 6 }));
    expect(a.blue.conviction.data).toBe(0.5);
    expect(a.blue.stakeFraction).toBeCloseTo(MAX_STAKE / 2, 10);
    expect(a.notes.join(' ')).toMatch(/6 of 10 picks/);
  });

  it('tapers from 15 points off the market to nothing at 25', () => {
    expect(marketTaper(0.1)).toBe(1);
    expect(marketTaper(0.15)).toBe(1);
    expect(marketTaper(0.2)).toBeCloseTo(0.5, 10);
    expect(marketTaper(0.25)).toBe(0);
    expect(marketTaper(0.4)).toBe(0);

    const a = assessPosition(input({ modelBlue: 0.72, priceBlue: 0.52, priceRed: 0.48 }));
    expect(a.distance).toBeCloseTo(0.2, 10);
    expect(a.blue.stakeFraction).toBeCloseTo(MAX_STAKE * 0.5, 10);
    expect(a.notes.join(' ')).toMatch(/cut to 50%/);
  });

  it('refuses to size a gap that is an input error, not an edge', () => {
    // The real case that exposed this: the model 4% on T1 for the series,
    // the market 60¢. The model is not 55 points smarter than the market.
    const a = assessPosition(input({ modelBlue: 0.043, priceBlue: 0.6, priceRed: 0.4 }));
    expect(a.decision.kind).toBe('too far');
    expect(a.red.value).toBe(true);
    expect(a.red.stakeFraction).toBe(0);
    expect(a.blue.stakeFraction).toBe(0);
  });

  it('checks the prices before anything else', () => {
    const a = assessPosition(input({ modelBlue: 0.9, priceBlue: 0.45, priceRed: 0.5 }));
    expect(a.decision).toEqual({ kind: 'crossed', total: expect.closeTo(0.95, 10) });
    expect(a.blue.stakeFraction).toBe(0);
  });

  it('says so when there is no bankroll or the spread is wide', () => {
    const a = assessPosition(input({ modelBlue: 0.7, priceBlue: 0.6, priceRed: 0.4, bankroll: null }));
    expect(a.blue.stake).toBeNull();
    expect(a.notes).toContain('add a bankroll for the amount');

    const wide = assessPosition(input({ priceBlue: 0.5, priceRed: 0.58 }));
    expect(wide.notes.join(' ')).toMatch(/wide spread \(8¢\)/);
  });
});

describe('your maximum entry', () => {
  // The model has blue at 82% for the game; the market 73¢.
  const favourite = { modelBlue: 0.82, priceBlue: 0.73, priceRed: 0.27 };

  it('waits for the ceiling when the value is priced over it', () => {
    const now = assessPosition(input(favourite));
    expect(now.decision).toEqual({ kind: 'buy', side: 'blue' });

    const a = assessPosition(input({ ...favourite, maxEntry: 0.6 }));
    expect(a.decision).toMatchObject({ kind: 'wait', side: 'blue', target: 0.6, reason: 'limit' });
  });

  it('says what it will stake at the target, and means it', () => {
    const a = assessPosition(input({ ...favourite, maxEntry: 0.6 }));
    if (a.decision.kind !== 'wait') throw new Error('expected a wait');
    // 22 points off a 60¢ market tapers the size to 30%; quarter Kelly is over the cap.
    expect(a.decision.stakeFraction).toBeCloseTo(MAX_STAKE * 0.3, 10);
    expect(a.decision.stake).toBe(15);

    // Enter 60¢ when it gets there: the same number comes back as a buy.
    const there = assessPosition(input({ ...favourite, priceBlue: 0.6, priceRed: null, maxEntry: 0.6 }));
    expect(there.decision).toEqual({ kind: 'buy', side: 'blue' });
    expect(there.blue.stakeFraction).toBeCloseTo(a.decision.stakeFraction, 10);
  });

  it('buys at or under the ceiling', () => {
    const a = assessPosition(input({ modelBlue: 0.7, priceBlue: 0.6, priceRed: 0.4, maxEntry: 0.6 }));
    expect(a.decision).toEqual({ kind: 'buy', side: 'blue' });
  });

  it('aims under the ceiling when the edge needs a lower price', () => {
    const a = assessPosition(input({ modelBlue: 0.55, priceBlue: 0.56, priceRed: 0.44, maxEntry: 0.6 }));
    expect(a.decision).toMatchObject({ kind: 'wait', side: 'blue', target: 0.52, reason: 'edge' });
  });

  it('waits on the team you picked', () => {
    const a = assessPosition(input({ modelBlue: 0.52, userBlue: 0.45, pick: 'red', maxEntry: 0.6 }));
    expect(a.decision).toMatchObject({ kind: 'wait', side: 'red' });
  });

  it('sizes nothing at a target only a changed game could reach', () => {
    // 91% on the blend, 60¢ ceiling: the market would have to move 30 points.
    const a = assessPosition(input({ modelBlue: 0.85, userBlue: 0.95, priceBlue: 0.8, priceRed: 0.2, maxEntry: 0.6 }));
    expect(a.decision).toMatchObject({ kind: 'wait', target: 0.6, stakeFraction: 0 });
  });
});

describe('spikeWatch', () => {
  const point = (minute: 10 | 15 | 20 | 25, sample: number, spikes: number, dips = 0, dipWins = 0) => ({
    minute,
    sample,
    spikes,
    spikeWins: Math.round(spikes * 0.8),
    dips,
    dipWins,
  });
  // Leads grow with time, so the league is ahead more often at every later mark.
  const league: GoldSwing = [
    point(10, 1000, 120, 120, 22),
    point(15, 1000, 270, 270, 50),
    point(20, 1000, 360, 360, 58),
    point(25, 1000, 410, 410, 49),
  ];

  it('picks the mark the team is unusually strong at, not the raw peak', () => {
    const early: GoldSwing = [point(10, 100, 25), point(15, 100, 30), point(20, 100, 40), point(25, 100, 45)];
    const w = spikeWatch(early, undefined, league)!;
    expect(w.minute).toBe(10);
    expect(w.rate).toBeCloseTo(0.25, 10);
    expect(w.leagueRate).toBeCloseTo(0.12, 10);

    const mid: GoldSwing = [point(10, 100, 10), point(15, 100, 38), point(20, 100, 40), point(25, 100, 45)];
    expect(spikeWatch(mid, undefined, league)!.minute).toBe(15);
  });

  it('ignores a mark with too few games', () => {
    const thin: GoldSwing = [point(10, 8, 6), point(15, 100, 30)];
    expect(spikeWatch(thin, undefined, league)!.minute).toBe(15);
  });

  it('uses your team’s own comeback record when it has one, else the league’s', () => {
    const them: GoldSwing = [point(15, 100, 38)];
    const ours: GoldSwing = [point(15, 100, 20, 10, 3)];
    const own = spikeWatch(them, ours, league)!;
    expect(own.comeback).toBeCloseTo(0.3, 10);
    expect(own.comebackIsLeague).toBe(false);

    const thinOurs: GoldSwing = [point(15, 100, 20, 3, 2)];
    const fallback = spikeWatch(them, thinOurs, league)!;
    expect(fallback.comeback).toBeCloseTo(50 / 270, 10);
    expect(fallback.comebackIsLeague).toBe(true);
  });

  it('says nothing without a record for the other team', () => {
    expect(spikeWatch(undefined, undefined, league)).toBeNull();
  });
});
