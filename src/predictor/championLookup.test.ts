import { describe, expect, it } from 'vitest';
import { makeChampion } from '../domain/champions.ts';
import { ROLES, type Game } from '../domain/types.ts';
import {
  championReport,
  decodePicks,
  draftsWith,
  encodePicks,
  pairRecords,
  rolePools,
  summarize,
} from './championLookup.ts';

const BLUE = ['Aatrox', 'Nocturne', 'Akali', 'Jinx', 'Rell'];
const RED = ['Gnar', 'Vi', 'Azir', 'Ezreal', 'Nautilus'];

interface Spec {
  id: string;
  day: number;
  blueWins: boolean;
  blue?: string[];
  red?: string[];
  blueTeam?: string;
  redTeam?: string;
  bluePlayers?: string[];
  diff15?: number | null;
  seconds?: number;
  redBans?: string[];
}

function game(spec: Spec): Game {
  const side = (which: 'blue' | 'red', team: string, draft: string[], players: string[], bans: string[]) => ({
    side: which,
    teamName: team,
    teamId: null,
    tag: team.slice(0, 3),
    players: ROLES.map((role, index) => ({
      role,
      playerName: players[index]!,
      playerId: null,
      champion: makeChampion(draft[index]!)!,
    })),
    bans: bans.map((name) => makeChampion(name)!),
    goldDiff:
      which === 'blue' && spec.diff15 !== undefined
        ? { checkpoints: [0, spec.diff15, null, null], peak: 0, trough: 0 }
        : null,
    gold: null,
  });
  const blueTeam = spec.blueTeam ?? 'T1';
  const redTeam = spec.redTeam ?? 'Gen.G';
  return {
    gameId: spec.id,
    competition: 'WORLDS',
    sourceLeague: 'WLDs',
    tournamentLabel: 'Worlds 2026',
    season: '2026',
    split: 'Main Event',
    date: new Date(Date.UTC(2026, 9, 1) + spec.day * 86_400_000).toISOString(),
    patch: '16.19',
    stage: { kind: 'group', label: 'Group', elimination: false },
    seriesFormat: 'BO1',
    seriesFormatInferred: true,
    gameNumber: 1,
    blue: side('blue', blueTeam, spec.blue ?? BLUE, spec.bluePlayers ?? ROLES.map((r) => `${blueTeam}-${r}`), []),
    red: side('red', redTeam, spec.red ?? RED, ROLES.map((r) => `${redTeam}-${r}`), spec.redBans ?? []),
    winner: spec.blueWins ? 'blue' : 'red',
    durationSeconds: spec.seconds ?? 1800,
    demo: false,
  };
}

const games = [
  // Nocturne jungle + Akali mid together for T1, twice: a win and a loss.
  game({ id: 'a', day: 0, blueWins: true, diff15: 1200, seconds: 1700 }),
  game({ id: 'b', day: 1, blueWins: false, diff15: -800, seconds: 2100 }),
  // Nocturne without Akali, for HLE on red, against Akali top — which doesn't count as Akali mid.
  game({
    id: 'c',
    day: 2,
    blueWins: false,
    blueTeam: 'G2',
    redTeam: 'HLE',
    blue: ['Akali', 'Vi', 'Azir', 'Ezreal', 'Rell'],
    red: ['Gnar', 'Nocturne', 'Taliyah', 'Jinx', 'Nautilus'],
    diff15: -2000,
  }),
  // Akali mid without Nocturne, played by a different T1 mid.
  game({
    id: 'd',
    day: 3,
    blueWins: true,
    blue: ['Aatrox', 'Viego', 'Akali', 'Jinx', 'Rell'],
    bluePlayers: ['T1-top', 'T1-jungle', 'Sub', 'T1-bot', 'T1-support'],
    redBans: ['Nocturne'],
  }),
];

describe('draftsWith', () => {
  it('finds drafts with every chosen champion in its role, newest first, on either side', () => {
    expect(draftsWith(games, { jungle: 'Nocturne', mid: 'Akali' }).map((hit) => hit.game.gameId)).toEqual(['b', 'a']);
    const nocturne = draftsWith(games, { jungle: 'Nocturne' });
    expect(nocturne.map((hit) => [hit.game.gameId, hit.side.teamName, hit.won])).toEqual([
      ['c', 'HLE', true],
      ['b', 'T1', false],
      ['a', 'T1', true],
    ]);
  });

  it('only counts a champion in the role it was asked for', () => {
    expect(draftsWith(games, { mid: 'Akali' }).map((hit) => hit.game.gameId)).toEqual(['d', 'b', 'a']);
    expect(draftsWith(games, { top: 'Akali' }).map((hit) => hit.side.teamName)).toEqual(['G2']);
  });

  it('finds nothing when nothing is chosen', () => {
    expect(draftsWith(games, {})).toEqual([]);
  });
});

