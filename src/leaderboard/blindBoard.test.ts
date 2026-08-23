import { describe, expect, it } from 'vitest';
import {
  blindPersonalBest,
  blindScorePct,
  clearedLabel,
  compareBlindEntries,
  entryFromRun,
  rankBlindEntries,
  type BlindBoardEntry,
} from './blindBoard.ts';
import { BLIND_LEVELS, MAX_BLIND_SCORE, type BlindRun } from '../quiz/blind.ts';

const entry = (over: Partial<BlindBoardEntry> = {}): BlindBoardEntry => ({
  id: Math.random().toString(36).slice(2),
  username: 'Summoner',
  score: 500,
  cleared: 2,
  hints: 0,
  levelsCleared: ['easy', 'medium'],
  date: '2026-08-01T00:00:00.000Z',
  demoData: false,
  ...over,
});

describe('compareBlindEntries', () => {
  it('ranks by score first', () => {
    const ranked = rankBlindEntries([entry({ score: 100 }), entry({ score: 900 })]);
    expect(ranked.map((e) => e.score)).toEqual([900, 100]);
  });

  it('breaks a tie on fewer hints', () => {
    // Same points, but one run needed help and the other read it clean.
    const ranked = rankBlindEntries([
      entry({ score: 500, hints: 3, username: 'Hinted' }),
      entry({ score: 500, hints: 0, username: 'Clean' }),
    ]);
    expect(ranked.map((e) => e.username)).toEqual(['Clean', 'Hinted']);
  });

  it('then prefers the run that read more levels', () => {
    const ranked = rankBlindEntries([
      entry({ score: 550, hints: 1, cleared: 1, username: 'OneBig' }),
      entry({ score: 550, hints: 1, cleared: 3, username: 'ThreeSmall' }),
    ]);
    expect(ranked[0]!.username).toBe('ThreeSmall');
  });

  it('is a total order, so sorting is stable and transitive', () => {
    const a = entry({ score: 900, hints: 0 });
    const b = entry({ score: 500, hints: 0 });
    expect(compareBlindEntries(a, b)).toBeLessThan(0);
    expect(compareBlindEntries(b, a)).toBeGreaterThan(0);
    expect(compareBlindEntries(a, a)).toBe(0);
  });
});

describe('entryFromRun', () => {
  const run = (over: Partial<BlindRun> = {}): BlindRun => ({
    games: [],
    level: 4,
    hints: 0,
    hintsTotal: 3,
    score: 650,
    status: 'finished',
    results: [
      { level: 'easy', correct: true, hints: 0, points: 100, call: 'blue' },
      { level: 'medium', correct: false, hints: 2, points: 0, call: 'red' },
      { level: 'hard', correct: true, hints: 1, points: 263, call: 'blue' },
      { level: 'impossible', correct: false, hints: 0, points: 0, call: 'red' },
    ],
    ...over,
  });

  it('records what the run actually did', () => {
    const made = entryFromRun(run(), 'Faker', false);
    expect(made.score).toBe(650);
    expect(made.cleared).toBe(2);
    expect(made.hints).toBe(3);
    expect(made.levelsCleared).toEqual(['easy', 'hard']);
    expect(made.username).toBe('Faker');
    expect(Number.isFinite(Date.parse(made.date))).toBe(true);
  });

  it('falls back to a name rather than storing a blank one', () => {
    expect(entryFromRun(run(), '   ', false).username).toBe('Anonymous');
  });

  it('carries the demo flag through', () => {
    expect(entryFromRun(run(), 'A', true).demoData).toBe(true);
  });
});

describe('blindPersonalBest', () => {
  it('finds a player’s top run, ignoring case', () => {
    const best = blindPersonalBest(
      [
        entry({ username: 'faker', score: 300 }),
        entry({ username: 'Faker', score: 900 }),
        entry({ username: 'Chovy', score: 1200 }),
      ],
      'FAKER',
    );
    expect(best?.score).toBe(900);
  });

  it('returns null for a player with no runs', () => {
    expect(blindPersonalBest([entry()], 'Nobody')).toBeNull();
  });
});

describe('presentation helpers', () => {
  it('shows a score as a share of the maximum', () => {
    expect(blindScorePct(MAX_BLIND_SCORE)).toBe(100);
    expect(blindScorePct(0)).toBe(0);
  });

  it('names the levels cleared', () => {
    expect(clearedLabel([])).toBe('none');
    expect(clearedLabel(['easy', 'hard'])).toBe('easy, hard');
    expect(clearedLabel([...BLIND_LEVELS])).toBe('all four');
  });
});
