#!/usr/bin/env node
/**
 * Turn a champion-pool CSV into the ratings table the predictor ships with
 * (`src/predictor/data/teamRatings.json`).
 *
 * Usage:
 *   node scripts/build-team-ratings.mjs <path-to-champpool.csv> [label]
 *
 * GlobalRank and Fraud are hand-maintained judgements that appear nowhere in an
 * Oracle's Elixir export, so shipping a default set means the rank edge and the
 * fraud penalty work out of the box instead of silently scoring zero until
 * someone finds the optional import. Importing a file on the Data tab still
 * overrides this table wholesale.
 *
 * Rankings go stale as teams rise and fall — re-run this against a refreshed
 * pool file, or just import the new file in the app.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/predictor/data/teamRatings.json');

const REQUIRED = ['teamName', 'GlobalRank', 'Fraud'];

/** Minimal RFC-4180 reader: the pool file has quoted, comma-bearing cells. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const normalize = (header) =>
  header.replace(/^﻿/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const input = process.argv[2];
if (!input) {
  console.error('usage: node scripts/build-team-ratings.mjs <champpool.csv> [label]');
  process.exit(1);
}

const rows = parseCsv(readFileSync(resolve(input), 'utf8'));
const header = rows.shift();
if (!header) {
  console.error('Empty file.');
  process.exit(1);
}

const index = {};
header.forEach((name, i) => {
  index[normalize(name)] = i;
});

const missing = REQUIRED.filter((name) => index[normalize(name)] === undefined);
if (missing.length) {
  console.error(`Not a champion-pool CSV — missing column(s): ${missing.join(', ')}`);
  process.exit(1);
}

const teamAt = index[normalize('teamName')];
const rankAt = index[normalize('GlobalRank')];
const fraudAt = index[normalize('Fraud')];

const num = (value) => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

// First non-blank value per column within each team's block — the two do not
// reliably share a row.
const blocks = new Map();
const order = [];
let current = '';

for (const row of rows) {
  const name = (row[teamAt] ?? '').trim();
  if (name) current = name;
  if (!current) continue;

  const key = current.toLowerCase();
  let block = blocks.get(key);
  if (!block) {
    block = { team: current, globalRank: null, fraud: null };
    blocks.set(key, block);
    order.push(key);
  }
  if (block.globalRank === null) block.globalRank = num(row[rankAt]);
  if (block.fraud === null) block.fraud = num(row[fraudAt]);
}

const teams = order
  .map((key) => blocks.get(key))
  .filter((block) => block.globalRank !== null || block.fraud !== null)
  .map((block) => ({
    team: block.team,
    globalRank: block.globalRank,
    fraud: block.fraud ?? 0,
  }))
  .sort((a, b) => a.team.localeCompare(b.team));

const payload = {
  label: process.argv[3] ?? basename(resolve(input)),
  generatedAt: new Date().toISOString().slice(0, 10),
  teams,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(payload, null, 1)}\n`, 'utf8');

const rated = teams.filter((entry) => entry.fraud !== 0).length;
console.log(
  `Wrote ${teams.length} teams (${rated} with a non-zero fraud rating) -> ${OUT}`,
);
