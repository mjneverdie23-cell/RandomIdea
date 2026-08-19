import { describe, expect, it } from 'vitest';
import {
  FIRST_PICK_SIDE,
  FORM_CAP,
  GAME_ONE_POCKET_SCALE,
  META_POINT,
  MOTIVATION_POINTS,
  POCKET_MANY_PENALTY,
  POCKET_POINT,
  anywhereKey,
  behaviorTendencies,
  championWinRate,
  predict,
  splitSubject,
  UNPLAYED_WIN_RATE,
  seriesWinProbability,
} from './engine.ts';
import { emptyPredictorModel } from './derive.ts';
import { makeChampion } from '../domain/champions.ts';
import { ROLES, type Champion, type Role } from '../domain/types.ts';
import type { GoldTempo, PredictionInput, PredictorModel, TeamBehavior, WinLoss } from './types.ts';

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

/** The starter a fixture team fields in a role. */
const starter = (team: string, role: Role): string => `${team} ${role}`;

/**
 * Records are keyed by player, so a fixture needs a roster to be readable at
 * all: without one the engine has nobody to look up. Each named team fields a
 * starter per role and carries the same record on every champion in its draft.
 */
function withHistory(
  ...entries: [team: string, draft: Champion[], wins: number, games: number][]
): Partial<PredictorModel> {
  const playerSplitRecord = new Map<string, WinLoss>();
  const rosters = new Map<string, Partial<Record<Role, string>>>();

  for (const [team, draft, wins, games] of entries) {
    const roster: Partial<Record<Role, string>> = {};
    ROLES.forEach((role, index) => {
      const player = starter(team, role);
      roster[role] = player;
      playerSplitRecord.set(anywhereKey(player, role, draft[index]!.id), { wins, games });
    });
    rosters.set(team.toLowerCase(), roster);
  }
  return { playerSplitRecord, rosters };
}

