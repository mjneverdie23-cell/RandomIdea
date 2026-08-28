import { beforeEach, describe, expect, it } from 'vitest';
import {
  BLANK_DRAFT,
  clampScores,
  clearSavedDraft,
  gameNumberOf,
  loadDraft,
  loadQueue,
  reviveDraft,
  saveDraft,
  saveQueue,
  swapDraftSides,
  type PredictorDraft,
} from './draft.ts';
import { makeChampion } from '../domain/champions.ts';
import { ROLES } from '../domain/types.ts';

const aatrox = makeChampion('Aatrox')!;
const viego = makeChampion('Viego')!;

function draft(overrides: Partial<PredictorDraft> = {}): PredictorDraft {
  return {
    ...BLANK_DRAFT,
    blue: {
      competition: 'LCK',
      team: 'T1',
      champions: [aatrox, viego, null, null, null],
      motivation: 'must win',
    },
    red: {
      competition: 'LCK',
      team: 'Gen.G',
      champions: ROLES.map(() => null),
      motivation: 'normal',
    },
    ...overrides,
  };
}

describe('gameNumberOf', () => {
  it('counts from the series score', () => {
    expect(gameNumberOf(BLANK_DRAFT)).toBe(1);
    expect(gameNumberOf(draft({ scoreBlue: 1, scoreRed: 1 }))).toBe(3);
  });

  it('uses a stated game number when no score is set', () => {
    // A pasted backtest game knows it is game 3 but withholds the score,
    // because the score would name the winner of the earlier games.
    expect(gameNumberOf(draft({ gameNumber: 3, scoreBlue: 0, scoreRed: 0 }))).toBe(3);
  });

  it('lets an entered score win over a stated game number', () => {
    expect(gameNumberOf(draft({ gameNumber: 5, scoreBlue: 1, scoreRed: 0 }))).toBe(2);
  });
});

describe('swapDraftSides', () => {
  it('carries each team score across with it', () => {
    const swapped = swapDraftSides(draft({ scoreBlue: 2, scoreRed: 0, seriesLength: 'BO5' }));
    expect(swapped.blue.team).toBe('Gen.G');
    expect(swapped.red.team).toBe('T1');
    expect(swapped.scoreBlue).toBe(0);
    expect(swapped.scoreRed).toBe(2);
    // The draft travels with its team, not with the side.
    expect(swapped.red.champions[0]).toEqual(aatrox);
    expect(swapped.red.motivation).toBe('must win');
  });
});

describe('clampScores', () => {
  it('leaves a legal score alone', () => {
    const legal = draft({ seriesLength: 'BO5', scoreBlue: 2, scoreRed: 1 });
    expect(clampScores(legal)).toBe(legal);
  });

  it('trims a score the format can no longer hold', () => {
    const shrunk = clampScores(draft({ seriesLength: 'BO3', scoreBlue: 2, scoreRed: 1 }));
    expect(shrunk.scoreBlue).toBe(1);
    expect(shrunk.scoreRed).toBe(1);
  });

  it('zeroes both scores in a best-of-one', () => {
    const single = clampScores(draft({ seriesLength: 'BO1', scoreBlue: 1, scoreRed: 1 }));
    expect(single.scoreBlue).toBe(0);
    expect(single.scoreRed).toBe(0);
  });
});

describe('reviveDraft', () => {
  it('restores a round-tripped draft', () => {
    const original = draft({ scoreBlue: 1, seriesLength: 'BO5', seriesTouched: true });
    const revived = reviveDraft(JSON.parse(JSON.stringify(original)));
    expect(revived).toEqual(original);
  });

  it('falls back to a blank draft for junk', () => {
    expect(reviveDraft(null)).toEqual(BLANK_DRAFT);
    expect(reviveDraft('nonsense')).toEqual(BLANK_DRAFT);
    expect(reviveDraft(42)).toEqual(BLANK_DRAFT);
  });

  it('drops champion slots that are not champions', () => {
    const revived = reviveDraft({
      blue: { team: 'T1', champions: [aatrox, 'Viego', { id: 5 }, null, undefined] },
    });
    expect(revived.blue.champions[0]).toEqual(aatrox);
    expect(revived.blue.champions.slice(1)).toEqual([null, null, null, null]);
  });

  it('always yields exactly one slot per role', () => {
    expect(reviveDraft({ blue: { champions: [aatrox] } }).blue.champions).toHaveLength(ROLES.length);
    expect(
      reviveDraft({ blue: { champions: new Array(30).fill(aatrox) } }).blue.champions,
    ).toHaveLength(ROLES.length);
  });

  it('rejects an unknown motivation rather than passing it to the engine', () => {
    expect(reviveDraft({ blue: { motivation: 'tilted' } }).blue.motivation).toBe('normal');
    expect(reviveDraft({ blue: { motivation: 'must win' } }).blue.motivation).toBe('must win');
  });

  it('rejects an unknown series length', () => {
    expect(reviveDraft({ seriesLength: 'BO7' }).seriesLength).toBe('BO3');
    expect(reviveDraft({ seriesLength: 'BO5' }).seriesLength).toBe('BO5');
  });

  it('clamps a stored score that the stored format cannot hold', () => {
    const revived = reviveDraft({ seriesLength: 'BO1', scoreBlue: 9, scoreRed: 4 });
    expect(revived.scoreBlue).toBe(0);
    expect(revived.scoreRed).toBe(0);
  });

  it('refuses negative and fractional scores', () => {
    const revived = reviveDraft({ seriesLength: 'BO5', scoreBlue: -3, scoreRed: 1.7 });
    expect(revived.scoreBlue).toBe(0);
    expect(revived.scoreRed).toBe(1);
  });

  it('treats an empty team name as no team', () => {
    expect(reviveDraft({ blue: { team: '' } }).blue.team).toBeNull();
  });
});

