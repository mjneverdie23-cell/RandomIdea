#!/usr/bin/env node
/**
 * Turn a `champions_data_enriched.json` reference file into the compact graph
 * the predictor ships with (`src/predictor/data/championGraph.json`).
 *
 * Usage:
 *   node scripts/build-champion-graph.mjs <path-to-champions_data_enriched.json>
 *
 * Why a build step rather than reading the file at runtime: the source carries
 * splash URLs, roles and two static meta lists we deliberately do not use (the
 * predictor computes meta from actual pick rates), and it keys everything off
 * display names, which drift between spellings — `LeBlanc` vs `Leblanc`. This
 * script keeps only the matchup edges and rewrites every name to the app's
 * champion id, so a spelling change in the source can't silently break a lookup.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/predictor/data/championGraph.json');

/** Mirror of `championIdFromName` in src/domain/champions.ts. */
const IRREGULAR_IDS = {
  belveth: 'Belveth',
  chogath: 'Chogath',
  kaisa: 'Kaisa',
  khazix: 'Khazix',
  leblanc: 'Leblanc',
  velkoz: 'Velkoz',
  wukong: 'MonkeyKing',
  monkeyking: 'MonkeyKing',
  nunuwillump: 'Nunu',
  nunuandwillump: 'Nunu',
  renataglasc: 'Renata',
  fiddlesticks: 'Fiddlesticks',
  drmundo: 'DrMundo',
};

function championId(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return '';
  const key = trimmed
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (IRREGULAR_IDS[key]) return IRREGULAR_IDS[key];
  const stripped = trimmed.replace(/[^A-Za-z0-9]/g, '');
  if (!stripped) return '';
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

const input = process.argv[2];
if (!input) {
  console.error('usage: node scripts/build-champion-graph.mjs <champions_data_enriched.json>');
  process.exit(1);
}

const source = JSON.parse(readFileSync(resolve(input), 'utf8'));
const champions = Array.isArray(source) ? source : source.champions;
if (!Array.isArray(champions)) {
  console.error('Expected a `champions` array in the source file.');
  process.exit(1);
}

const known = new Set(champions.map((c) => championId(c.name)).filter(Boolean));
const graph = {};
let edges = 0;
let dropped = 0;

const ids = (names) => {
  const out = [];
  for (const name of names ?? []) {
    const id = championId(name);
    // A reference to a champion the file doesn't define is unusable — the UI
    // would have no name or art for it.
    if (!id || !known.has(id)) {
      dropped += 1;
      continue;
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
};

for (const champion of champions) {
  const id = championId(champion.name);
  if (!id) continue;
  const entry = {
    name: String(champion.name).trim(),
    counters: ids(champion.counter),
    counteredBy: ids(champion.countered_by),
    synergy: ids(champion.synergy),
  };
  edges += entry.counters.length + entry.counteredBy.length + entry.synergy.length;
  graph[id] = entry;
}

const sorted = Object.fromEntries(Object.keys(graph).sort().map((k) => [k, graph[k]]));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(sorted, null, 1)}\n`, 'utf8');

console.log(
  `Wrote ${Object.keys(sorted).length} champions, ${edges} edges -> ${OUT}` +
    (dropped ? ` (${dropped} unresolvable reference(s) dropped)` : ''),
);
