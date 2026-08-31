import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, place, advance } from './helpers.js';
import { PurchaseRejection } from '../src/core/systems/ShopSystem.js';
import { RoundPhase } from '../src/config/gameplay.config.js';
import { getItemDefinition } from '../src/config/weapons.config.js';

function buyPhaseGame() {
  const game = createTestGame({ teamSize: 1 });
  const attacker = game.addPlayer({ name: 'A', classId: 'RANGER', teamId: 'TEAM_ONE' });
  const defender = game.addPlayer({ name: 'D', classId: 'TANK', teamId: 'TEAM_TWO' });
  game.start();
  game.round.skipPhase();
  advance(game, 0.1); // WARMUP -> BUY
  return { game, attacker, defender };
}

test('buying inside the buy phase and buy zone works and costs money', () => {
  const { game, attacker } = buyPhaseGame();
  attacker.money = 5000;
  const result = game.shop.buy(attacker, 'rifle_ranger');
  assert.ok(result.ok, `purchase succeeded (${result.reason ?? ''})`);
  assert.equal(attacker.money, 5000 - getItemDefinition('rifle_ranger').price);
  assert.equal(attacker.inventory.getWeapon('primary').id, 'rifle_ranger');
});

test('a class cannot buy weapons outside its categories', () => {
  const { game, defender } = buyPhaseGame();
  defender.money = 16000;
  const result = game.shop.buy(defender, 'sniper_longneck'); // Tank has no SNIPER access
  assert.ok(!result.ok);
  assert.equal(result.reason, PurchaseRejection.CLASS_RESTRICTED);
});

test('too little money is rejected with a reason', () => {
  const { game, attacker } = buyPhaseGame();
  attacker.money = 100;
  const result = game.shop.buy(attacker, 'rifle_ranger');
  assert.equal(result.reason, PurchaseRejection.NOT_ENOUGH_MONEY);
  assert.equal(attacker.money, 100, 'no money was taken');
});

test('defuse kits are defenders-only', () => {
  const { game, attacker, defender } = buyPhaseGame();
  attacker.money = 5000;
  defender.money = 5000;
  assert.equal(game.shop.buy(attacker, 'eq_defuser').reason, PurchaseRejection.SIDE_RESTRICTED);
  assert.ok(game.shop.buy(defender, 'eq_defuser').ok);
  assert.ok(defender.inventory.hasDefuseKit);
});

test('buying is blocked outside the buy zone and outside the buy phase', () => {
  const { game, attacker } = buyPhaseGame();
  attacker.money = 5000;
  place(attacker, 0, 0); // middle of the map
  assert.equal(game.shop.buy(attacker, 'rifle_ranger').reason, PurchaseRejection.NOT_IN_BUY_ZONE);

  place(attacker, 0, -66);
  game.round.skipPhase();
  advance(game, 0.1);
  assert.equal(game.round.phase, RoundPhase.LIVE);
  assert.equal(game.shop.buy(attacker, 'rifle_ranger').reason, PurchaseRejection.WRONG_PHASE);
});

test('the shop listing hides gear the class can never use', () => {
  const { game, defender } = buyPhaseGame();
  defender.money = 16000;
  const listing = game.shop.listFor(defender);
  const ids = listing.flatMap((category) => category.items.map((item) => item.id));
  assert.ok(ids.includes('lmg_thunder'), 'the tank sees heavy weapons');
  assert.ok(!ids.includes('sniper_longneck'), 'the tank never sees snipers');
  assert.ok(listing.every((category) => category.items.length > 0), 'no empty categories are shown');
});

test('armour and helmets apply immediately', () => {
  const { game, attacker } = buyPhaseGame();
  attacker.money = 5000;
  attacker.health.armor = 0;
  game.shop.buy(attacker, 'eq_helmet');
  assert.equal(attacker.health.armor, attacker.health.maxArmor);
  assert.ok(attacker.health.hasHelmet);
  assert.equal(game.shop.buy(attacker, 'eq_helmet').reason, PurchaseRejection.ALREADY_OWNED);
});

test('grenades are limited by their max count', () => {
  const { game, attacker } = buyPhaseGame();
  attacker.money = 16000;
  assert.ok(game.shop.buy(attacker, 'eq_frag').ok);
  assert.ok(game.shop.buy(attacker, 'eq_frag').ok);
  assert.equal(game.shop.buy(attacker, 'eq_frag').reason, PurchaseRejection.ALREADY_OWNED);
  assert.equal(attacker.inventory.grenadeCount('eq_frag'), 2);
});
