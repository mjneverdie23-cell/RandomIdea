/**
 * Shared test scaffolding: builds deterministic games without bots so a test
 * can place characters exactly where it needs them.
 */
import { GameManager } from '../src/core/GameManager.js';
import { SimConfig, RoundPhase } from '../src/config/gameplay.config.js';

export const DT = SimConfig.fixedDelta;

/** A game with no bots and (optionally) no local player. */
export function createTestGame({ seed = 42, withLocalPlayer = false, teamSize = 2 } = {}) {
  return new GameManager({ seed, withLocalPlayer, fillBots: false, teamSize });
}

/** Runs `seconds` of simulation. */
export function advance(game, seconds) {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) game.tick(DT);
  return game;
}

/** Runs until `predicate` is true or the timeout elapses. */
export function advanceUntil(game, predicate, timeoutSeconds = 60) {
  const maxTicks = Math.round(timeoutSeconds / DT);
  for (let i = 0; i < maxTicks; i++) {
    if (predicate(game)) return true;
    game.tick(DT);
  }
  return predicate(game);
}

/** Fast-forwards through warmup and the buy phase into a live round. */
export function startLiveRound(game) {
  game.start();
  advanceUntil(game, (g) => g.round.phase === RoundPhase.BUY, 30);
  game.round.skipPhase();
  advanceUntil(game, (g) => g.round.phase === RoundPhase.LIVE, 30);
  return game;
}

/**
 * Freezes round logic (no phase changes, no warmup respawns, no elimination
 * checks) so a test can study one mechanic in isolation.
 */
export function pauseRounds(game, { combatEnabled = true } = {}) {
  game.round.paused = true;
  game.combat.combatEnabled = combatEnabled;
  return game;
}

/** Places a character at a world position, facing `yaw`. */
export function place(character, x, z, { y = 0.1, yaw = 0, pitch = 0 } = {}) {
  character.spawnAt({ x, y, z }, yaw);
  character.intent.yaw = yaw;
  character.intent.pitch = pitch;
  character.pitch = pitch;
  return character;
}

/** Points `shooter` at `target`'s centre of mass. */
export function aimAt(shooter, target) {
  const from = shooter.eyePosition;
  const to = target.centerPosition;
  const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  const pitch = Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z));
  shooter.intent.yaw = yaw;
  shooter.yaw = yaw;
  shooter.intent.pitch = pitch;
  shooter.pitch = pitch;
}

export function collectEvents(bus, eventName) {
  const captured = [];
  bus.on(eventName, (payload) => captured.push(payload));
  return captured;
}
