import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, advance, place, DT } from './helpers.js';
import { WeaponFactory } from '../src/core/weapons/WeaponFactory.js';
import { WEAPON_DEFINITIONS } from '../src/config/weapons.config.js';
import { GameEvents } from '../src/core/events/GameEvents.js';

test('every weapon definition is complete enough to instantiate', () => {
  for (const [id, definition] of Object.entries(WEAPON_DEFINITIONS)) {
    assert.equal(definition.id, id, `${id} declares a matching id`);
    const weapon = WeaponFactory.create(id);
    assert.ok(weapon.def.damage > 0, `${id} deals damage`);
    assert.ok(weapon.def.fireRate > 0, `${id} has a fire rate`);
    assert.ok(weapon.def.range > 0, `${id} has a range`);
    assert.ok(definition.falloffEnd >= definition.falloffStart, `${id} has a sane falloff curve`);
  }
});

test('class restrictions gate which weapons can be used', () => {
  assert.ok(WeaponFactory.isAllowedForClass('sniper_longneck', 'SNIPER'));
  assert.ok(!WeaponFactory.isAllowedForClass('sniper_longneck', 'TANK'));
  assert.ok(WeaponFactory.isAllowedForClass('lmg_thunder', 'TANK'));
  assert.ok(!WeaponFactory.isAllowedForClass('lmg_thunder', 'ASSASSIN'));
  assert.ok(WeaponFactory.isAllowedForClass('pistol_scav', 'RANGER'), 'every class can hold a sidearm');
});

test('automatic fire respects the fire rate and drains the magazine', () => {
  const game = createTestGame();
  const shooter = game.addPlayer({ name: 'Shooter', classId: 'RANGER', teamId: 'TEAM_ONE' });
  place(shooter, 0, -66, { yaw: Math.PI });
  shooter.inventory.giveWeapon('rifle_ranger');
  game.combat.combatEnabled = true;

  const weapon = shooter.inventory.activeWeapon;
  advance(game, weapon.def.equipTime + 0.1);
  const shots = [];
  game.bus.on(GameEvents.WEAPON_FIRED, () => shots.push(game.world.time));

  shooter.intent.fire = true;
  advance(game, 1);
  shooter.intent.fire = false;

  const expected = weapon.def.fireRate / 60;
  assert.ok(Math.abs(shots.length - expected) <= 2, `fired ~${expected} rounds in a second (got ${shots.length})`);
  assert.equal(weapon.ammoInMag, weapon.def.magSize - shots.length, 'ammo matches shots fired');
});

test('semi-automatic weapons need the trigger released between shots', () => {
  const game = createTestGame();
  const shooter = game.addPlayer({ name: 'Semi', classId: 'SNIPER', teamId: 'TEAM_ONE' });
  place(shooter, 0, -66);
  // pistol_scav is semi-auto at 400 rpm, so one cycle is well inside the window.
  shooter.inventory.giveWeapon('pistol_scav');
  shooter.inventory.equipSlot('secondary');
  advance(game, 1.2);

  let fired = 0;
  game.bus.on(GameEvents.WEAPON_FIRED, () => { fired += 1; });
  shooter.intent.fire = true;
  advance(game, 1.0);
  assert.equal(fired, 1, 'holding the trigger only fires once');

  shooter.intent.fire = false;
  advance(game, 0.2);
  shooter.intent.fire = true;
  advance(game, 0.2);
  assert.equal(fired, 2, 'releasing and pulling again fires a second shot');
});

test('reloading refills from reserve and takes the configured time', () => {
  const game = createTestGame();
  const shooter = game.addPlayer({ name: 'Reloader', classId: 'RANGER', teamId: 'TEAM_ONE' });
  place(shooter, 0, -66);
  shooter.inventory.giveWeapon('rifle_ranger');
  const weapon = shooter.inventory.activeWeapon;
  advance(game, 1);

  weapon.ammoInMag = 10;
  const reserveBefore = weapon.reserveAmmo;
  shooter.intent.reload = true;
  advance(game, 0.1);
  assert.ok(weapon.reloading, 'reload started');
  advance(game, weapon.def.reloadTime);
  assert.equal(weapon.ammoInMag, weapon.def.magSize, 'magazine is full');
  assert.equal(weapon.reserveAmmo, reserveBefore - 20, 'reserve paid for the refill');
});

test('recoil accumulates while firing and recovers afterwards', () => {
  const game = createTestGame();
  const shooter = game.addPlayer({ name: 'Sprayer', classId: 'RANGER', teamId: 'TEAM_ONE' });
  place(shooter, 0, -66);
  shooter.inventory.giveWeapon('rifle_ranger');
  const weapon = shooter.inventory.activeWeapon;
  advance(game, 1);

  shooter.intent.fire = true;
  advance(game, 0.6);
  const peak = weapon.recoilPitch;
  assert.ok(peak > 0.5, `recoil built up (${peak.toFixed(2)} degrees)`);
  assert.ok(peak <= weapon.def.recoil.maxVertical, 'recoil is capped');

  shooter.intent.fire = false;
  advance(game, 2);
  assert.ok(weapon.recoilPitch < 0.01, 'recoil recovered');
});

test('spread grows when moving and shrinks when crouched or aiming', () => {
  const game = createTestGame();
  const shooter = game.addPlayer({ name: 'Spread', classId: 'RANGER', teamId: 'TEAM_ONE' });
  place(shooter, 0, -66);
  shooter.inventory.giveWeapon('rifle_ranger');
  const weapon = shooter.inventory.activeWeapon;
  advance(game, 1);

  const still = game.combat.computeSpread(shooter, weapon);
  shooter.intent.moveForward = 1;
  advance(game, 1);
  const moving = game.combat.computeSpread(shooter, weapon);
  assert.ok(moving > still, 'moving is less accurate');

  shooter.intent.moveForward = 0;
  advance(game, 1);
  shooter.intent.aim = true;
  const aiming = game.combat.computeSpread(shooter, weapon);
  assert.ok(aiming < still, 'aiming is more accurate');
});

test('weapon switching swaps slots and applies the equip delay', () => {
  const game = createTestGame();
  const character = game.addPlayer({ name: 'Switcher', classId: 'RANGER', teamId: 'TEAM_ONE' });
  place(character, 0, -66);
  character.inventory.giveWeapon('rifle_ranger');
  advance(game, 1);

  character.intent.switchToSlot = 'secondary';
  advance(game, DT * 2);
  assert.equal(character.inventory.activeSlot, 'secondary');
  assert.ok(character.inventory.activeWeapon.equipRemaining > 0, 'the draw animation is running');
  assert.ok(!character.inventory.activeWeapon.canFire(), 'cannot fire mid-draw');
  advance(game, 1);
  assert.ok(character.inventory.activeWeapon.canFire(), 'can fire once drawn');
});