/** A team with a game count but every read too thin to report. */
const BLANK_BEHAVIOR: TeamBehavior = {
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

/** The same matchup at game two, where the pocket term is not discounted. */
const laterGame = () => input({ gameNumber: 2 });

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
  const TOP = DRAFT_A[0]!;
  /** A team whose top laner is a named player, so records have an owner. */
  const rosterOnly = (team: string, player: string): Map<string, Partial<Record<Role, string>>> =>
    new Map([[team.toLowerCase(), { top: player }]]);

  it('scores from what the starter has done this split', () => {
    const m = model(withHistory(['Blue Team', DRAFT_A, 3, 4]));
    const read = championWinRate(m, 'Blue Team', 'top', TOP);
    expect(read.winRate).toBe(0.75);
    expect(read.scope).toBe('split');
    expect(read.player).toBe(starter('Blue Team', 'top'));
    expect(read.note).toContain('3W/4');
  });

  it('falls back to the career record when the split has no games yet', () => {
    const m = model({
      rosters: rosterOnly('Blue Team', 'Faker'),
      playerCareerRecord: new Map([[anywhereKey('Faker', 'top', TOP.id), { wins: 8, games: 10 }]]),
    });
    const read = championWinRate(m, 'Blue Team', 'top', TOP);
    expect(read.winRate).toBe(0.8);
    expect(read.scope).toBe('career');
    expect(read.note).toContain('first time this split');
  });

  it('reports both records, whichever one it scored from', () => {
    // 50% on it last split, untouched this one: the report needs both numbers.
    const m = model({
      rosters: rosterOnly('Blue Team', 'Faker'),
      playerCareerRecord: new Map([[anywhereKey('Faker', 'top', TOP.id), { wins: 5, games: 10 }]]),
    });
    const read = championWinRate(m, 'Blue Team', 'top', TOP);
    expect(read.careerRecord).toEqual({ wins: 5, games: 10 });
    expect(read.splitRecord).toBeNull();

    const both = model({
      rosters: rosterOnly('Blue Team', 'Faker'),
      playerSplitRecord: new Map([[anywhereKey('Faker', 'top', TOP.id), { wins: 2, games: 2 }]]),
      playerCareerRecord: new Map([[anywhereKey('Faker', 'top', TOP.id), { wins: 7, games: 12 }]]),
    });
    const read2 = championWinRate(both, 'Blue Team', 'top', TOP);
    expect(read2.winRate).toBe(1);
    expect(read2.splitRecord).toEqual({ wins: 2, games: 2 });
    expect(read2.careerRecord).toEqual({ wins: 7, games: 12 });
  });

  it('does not let a single split game overwrite a career', () => {
    // One loss this split is 0%, which would wipe out an 8-12 career record.
    const m = model({
      rosters: rosterOnly('Blue Team', 'Faker'),
      playerSplitRecord: new Map([[anywhereKey('Faker', 'top', TOP.id), { wins: 0, games: 1 }]]),
      playerCareerRecord: new Map([[anywhereKey('Faker', 'top', TOP.id), { wins: 8, games: 12 }]]),
    });
    const read = championWinRate(m, 'Blue Team', 'top', TOP);
    expect(read.scope).toBe('career');
    expect(read.winRate).toBeCloseTo(8 / 12, 10);
    expect(read.note).toContain('only 1 this split');
    // Still reported, so the reader sees why the career number was used.
    expect(read.splitRecord).toEqual({ wins: 0, games: 1 });

    // A second game clears the bar and the split takes over.
    m.playerSplitRecord.set(anywhereKey('Faker', 'top', TOP.id), { wins: 0, games: 2 });
    expect(championWinRate(m, 'Blue Team', 'top', TOP).scope).toBe('split');
  });

  it('names the split the player is actually in', () => {
    const m = model({
      rosters: rosterOnly('BLG', 'Bin'),
      currentSplitOf: new Map([[splitSubject('player', 'Bin'), '2026|Split 3']]),
      playerSplitRecord: new Map([[anywhereKey('Bin', 'top', TOP.id), { wins: 3, games: 4 }]]),
    });
    const read = championWinRate(m, 'BLG', 'top', TOP);
    expect(read.splitLabel).toBe('Split 3');
    expect(read.note).toContain('in Split 3');
  });

  it('ignores the departed player after a roster change', () => {
    // Zeus went 0-4 on this champion; Doran, who now starts, is 3-4. The old
    // number must not follow the jersey.
    const records = new Map([
      [anywhereKey('Zeus', 'top', TOP.id), { wins: 0, games: 4 }],
      [anywhereKey('Doran', 'top', TOP.id), { wins: 3, games: 4 }],
    ]);
    const m = model({ rosters: rosterOnly('T1', 'Doran'), playerSplitRecord: records });
    const read = championWinRate(m, 'T1', 'top', TOP);
    expect(read.winRate).toBe(0.75);
    expect(read.player).toBe('Doran');
  });

  it('credits a full win rate to a champion with no recorded games', () => {
    // A pro pulling out an unplayed champion has prepared it; nobody
    // first-times one on stage.
    const read = championWinRate(model(), 'Blue Team', 'top', TOP);
    expect(read.winRate).toBe(UNPLAYED_WIN_RATE);
    expect(read.winRate).toBe(1);
    expect(read.scope).toBe('none');
    expect(read.note).toContain('first-time pick');
  });

  it('uses the team record only when the roster is unknown', () => {
    const teamRecord = new Map([[anywhereKey('Blue Team', 'top', TOP.id), { wins: 1, games: 4 }]]);
    const read = championWinRate(model({ teamCareerRecord: teamRecord }), 'Blue Team', 'top', TOP);
    expect(read.winRate).toBe(0.25);
    expect(read.scope).toBe('team');
    expect(read.player).toBeNull();

    // With a starter identified, their own blank record wins over the team's.
    const named = model({ rosters: rosterOnly('Blue Team', 'Doran'), teamCareerRecord: teamRecord });
    expect(championWinRate(named, 'Blue Team', 'top', TOP).scope).toBe('none');
  });
});

