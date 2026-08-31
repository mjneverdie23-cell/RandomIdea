import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, advance, place, aimAt, collectEvents, pauseRounds } from './helpers.js';
import { GameEvents } from '../src/core/events/GameEvents.js';
import { HitZone } from '../src/core/world/World.js';
import { CombatConfig } from '../src/config/gameplay.config.js';

function duel({ shooterClass = 'RANGER', targetClass = 'RANGER', distance = 10, weapon = 'rifle_ranger' } = {}) {
  const game = createTestGame();
  const shooter = game.addPlayer({ name: 'A', classId: shooterClass, teamId: 'TEAM_ONE' });
  const target = game.addPlayer({ name: 'B', classId: targetClass, teamId: 'TEAM_TWO' });
  place(shooter, 0, -66);
  place(target, 0, -66 + distance);
  shooter.inventory.giveWeapon(weapon);
  pauseRounds(game);
  advance(game, 1.2);
  aimAt(shooter, target);
  return { game, shooter, target };
}

test('a hitscan shot damages the target it is aimed at', () => {
  const { game, shooter, target } = duel();
  const before = target.health.health;
  game.combat.applyDamage({ target, attacker: shooter, amount: 25, source: 'test' });
  assert.ok(target.health.health < before, 'health dropped');
  assert.equal(target.health.health, before - 25, 'unarmoured damage is applied in full');
});

test('headshots multiply damage, legs reduce it', () => {
  const { game, shooter, target } = duel();
  const weapon = shooter.inventory.activeWeapon;
  const baseline = target.health.health;
  game.combat.applyDamage({
    target, attacker: shooter, amount: weapon.def.damage * weapon.def.headshotMultiplier,
    hitZone: HitZone.HEAD, isHeadshot: true, source: weapon.id,
  });
  const headshotDamage = baseline - target.health.health;
  assert.ok(headshotDamage > weapon.def.damage, 'a headshot hurts more than a body shot');
  assert.ok(CombatConfig.hitZones.LEGS.damageMultiplier < 1, 'leg shots are reduced');
});

test('armour absorbs damage and is consumed', () => {
  const { game, shooter, target } = duel();
  target.health.armor = 100;
  const healthBefore = target.health.health;
  game.combat.applyDamage({ target, attacker: shooter, amount: 50, armorPenetration: 0.7, source: 'test' });
  const taken = healthBefore - target.health.health;
  assert.ok(taken < 50, `armour reduced the damage (${taken.toFixed(1)} of 50)`);
  assert.ok(target.health.armor < 100, 'armour was consumed');
});

test('damage falls off with distance', () => {
  const close = duel({ distance: 5 });
  const far = duel({ distance: 78 });
  const weapon = close.shooter.inventory.activeWeapon;

  const closeMultiplier = close.game.combat._falloffMultiplier(weapon, 5);
  const farMultiplier = far.game.combat._falloffMultiplier(weapon, 78);
  assert.equal(closeMultiplier, 1, 'no falloff inside the effective range');
  assert.ok(farMultiplier < 1, 'damage drops at long range');
  assert.ok(farMultiplier >= weapon.def.falloffMinMultiplier, 'falloff never goes below the floor');
});

test('class stats change how much damage is dealt and taken', () => {
  const tank = duel({ targetClass: 'TANK' });
  const assassin = duel({ targetClass: 'ASSASSIN' });
  tank.game.combat.applyDamage({ target: tank.target, attacker: tank.shooter, amount: 100, source: 'test' });
  assassin.game.combat.applyDamage({ target: assassin.target, attacker: assassin.shooter, amount: 100, source: 'test' });

  const tankTaken = tank.target.stats.maxHealth - tank.target.health.health - tank.target.health.armor * 0;
  const assassinTaken = assassin.target.stats.maxHealth - assassin.target.health.health;
  assert.ok(assassinTaken > 0 && tankTaken > 0);
  assert.ok(
    assassin.target.health.health / assassin.target.stats.maxHealth <
    tank.target.health.health / tank.target.stats.maxHealth,
    'the tank survives the same hit better than the assassin',
  );
});

