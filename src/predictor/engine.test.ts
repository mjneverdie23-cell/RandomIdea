import { describe, expect, it } from 'vitest';
import {
  FORM_CAP,
  META_POINT,
  MOTIVATION_POINTS,
  POCKET_MANY_PENALTY,
  POCKET_POINT,
  RANK_BONUS,
  anywhereKey,
  behaviorTendencies,
  championWinRate,
  predict,
  recordKey,
  seriesWinProbability,
} from './engine.ts';
import { emptyPredictorModel } from './derive.ts';
import { makeChampion } from '../domain/champions.ts';
import { ROLES, type Champion, type Role } from '../domain/types.ts';
import type { PredictionInput, PredictorModel, TeamBehavior } from './types.ts';

const champ = (name: string): Champion => makeChampion(name)!;

/** Five distinct champions in role order. */
const DRAFT_A = ['Aatrox', 'Viego', 'Azir', 'Jinx', 'Thresh'].map(champ);
const DRAFT_B = ['Gnar', 'Sejuani', 'Orianna', 'Ezreal', 'Nautilus'].map(champ);

function model(overrides: Partial<PredictorModel> = {}): PredictorModel {
  return { ...emptyPredictorModel(), ...overrides };
}

function input(overrides: Partial<PredictionInput> = {}): PredictionInput {
  return {
    blue: { competition: 'LCK', team: 'Blue Team', champions: DRAFT_A, motivation: 'normal' },
    red: { competition: 'LCK', team: 'Red Team', champions: DRAFT_B, motivation: 'normal' },
    stage: 'regular',
    seriesLength: 'BO3',
    gameNumber: 1,
    scoreBlue: 0,
    scoreRed: 0,
    previousWinner: null,
    winRequirement: 'series',
    ...overrides,
  };
}

/** Give one team a perfect record on every champion in its draft. */
function withRecords(
  team: string,
  competition: string,
  draft: Champion[],
  wins: number,
  games: number,
): Map<string, { wins: number; games: number }> {
  const map = new Map<string, { wins: number; games: number }>();
  ROLES.forEach((role, index) => {
    map.set(recordKey(competition, team, role, draft[index]!.id), { wins, games });
  });
  return map;
}

/** Mark the first `count` of blue's picks as meta, leaving the rest off-meta. */
function metaFor(count: number): Map<Role, Set<string>> {
  const map = new Map<Role, Set<string>>();
  ROLES.forEach((role, index) => {
    map.set(role, index < count ? new Set([DRAFT_A[index]!.id]) : new Set());
  });
  return map;
}

describe('seriesWinProbability', () => {
  it('is the game probability when one win is needed and the opponent needs one', () => {
    expect(seriesWinProbability(0.6, 1, 1)).toBeCloseTo(0.6, 10);
  });

  it('returns certainty when the series is already clinched', () => {
    expect(seriesWinProbability(0.4, 0, 2)).toBe(1);
    expect(seriesWinProbability(0.4, 2, 0)).toBe(0);
  });

  it('complements between the two sides of a best-of-three', () => {
    const blue = seriesWinProbability(0.62, 2, 2);
    const red = seriesWinProbability(0.38, 2, 2);
    expect(blue + red).toBeCloseTo(1, 10);
  });

  it('rewards a lead: 1-0 up beats level in the same best-of-five', () => {
    const level = seriesWinProbability(0.55, 3, 3);
    const ahead = seriesWinProbability(0.55, 2, 3);
    expect(ahead).toBeGreaterThan(level);
  });

  it('matches a hand-computed best-of-three from level', () => {
    // p^2 + 2*p^2*(1-p) for a race to two.
    const p = 0.6;
    expect(seriesWinProbability(p, 2, 2)).toBeCloseTo(p ** 2 + 2 * p ** 2 * (1 - p), 10);
  });
});

