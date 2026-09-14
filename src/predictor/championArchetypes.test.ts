import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES_BY_ROLE,
  ARCHETYPE_LABEL,
  archetypeLabel,
  archetypeOf,
  archetypeProfileKey,
  archetypesFor,
  coveredPairs,
} from './championArchetypes.ts';
import { championClasses } from './championClasses.ts';
import { makeChampion } from '../domain/champions.ts';
import { ROLES, type Role } from '../domain/types.ts';
import classTable from './data/championClasses.json';

const champ = (name: string) => makeChampion(name)!;

describe('the archetype table', () => {
  const pairs = coveredPairs();

  it('covers every role with four archetypes', () => {
    for (const role of ROLES) {
      expect(archetypesFor(role)).toHaveLength(4);
      expect(new Set(archetypesFor(role)).size).toBe(4);
    }
  });

  it('only uses champion ids the app knows', () => {
    const known = new Set(Object.keys(classTable as Record<string, string[]>));
    const unknown = pairs.filter((pair) => !known.has(pair.championId));
    // Named rather than counted: a typo should say which id is wrong.
    expect(unknown.map((p) => `${p.role}/${p.championId}`)).toEqual([]);
  });

  it('never files one champion under two archetypes in the same role', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const { role, championId, archetype } of pairs) {
      const key = `${role}|${championId}`;
      const held = seen.get(key);
      if (held && held !== archetype) clashes.push(`${key}: ${held} and ${archetype}`);
      seen.set(key, archetype);
    }
    expect(clashes).toEqual([]);
  });

  it('only files champions under archetypes that exist for that role', () => {
    const wrong = pairs.filter(
      (pair) => !(archetypesFor(pair.role) as readonly string[]).includes(pair.archetype),
    );
    expect(wrong.map((p) => `${p.role}/${p.archetype}`)).toEqual([]);
  });

  it('gives every archetype a label and at least one champion', () => {
    for (const role of ROLES) {
      for (const archetype of archetypesFor(role)) {
        expect(ARCHETYPE_LABEL[archetype]).toBeTruthy();
        const members = pairs.filter((p) => p.role === role && p.archetype === archetype);
        expect(members.length).toBeGreaterThan(0);
      }
    }
  });

  it('gives every role a usable number of champions', () => {
    for (const role of ROLES) {
      const inRole = pairs.filter((p) => p.role === role);
      expect(inRole.length).toBeGreaterThanOrEqual(30);
    }
  });
});

describe('archetypeOf', () => {
  it('reads a champion differently in different roles', () => {
    // The whole reason the table is keyed on the pair.
    expect(archetypeOf('top', champ('Camille'))).toBe('splitPusher');
    expect(archetypeOf('support', champ('Camille'))).toBe('playmaking');
    expect(archetypeOf('mid', champ('Swain'))).toBe('mage');
    expect(archetypeOf('bot', champ('Swain'))).toBe('mageBot');
  });

  it('places the examples the taxonomy was specified with', () => {
    expect(archetypeOf('support', champ('Pyke'))).toBe('playmaking');
    expect(archetypeOf('jungle', champ('Lee Sin'))).toBe('ganker');
    expect(archetypeOf('jungle', champ('Sejuani'))).toBe('tank');
    expect(archetypeOf('mid', champ('Zed'))).toBe('assassin');
    expect(archetypeOf('bot', champ('Jinx'))).toBe('hypercarry');
    expect(archetypeOf('bot', champ('Ziggs'))).toBe('mageBot');
    expect(archetypeOf('top', champ('Ornn'))).toBe('frontline');
    expect(archetypeOf('top', champ('Jayce'))).toBe('rangedTop');
  });

  it('returns null rather than guessing for an uncovered pair', () => {
    // Nobody is putting Ornn in the bot lane; the table says nothing and so
    // should the read.
    expect(archetypeOf('bot', champ('Ornn'))).toBeNull();
    expect(archetypeOf('support', champ('Azir'))).toBeNull();
  });

  it('agrees with the class table on what exists', () => {
    // Not a claim that the taxonomies match — only that a champion named here
    // is a champion the rest of the app can render.
    for (const { championId } of coveredPairs()) {
      expect(championClasses({ id: championId, name: championId }).length).toBeGreaterThan(0);
    }
  });
});

describe('labels and keys', () => {
  it('labels read as plain english', () => {
    expect(archetypeLabel('splitPusher')).toBe('split pusher');
    expect(archetypeLabel('tank')).toBe('tank / support');
    expect(archetypeLabel('tankOpener')).toBe('tank / opener');
    expect(archetypeLabel('mageBot')).toBe('mage bot');
  });

  it('keys a profile case-insensitively per role', () => {
    expect(archetypeProfileKey('Faker', 'mid')).toBe(archetypeProfileKey('faker', 'mid'));
    expect(archetypeProfileKey('Faker', 'mid')).not.toBe(archetypeProfileKey('Faker', 'top'));
  });

  it('declares an archetype set for every role the app has', () => {
    expect(Object.keys(ARCHETYPES_BY_ROLE).sort()).toEqual([...ROLES].sort() as Role[]);
  });
});
