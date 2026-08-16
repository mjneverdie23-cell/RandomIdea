import { describe, expect, it } from 'vitest';
import {
  RatingsParseError,
  lookupRating,
  parseRatingsCsv,
  ratingKeys,
  ratingsFromStored,
  ratingsToStored,
} from './ratings.ts';

const HEADER = 'league,teamName,playerName,position,Fraud,GlobalRank';

/** Champion-pool files carry a team's values only on its first player row. */
const FILLED_DOWN = [
  HEADER,
  'LCK,BNK FEARX,Clear,top,0,13',
  ',,Raptor,jng,,',
  ',,VicLa,mid,,',
  'LCK,Gen.G,Kiin,top,1.5,2',
  ',,Canyon,jng,,',
].join('\n');

describe('ratingKeys', () => {
  it('adds an alphanumeric-only key when punctuation is present', () => {
    expect(ratingKeys('Gen.G')).toEqual(['gen.g', 'geng']);
  });

  it('emits a single key when there is nothing to strip', () => {
    expect(ratingKeys('T1')).toEqual(['t1']);
  });
});

describe('parseRatingsCsv', () => {
  it('carries a team down its blank rows', () => {
    const { ratings, teamsRead } = parseRatingsCsv(FILLED_DOWN);
    expect(teamsRead).toBe(2);
    expect(lookupRating(ratings, 'BNK FEARX')).toMatchObject({ globalRank: 13, fraud: 0 });
    expect(lookupRating(ratings, 'Gen.G')).toMatchObject({ globalRank: 2, fraud: 1.5 });
  });

  it('matches the casing Oracle uses, not the casing the ratings file uses', () => {
    const { ratings } = parseRatingsCsv(FILLED_DOWN);
    // The file says `BNK FEARX`; the match data says `BNK FearX`.
    expect(lookupRating(ratings, 'BNK FearX')?.globalRank).toBe(13);
  });

  it('matches across punctuation differences', () => {
    const { ratings } = parseRatingsCsv(FILLED_DOWN);
    expect(lookupRating(ratings, 'GENG')?.globalRank).toBe(2);
  });

  it('returns nothing for a team the file does not list', () => {
    const { ratings } = parseRatingsCsv(FILLED_DOWN);
    expect(lookupRating(ratings, 'T1')).toBeNull();
  });

  it('treats a missing fraud value as no penalty', () => {
    const { ratings } = parseRatingsCsv([HEADER, 'LCK,T1,Doran,top,,4'].join('\n'));
    expect(lookupRating(ratings, 'T1')).toMatchObject({ globalRank: 4, fraud: 0 });
  });

  it('keeps a team whose only value is a fraud rating', () => {
    const { ratings, teamsRead } = parseRatingsCsv([HEADER, 'LCK,T1,Doran,top,2,'].join('\n'));
    expect(teamsRead).toBe(1);
    expect(lookupRating(ratings, 'T1')).toMatchObject({ globalRank: null, fraud: 2 });
  });

  it('rejects a match-data file with a message that says which file to use', () => {
    const matchData = ['gameid,league,teamname,champion,result', 'A,LCK,T1,Aatrox,1'].join('\n');
    expect(() => parseRatingsCsv(matchData)).toThrow(RatingsParseError);
    try {
      parseRatingsCsv(matchData);
    } catch (error) {
      expect((error as RatingsParseError).detail).toContain('GlobalRank');
      expect((error as RatingsParseError).detail).toContain('not the Oracle');
    }
  });

  it('reports a file that has the columns but no values', () => {
    const { teamsRead, warnings } = parseRatingsCsv([HEADER, 'LCK,T1,Doran,top,,'].join('\n'));
    expect(teamsRead).toBe(0);
    expect(warnings.join(' ')).toContain('No team carried');
  });
});

describe('round trip through storage', () => {
  it('survives being stored and reloaded', () => {
    const { ratings } = parseRatingsCsv(FILLED_DOWN);
    const stored = ratingsToStored(ratings, 'pool.csv');
    expect(stored.teams).toHaveLength(2);
    expect(stored.label).toBe('pool.csv');

    const restored = ratingsFromStored(stored);
    expect(lookupRating(restored, 'BNK FearX')?.globalRank).toBe(13);
    expect(lookupRating(restored, 'geng')?.fraud).toBe(1.5);
  });

  it('stores each team once even though it is indexed under several keys', () => {
    const { ratings } = parseRatingsCsv([HEADER, 'LCK,Gen.G,Kiin,top,1,2'].join('\n'));
    expect(ratings.size).toBe(2); // `gen.g` and `geng`
    expect(ratingsToStored(ratings, 'x.csv').teams).toHaveLength(1);
  });

  it('yields an empty map when nothing is stored', () => {
    expect(ratingsFromStored(null).size).toBe(0);
  });
});