describe('championWinRate', () => {
  it('uses the selected competition when the team has played there', () => {
    const m = model({ championRecord: withRecords('Blue Team', 'LCK', DRAFT_A, 3, 4) });
    const read = championWinRate(m, 'LCK', 'Blue Team', DRAFT_A[0]!, 'top');
    expect(read.winRate).toBe(0.75);
    expect(read.scope).toBe('competition');
    expect(read.note).toContain('3W/4');
  });

  it('falls back to the full history rather than reporting a bare 50%', () => {
    const anywhere = new Map([
      [anywhereKey('Blue Team', 'top', DRAFT_A[0]!.id), { wins: 8, games: 10 }],
    ]);
    const m = model({ championRecordAnywhere: anywhere });
    const read = championWinRate(m, 'WORLDS', 'Blue Team', DRAFT_A[0]!, 'top');
    expect(read.winRate).toBe(0.8);
    expect(read.scope).toBe('anywhere');
    expect(read.note).toContain('all competitions');
  });

  it('reports neutral when the champion has never been played in that role', () => {
    const read = championWinRate(model(), 'LCK', 'Blue Team', DRAFT_A[0]!, 'top');
    expect(read.winRate).toBe(0.5);
    expect(read.scope).toBe('none');
  });
});

describe('predict — point tally', () => {
  it('is a coin flip when neither side has any history', () => {
    const result = predict(model(), input());
    expect(result.blue.winRateBase).toBe(2.5);
    expect(result.red.winRateBase).toBe(2.5);
    expect(result.margin).toBe(0);
    expect(result.favourite).toBeNull();
    expect(result.gameProbBlue).toBeCloseTo(0.5, 10);
  });

  it('favours the team with the stronger champion history', () => {
    const result = predict(
      model({ championRecord: withRecords('Blue Team', 'LCK', DRAFT_A, 9, 10) }),
      input(),
    );
    expect(result.blue.winRateBase).toBeCloseTo(4.5, 10);
    expect(result.favourite).toBe('blue');
    expect(result.gameProbBlue).toBeGreaterThan(0.5);
  });

  it('caps the win-rate base at one point per lane', () => {
    const result = predict(
      model({ championRecord: withRecords('Blue Team', 'LCK', DRAFT_A, 10, 10) }),
      input(),
    );
    expect(result.blue.winRateBase).toBe(5);
  });

  it('awards a point per meta champion', () => {
    const metaByRole = new Map<Role, Set<string>>();
    ROLES.forEach((role, index) => metaByRole.set(role, new Set([DRAFT_A[index]!.id])));
    const result = predict(model({ metaByRole }), input());
    expect(result.blue.metaCount).toBe(5);
    expect(result.blue.metaBonus).toBe(5 * META_POINT);
    expect(result.blue.offMetaCount).toBe(0);
    expect(result.blue.pocketBonus).toBe(0);
    expect(result.red.metaBonus).toBe(0);
  });

  it('rewards one or two pocket picks and punishes more than two', () => {
    // Four meta picks leaves one off-meta pick: a pocket pick.
    expect(predict(model({ metaByRole: metaFor(4) }), input()).blue.pocketBonus).toBe(POCKET_POINT);
    expect(predict(model({ metaByRole: metaFor(3) }), input()).blue.pocketBonus).toBe(
      2 * POCKET_POINT,
    );
    // Three off-meta picks tips over into chaos.
    expect(predict(model({ metaByRole: metaFor(2) }), input()).blue.pocketBonus).toBe(
      POCKET_MANY_PENALTY,
    );
  });

  it('prices a pocket pick above a meta pick', () => {
    // An off-meta champion forfeits its meta bonus, so at parity the two
    // cancelled and a pocket pick was worth exactly nothing in the total.
    expect(POCKET_POINT).toBeGreaterThan(META_POINT);

    const allMeta = predict(model({ metaByRole: metaFor(5) }), input()).blue;
    const onePocket = predict(model({ metaByRole: metaFor(4) }), input()).blue;
    expect(allMeta.metaBonus + allMeta.pocketBonus).toBe(5);
    expect(onePocket.metaBonus + onePocket.pocketBonus).toBeCloseTo(4 + POCKET_POINT, 10);
    expect(onePocket.total).toBeGreaterThan(allMeta.total);
  });

  it('makes a second pocket pick worth more than the first, then falls off a cliff', () => {
    const draftValue = (metaCount: number): number => {
      const score = predict(model({ metaByRole: metaFor(metaCount) }), input()).blue;
      return score.metaBonus + score.pocketBonus;
    };
    expect(draftValue(3)).toBeGreaterThan(draftValue(4));
    expect(draftValue(4)).toBeGreaterThan(draftValue(5));
    // A third off-meta pick is chaos, not a plan.
    expect(draftValue(2)).toBeLessThan(draftValue(5));
  });

  it('gives the rank edge only when the gap clears the threshold', () => {
    const ratings = new Map([
      ['blue team', { team: 'Blue Team', globalRank: 1, fraud: 0 }],
      ['red team', { team: 'Red Team', globalRank: 2, fraud: 0 }],
    ]);
    const close = predict(model({ ratings }), input());
    expect(close.blue.rankBonus).toBe(0);
    expect(close.rankNote).toContain('no bonus');

    ratings.set('red team', { team: 'Red Team', globalRank: 6, fraud: 0 });
    const wide = predict(model({ ratings }), input());
    expect(wide.blue.rankBonus).toBe(RANK_BONUS);
    expect(wide.red.rankBonus).toBe(0);
  });

  it('subtracts the fraud rating from the team that carries it', () => {
    const ratings = new Map([['red team', { team: 'Red Team', globalRank: null, fraud: 1.5 }]]);
    const result = predict(model({ ratings }), input());
    expect(result.red.fraudPenalty).toBe(1.5);
    // Both sides sit at the neutral base and, with no meta table loaded, both
    // take the chaotic-draft penalty; only the fraud rating separates them.
    expect(result.red.total).toBeCloseTo(result.blue.total - 1.5, 10);
    expect(result.favourite).toBe('blue');
  });

  it('caps the form edge and ignores records below the trust threshold', () => {
    const row = (team: string, won: number, lost: number) => ({
      team,
      rank: 1,
      seriesWon: won,
      seriesLost: lost,
      seriesPct: won / (won + lost),
      gamesWon: won * 2,
      gamesLost: lost * 2,
      gamePct: won / (won + lost),
      streak: '',
    });

    // Two series each is below MIN_FORM_SERIES, so no edge is awarded.
    const thin = new Map([
      ['LCK' as const, new Map([['blue team', row('Blue Team', 2, 0)], ['red team', row('Red Team', 0, 2)]])],
    ]);
    expect(predict(model({ standingsByCompetition: thin }), input()).blue.formEdge).toBe(0);

    // A perfect record against a winless one is a 100% gap: capped at FORM_CAP.
    const wide = new Map([
      ['LCK' as const, new Map([['blue team', row('Blue Team', 6, 0)], ['red team', row('Red Team', 0, 6)]])],
    ]);
    const result = predict(model({ standingsByCompetition: wide }), input());
    expect(result.blue.formEdge).toBe(FORM_CAP);
    expect(result.red.formEdge).toBe(0);
  });

  it('scores the stated motivation', () => {
    const level = predict(model(), input());
    expect(level.blue.motivationBonus).toBe(0);
    expect(level.margin).toBe(0);

    const mustWin = predict(
      model(),
      input({ blue: { ...input().blue, motivation: 'must win' } }),
    );
    expect(mustWin.blue.motivationBonus).toBe(MOTIVATION_POINTS['must win']);
    expect(mustWin.margin).toBeCloseTo(0.5, 10);
    expect(mustWin.favourite).toBe('blue');

    const tanking = predict(
      model(),
      input({ blue: { ...input().blue, motivation: 'tank incentive' } }),
    );
    expect(tanking.blue.motivationBonus).toBe(-1);
    expect(tanking.favourite).toBe('red');
  });

  it('lets motivation decide an otherwise level matchup', () => {
    const result = predict(
      model(),
      input({
        blue: { ...input().blue, motivation: 'must win' },
        red: { ...input().red, motivation: 'nothing to play for' },
      }),
    );
    // +0.5 against -0.5 is a full point of swing.
    expect(result.margin).toBeCloseTo(1, 10);
    expect(result.gameProbBlue).toBeGreaterThan(0.6);
  });

  it('never lets motivation outweigh the draft itself', () => {
    // A team with a perfect record on every pick, but tanking, still leads a
    // team with no history at all.
    const result = predict(
      model({ championRecord: withRecords('Blue Team', 'LCK', DRAFT_A, 10, 10) }),
      input({ blue: { ...input().blue, motivation: 'tank incentive' } }),
    );
    expect(result.favourite).toBe('blue');
  });

  it('sums every line item into the total', () => {
    const metaByRole = new Map<Role, Set<string>>();
    ROLES.forEach((role, index) => metaByRole.set(role, new Set([DRAFT_A[index]!.id])));
    const result = predict(
      model({ championRecord: withRecords('Blue Team', 'LCK', DRAFT_A, 8, 10), metaByRole }),
      input(),
    );
    const { blue } = result;
    expect(blue.total).toBeCloseTo(
      blue.winRateBase +
        blue.metaBonus +
        blue.pocketBonus +
        blue.rankBonus +
        blue.formEdge +
        blue.motivationBonus -
        blue.fraudPenalty,
      10,
    );
  });
});

