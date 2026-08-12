import { describe, expect, it } from 'vitest';
import { championIdFromName, championInitials, makeChampion } from './champions.ts';

describe('championIdFromName', () => {
  it('passes through simple names', () => {
    expect(championIdFromName('Aatrox')).toBe('Aatrox');
    expect(championIdFromName('Zeri')).toBe('Zeri');
  });

  it('joins multi-word names', () => {
    expect(championIdFromName('Miss Fortune')).toBe('MissFortune');
    expect(championIdFromName('Lee Sin')).toBe('LeeSin');
    expect(championIdFromName('Twisted Fate')).toBe('TwistedFate');
    expect(championIdFromName('Jarvan IV')).toBe('JarvanIV');
    expect(championIdFromName('Dr. Mundo')).toBe('DrMundo');
  });

  it('keeps inner capitals where Data Dragon does', () => {
    expect(championIdFromName("Rek'Sai")).toBe('RekSai');
    expect(championIdFromName("Kog'Maw")).toBe('KogMaw');
    expect(championIdFromName("K'Sante")).toBe('KSante');
  });

  it('handles the irregular keys', () => {
    expect(championIdFromName("Kai'Sa")).toBe('Kaisa');
    expect(championIdFromName("Kha'Zix")).toBe('Khazix');
    expect(championIdFromName("Vel'Koz")).toBe('Velkoz');
    expect(championIdFromName("Cho'Gath")).toBe('Chogath');
    expect(championIdFromName("Bel'Veth")).toBe('Belveth');
    expect(championIdFromName('LeBlanc')).toBe('Leblanc');
    expect(championIdFromName('Wukong')).toBe('MonkeyKing');
    expect(championIdFromName('Nunu & Willump')).toBe('Nunu');
    expect(championIdFromName('Renata Glasc')).toBe('Renata');
  });

  it('treats typographic apostrophes the same as straight ones', () => {
    expect(championIdFromName('Kai’Sa')).toBe('Kaisa');
    expect(championIdFromName('Cho’Gath')).toBe('Chogath');
  });

  it('returns an empty id for unusable input', () => {
    expect(championIdFromName('   ')).toBe('');
    expect(championIdFromName('!!!')).toBe('');
  });
});

describe('makeChampion', () => {
  it('keeps the display name and derives the asset id', () => {
    expect(makeChampion("Kai'Sa")).toEqual({ id: 'Kaisa', name: "Kai'Sa" });
  });

  it('returns null for blank names', () => {
    expect(makeChampion('')).toBeNull();
    expect(makeChampion('   ')).toBeNull();
  });

  it('memoizes by display name', () => {
    expect(makeChampion('Ahri')).toBe(makeChampion('Ahri'));
  });
});

describe('championInitials', () => {
  it('uses the first letter of the first two words', () => {
    expect(championInitials({ id: 'MissFortune', name: 'Miss Fortune' })).toBe('MF');
    expect(championInitials({ id: 'Kaisa', name: "Kai'Sa" })).toBe('KS');
    expect(championInitials({ id: 'Ahri', name: 'Ahri' })).toBe('AH');
  });
});
