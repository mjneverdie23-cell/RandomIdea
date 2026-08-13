#!/usr/bin/env node
/**
 * Download champion art and team logos into `public/assets/`.
 *
 *   npm run assets              # champions + teams
 *   npm run assets -- --only=champions
 *   npm run assets -- --only=teams
 *   npm run assets -- --force   # re-download files that already exist
 *   npm run assets -- --version=15.24.1
 *
 * Sources
 *   Champions : Riot's Data Dragon (ddragon.leagueoflegends.com) — square face
 *               icons and tall loading art, for every champion in the patch.
 *   Teams     : Leaguepedia (lol.fandom.com) — the `Teams` Cargo table gives
 *               each org's logo file name, which the MediaWiki API resolves to
 *               a download URL.
 *
 * Writes `src/assets/assetManifest.json` describing what landed on disk. The
 * app reads that manifest and prefers local files, falling back to the CDN (and
 * then to initials / a monogram) for anything missing — so a partial or failed
 * run degrades instead of breaking.
 *
 * Re-runnable: existing files are skipped unless `--force`.
 */

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetKey, teamFileSlug } from './lib/assetNames.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTRAIT_DIR = path.join(ROOT, 'public/assets/champions/portrait');
const ICON_DIR = path.join(ROOT, 'public/assets/champions/icon');
const TEAM_DIR = path.join(ROOT, 'public/assets/teams');
const MANIFEST_PATH = path.join(ROOT, 'src/assets/assetManifest.json');
const TEAM_LIST_PATH = path.join(ROOT, 'scripts/teams.json');

/*
 * Endpoints are overridable so the script can run against a mirror, a corporate
 * proxy, or a local stub in tests. Defaults are the real services.
 */
const DDRAGON = process.env.DRAFTCALL_DDRAGON_BASE ?? 'https://ddragon.leagueoflegends.com';
const FANDOM_API = process.env.DRAFTCALL_FANDOM_API ?? 'https://lol.fandom.com/api.php';

/** Identify the tool to Leaguepedia, as their API terms ask. */
const USER_AGENT =
  'DraftCall-AssetFetcher/1.0 (League draft quiz; https://github.com/mjneverdie23-cell/RandomIdea)';

const CONCURRENCY = 6;
/** Leaguepedia asks for gentle pacing; one metadata call at a time. */
const FANDOM_DELAY_MS = 250;

const args = parseArgs(process.argv.slice(2));

async function main() {
  const only = args.only ?? 'all';
  await Promise.all([
    mkdir(PORTRAIT_DIR, { recursive: true }),
    mkdir(ICON_DIR, { recursive: true }),
    mkdir(TEAM_DIR, { recursive: true }),
  ]);

  const manifest = await readManifest();

  if (only === 'all' || only === 'champions') {
    const result = await fetchChampions();
    manifest.champions = result.ids;
    manifest.dataDragonVersion = result.version;
  }

  if (only === 'all' || only === 'teams') {
    manifest.teams = await fetchTeams();
  }

  manifest.generatedAt = new Date().toISOString();
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log('\nManifest written to src/assets/assetManifest.json');
  console.log(
    `  ${manifest.champions.length} champions · ${Object.keys(manifest.teams).length} team logos`,
  );
  console.log('Restart the dev server so Vite picks up the new files.');
}

/* ------------------------------------------------------------------ */
/* Champions                                                           */
/* ------------------------------------------------------------------ */

