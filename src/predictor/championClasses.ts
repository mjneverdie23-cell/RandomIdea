/**
 * Champion class reference — Fighter, Mage, Assassin, Marksman, Tank, Support.
 *
 * Like the matchup graph, this is a statement about champion design rather than
 * something match results reveal, so it ships as a static table keyed by the
 * app's champion id. Tags are Riot's, in Riot's order: the first is the primary
 * class, and everything after it is secondary. Ahri is `Mage, Assassin`;
 * Nocturne is `Fighter, Assassin`.
 *
 * Coverage against the 2026 export is 152 of the 153 champions actually picked.
 * The one gap was Locke, which postdates the source table; its class is stated
 * here rather than derived.
 *
 * Used to describe what a player *usually* drafts. It annotates the per-lane
 * breakdown and never moves a score — see `deriveClassProfiles` for the
 * measurement behind that decision.
 */

import type { Champion } from '../domain/types.ts';
import table from './data/championClasses.json';

/** Riot's six champion classes. */
export type ChampionClass = 'Fighter' | 'Mage' | 'Assassin' | 'Marksman' | 'Tank' | 'Support';

const CLASSES = table as Record<string, string[]>;

/** Every tag, primary first; empty when the champion is not in the table. */
export function championClasses(champion: Champion): ChampionClass[] {
  return (CLASSES[champion.id] ?? []) as ChampionClass[];
}

/**
 * The champion's primary class, or `null` when it is unknown.
 *
 * Only the primary tag is used for profiling. Secondary tags are so broad —
 * "Assassin" appears on Lucian, Vayne and Tristana — that counting them makes
 * almost every champion belong to almost every class, which tells you nothing
 * about what a player prefers.
 */
export function primaryClass(champion: Champion): ChampionClass | null {
  return championClasses(champion)[0] ?? null;
}