/** A `Storage`-shaped object over a plain map, since these tests have no DOM. */
function storageOver(store: Map<string, string>) {
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

function define(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

/**
 * One `localStorage` shared by every tab, and a `sessionStorage` per tab.
 *
 * `openTab()` swaps in a fresh session store while keeping the shared one,
 * which is exactly what opening a second tab on the same origin does.
 */
function installStorage(): { local: Map<string, string>; openTab: () => void } {
  const local = new Map<string, string>();
  define('localStorage', storageOver(local));
  const openTab = () => define('sessionStorage', storageOver(new Map()));
  openTab();
  return { local, openTab };
}

/** No `sessionStorage` at all — private modes and locked-down browsers. */
function installLocalOnly(): void {
  define('localStorage', storageOver(new Map()));
  define('sessionStorage', undefined);
}

describe('storage round trip', () => {
  beforeEach(() => {
    installStorage();
  });

  it('returns a blank draft when nothing is stored', () => {
    expect(loadDraft()).toEqual(BLANK_DRAFT);
  });

  it('reloads what was saved', () => {
    const original = draft({ scoreBlue: 1, scoreRed: 1, seriesLength: 'BO5' });
    saveDraft(original);
    expect(loadDraft()).toEqual(original);
  });

  it('survives a corrupt stored value', () => {
    localStorage.setItem('predictor:draft:v1', '{not json');
    sessionStorage.setItem('predictor:draft:v1', '{not json');
    expect(loadDraft()).toEqual(BLANK_DRAFT);
  });

  it('forgets the draft when it is cleared', () => {
    saveDraft(draft());
    clearSavedDraft();
    expect(loadDraft()).toEqual(BLANK_DRAFT);
  });

  it('still works when sessionStorage is unavailable', () => {
    installLocalOnly();
    const original = draft({ scoreBlue: 2, seriesLength: 'BO5' });
    saveDraft(original);
    expect(loadDraft()).toEqual(original);
    clearSavedDraft();
    expect(loadDraft()).toEqual(BLANK_DRAFT);
  });
});

describe('two tabs on two series', () => {
  let openTab: () => void;

  beforeEach(() => {
    ({ openTab } = installStorage());
  });

  it('keeps each tab on its own draft', () => {
    const first = draft({ scoreBlue: 1, scoreRed: 0, seriesLength: 'BO5' });
    saveDraft(first);
    const tabOne = sessionStorage;

    // A second tab composes a different series and saves over the shared key.
    openTab();
    const second = draft({ scoreBlue: 0, scoreRed: 1, seriesLength: 'BO3' });
    saveDraft(second);
    expect(loadDraft()).toEqual(second);

    // The first tab reloads. Before this fix it came back holding `second`.
    define('sessionStorage', tabOne);
    expect(loadDraft()).toEqual(first);
  });

  it('keeps each tab on its own queue', () => {
    saveQueue({ text: 'series-one', index: 3 });
    const tabOne = sessionStorage;

    openTab();
    saveQueue({ text: 'series-two', index: 0 });
    expect(loadQueue()).toEqual({ text: 'series-two', index: 0 });

    define('sessionStorage', tabOne);
    expect(loadQueue()).toEqual({ text: 'series-one', index: 3 });
  });

  it('starts a freshly opened tab from the last saved draft', () => {
    const original = draft({ scoreBlue: 2, seriesLength: 'BO5' });
    saveDraft(original);
    // Nothing of its own yet, so it inherits rather than opening blank — which
    // is also what reopening the app after closing it has to do.
    openTab();
    expect(loadDraft()).toEqual(original);
  });

  it('does not strand another tab when one of them resets', () => {
    const first = draft({ scoreBlue: 1, seriesLength: 'BO5' });
    saveDraft(first);
    const tabOne = sessionStorage;

    openTab();
    saveDraft(draft({ scoreRed: 1 }));
    clearSavedDraft();
    expect(loadDraft()).toEqual(BLANK_DRAFT);

    define('sessionStorage', tabOne);
    expect(loadDraft()).toEqual(first);
  });
});