async function fetchChampions() {
  const version = args.version ?? (await latestVersion());
  console.log(`\nData Dragon ${version}`);

  const championData = await getJson(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`);
  const ids = Object.keys(championData.data ?? {}).sort();
  if (ids.length === 0) throw new Error('Data Dragon returned no champions.');
  console.log(`  ${ids.length} champions listed`);

  let downloaded = 0;
  let skipped = 0;
  const failed = [];

  await pool(ids, CONCURRENCY, async (id) => {
    const targets = [
      // Square face icon — bans and compact lists.
      { url: `${DDRAGON}/cdn/${version}/img/champion/${id}.png`, file: path.join(ICON_DIR, `${id}.png`) },
      // Tall loading art — pick cards crop this to the face.
      { url: `${DDRAGON}/cdn/img/champion/loading/${id}_0.jpg`, file: path.join(PORTRAIT_DIR, `${id}.jpg`) },
    ];

    for (const target of targets) {
      if (!args.force && (await exists(target.file))) {
        skipped += 1;
        continue;
      }
      try {
        await download(target.url, target.file);
        downloaded += 1;
      } catch (error) {
        failed.push(`${id}: ${error.message}`);
        return;
      }
    }
    process.stdout.write('.');
  });

  process.stdout.write('\n');
  console.log(`  downloaded ${downloaded}, skipped ${skipped}, failed ${failed.length}`);
  if (failed.length) console.log(`  first failures: ${failed.slice(0, 5).join('; ')}`);

  // Only list champions that ended up with both files present.
  const complete = [];
  for (const id of ids) {
    const [icon, portrait] = await Promise.all([
      exists(path.join(ICON_DIR, `${id}.png`)),
      exists(path.join(PORTRAIT_DIR, `${id}.jpg`)),
    ]);
    if (icon && portrait) complete.push(id);
  }
  return { ids: complete, version };
}

async function latestVersion() {
  const versions = await getJson(`${DDRAGON}/api/versions.json`);
  if (!Array.isArray(versions) || typeof versions[0] !== 'string') {
    throw new Error('Unexpected versions.json payload.');
  }
  return versions[0];
}

/* ------------------------------------------------------------------ */
/* Teams                                                               */
/* ------------------------------------------------------------------ */

async function fetchTeams() {
  const names = await readTeamList();
  console.log(`\nLeaguepedia team logos (${names.length} teams)`);

  const teams = {};
  let downloaded = 0;
  let skipped = 0;
  const missing = [];

  // Sequential on purpose: this is a third-party wiki API, not a CDN.
  for (const name of names) {
    const slug = teamFileSlug(name);
    const file = path.join(TEAM_DIR, `${slug}.png`);
    const key = assetKey(name);

    if (!args.force && (await exists(file))) {
      teams[key] = `${slug}.png`;
      skipped += 1;
      continue;
    }

    try {
      const url = await resolveTeamLogoUrl(name);
      if (!url) {
        missing.push(name);
        continue;
      }
      await download(url, file);
      teams[key] = `${slug}.png`;
      downloaded += 1;
      process.stdout.write('.');
    } catch (error) {
      missing.push(`${name} (${error.message})`);
    }
    await sleep(FANDOM_DELAY_MS);
  }

  process.stdout.write('\n');
  console.log(`  downloaded ${downloaded}, skipped ${skipped}, unresolved ${missing.length}`);
  if (missing.length) {
    console.log('  not found on Leaguepedia:');
    for (const name of missing) console.log(`    - ${name}`);
    console.log('  (these teams keep their monogram tag in the app)');
  }
  return teams;
}

/**
 * Team name -> logo download URL.
 *
 * The `Teams` Cargo table holds the canonical logo file name; a second call
 * resolves that file to a URL. Falls back to Leaguepedia's usual
 * `<Name>logo square.png` convention when the table has no row.
 */
async function resolveTeamLogoUrl(teamName) {
  const cargo = new URL(FANDOM_API);
  cargo.searchParams.set('action', 'cargoquery');
  cargo.searchParams.set('tables', 'Teams');
  cargo.searchParams.set('fields', 'Name,Short,Image');
  cargo.searchParams.set('where', `Teams.Name="${teamName.replace(/"/g, '\\"')}"`);
  cargo.searchParams.set('limit', '1');
  cargo.searchParams.set('format', 'json');

  let imageName = null;
  try {
    const result = await getJson(cargo.toString());
    imageName = result?.cargoquery?.[0]?.title?.Image ?? null;
  } catch {
    // Fall through to the naming convention.
  }

  const candidates = [
    imageName,
    `${teamName}logo square.png`,
    `${teamName}logo std.png`,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const url = await resolveFileUrl(candidate);
    if (url) return url;
  }
  return null;
}

async function resolveFileUrl(fileName) {
  const api = new URL(FANDOM_API);
  api.searchParams.set('action', 'query');
  api.searchParams.set('titles', `File:${fileName}`);
  api.searchParams.set('prop', 'imageinfo');
  api.searchParams.set('iiprop', 'url');
  api.searchParams.set('format', 'json');

  try {
    const result = await getJson(api.toString());
    const pages = result?.query?.pages ?? {};
    for (const page of Object.values(pages)) {
      const url = page?.imageinfo?.[0]?.url;
      if (url) return url;
    }
  } catch {
    // Treated as "not found" by the caller.
  }
  return null;
}

async function readTeamList() {
  const raw = await readFile(TEAM_LIST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const names = Array.isArray(parsed) ? parsed : parsed.teams;
  if (!Array.isArray(names)) throw new Error(`${TEAM_LIST_PATH} must contain an array of names.`);
  return [...new Set(names.map((n) => String(n).trim()).filter(Boolean))];
}

/* ------------------------------------------------------------------ */
/* Plumbing                                                            */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const parsed = { force: false };
  for (const arg of argv) {
    if (arg === '--force') parsed.force = true;
    else if (arg.startsWith('--only=')) parsed.only = arg.slice(7);
    else if (arg.startsWith('--version=')) parsed.version = arg.slice(10);
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/fetch-assets.mjs [--only=champions|teams] [--force] [--version=X.Y.Z]');
      process.exit(0);
    }
  }
  if (parsed.only && !['champions', 'teams', 'all'].includes(parsed.only)) {
    throw new Error(`--only must be champions, teams or all (got "${parsed.only}")`);
  }
  return parsed;
}

async function readManifest() {
  try {
    const raw = await readFile(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      generatedAt: parsed.generatedAt ?? null,
      dataDragonVersion: parsed.dataDragonVersion ?? null,
      champions: Array.isArray(parsed.champions) ? parsed.champions : [],
      teams: parsed.teams && typeof parsed.teams === 'object' ? parsed.teams : {},
    };
  } catch {
    return { generatedAt: null, dataDragonVersion: null, champions: [], teams: {} };
  }
}

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function getJson(url) {
  const res = await fetchWithRetry(url);
  return res.json();
}

async function download(url, file) {
  const res = await fetchWithRetry(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error('empty response');
  await writeFile(file, buffer);
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(400 * 2 ** (attempt - 1));
    }
  }
  throw lastError ?? new Error('request failed');
}

/** Run `worker` over `items` with at most `size` in flight. */
async function pool(items, size, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(`\nAsset fetch failed: ${error.message}`);
  console.error('Nothing was corrupted — re-run the command to resume; existing files are skipped.');
  process.exit(1);
});
