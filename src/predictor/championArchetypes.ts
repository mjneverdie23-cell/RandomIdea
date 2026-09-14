/**
 * Role-scoped draft archetypes.
 *
 * The champion-class table next door answers "what kind of champion is this" in
 * Riot's terms — Fighter, Mage, Tank. Useful, but blunt for reading a draft: it
 * calls Camille a Fighter whether she is split-pushing top or making picks from
 * support, and it puts Ziggs and Orianna in the same bucket when a Ziggs bot
 * lane is a completely different plan from an Orianna mid.
 *
 * So this is a second, narrower taxonomy keyed on the **pair** — role plus
 * champion — with four archetypes per role:
 *
 *   top       split pusher · frontline · ranged top · bruiser
 *   jungle    ganker · tempo · carry · tank/support
 *   mid       mage · assassin · skirmisher · utility
 *   bot       mage bot · hypercarry · spellcaster · utility
 *   support   buff · tank/opener · utility · playmaking
 *
 * Like the matchup graph and the class table, this is a statement about how
 * champions are drafted rather than something results reveal, so it ships as a
 * static table. A champion played somewhere the table does not cover — an
 * off-role pick, or one added since — simply has no archetype, and everything
 * downstream treats that as "no read" rather than guessing.
 *
 * Reported only. It annotates the per-lane breakdown and never moves a score.
 */

import type { Champion, Role } from '../domain/types.ts';
import table from './data/championArchetypes.json';

export const ARCHETYPES_BY_ROLE = {
  top: ['splitPusher', 'frontline', 'rangedTop', 'bruiser'],
  jungle: ['ganker', 'tempo', 'carry', 'tank'],
  mid: ['mage', 'assassin', 'skirmisher', 'utility'],
  bot: ['mageBot', 'hypercarry', 'spellcaster', 'utility'],
  support: ['buff', 'tankOpener', 'utility', 'playmaking'],
} as const satisfies Record<Role, readonly string[]>;

export type Archetype = (typeof ARCHETYPES_BY_ROLE)[Role][number];

/** Display names. Keyed by archetype id, which is unique across roles. */
export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  splitPusher: 'split pusher',
  frontline: 'frontline',
  rangedTop: 'ranged top',
  bruiser: 'bruiser',
  buff: 'buff',
  tankOpener: 'tank / opener',
  ganker: 'ganker',
  tempo: 'tempo',
  carry: 'carry',
  tank: 'tank / support',
  mage: 'mage',
  assassin: 'assassin',
  skirmisher: 'skirmisher',
  utility: 'utility',
  mageBot: 'mage bot',
  hypercarry: 'hypercarry',
  spellcaster: 'spellcaster',
  playmaking: 'playmaking',
};

type RawTable = Record<string, Record<string, string[]>>;

/**
 * Flattened to `role|championId -> archetype` once at module load.
 *
 * The file is authored as role -> archetype -> champions because that is how
 * the question is actually asked ("which junglers are gankers?"); lookups want
 * the inverse.
 */
const INDEX: Map<string, Archetype> = (() => {
  const index = new Map<string, Archetype>();
  for (const [role, groups] of Object.entries(table as unknown as RawTable)) {
    if (role.startsWith('_')) continue;
    for (const [archetype, champions] of Object.entries(groups)) {
      for (const id of champions) index.set(`${role}|${id}`, archetype as Archetype);
    }
  }
  return index;
})();

/**
 * Key for a player's profile in a given role.
 *
 * Lives here rather than in `derive.ts` so the engine can look a profile up
 * without importing the model builder — `derive.ts` already imports the engine,
 * and the dependency is deliberately one-way.
 */
export function archetypeProfileKey(player: string, role: Role): string {
  return `${player.toLowerCase()}|${role}`;
}

/** The archetype this champion plays as in this role, or `null` if uncovered. */
export function archetypeOf(role: Role, champion: Champion): Archetype | null {
  return INDEX.get(`${role}|${champion.id}`) ?? null;
}

/** Archetypes available in a role, in the order they are defined. */
export function archetypesFor(role: Role): readonly Archetype[] {
  return ARCHETYPES_BY_ROLE[role];
}

export function archetypeLabel(archetype: Archetype): string {
  return ARCHETYPE_LABEL[archetype] ?? archetype;
}

/** Every (role, champion) pair covered — used by the table's own tests. */
export function coveredPairs(): { role: Role; championId: string; archetype: Archetype }[] {
  return [...INDEX.entries()].map(([key, archetype]) => {
    const [role = '', championId = ''] = key.split('|');
    return { role: role as Role, championId, archetype };
  });
}