describe('predict — series probabilities', () => {
  it('treats a best-of-one series as the single game', () => {
    const result = predict(model(), input({ seriesLength: 'BO1' }));
    expect(result.seriesProbBlue).toBeCloseTo(result.gameProbBlue, 10);
    expect(result.seriesTarget).toBe(1);
  });

  it('accounts for games already won', () => {
    const m = model({ championRecord: withRecords('Blue Team', 'LCK', DRAFT_A, 9, 10) });
    const level = predict(m, input({ seriesLength: 'BO5' }));
    const ahead = predict(m, input({ seriesLength: 'BO5', scoreBlue: 2, scoreRed: 0 }));
    expect(ahead.needBlue).toBe(1);
    expect(ahead.seriesProbBlue).toBeGreaterThan(level.seriesProbBlue);
  });

  it('keeps the two sides complementary', () => {
    const result = predict(
      model({ championRecord: withRecords('Blue Team', 'LCK', DRAFT_A, 7, 10) }),
      input({ seriesLength: 'BO5', scoreBlue: 1, scoreRed: 1 }),
    );
    expect(result.gameProbBlue + result.gameProbRed).toBeCloseTo(1, 10);
    expect(result.seriesProbBlue + result.seriesProbRed).toBeCloseTo(1, 10);
  });
});

