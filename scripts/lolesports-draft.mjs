#!/usr/bin/env node
/**
 * Pull the league, teams, series and draft of a live pro game from LoL Esports
 * and print it as the JSON the Predictor's "Paste matches" box accepts.
 *
 *   npm run draft:live                          what is live now, with drafts
 *   npm run draft:live -- --watch               keep polling; print each new game once
 *   npm run draft:live -- --watch --gold        ...and the gold/kills line every poll
 *   npm run draft:live -- --league lck,lpl      only these leagues (slug or name)
 *   npm run draft:live -- --recent              recently finished matches, to test with
 *   npm run draft:live -- --match <id> [--game 2]   one match, any state
 *   npm run draft:live -- --copy                also copy the paste to the clipboard
 *   npm run draft:live -- --out draft.json      also write the paste to a file
 *   npm run draft:live -- --json                print only the paste (for piping)
 *
 * Team names are matched to your own data (`data/<year>.json`, written by the
 * app when it runs with `npm run dev`) so the Predictor finds their records.
 * Fix any it can't match in `scripts/lolesports-aliases.json`.
 *
 * Test version: the feeds are the ones lolesports.com uses, not a documented
 * API, and may change. See `scripts/lib/lolesports.mjs`.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API_BASE,
  API_KEY,
  FEED_BASE,
  buildPasteMatch,
  chooseGame,
  competitionFor,
  liveMatches,
  pasteText,
  readEventDetails,
  readWindow,
  recentMatches,
  teamsFromSeasons,
} from './lib/lolesports.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Overridable so the script can run against a mirror, a proxy or a recorded mock.
const API = process.env.LOLESPORTS_API_BASE ?? API_BASE;
const FEED = process.env.LOLESPORTS_FEED_BASE ?? FEED_BASE;
const ALIAS_PATH = path.join(ROOT, 'scripts/lolesports-aliases.json');

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = { leagues: [], every: 20 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => inline ?? argv[++i];
    switch (flag) {
      case '--watch': args.watch = true; break;
      case '--gold': args.gold = true; break;
      case '--recent': args.recent = true; break;
      case '--copy': args.copy = true; break;
      case '--json': args.json = true; break;
      case '--league': args.leagues = String(value()).split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--match': args.match = String(value()); break;
      case '--game': args.game = Number(value()); break;
      case '--stage': args.stage = String(value()); break;
      case '--out': args.out = String(value()); break;
      case '--data': args.data = String(value()); break;
      case '--every': args.every = Math.max(10, Number(value()) || 20); break;
      case '--help': case '-h': args.help = true; break;
      default:
        throw new Error(`Unknown option ${arg}. Try --help.`);
    }
  }
  return args;
}

const HELP = `Pull a live pro game's draft from LoL Esports for the DraftCall Predictor.

  --watch            keep polling; print each new game's draft once
  --every <sec>      poll interval for --watch (default 20, minimum 10)
  --gold             with --watch, print the gold/kills line for live games every poll
  --league <list>    only these leagues, by slug or name: lck,lpl,lec,lck_challengers_league
  --recent           list recently finished matches (ids to try with --match)
  --match <id>       read one match, live or finished
  --game <n>         with --match, the game number (default: live game, else last finished)
  --stage <text>     stage to send when the feed doesn't say (e.g. playoffs)
  --copy             copy the paste to the clipboard
  --out <file>       write the paste to a file
  --json             print only the paste JSON
  --data <dir>       your data folder for team-name matching (default ./data)
`;

/* ------------------------------------------------------------------ */
/* Network                                                             */
/* ------------------------------------------------------------------ */

async function getJson(url, { apiKey = false } = {}) {
  const headers = apiKey ? { 'x-api-key': process.env.LOLESPORTS_API_KEY ?? API_KEY } : {};
  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  } catch (cause) {
    throw new Error(`Could not reach ${new URL(url).host} (${cause?.cause?.code ?? cause?.message ?? cause}).`);
  }
  // The livestats feed answers 204 until a game has loaded.
  if (response.status === 204 || response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `${new URL(url).host} refused the request (${response.status}). Either the site's public key was ` +
        'rotated (set LOLESPORTS_API_KEY to the new one) or a firewall/proxy on this network blocks the host.',
    );
  }
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status} for ${url}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const api = (endpoint, params = {}) =>
  getJson(`${API}/${endpoint}?${new URLSearchParams({ hl: 'en-US', ...params })}`, { apiKey: true });

const feedWindow = (gameId) => getJson(`${FEED}/window/${gameId}`);

/* ------------------------------------------------------------------ */
/* Local files                                                         */
/* ------------------------------------------------------------------ */

async function loadKnownTeams(dir) {
  const folder = path.resolve(ROOT, dir ?? 'data');
  let files;
  try {
    files = (await readdir(folder)).filter((file) => /^\d{4}\.json$/.test(file)).sort().reverse();
  } catch {
    return { known: [], folder, files: [] };
  }
  const seasons = [];
  for (const file of files) {
    try {
      seasons.push(JSON.parse(await readFile(path.join(folder, file), 'utf8')));
    } catch {
      // A half-written or foreign file is skipped rather than fatal.
    }
  }
  return { known: teamsFromSeasons(seasons), folder, files };
}

