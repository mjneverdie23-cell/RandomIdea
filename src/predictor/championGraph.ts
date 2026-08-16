/**
 * Champion matchup reference — who counters whom, and who plays well together.
 *
 * This is the one input the predictor cannot derive from match results: a
 * counter relationship is a statement about champion design, not something a
 * win/loss column reveals at the sample sizes pro play provides. It ships as a
 * static table, regenerated with `scripts/build-champion-graph.mjs`, and is
 * keyed by the app's champion id so source spelling drift can't break lookups.
 *
 * It is editable reference data, not ground truth — used only to annotate the
 * per-lane breakdown, never to move a team's score.
 */

import { makeChampion } from '../domain/champions.ts';
import type { Champion } from '../domain/types.ts';
import type { ChampionEdges } from './types.ts';
import graph from './data/championGraph.json';

const GRAPH = graph as Record<string, ChampionEdges>;

export function championEdges(champion: Champion): ChampionEdges | null {
  return GRAPH[champion.id] ?? null;
}

/** Resolve ids from the graph back into champion references for rendering. */
export function championsFromIds(ids: readonly string[]): Champion[] {
  const out: Champion[] = [];
  for (const id of ids) {
    const entry = GRAPH[id];
    const champion = makeChampion(entry?.name ?? id);
    if (champion) out.push(champion);
  }
  return out;
}

/**
 * Restrict a champion's counter/synergy lists to champions actually on the
 * board — a counter nobody picked is noise, not a scouting note.
 */
export function relevantEdges(
  champion: Champion,
  sameSide: readonly Champion[],
  opposing: readonly Champion[],
): { counters: Champion[]; counteredBy: Champion[]; synergy: Champion[] } {
  const edges = championEdges(champion);
  if (!edges) return { counters: [], counteredBy: [], synergy: [] };

  const opposingIds = new Set(opposing.map((c) => c.id));
  const alliedIds = new Set(sameSide.filter((c) => c.id !== champion.id).map((c) => c.id));

  return {
    counters: championsFromIds(edges.counters.filter((id) => opposingIds.has(id))),
    counteredBy: championsFromIds(edges.counteredBy.filter((id) => opposingIds.has(id))),
    synergy: championsFromIds(edges.synergy.filter((id) => alliedIds.has(id))),
  };
}

export function graphSize(): number {
  return Object.keys(GRAPH).length;
}