describe('summarize', () => {
  it('gives the record, game time, gold at 15 from the drafting side, sides and teams', () => {
    const summary = summarize(draftsWith(games, { jungle: 'Nocturne' }));
    expect(summary).toMatchObject({ games: 3, wins: 2, averageSeconds: (1800 + 2100 + 1700) / 3 });
    // HLE was red when blue led by −2,000, so HLE was 2,000 up.
    expect(summary.gold15).toBeCloseTo((2000 - 800 + 1200) / 3);
    expect(summary.sides).toEqual({ blue: { games: 2, wins: 1 }, red: { games: 1, wins: 1 } });
    expect(summary.teams).toEqual([
      { team: 'T1', games: 2, wins: 1 },
      { team: 'HLE', games: 1, wins: 1 },
    ]);
  });
});

describe('championReport', () => {
  const report = championReport(games, 'mid', 'Akali');

  it('counts picks in the role, bans and presence in any role', () => {
    expect(report).toMatchObject({ games: 3, wins: 2, bans: 0, scope: 4 });
    // Picked in all four games (once as top), never banned.
    expect(report.presence).toBe(1);
    expect(championReport(games, 'jungle', 'Nocturne')).toMatchObject({ bans: 1, presence: 1 });
    expect(report.champion?.name).toBe('Akali');
  });

  it('ranks players, teammates and counters with a small-sample discount', () => {
    expect(report.players.map((line) => [line.player, line.games, line.wins])).toEqual([
      ['Sub', 1, 1],
      ['T1-mid', 2, 1],
    ]);
    // Viego's 1–0 rates (1+1)/(1+2) = 0.67, just above a 2–1 at (2+1)/(3+2) = 0.6;
    // Nocturne's 1–1 comes last at 0.5.
    expect(report.teammates.map((partner) => [partner.champion.id, partner.games, partner.wins])).toEqual([
      ['Viego', 1, 1],
      ['Aatrox', 3, 2],
      ['Jinx', 3, 2],
      ['Rell', 3, 2],
      ['Nocturne', 2, 1],
    ]);
    // Every enemy faced it three times; nothing went worse than 2–1 against it.
    expect(report.counters[0]).toMatchObject({ games: 3, wins: 2 });
    expect(report.lane).toEqual([expect.objectContaining({ role: 'mid', games: 3, wins: 2 })]);
  });

  it('has no champion when it was never picked in that role', () => {
    const none = championReport(games, 'support', 'Akali');
    expect(none).toMatchObject({ games: 0, champion: null, players: [], averageSeconds: null });
  });
});

describe('pairRecords', () => {
  it('gives every pair of the chosen picks', () => {
    expect(pairRecords(games, { jungle: 'Nocturne', mid: 'Akali', bot: 'Jinx' })).toEqual([
      { roles: ['jungle', 'mid'], games: 2, wins: 1 },
      // HLE drafted Nocturne with Jinx too.
      { roles: ['jungle', 'bot'], games: 3, wins: 2 },
      { roles: ['mid', 'bot'], games: 3, wins: 2 },
    ]);
  });
});

describe('rolePools and links', () => {
  it('lists each role\'s champions, most picked first', () => {
    const pools = rolePools(games);
    expect(pools.jungle.map((entry) => [entry.champion.id, entry.picks])).toEqual([
      ['Vi', 4],
      ['Nocturne', 3],
      ['Viego', 1],
    ]);
  });

  it('round-trips picks through the page link and drops junk', () => {
    expect(encodePicks({ mid: 'Akali', jungle: 'Nocturne' })).toBe('jungle:Nocturne,mid:Akali');
    expect(decodePicks('jungle:Nocturne,mid:Akali,feeder:Teemo,top:')).toEqual({ jungle: 'Nocturne', mid: 'Akali' });
    expect(decodePicks(null)).toEqual({});
  });
});
