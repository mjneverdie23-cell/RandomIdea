#!/usr/bin/env node
/**
 * Runs a complete bot-vs-bot match with no renderer.
 *
 *   node tools/headless-match.js [--seed 123] [--verbose] [--rounds 24] [--speed]
 *
 * This is the fastest way to check that a gameplay change did not break the
 * round loop: it exercises buy phases, combat, planting, defusing, side
 * switching and the match win condition end to end.
 */
import { GameManager } from '../src/core/GameManager.js';
import { GameEvents } from '../src/core/events/GameEvents.js';
import { SimConfig, RoundPhase } from '../src/config/gameplay.config.js';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : true;
};

const seed = Number(flag('seed', SimConfig.seed));
const verbose = Boolean(flag('verbose', false));
const maxMinutes = Number(flag('minutes', 90));

const game = new GameManager({ withLocalPlayer: false, seed });
const rounds = [];
let sideSwitches = 0;

game.bus.on(GameEvents.ROUND_ENDED, ({ roundNumber, winningTeamId, reason, scores }) => {
  const sides = game.teams.describeSides();
  rounds.push({ roundNumber, winningTeamId, reason, scores: { ...scores }, sides });
  const scoreLine = Object.entries(scores).map(([team, value]) => `${team}:${value}`).join('  ');
  console.log(
    `round ${String(roundNumber).padStart(2)} | winner ${winningTeamId.padEnd(8)} | ${reason.padEnd(22)} | ${scoreLine}` +
    ` | ${sides.TEAM_ONE === 'ATTACKERS' ? 'T1 attacking' : 'T2 attacking'}`,
  );
});
game.bus.on(GameEvents.SIDES_SWITCHED, ({ roundNumber }) => {
  sideSwitches += 1;
  console.log(`--- sides switched after ${roundNumber} completed rounds ---`);
});
game.bus.on(GameEvents.MATCH_ENDED, ({ winningTeamId, reason, score }) => {
  console.log(`\nMATCH OVER: ${winningTeamId ?? 'DRAW'} (${reason})  final score ${JSON.stringify(score)}`);
});

if (verbose) {
  game.bus.on(GameEvents.BOMB_PLANTED, ({ character, siteId }) => console.log(`   bomb planted at ${siteId} by ${character.name}`));
  game.bus.on(GameEvents.BOMB_DEFUSED, ({ character }) => console.log(`   bomb defused by ${character.name}`));
  game.bus.on(GameEvents.KILL_FEED, (p) => console.log(`   ${p.attackerName} [${p.weaponId}${p.headshot ? ' HS' : ''}] ${p.victimName}`));
}

const dt = SimConfig.fixedDelta;
const maxTicks = Math.round(maxMinutes * 60 * SimConfig.tickRate);
const started = Date.now();

game.start();
let ticks = 0;
while (ticks < maxTicks && game.round.phase !== RoundPhase.MATCH_END) {
  game.tick(dt);
  ticks += 1;
}

const wallClock = (Date.now() - started) / 1000;
const simMinutes = (ticks * dt / 60).toFixed(1);
console.log(`\nsimulated ${rounds.length} rounds in ${simMinutes} in-game minutes (${wallClock.toFixed(1)}s wall clock, ${ticks} ticks)`);
console.log(`side switches: ${sideSwitches}`);

const reasons = rounds.reduce((acc, r) => { acc[r.reason] = (acc[r.reason] ?? 0) + 1; return acc; }, {});
console.log('round end reasons:', reasons);

const scoreboard = game.world.characters
  .map((c) => ({ name: c.name, team: c.teamId, cls: c.classId, k: c.score.kills, d: c.score.deaths, a: c.score.assists, plants: c.score.plants, defuses: c.score.defuses, money: c.money }))
  .sort((a, b) => b.k - a.k);
console.table(scoreboard);

if (game.round.phase !== RoundPhase.MATCH_END) {
  console.error('WARNING: match did not reach MATCH_END within the tick budget');
  process.exitCode = 1;
}