describe('predict — notices', () => {
  it('credits first pick to blue side, which drafts first', () => {
    const notice = predict(model(), input()).notices.find((n) => n.kind === 'first-pick');
    expect(notice?.side).toBe('blue');
    expect(notice?.text).toContain('First pick belongs to Blue Team');
    expect(notice?.text).toContain('last pick on red');
  });

  it('flags a decider when both teams are one win away', () => {
    const notices = predict(model(), input({ seriesLength: 'BO3', scoreBlue: 1, scoreRed: 1 })).notices;
    const series = notices.find((n) => n.kind === 'series');
    expect(series?.text).toContain('Series decider');
    expect(series?.warning).toBe(true);
  });

  it('flags match point for the side that holds it', () => {
    const notices = predict(model(), input({ seriesLength: 'BO5', scoreBlue: 2, scoreRed: 0 })).notices;
    expect(notices.find((n) => n.kind === 'series')?.text).toContain('Blue Team on match point');
  });

  it('surfaces a tank incentive as a warning, with its cost', () => {
    const notices = predict(
      model(),
      input({ red: { ...input().red, motivation: 'tank incentive' } }),
    ).notices;
    const motivation = notices.find((n) => n.kind === 'motivation');
    expect(motivation?.warning).toBe(true);
    expect(motivation?.side).toBe('red');
    expect(motivation?.text).toContain('−1');
  });

  it('reports fractional point values without rounding them away', () => {
    // A +1.5 pocket bonus used to print as "+2" and a 0.25 fraud rating as "-0".
    const pocket = predict(model({ metaByRole: metaFor(4) }), input()).notices.find(
      (n) => n.kind === 'draft' && n.side === 'blue',
    );
    expect(pocket?.text).toContain('+1.5');

    const ratings = new Map([['red team', { team: 'Red Team', globalRank: null, fraud: 0.25 }]]);
    const fraud = predict(model({ ratings }), input()).notices.find(
      (n) => n.kind === 'reliability',
    );
    expect(fraud?.text).toContain('−0.25');
  });

  it('says nothing about motivation for a normal game', () => {
    expect(predict(model(), input()).notices.filter((n) => n.kind === 'motivation')).toHaveLength(0);
  });
});

