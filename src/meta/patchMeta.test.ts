import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '../data/demoDataset.ts';
import { computePatchMeta, MetaIndex } from './patchMeta.ts';
import { makeChampion } from '../domain/champions.ts';
import { ROLES, type Champion, type Game, type Role, type Side } from '../domain/types.ts';

function champ(name: string): Champion {
  const value = makeChampion(name);
  if (!value) throw new Error(`bad champion fixture: ${name}`);
  return value;
}

function makeGame(
  id: string,
  bluePicks: string[],
  redPicks: string[],
  bans: string[],
  winner: Side = 'blue',
): Game {
  const team = (side: Side, picks: string[]) => ({
    side,
    teamName: side === 'blue' ? 'Blue' : 'Red',
    teamId: null,
    tag: side === 'blue' ? 'BLU' : 'RED',
    players: picks.map((name, index) => ({
      role: ROLES[index] as Role,
      playerName: `${side}-${index}`,
      playerId: null,
      champion: champ(name),
    })),
    bans: bans.map(champ),
  });

  return {
    gameId: id,
    competition: 'LCK',
    sourceLeague: 'LCK',
    tournamentLabel: 'LCK 2024',
    season: '2024',
    split: null,
    date: '2024-06-01T00:00:00.000Z',
    patch: '14.11',
    stage: { kind: 'regular', label: 'Regular Season', elimination: false },
    seriesFormat: 'BO3',
    seriesFormatInferred: true,
    gameNumber: 1,
    blue: team('blue', bluePicks),
    red: team('red', redPicks),
    winner,
    durationSeconds: 1800,
    demo: true,
  };
}

const A = ['Aatrox', 'Viego', 'Ahri', 'Jinx', 'Thresh'];
const B = ['Gnar', 'Sejuani', 'Azir', 'Ashe', 'Nautilus'];

describe('computePatchMeta', () => {
  it('computes pick rate as a share of games', () => {
    const meta = computePatchMeta('14.11', [
      makeGame('1', A, B, ['Rell']),
      makeGame('2', A, ['Ornn', 'Vi', 'Azir', 'Varus', 'Rakan'], ['Rell']),
    ]);

    const aatrox = meta.topPicked.find((e) => e.champion.id === 'Aatrox')!;
    expect(aatrox.picks).toBe(2);
    expect(aatrox.pickRate).toBe(1);

    const azir = meta.topPicked.find((e) => e.champion.id === 'Azir')!;
    expect(azir.picks).toBe(2);

    const gnar = meta.topPicked.find((e) => e.champion.id === 'Gnar')!;
    expect(gnar.pickRate).toBe(0.5);
  });

  it('counts a champion banned by both teams once per game', () => {
    const game = makeGame('1', A, B, ['Rell']);
    const meta = computePatchMeta('14.11', [game]);
    const rell = meta.topBanned.find((e) => e.champion.id === 'Rell')!;
    expect(rell.bans).toBe(1);
    expect(rell.banRate).toBe(1);
  });

  it('computes win rate from the winning side only', () => {
    const meta = computePatchMeta('14.11', [
      makeGame('1', A, B, [], 'blue'),
      makeGame('2', A, B, [], 'red'),
    ]);
    expect(meta.topPicked.find((e) => e.champion.id === 'Aatrox')!.winRate).toBe(0.5);
    expect(meta.topPicked.find((e) => e.champion.id === 'Gnar')!.winRate).toBe(0.5);
  });

  it('reports the role a champion is mostly played in', () => {
    const meta = computePatchMeta('14.11', [makeGame('1', A, B, [])]);
    expect(meta.topPicked.find((e) => e.champion.id === 'Ahri')!.primaryRole).toBe('mid');
    expect(meta.topPicked.find((e) => e.champion.id === 'Thresh')!.primaryRole).toBe('support');
  });

  it('sorts most-picked first', () => {
    const meta = computePatchMeta('14.11', [
      makeGame('1', A, B, []),
      makeGame('2', A, ['Ornn', 'Vi', 'Orianna', 'Varus', 'Rakan'], []),
    ]);
    expect(meta.topPicked[0]!.picks).toBeGreaterThanOrEqual(meta.topPicked[1]!.picks);
  });

  it('handles an empty sample', () => {
    const meta = computePatchMeta('14.11', []);
    expect(meta.sampleSize).toBe(0);
    expect(meta.topPicked).toEqual([]);
  });
});

describe('MetaIndex', () => {
  const dataset = buildDemoDataset();
  const index = new MetaIndex(dataset.games);

  it('lists the dataset patches newest first', () => {
    const patches = index.patches();
    expect(patches.length).toBeGreaterThan(1);
    expect(patches).toEqual([...patches].sort((a, b) => Number(b.replace('.', '')) - Number(a.replace('.', ''))));
  });

  it('returns meta for a patch present in the data', () => {
    const patch = index.patches()[0]!;
    const meta = index.get(patch);
    expect(meta).not.toBeNull();
    expect(meta!.sampleSize).toBe(index.gamesOnPatch(patch));
    expect(meta!.topPicked.length).toBeGreaterThan(0);
  });

  it('memoizes repeated lookups', () => {
    const patch = index.patches()[0]!;
    expect(index.get(patch)).toBe(index.get(patch));
  });

  it('returns null for an unknown patch', () => {
    expect(index.get('0.01')).toBeNull();
  });

  it('falls back to the cross-league sample when a scope is too thin', () => {
    const patch = index.patches()[0]!;
    const scoped = index.get(patch, { competition: 'EWC' });
    expect(scoped).not.toBeNull();
    expect(scoped!.sampleSize).toBeGreaterThan(0);
  });
});
