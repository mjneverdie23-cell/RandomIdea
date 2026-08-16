import { describe, expect, it } from 'vitest';
import { assetKey, teamFileSlug } from '../../scripts/lib/assetNames.mjs';
import { assetKey as appAssetKey } from './assetKeys.ts';
import { teamLogoUrl } from './teams.ts';

/**
 * The downloader names files, the app looks them up. They live in different
 * module systems and can't share code without extra build config, so this
 * suite is the contract between them: if the two `assetKey` implementations
 * ever drift, every team logo silently disappears — these tests fail instead.
 */
const TEAM_NAMES = [
  'T1',
  'Gen.G',
  'Hanwha Life Esports',
  'Dplus KIA',
  'OKSavingsBank BRION',
  'Bilibili Gaming',
  'JD Gaming',
  "Anyone's Legend",
  'Anyone’s Legend',
  'G2 Esports',
  'MAD Lions KOI',
  '100 Thieves',
  'Cloud9',
  'Shopify Rebellion',
  'Leviatán Esports',
  'Fukuoka SoftBank Hawks gaming',
  'CTBC Flying Oyster',
];

describe('assetKey', () => {
  it('agrees between the fetch script and the app', () => {
    for (const name of TEAM_NAMES) {
      expect(appAssetKey(name)).toBe(assetKey(name));
    }
  });

  it('strips punctuation, case and spacing', () => {
    expect(appAssetKey('Gen.G')).toBe('geng');
    expect(appAssetKey('100 Thieves')).toBe('100thieves');
    expect(appAssetKey('JD Gaming')).toBe('jdgaming');
  });

  it('folds both apostrophe styles onto the same key', () => {
    expect(appAssetKey("Anyone's Legend")).toBe(appAssetKey('Anyone’s Legend'));
  });

  it('strips diacritics so accented names still match', () => {
    expect(appAssetKey('Leviatán Esports')).toBe('leviatanesports');
  });
});

describe('teamFileSlug', () => {
  it('produces readable, unique file names', () => {
    expect(teamFileSlug('Gen.G')).toBe('gen-g');
    expect(teamFileSlug('100 Thieves')).toBe('100-thieves');
    expect(teamFileSlug("Anyone's Legend")).toBe('anyones-legend');
    expect(teamFileSlug('T1')).toBe('t1');
  });

  it('never emits leading or trailing separators', () => {
    for (const name of TEAM_NAMES) {
      const slug = teamFileSlug(name);
      expect(slug).not.toMatch(/^-|-$/);
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe('teamLogoUrl', () => {
  it('returns null for a team with no downloaded logo', () => {
    // Behavioural, so it holds whether or not `npm run assets` has been run.
    expect(teamLogoUrl('Definitely Not A Real Organization')).toBeNull();
  });

  it('resolves to a path under the public assets folder when present', () => {
    const url = teamLogoUrl('T1');
    if (url !== null) expect(url).toMatch(/^\/assets\/teams\/.+\.png$/);
  });
});