describe('behaviorTendencies', () => {
  const base: TeamBehavior = {
    games: 30,
    winRate: 0.5,
    recentForm: null,
    blueWinRate: null,
    redWinRate: null,
    throwRate: null,
    throwSample: 0,
    comebackRate: null,
    comebackSample: 0,
    bouncebackRate: null,
    deciderRate: null,
    matchPointCloseRate: null,
    chokeRate: null,
    chokeSample: 0,
    game1Rate: null,
  };

  it('says so plainly when there is no team at all', () => {
    expect(behaviorTendencies(undefined)[0]).toContain('No games');
  });

  it('falls back to a single honest line when every read is thin', () => {
    expect(behaviorTendencies(base)).toEqual(['Not enough games yet for a clear behavioural read.']);
  });

  it('calls out strong recent form', () => {
    expect(behaviorTendencies({ ...base, recentForm: 0.75 })[0]).toContain('strong recent form');
  });

  it('reports a side preference only when the gap is wide', () => {
    const narrow = behaviorTendencies({ ...base, blueWinRate: 0.55, redWinRate: 0.5 });
    expect(narrow.join(' ')).not.toContain('stronger on');
    const wide = behaviorTendencies({ ...base, blueWinRate: 0.7, redWinRate: 0.45 });
    expect(wide.join(' ')).toContain('stronger on blue side');
  });

  it('ignores throw and comeback rates built on too few games', () => {
    const thin = behaviorTendencies({ ...base, throwRate: 0.5, throwSample: 2 });
    expect(thin.join(' ')).not.toContain('throwing leads');
    const solid = behaviorTendencies({ ...base, throwRate: 0.5, throwSample: 6 });
    expect(solid.join(' ')).toContain('Prone to throwing leads');
  });
});

describe('predict — partial drafts', () => {
  it('scores only the lanes that are filled in', () => {
    const half: (Champion | null)[] = [DRAFT_A[0]!, DRAFT_A[1]!, null, null, null];
    const result = predict(model(), input({ blue: { ...input().blue, champions: half } }));
    expect(result.blue.picks).toHaveLength(2);
    expect(result.blue.winRateBase).toBeCloseTo(1, 10);
    expect(result.red.picks).toHaveLength(5);
  });

  it('does not report a draft notice for an empty board', () => {
    const empty: (Champion | null)[] = [null, null, null, null, null];
    const result = predict(
      model(),
      input({
        blue: { ...input().blue, champions: empty },
        red: { ...input().red, champions: empty },
      }),
    );
    expect(result.notices.filter((n) => n.kind === 'draft')).toHaveLength(0);
  });
});