async function loadAliases() {
  try {
    const parsed = JSON.parse(await readFile(ALIAS_PATH, 'utf8'));
    return Object.fromEntries(Object.entries(parsed.teams ?? {}).filter(([key]) => !key.startsWith('_')));
  } catch {
    return {};
  }
}

function copyToClipboard(text) {
  const candidates =
    process.platform === 'darwin'
      ? [['pbcopy', []]]
      : process.platform === 'win32'
        ? [['clip', []]]
        : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  return new Promise((resolve) => {
    const attempt = (index) => {
      if (index >= candidates.length) return resolve(false);
      const [command, args] = candidates[index];
      const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] });
      child.on('error', () => attempt(index + 1));
      child.on('close', (code) => (code === 0 ? resolve(true) : attempt(index + 1)));
      child.stdin.end(text);
    };
    attempt(0);
  });
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

const ROLES = ['top', 'jungle', 'mid', 'bot', 'support'];
const pad = (text, width) => String(text ?? '').padEnd(width);
const signed = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString()}`;

function printDraft(match, draft, warnings, summary) {
  const score = match.score ? ` (${match.blue.team} ${match.score[0]}–${match.score[1]} ${match.red.team})` : '';
  console.log('');
  console.log(
    `${match.competition ?? '?'}${match.stage ? ` · ${match.stage}` : ''} · ${match.series ?? '?'} · ` +
      `Game ${match.game}${score}${draft.patch ? ` · patch ${draft.patch}` : ''}`,
  );
  console.log(`  ${pad('', 8)}${pad(`BLUE  ${match.blue.team}`, 34)}RED  ${match.red.team}`);
  for (const role of ROLES) {
    const cell = (side, which) =>
      side[role] ? `${side[role]}${draft[which].players[role] ? ` (${draft[which].players[role]})` : ''}` : '—';
    console.log(`  ${pad(role, 8)}${pad(cell(match.blue, 'blue'), 34)}${cell(match.red, 'red')}`);
  }
  if (summary) console.log(`  ${summary}`);
  for (const warning of warnings) console.log(`  ! ${warning}`);
}

function liveLine(match, draft) {
  const live = draft.live;
  if (!live || live.gold[0] === null || live.gold[1] === null) return null;
  const diff = live.gold[0] - live.gold[1];
  const leader = diff >= 0 ? match.blue.team : match.red.team;
  const when = live.at ? new Date(live.at).toLocaleTimeString() : '';
  return (
    `live ${when}: ${leader} ${signed(Math.abs(diff))}g · kills ${live.kills[0]}–${live.kills[1]} · ` +
    `towers ${live.towers[0]}–${live.towers[1]}${live.state && live.state !== 'in_game' ? ` · ${live.state}` : ''}`
  );
}

/* ------------------------------------------------------------------ */
/* One game                                                            */
/* ------------------------------------------------------------------ */

async function pullGame({ matchId, gameNumber = null, listing = null, context }) {
  const details = readEventDetails(await api('getEventDetails', { id: matchId }));
  if (!details) return { status: 'no-match' };
  const game = chooseGame(details, gameNumber);
  if (!game) return { status: 'no-game', details };

  const codes = Object.fromEntries(details.teams.map((team) => [team.id, team.code]));
  const draft = readWindow(await feedWindow(game.id), codes);
  if (!draft) return { status: 'no-draft', details, game };

  const { match, warnings } = buildPasteMatch({
    details,
    game,
    draft,
    // The game's own frames date it best; the listing's start time is the series'.
    startTime: draft.live?.at ?? listing?.startTime ?? null,
    blockName: context.stage ?? listing?.blockName ?? null,
    known: context.known,
    aliases: context.aliases,
  });
  return { status: 'ok', details, game, draft, match, warnings };
}

async function deliver(matches, args) {
  if (matches.length === 0) return;
  const text = pasteText(matches);
  if (args.json) {
    console.log(text);
  } else {
    console.log('\nPaste into Predictor → "Paste matches":\n');
    console.log(text);
  }
  if (args.out) {
    await writeFile(path.resolve(process.cwd(), args.out), `${text}\n`);
    if (!args.json) console.log(`\nWritten to ${args.out}`);
  }
  if (args.copy) {
    const copied = await copyToClipboard(text);
    if (!args.json) console.log(copied ? '\nCopied to the clipboard.' : '\nCould not reach a clipboard tool — copy it from above.');
  }
}

/* ------------------------------------------------------------------ */
/* Modes                                                               */
/* ------------------------------------------------------------------ */

async function showLive(args, context, seen = null) {
  const live = liveMatches(await api('getLive'), args.leagues);
  const pasted = [];
  if (live.length === 0 && !seen && !args.json) {
    console.log(`Nothing live${args.leagues.length ? ` in ${args.leagues.join(', ')}` : ''} right now.`);
    console.log('Try --recent to test on a finished match, or --watch to wait for the next one.');
  }
  for (const listing of live) {
    const [a, b] = listing.teams;
    const label = `${competitionFor(listing.league)} · ${a?.name} ${a?.wins}–${b?.wins} ${b?.name} (BO${listing.bestOf ?? '?'})`;
    const result = await pullGame({ matchId: listing.matchId, listing, context });

    if (result.status !== 'ok') {
      const why =
        result.status === 'no-draft'
          ? `game ${result.game.number}: draft not in the feed yet (it appears once the game loads)`
          : 'between games';
      // While watching, say it once per state rather than every poll.
      const key = `${listing.matchId}|${result.status}|${result.game?.id ?? ''}`;
      if (!args.json && (!seen || !seen.has(key))) {
        console.log(`\n${label}: ${why}.`);
        seen?.add(key);
      }
      continue;
    }
    const firstTime = !seen || !seen.has(result.game.id);
    if (firstTime) {
      if (!args.json) printDraft(result.match, result.draft, result.warnings, liveLine(result.match, result.draft));
      else for (const warning of result.warnings) console.error(`! ${warning}`);
      pasted.push(result.match);
      seen?.add(result.game.id);
    } else if (args.gold && !args.json) {
      const line = liveLine(result.match, result.draft);
      if (line) console.log(`${result.match.blue.team} vs ${result.match.red.team} G${result.game.number} — ${line}`);
    }
  }
  await deliver(pasted, args);
}

async function showRecent(args) {
  const found = [];
  let pageToken = null;
  for (let page = 0; page < 4 && found.length < 10; page += 1) {
    const json = await api('getSchedule', pageToken ? { pageToken } : {});
    found.push(...recentMatches(json, args.leagues, 10 - found.length));
    pageToken = json?.data?.schedule?.pages?.older ?? null;
    if (!pageToken) break;
  }
  if (found.length === 0) {
    console.log('No finished matches found in the schedule pages read.');
    return;
  }
  console.log('Recently finished — try one with --match <id> [--game n]:\n');
  for (const event of found) {
    const [a, b] = event.teams;
    console.log(
      `  ${pad(event.matchId, 20)} ${pad(String(event.startTime).slice(0, 10), 11)} ${pad(competitionFor(event.league), 12)}` +
        `${a?.name} ${a?.wins}–${b?.wins} ${b?.name}${event.blockName ? `  (${event.blockName})` : ''}`,
    );
  }
}

/**
 * The match's listing — round name and start time — which the match details
 * don't carry. Live first, then a few pages of the schedule; `null` if it is
 * older than that, and the stage is then whatever `--stage` says.
 */
async function findListing(matchId) {
  const live = liveMatches(await api('getLive')).find((event) => event.matchId === matchId);
  if (live) return live;
  let pageToken = null;
  for (let page = 0; page < 3; page += 1) {
    const json = await api('getSchedule', pageToken ? { pageToken } : {});
    const events = json?.data?.schedule?.events ?? [];
    const hit = events.find((event) => String(event?.match?.id ?? '') === matchId);
    if (hit) return { matchId, startTime: hit.startTime ?? null, blockName: hit.blockName ?? null };
    pageToken = json?.data?.schedule?.pages?.older ?? null;
    if (!pageToken) break;
  }
  return null;
}

async function showMatch(args, context) {
  const listing = await findListing(args.match).catch(() => null);
  const result = await pullGame({
    matchId: args.match,
    gameNumber: Number.isFinite(args.game) ? args.game : null,
    listing,
    context,
  });
  if (result.status === 'no-match') throw new Error(`No match with id ${args.match}.`);
  if (result.status === 'no-game') {
    const numbers = result.details.games.map((g) => `${g.number} (${g.state})`).join(', ');
    throw new Error(`No such game in that match. Games: ${numbers}.`);
  }
  if (result.status === 'no-draft') {
    throw new Error(`Game ${result.game.number} (${result.game.state}) has no draft in the feed — not started, or no live stats kept for it.`);
  }
  if (!args.json) printDraft(result.match, result.draft, result.warnings, liveLine(result.match, result.draft));
  // With --json, stdout is the paste alone; warnings still reach the terminal.
  else for (const warning of result.warnings) console.error(`! ${warning}`);
  await deliver([result.match], args);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const { known, folder, files } = await loadKnownTeams(args.data);
  const aliases = await loadAliases();
  const context = { known, aliases, stage: args.stage ?? null };
  if (!args.json && !args.recent) {
    console.log(
      known.length > 0
        ? `Matching team names against ${known.length} teams in ${path.relative(process.cwd(), folder) || folder}/ (${files.join(', ')}).`
        : `No data folder at ${folder} — team names are sent as LoL Esports spells them. Run the app with "npm run dev" and import your CSV to create it.`,
    );
  }

  if (args.recent) return showRecent(args);
  if (args.match) return showMatch(args, context);
  if (!args.watch) return showLive(args, context);

  const seen = new Set();
  console.log(`Watching${args.leagues.length ? ` ${args.leagues.join(', ')}` : ' all leagues'} every ${args.every}s. Ctrl+C to stop.`);
  const tick = async () => {
    try {
      await showLive(args, context, seen);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ${error.message}`);
    }
  };
  await tick();
  setInterval(tick, args.every * 1000);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
