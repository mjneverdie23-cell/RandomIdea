import { describe, expect, it } from 'vitest';
import {
  MatchImportError,
  describeMatch,
  looseJsonParse,
  matchToDraft,
  parseMatchText,
  parseSeriesLength,
  parseStage,
  unknownChampions,
} from './matchImport.ts';
import { makeChampion } from '../domain/champions.ts';
import { ROLES } from '../domain/types.ts';

const FULL = `{
  "matches": [{
    "id": "G1",
    "date": "2026-07-14",
    "competition": "LCK",
    "stage": "playoffs",
    "series": "BO5",
    "score": [1, 1],
    "blue": { "team": "T1", "top": "Aatrox", "jungle": "Viego", "mid": "Azir", "bot": "Jinx", "support": "Thresh" },
    "red":  { "team": "Gen.G", "top": "Gnar", "jungle": "Sejuani", "mid": "Orianna", "bot": "Ezreal", "support": "Nautilus" }
  }]
}`;

const only = (text: string) => parseMatchText(text).matches[0]!;

describe('looseJsonParse', () => {
  it('reads strict JSON unchanged', () => {
    expect(looseJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it('accepts unquoted keys, single quotes and trailing commas', () => {
    expect(looseJsonParse("{ team: 'T1', top: 'Aatrox', }")).toEqual({
      team: 'T1',
      top: 'Aatrox',
    });
  });

  it('ignores line and block comments', () => {
    expect(looseJsonParse('{ // a\n "a": 1, /* b */ "b": 2 }')).toEqual({ a: 1, b: 2 });
  });

  it('leaves braces and slashes inside strings alone', () => {
    expect(looseJsonParse('{ "note": "a { b } // c" }')).toEqual({ note: 'a { b } // c' });
  });

  it('escapes a double quote carried inside a single-quoted string', () => {
    expect(looseJsonParse(`{ 'note': 'say "hi"' }`)).toEqual({ note: 'say "hi"' });
  });
});

describe('parseStage / parseSeriesLength', () => {
  it('maps stage words', () => {
    expect(parseStage('Playoffs')).toBe('playoffs');
    expect(parseStage('Semifinal')).toBe('semifinal');
    // Both of these end in "final"; the narrower rule has to win.
    expect(parseStage('Quarterfinal')).toBe('quarterfinal');
    expect(parseStage('Grand Final')).toBe('final');
    expect(parseStage('Play-In')).toBe('playin');
    expect(parseStage('Groups')).toBe('group');
    expect(parseStage(null)).toBe('regular');
    expect(parseStage('something else')).toBe('regular');
  });

  it('reads a best-of in any spelling', () => {
    expect(parseSeriesLength('BO5')).toBe('BO5');
    expect(parseSeriesLength('bo3')).toBe('BO3');
    expect(parseSeriesLength('Best of 1')).toBe('BO1');
    expect(parseSeriesLength(5)).toBe('BO5');
    expect(parseSeriesLength('unknown')).toBeNull();
  });
});

describe('parseMatchText', () => {
  it('reads a full match', () => {
    const match = only(FULL);
    expect(match.id).toBe('G1');
    expect(match.competition).toBe('LCK');
    expect(match.stage).toBe('playoffs');
    expect(match.seriesLength).toBe('BO5');
    expect(match.blue.team).toBe('T1');
    expect(match.red.team).toBe('Gen.G');
    expect(match.blue.champions.map((c) => c?.name)).toEqual([
      'Aatrox',
      'Viego',
      'Azir',
      'Jinx',
      'Thresh',
    ]);
  });

  it('accepts a bare object and a bare array as well as a wrapper', () => {
    const single = `{ "blue": { "team": "T1" }, "red": { "team": "GenG" } }`;
    expect(parseMatchText(single).matches).toHaveLength(1);
    expect(parseMatchText(`[${single}, ${single}]`).matches).toHaveLength(2);
    expect(parseMatchText(`{ "games": [${single}] }`).matches).toHaveLength(1);
  });

  it('accepts any spelling of a role key', () => {
    const match = only(
      `{ "blue": { "team": "T1", "TOP": "Aatrox", "jgl": "Viego", "middle": "Azir", "adc": "Jinx", "sup": "Thresh" }, "red": { "team": "G" } }`,
    );
    expect(match.blue.champions.map((c) => c?.name)).toEqual([
      'Aatrox',
      'Viego',
      'Azir',
      'Jinx',
      'Thresh',
    ]);
  });

  it('accepts champions as a plain list in draft order', () => {
    const match = only(
      `{ "blue": { "team": "T1", "picks": ["Aatrox","Viego","Azir","Jinx","Thresh"] }, "red": { "team": "G" } }`,
    );
    expect(match.blue.champions.map((c) => c?.name)).toEqual([
      'Aatrox',
      'Viego',
      'Azir',
      'Jinx',
      'Thresh',
    ]);
  });

  it('derives the game number from the score', () => {
    const match = only(FULL);
    expect(match.scoreBlue).toBe(1);
    expect(match.scoreRed).toBe(1);
    expect(match.gameNumber).toBe(3);
  });

  it('ignores a game number that the score contradicts', () => {
    const match = only(
      `{ "series": "BO5", "score": [2,0], "game": 1, "blue": {"team":"A"}, "red": {"team":"B"} }`,
    );
    expect(match.gameNumber).toBe(3);
  });

  it('clamps a score the stated format cannot hold', () => {
    const match = only(
      `{ "series": "BO1", "score": [3,2], "blue": {"team":"A"}, "red": {"team":"B"} }`,
    );
    expect(match.scoreBlue).toBe(0);
    expect(match.scoreRed).toBe(0);
  });

  it('resolves competition aliases and flags ones it cannot', () => {
    expect(only(`{"league":"WLDS","blue":{"team":"A"},"red":{"team":"B"}}`).competition).toBe(
      'WORLDS',
    );
    const result = parseMatchText(`{"league":"NACL","blue":{"team":"A"},"red":{"team":"B"}}`);
    expect(result.matches[0]!.competition).toBeNull();
    expect(result.matches[0]!.competitionRaw).toBe('NACL');
    expect(result.warnings.join(' ')).toContain('unrecognized competition');
  });

  it('warns about a half-filled draft but still returns it', () => {
    const result = parseMatchText(
      `{ "blue": { "team": "T1", "top": "Aatrox", "mid": "Azir" }, "red": { "team": "G" } }`,
    );
    expect(result.warnings.join(' ')).toContain('only 2 of 5 lanes');
    expect(result.matches[0]!.blue.champions.filter(Boolean)).toHaveLength(2);
  });

  it('reads motivation when given, and defaults it otherwise', () => {
    expect(
      only(`{"blue":{"team":"A","motivation":"must win"},"red":{"team":"B"}}`).blue.motivation,
    ).toBe('must win');
    expect(only(`{"blue":{"team":"A"},"red":{"team":"B"}}`).blue.motivation).toBe('normal');
    // An unrecognized value must not reach the engine.
    expect(
      only(`{"blue":{"team":"A","motivation":"angry"},"red":{"team":"B"}}`).blue.motivation,
    ).toBe('normal');
  });

  it('never reads a winner, even when one is present', () => {
    const match = only(
      `{ "winner": "blue", "result": 1, "blue": {"team":"A"}, "red": {"team":"B"} }`,
    );
    expect(JSON.stringify(match)).not.toContain('winner');
    expect(Object.keys(match)).not.toContain('winner');
  });

  it('rejects empty, malformed and empty-list input', () => {
    expect(() => parseMatchText('   ')).toThrow(MatchImportError);
    expect(() => parseMatchText('not json at all {{{')).toThrow(MatchImportError);
    expect(() => parseMatchText('[]')).toThrow(MatchImportError);
    expect(() => parseMatchText('42')).toThrow(MatchImportError);
  });

  it('skips unusable entries in a list rather than failing the whole paste', () => {
    const result = parseMatchText(`[ 5, { "blue": {"team":"A"}, "red": {"team":"B"} } ]`);
    expect(result.matches).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('not a match object');
  });
});

describe('matchToDraft', () => {
  it('fills the composer from a match', () => {
    const draft = matchToDraft(only(FULL));
    expect(draft.blue.team).toBe('T1');
    expect(draft.red.team).toBe('Gen.G');
    expect(draft.blue.competition).toBe('LCK');
    expect(draft.red.competition).toBe('LCK');
    expect(draft.stage).toBe('playoffs');
    expect(draft.seriesLength).toBe('BO5');
    expect(draft.scoreBlue).toBe(1);
    expect(draft.scoreRed).toBe(1);
    expect(draft.blue.champions).toHaveLength(ROLES.length);
  });

  it('freezes the series length so the format suggestion cannot overwrite it', () => {
    expect(matchToDraft(only(FULL)).seriesTouched).toBe(true);
  });

  it('leaves the composer clean for a match with no draft', () => {
    const draft = matchToDraft(only(`{ "blue": {"team":"A"}, "red": {"team":"B"} }`));
    expect(draft.blue.champions.every((c) => c === null)).toBe(true);
    expect(draft.scoreBlue).toBe(0);
  });
});

describe('describeMatch', () => {
  it('names both teams', () => {
    expect(describeMatch(only(FULL))).toContain('T1 vs Gen.G');
  });

  it('shows the game number once a series is under way', () => {
    expect(describeMatch(only(FULL))).toContain('G3');
  });

  it('omits the game number for an opening game', () => {
    const label = describeMatch(only(`{ "blue": {"team":"A"}, "red": {"team":"B"} }`));
    expect(label).toBe('A vs B');
  });
});

describe('unknownChampions', () => {
  it('lists champions the loaded seasons have never seen', () => {
    const known = new Set([makeChampion('Aatrox')!.id, makeChampion('Viego')!.id]);
    expect(unknownChampions(only(FULL), known)).toEqual(['Azir', 'Jinx', 'Thresh', 'Gnar', 'Sejuani', 'Orianna', 'Ezreal', 'Nautilus']);
  });

  it('returns nothing when every pick is known', () => {
    const all = new Set(
      ['Aatrox', 'Viego', 'Azir', 'Jinx', 'Thresh', 'Gnar', 'Sejuani', 'Orianna', 'Ezreal', 'Nautilus'].map(
        (name) => makeChampion(name)!.id,
      ),
    );
    expect(unknownChampions(only(FULL), all)).toEqual([]);
  });
});