test('lethal damage kills, emits events and credits the attacker', () => {
  const { game, shooter, target } = duel();
  const deaths = collectEvents(game.bus, GameEvents.CHARACTER_DIED);
  const feed = collectEvents(game.bus, GameEvents.KILL_FEED);

  game.combat.applyDamage({ target, attacker: shooter, amount: 500, source: 'rifle_ranger' });
  assert.ok(!target.health.alive, 'target died');
  assert.equal(deaths.length, 1);
  assert.equal(deaths[0].victim, target);
  assert.equal(deaths[0].attacker, shooter);
  assert.equal(shooter.score.kills, 1);
  assert.equal(target.score.deaths, 1);
  assert.equal(feed.length, 1, 'kill feed was notified');
});

test('friendly fire is off by default', () => {
  const game = createTestGame();
  const a = game.addPlayer({ name: 'A', classId: 'RANGER', teamId: 'TEAM_ONE' });
  const b = game.addPlayer({ name: 'B', classId: 'RANGER', teamId: 'TEAM_ONE' });
  pauseRounds(game);
  place(a, 0, -66);
  place(b, 0, -62);
  const before = b.health.health;
  game.combat.applyDamage({ target: b, attacker: a, amount: 100, source: 'test' });
  assert.equal(b.health.health, before, 'teammates take no damage');
});

test('shooting is blocked while combat is disabled (freeze time)', () => {
  const { game, shooter } = duel();
  game.combat.combatEnabled = false; // what RoundManager does during the buy phase
  const fired = collectEvents(game.bus, GameEvents.WEAPON_FIRED);
  shooter.intent.fire = true;
  advance(game, 0.5);
  assert.equal(fired.length, 0, 'no shots during freeze time');
});

test('real shots travel, hit a character in the line of fire and can kill them', () => {
  const { game, shooter, target } = duel({ distance: 12, weapon: 'rifle_ranger' });
  const hits = collectEvents(game.bus, GameEvents.WEAPON_HIT);
  shooter.intent.fire = true;
  advance(game, 3);
  shooter.intent.fire = false;
  const characterHits = hits.filter((hit) => hit.target === target);
  assert.ok(characterHits.length > 0, `bullets connected (${characterHits.length} hits)`);
  assert.ok(!target.health.alive, 'sustained accurate fire is lethal');
});

test('walls block shots', () => {
  const game = createTestGame();
  const shooter = game.addPlayer({ name: 'A', classId: 'RANGER', teamId: 'TEAM_ONE' });
  const target = game.addPlayer({ name: 'B', classId: 'RANGER', teamId: 'TEAM_TWO' });
  // Opposite sides of the solid block between mid and A long.
  place(shooter, 0, -20);
  place(target, 46, -20);
  shooter.inventory.giveWeapon('rifle_ranger');
  pauseRounds(game);
  advance(game, 1.2);
  aimAt(shooter, target);
  assert.ok(!game.world.hasLineOfSight(shooter, target), 'the wall blocks line of sight');

  const healthBefore = target.health.health;
  shooter.intent.fire = true;
  advance(game, 1.5);
  assert.equal(target.health.health, healthBefore, 'no damage through the wall');
});

test('grenades explode after their fuse and damage everyone nearby', () => {
  const game = createTestGame();
  const thrower = game.addPlayer({ name: 'A', classId: 'RANGER', teamId: 'TEAM_ONE' });
  const victim = game.addPlayer({ name: 'B', classId: 'RANGER', teamId: 'TEAM_TWO' });
  place(thrower, 0, -66, { yaw: Math.PI });
  place(victim, 0, -58);
  thrower.inventory.addGrenade('eq_frag');
  pauseRounds(game);
  advance(game, 0.5);

  const explosions = collectEvents(game.bus, GameEvents.GRENADE_EXPLODED);
  const healthBefore = victim.health.health;
  thrower.intent.throwGrenade = true;
  advance(game, 4);

  assert.equal(explosions.length, 1, 'the grenade went off');
  assert.ok(victim.health.health < healthBefore, 'the blast hurt the nearby enemy');
  assert.equal(thrower.inventory.grenadeCount('eq_frag'), 0, 'the grenade was consumed');
});
