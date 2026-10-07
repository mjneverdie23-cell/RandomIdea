import { describe, expect, it } from 'vitest';
import { makeChampion } from '../domain/champions.ts';
import { ROLES, type Game, type Role, type Side, type TeamGold } from '../domain/types.ts';
import { archetypeProfileKey } from './championArchetypes.ts';
import { currentTeamSeason, teamOptions, teamSeasons, teamStats } from './teamStats.ts';
import type { ArchetypeProfile, PatchMeta } from './types.ts';

const DRAFT = ['Aatrox', 'Viego', 'Azir', 'Jinx', 'Thresh'];
const OPP = ['Gnar', 'Sejuani', 'Orianna', 'Ezreal', 'Nautilus'];
const LINEUP = ['Top1', 'Jng1', 'Mid1', 'Bot1', 'Sup1'];

interface Spec {
  id: string;
  day: number;
  winner: Side;
  blue?: string;
  red?: string;
  competition?: Game['competition'];
  season?: string;
  patch?: string;
  draft?: string[];
  players?: string[];
  seconds?: number | null;
  gold?: TeamGold | null;
  diffs?: (number | null)[];
}

function game(spec: Spec): Game {
  const side = (s: Side, team: string, draft: string[], names: string[], gold: TeamGold | null | undefined, diffs?: (number | null)[]) => ({
    side: s,
    teamName: team,
    teamId: null,
    tag: team.slice(0, 3),
    players: ROLES.map((role, i) => ({ role, playerName: names[i]!, playerId: null, champion: makeChampion(draft[i]!)! })),
    bans: [],
    goldDiff: diffs ? { checkpoints: diffs, peak: 0, trough: 0 } : null,
    gold: gold === undefined ? null : gold,
  });
  return {
    gameId: spec.id,
    competition: spec.competition ?? 'LCK',
    sourceLeague: spec.competition ?? 'LCK',
    tournamentLabel: 'Test',
    season: spec.season ?? '2026',
    split: 'Spring',
    date: new Date(Date.UTC(2026, 0, 1) + spec.day * 86_400_000).toISOString(),
    patch: spec.patch ?? '16.01',
    stage: { kind: 'regular', label: 'Regular Season', elimination: false },
    seriesFormat: 'BO3',
    seriesFormatInferred: true,
    gameNumber: 1,
    blue: side('blue', spec.blue ?? 'T1', spec.draft ?? DRAFT, spec.players ?? LINEUP, spec.gold, spec.diffs),
    red: side('red', spec.red ?? 'Gen.G', OPP, ROLES.map((r) => `opp-${r}`), null),
    winner: spec.winner,
    durationSeconds: spec.seconds === undefined ? 1800 : spec.seconds,
    demo: false,
  };
}

/** Everything in DRAFT and OPP is meta on every patch listed, unless removed. */
const metaFor = (patches: string[], drop: Partial<Record<Role, string>> = {}): Map<string, PatchMeta> =>
  new Map(
    patches.map((patch) => [
      patch,
      new Map(
        ROLES.map((role, i) => {
          const set = new Set([DRAFT[i]!, OPP[i]!, 'Zed']);
          if (drop[role]) set.delete(drop[role]!);
          return [role, set];
        }),
      ),
    ]),
  );

describe('teamOptions and teamSeasons', () => {
  const games = [
    game({ id: 'a', day: 0, winner: 'blue' }),
    game({ id: 'b', day: 1, winner: 'blue', competition: 'MSI', season: '2025' }),
    game({ id: 'c', day: 2, winner: 'red', competition: 'MSI', blue: 'G2 Esports', red: 'Gen.G' }),
  ];

  it('files a team under the league it plays most, not an event', () => {
    const t1 = teamOptions(games).find((t) => t.name === 'T1')!;
    expect(t1.home).toBe('LCK');
    expect(t1.games).toBe(2);
    // A team seen only at an international falls back to that event.
    expect(teamOptions(games).find((t) => t.name === 'G2 Esports')!.home).toBe('MSI');
  });

  it('lists seasons newest first', () => {
    expect(teamSeasons('t1', games)).toEqual(['2026', '2025']);
  });

  it('opens on the season most of a team\'s newest games are in, not an early label', () => {
    const season = [
      ...Array.from({ length: 12 }, (_, i) => game({ id: `s${i}`, day: i, winner: 'blue' })),
      ...Array.from({ length: 3 }, (_, i) => game({ id: `n${i}`, day: 40 + i, winner: 'blue', season: '2027', competition: 'OTHER' })),
    ];
    expect(currentTeamSeason('T1', season)).toBe('2026');
    expect(currentTeamSeason('Nobody', season)).toBeNull();
  });
});