describe('predict — point tally', () => {
  it('is a coin flip when neither side has any history', () => {
    // Ten first-time picks: both bases max out, and the two cancel.
    const result = predict(model(), input());
    expect(result.blue.winRateBase).toBe(5);
    expect(result.red.winRateBase).toBe(5);
    expect(result.margin).toBe(0);
    expect(result.favourite).toBeNull();
    expect(result.gameProbBlue).toBeCloseTo(0.5, 10);
  });

  it('ranks a played champion below an unplayed one when the record is poor', () => {
    // Red's picks are all first-time (1.00 each); blue's are known and bad.
    const result = predict(
      model(withHistory(['Blue Team', DRAFT_A, 1, 10])),
      input(),
    );
    expect(result.blue.winRateBase).toBeCloseTo(0.5, 10);
    expect(result.red.winRateBase).toBe(5);
    expect(result.favourite).toBe('red');
  });

  it('favours the team with the stronger champion history', () => {
    const result = predict(
      model(withHistory(['Blue Team', DRAFT_A, 9, 10], ['Red Team', DRAFT_B, 3, 10])),
      input(),
    );
    expect(result.blue.winRateBase).toBeCloseTo(4.5, 10);
    expect(result.red.winRateBase).toBeCloseTo(1.5, 10);
    expect(result.favourite).toBe('blue');
    expect(result.gameProbBlue).toBeGreaterThan(0.5);
  });

  it('caps the win-rate base at one point per lane', () => {
    const result = predict(
      model(withHistory(['Blue Team', DRAFT_A, 10, 10])),
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
    expect(predict(model({ metaByRole: metaFor(4) }), laterGame()).blue.pocketBonus).toBe(
      POCKET_POINT,
    );
    expect(predict(model({ metaByRole: metaFor(3) }), laterGame()).blue.pocketBonus).toBe(
      2 * POCKET_POINT,
    );
    // Three off-meta picks tips over into chaos.
    expect(predict(model({ metaByRole: metaFor(2) }), laterGame()).blue.pocketBonus).toBe(
      POCKET_MANY_PENALTY,
    );
  });

  it('halves the whole pocket term in game one', () => {
    const one = (metaCount: number) =>
      predict(model({ metaByRole: metaFor(metaCount) }), input({ gameNumber: 1 })).blue
        .pocketBonus;
    const later = (metaCount: number) =>
      predict(model({ metaByRole: metaFor(metaCount) }), laterGame()).blue.pocketBonus;

    expect(one(4)).toBe(POCKET_POINT * GAME_ONE_POCKET_SCALE);
    expect(one(3)).toBe(2 * POCKET_POINT * GAME_ONE_POCKET_SCALE);
    // The chaos penalty is discounted too — the read is less informative in
    // game one, not less punishing.
    expect(one(2)).toBe(POCKET_MANY_PENALTY * GAME_ONE_POCKET_SCALE);

    for (const metaCount of [2, 3, 4]) {
      expect(one(metaCount)).toBeCloseTo(later(metaCount) * GAME_ONE_POCKET_SCALE, 10);
    }
  });

  it('leaves every other line item alone in game one', () => {
    const one = predict(model({ metaByRole: metaFor(4) }), input({ gameNumber: 1 })).blue;
    const later = predict(model({ metaByRole: metaFor(4) }), laterGame()).blue;
    expect(one.winRateBase).toBe(later.winRateBase);
    expect(one.metaBonus).toBe(later.metaBonus);
    expect(one.formEdge).toBe(later.formEdge);
    expect(one.motivationBonus).toBe(later.motivationBonus);
  });

  it('prices a pocket pick above a meta pick', () => {
    // An off-meta champion forfeits its meta bonus, so at parity the two
    // cancelled and a pocket pick was worth exactly nothing in the total.
    expect(POCKET_POINT).toBeGreaterThan(META_POINT);

    const allMeta = predict(model({ metaByRole: metaFor(5) }), laterGame()).blue;
    const onePocket = predict(model({ metaByRole: metaFor(4) }), laterGame()).blue;
    expect(allMeta.metaBonus + allMeta.pocketBonus).toBe(5);
    expect(onePocket.metaBonus + onePocket.pocketBonus).toBeCloseTo(4 + POCKET_POINT, 10);
    expect(onePocket.total).toBeGreaterThan(allMeta.total);
  });

  it('turns a game-one pocket pick into a small net cost', () => {
    // A consequence of halving, worth pinning because it flips the sign: an
    // off-meta pick still forfeits its full meta point, but only earns half a
    // pocket bonus. At 1.5 * 0.5 = 0.75 against META_POINT of 1.0 that is a
    // net -0.25 in game one, where the same pick is +0.5 from game two on.
    const allMeta = predict(model({ metaByRole: metaFor(5) }), input({ gameNumber: 1 })).blue;
    const onePocket = predict(model({ metaByRole: metaFor(4) }), input({ gameNumber: 1 })).blue;
    expect(onePocket.total - allMeta.total).toBeCloseTo(
      POCKET_POINT * GAME_ONE_POCKET_SCALE - META_POINT,
      10,
    );
    expect(onePocket.total).toBeLessThan(allMeta.total);

    // From game two it is an edge again.
    const laterAllMeta = predict(model({ metaByRole: metaFor(5) }), laterGame()).blue;
    const laterPocket = predict(model({ metaByRole: metaFor(4) }), laterGame()).blue;
    expect(laterPocket.total).toBeGreaterThan(laterAllMeta.total);
  });

  it('makes a second pocket pick worth more than the first, then falls off a cliff', () => {
    const draftValue = (metaCount: number): number => {
      const score = predict(model({ metaByRole: metaFor(metaCount) }), laterGame()).blue;
      return score.metaBonus + score.pocketBonus;
    };
    expect(draftValue(3)).toBeGreaterThan(draftValue(4));
    expect(draftValue(4)).toBeGreaterThan(draftValue(5));
    // A third off-meta pick is chaos, not a plan.
    expect(draftValue(2)).toBeLessThan(draftValue(5));
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
    // Blue drafts five meta picks they win on; red drafts three off-meta and
    // has a poor record. Tanking is not enough to flip that.
    const metaByRole = new Map<Role, Set<string>>();
    ROLES.forEach((role, index) => metaByRole.set(role, new Set([DRAFT_A[index]!.id])));
    const result = predict(
      model({
        metaByRole,
        ...withHistory(['Blue Team', DRAFT_A, 10, 10], ['Red Team', DRAFT_B, 2, 10]),
      }),
      input({ blue: { ...input().blue, motivation: 'tank incentive' } }),
    );
    expect(result.favourite).toBe('blue');
  });

  it('sums every line item into the total', () => {
    const metaByRole = new Map<Role, Set<string>>();
    ROLES.forEach((role, index) => metaByRole.set(role, new Set([DRAFT_A[index]!.id])));
    const result = predict(
      model({ ...withHistory(['Blue Team', DRAFT_A, 8, 10]), metaByRole }),
      input(),
    );
    const { blue } = result;
    expect(blue.total).toBeCloseTo(
      blue.winRateBase +
        blue.metaBonus +
        blue.pocketBonus +
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
    const m = model(withHistory(['Blue Team', DRAFT_A, 9, 10]));
    const level = predict(m, input({ seriesLength: 'BO5' }));
    const ahead = predict(m, input({ seriesLength: 'BO5', scoreBlue: 2, scoreRed: 0 }));
    expect(ahead.needBlue).toBe(1);
    expect(ahead.seriesProbBlue).toBeGreaterThan(level.seriesProbBlue);
  });

  it('keeps the two sides complementary', () => {
    const result = predict(
      model(withHistory(['Blue Team', DRAFT_A, 7, 10])),
      input({ seriesLength: 'BO5', scoreBlue: 1, scoreRed: 1 }),
    );
    expect(result.gameProbBlue + result.gameProbRed).toBeCloseTo(1, 10);
    expect(result.seriesProbBlue + result.seriesProbRed).toBeCloseTo(1, 10);
  });
});

describe('predict — notices', () => {
  it('credits first pick to the configured side and last pick to the other', () => {
    const notice = predict(model(), input()).notices.find((n) => n.kind === 'first-pick');
    expect(notice?.side).toBe(FIRST_PICK_SIDE);

    const [first, last] =
      FIRST_PICK_SIDE === 'red' ? ['Red Team', 'Blue Team'] : ['Blue Team', 'Red Team'];
    expect(notice?.text).toContain(`First pick belongs to ${first}`);
    expect(notice?.text).toContain(`${last} have last pick`);
    // Never both roles to the same team.
    expect(notice?.text).not.toContain(`${first} have last pick`);
  });

  it('quotes the first-pick team win rate on the side it is drafting from', () => {
    const behavior = new Map([
      [
        'red team',
        { ...BLANK_BEHAVIOR, blueWinRate: 0.9, redWinRate: 0.42 },
      ],
      [
        'blue team',
        { ...BLANK_BEHAVIOR, blueWinRate: 0.71, redWinRate: 0.11 },
      ],
    ]);
    const notice = predict(model({ behavior }), input()).notices.find(
      (n) => n.kind === 'first-pick',
    );
    // Whichever side has first pick, the quoted rate is that team on that side.
    expect(notice?.text).toContain(FIRST_PICK_SIDE === 'red' ? '42% on red' : '71% on blue');
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
    const pocket = predict(model({ metaByRole: metaFor(4) }), laterGame()).notices.find(
      (n) => n.kind === 'draft' && n.side === 'blue',
    );
    expect(pocket?.text).toContain('+1.5');

    // Game one says so rather than quietly reporting a different number.
    const halved = predict(model({ metaByRole: metaFor(4) }), input({ gameNumber: 1 })).notices.find(
      (n) => n.kind === 'draft' && n.side === 'blue',
    );
    expect(halved?.text).toContain('+0.75');
    expect(halved?.text).toContain('halved in game one');

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
  const base = BLANK_BEHAVIOR;

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
    // Two first-time picks at 1.00 each; the three empty lanes contribute nothing.
    expect(result.blue.winRateBase).toBeCloseTo(2, 10);
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

describe('predict — early-game gold tempo', () => {
  const tempo = (
    team: string,
    averageDiff: number,
    aheadRate: number,
    sample = 40,
    minute: 10 | 15 | 20 | 25 = 10,
  ): [string, GoldTempo] => [team, [{ minute, sample, averageDiff, aheadRate }]];

  const goldNotices = (model: PredictorModel) =>
    predict(model, input()).notices.filter((n) => n.kind === 'gold');

  it('says nothing when no team has gold data', () => {
    expect(goldNotices(model())).toHaveLength(0);
  });

  it('calls out a team that habitually leads early', () => {
    const goldTempo = new Map([tempo('blue team', 480, 0.66)]);
    const text = goldNotices(model({ goldTempo }))[0]!.text;
    expect(text).toContain('Blue Team');
    expect(text).toContain('+480g');
    expect(text).toContain('at 10 min');
    expect(text).toContain('ahead in 66%');
    expect(text).toContain('tend to lead early');
  });

  it('calls out a team that habitually falls behind, and flags it', () => {
    const goldTempo = new Map([tempo('red team', -390, 0.34)]);
    const notice = goldNotices(model({ goldTempo }))[0]!;
    expect(notice.text).toContain('−390g');
    expect(notice.text).toContain('tend to fall behind early');
    expect(notice.warning).toBe(true);
    expect(notice.side).toBe('red');
  });

  it('does not mistake a few blowouts for a habit', () => {
    // A big average that comes from rarely being ahead is variance, not tempo.
    const goldTempo = new Map([tempo('blue team', 600, 0.45)]);
    const text = goldNotices(model({ goldTempo }))[0]!.text;
    expect(text).toContain('swingy starts');
    expect(text).not.toContain('tend to lead early');
  });

  it('describes a genuinely even team as even', () => {
    const goldTempo = new Map([tempo('blue team', 40, 0.51)]);
    expect(goldNotices(model({ goldTempo }))[0]!.text).toContain('even out of the gate');
  });

  it('adds a head-to-head line when the two teams differ meaningfully', () => {
    const goldTempo = new Map([tempo('blue team', 421, 0.62), tempo('red team', -379, 0.37)]);
    const notices = goldNotices(model({ goldTempo }));
    const head = notices.find((n) => n.text.startsWith('Early game'));
    expect(head?.text).toContain('Blue Team +421g');
    expect(head?.text).toContain('Red Team −379g');
    expect(head?.text).toContain('Blue Team open 800g stronger');
  });

  it('skips the head-to-head line when the two open alike', () => {
    const goldTempo = new Map([tempo('blue team', 120, 0.52), tempo('red team', 40, 0.5)]);
    expect(goldNotices(model({ goldTempo })).some((n) => n.text.startsWith('Early game'))).toBe(
      false,
    );
  });

  it('prefers the 10-minute mark when several are available', () => {
    const goldTempo = new Map<string, GoldTempo>([
      [
        'blue team',
        [
          { minute: 10, sample: 30, averageDiff: 111, aheadRate: 0.55 },
          { minute: 15, sample: 30, averageDiff: 999, aheadRate: 0.8 },
        ],
      ],
    ]);
    expect(goldNotices(model({ goldTempo }))[0]!.text).toContain('at 10 min');
  });

  it('falls back to a later mark when 10 minutes is missing', () => {
    const goldTempo = new Map<string, GoldTempo>([
      ['blue team', [{ minute: 15, sample: 30, averageDiff: 500, aheadRate: 0.7 }]],
    ]);
    expect(goldNotices(model({ goldTempo }))[0]!.text).toContain('at 15 min');
  });

  it('never moves the score', () => {
    const goldTempo = new Map([tempo('blue team', 900, 0.8), tempo('red team', -900, 0.2)]);
    const withGold = predict(model({ goldTempo }), input());
    const without = predict(model(), input());
    expect(withGold.blue.total).toBe(without.blue.total);
    expect(withGold.red.total).toBe(without.red.total);
    expect(withGold.gameProbBlue).toBe(without.gameProbBlue);
  });
});

describe('predict — first-time picks', () => {
  it('rewards the side that pulled out an unplayed champion', () => {
    // Both sides have a solid record on four lanes; blue's mid is brand new.
    const known = withHistory(['Blue Team', DRAFT_A, 6, 10], ['Red Team', DRAFT_B, 6, 10]);
    known.playerSplitRecord!.delete(
      anywhereKey(starter('Blue Team', 'mid'), 'mid', DRAFT_A[2]!.id),
    );

    const result = predict(model(known), input());
    const surprise = result.blue.picks.find((pick) => pick.role === 'mid')!;
    expect(surprise.scope).toBe('none');
    expect(surprise.winRate).toBe(1);
    expect(result.blue.winRateBase).toBeCloseTo(0.6 * 4 + 1, 10);
    expect(result.red.winRateBase).toBeCloseTo(0.6 * 5, 10);
    expect(result.favourite).toBe('blue');
  });

  it('labels the lane so the report can explain the 100%', () => {
    const pick = predict(model(), input()).blue.picks[0]!;
    expect(pick.note).toContain('first-time pick');
  });
});