describe('teamStats', () => {
  it('is null for a team with no games', () => {
    expect(teamStats('Nobody', [game({ id: 'a', day: 0, winner: 'blue' })], new Map())).toBeNull();
  });

  it('averages game time overall, in wins and in losses', () => {
    const stats = teamStats('T1', [
      game({ id: 'a', day: 0, winner: 'blue', seconds: 1800 }),
      game({ id: 'b', day: 1, winner: 'blue', seconds: 2000 }),
      game({ id: 'c', day: 2, winner: 'red', seconds: 2400 }),
      game({ id: 'd', day: 3, winner: 'red', seconds: null }),
    ], new Map())!;
    expect(stats.games).toBe(4);
    expect(stats.wins).toBe(2);
    expect(stats.duration.all).toMatchObject({ average: 2066.6666666666665, sample: 3 });
    expect(stats.duration.wins.average).toBe(1900);
    expect(stats.duration.losses.average).toBe(2400);
  });

  it('names the shortest and longest game, overall and in wins', () => {
    const stats = teamStats('T1', [
      game({ id: 'a', day: 0, winner: 'blue', seconds: 1500 }),
      game({ id: 'b', day: 1, winner: 'red', seconds: 2900, red: 'G2 Esports' }),
      game({ id: 'c', day: 2, winner: 'blue', seconds: 2100, red: 'KT Rolster' }),
    ], new Map())!;
    expect(stats.duration.all.shortest).toMatchObject({ seconds: 1500, opponent: 'Gen.G', won: true });
    expect(stats.duration.all.longest).toMatchObject({ seconds: 2900, opponent: 'G2 Esports', won: false });
    // The longest WIN is a different game from the longest game.
    expect(stats.duration.wins.longest).toMatchObject({ seconds: 2100, opponent: 'KT Rolster' });
    expect(stats.duration.losses.shortest!.seconds).toBe(2900);
  });

  it('buckets games by length, split by result', () => {
    const minutes = [24, 27, 29.99, 30, 34, 36, 41, 52];
    const stats = teamStats('T1', minutes.map((m, i) => game({ id: `g${i}`, day: i, winner: i % 2 ? 'red' : 'blue', seconds: m * 60 })), new Map())!;
    expect(stats.lengthBuckets.map((b) => [b.from, b.to, b.wins, b.losses])).toEqual([
      [null, 25, 1, 0],
      [25, 30, 1, 1],
      [30, 35, 1, 1],
      [35, 40, 0, 1],
      [40, null, 1, 1],
    ]);
  });

  it('averages team gold at each mark, skipping marks a game never reached', () => {
    const stats = teamStats('T1', [
      game({ id: 'a', day: 0, winner: 'blue', seconds: 1500, gold: { at: [15000, 25000, 35000, null], total: 50000 }, diffs: [500, 1000, 2000, null] }),
      game({ id: 'b', day: 1, winner: 'red', seconds: 2400, gold: { at: [14000, 23000, 33000, 43000], total: 64000 }, diffs: [-500, -1000, -2000, -3000] }),
      // Imported before team gold was captured: still has the diffs.
      game({ id: 'c', day: 2, winner: 'blue', diffs: [300, 300, 300, 300] }),
    ], new Map())!;
    expect(stats.gold.map((m) => m.minute)).toEqual([10, 15, 20, 25]);
    expect(stats.gold[0]).toEqual({ minute: 10, gold: 14500, diff: 100, sample: 3 });
    expect(stats.gold[3]).toEqual({ minute: 25, gold: 43000, diff: -1350, sample: 2 });
    expect(stats.endGold).toEqual({ average: 57000, perMinute: (2000 + 1600) / 2, sample: 2 });
    expect(stats.goldMissing).toBe(1);
  });

  it('judges pocket picks by the patch each game was played on', () => {
    // Zed is meta on 16.01 and off-meta on 16.03.
    const meta = new Map([...metaFor(['16.01']), ...metaFor(['16.03'], { mid: 'Zed' })]);
    const zed = ['Aatrox', 'Viego', 'Zed', 'Jinx', 'Thresh'];
    const stats = teamStats('T1', [
      game({ id: 'meta', day: 0, winner: 'blue', patch: '16.01', draft: zed, seconds: 1700 }),
      game({ id: 'pocket', day: 5, winner: 'blue', patch: '16.03', draft: zed, seconds: 2300 }),
      game({ id: 'plain', day: 6, winner: 'red', patch: '16.03', seconds: 1900 }),
    ], meta)!;

    expect(stats.pocket).toMatchObject({ games: 3, pocketGames: 1, pocketWins: 1, pocketPicks: 1, metaGames: 2, metaWins: 1 });
    expect(stats.pocket.pocketSeconds).toBe(2300);
    expect(stats.pocket.metaSeconds).toBe(1800);
    // Zed was played twice, but only one of those was a pocket pick.
    expect(stats.pocketChampions).toHaveLength(1);
    expect(stats.pocketChampions[0]).toMatchObject({ championId: 'Zed', role: 'mid', games: 1, wins: 1, players: ['Mid1'] });
    const mid = stats.players.find((p) => p.role === 'mid')!;
    expect(mid.champions.find((c) => c.championId === 'Zed')).toMatchObject({ games: 2, pocketGames: 1 });
    expect(mid).toMatchObject({ judged: 3, pocketPicks: 1, pocketWins: 1 });
  });

  it('puts the newest lineup first, in role order, then everyone who played before', () => {
    const sub = ['Top1', 'Jng1', 'Mid1', 'OldBot', 'Sup1'];
    const style = { favourite: 'hypercarry', games: 9 } as unknown as ArchetypeProfile;
    const stats = teamStats(
      'T1',
      [
        game({ id: 'old', day: 0, winner: 'blue', players: sub }),
        game({ id: 'new', day: 1, winner: 'blue' }),
      ],
      new Map(),
      new Map([[archetypeProfileKey('Bot1', 'bot'), style]]),
    )!;
    expect(stats.players.map((p) => `${p.role}:${p.player}:${p.current}`)).toEqual([
      'top:Top1:true',
      'jungle:Jng1:true',
      'mid:Mid1:true',
      'bot:Bot1:true',
      'support:Sup1:true',
      'bot:OldBot:false',
    ]);
    expect(stats.players[3]!.style).toBe(style);
    expect(stats.players[0]!.games).toBe(2);
  });
});
