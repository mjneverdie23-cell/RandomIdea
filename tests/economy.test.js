import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame, place, pauseRounds, collectEvents } from './helpers.js';
import { EconomyConfig } from '../src/config/gameplay.config.js';
import { GameEvents } from '../src/core/events/GameEvents.js';
import { getWeaponDefinition } from '../src/config/weapons.config.js';

function twoPlayers() {
  const game = createTestGame();
  const a = game.addPlayer({ name: 'A', classId: 'RANGER', teamId: 'TEAM_ONE' });
  const b = game.addPlayer({ name: 'B', classId: 'RANGER', teamId: 'TEAM_TWO' });
  pauseRounds(game);
  place(a, 0, -66);
  place(b, 0, -60);
  return { game, a, b };
}

test('starting money comes from the config', () => {
  const { game, a } = twoPlayers();
  game.economy.grantStartingMoney(game.world.characters);
  assert.equal(a.money, EconomyConfig.startingMoney);
});

test('money is capped and never negative', () => {
  const { game, a } = twoPlayers();
  game.economy.addMoney(a, 999999, 'test');
  assert.equal(a.money, EconomyConfig.maxMoney);
  game.economy.addMoney(a, -999999, 'test');
  assert.equal(a.money, 0);
});

test('kills pay the weapon-specific reward', () => {
  const { game, a, b } = twoPlayers();
  a.money = 0;
  game.combat.applyDamage({ target: b, attacker: a, amount: 500, source: 'shotgun_maw' });
  assert.equal(a.money, getWeaponDefinition('shotgun_maw').killReward);
});

test('team kills and suicides are punished', () => {
  const game = createTestGame();
  const a = game.addPlayer({ name: 'A', classId: 'RANGER', teamId: 'TEAM_ONE' });
  const mate = game.addPlayer({ name: 'Mate', classId: 'RANGER', teamId: 'TEAM_ONE' });
  pauseRounds(game);
  place(a, 0, -66);
  place(mate, 0, -62);
  a.money = 1000;
  // Friendly fire is off, so kill the teammate directly through the health component.
  mate.health.kill();
  game.combat._handleDeath(mate, a, 'rifle_ranger', 'CHEST', false);
  assert.equal(a.money, 1000 + EconomyConfig.teamKillPenalty);
});

test('round win pays the win reward and losses build a streak bonus', () => {
  const { game, a, b } = twoPlayers();
  a.money = 0;
  b.money = 0;

  // First loss for TEAM_TWO.
  game.teams.get('TEAM_ONE').lossStreak = 0;
  game.teams.get('TEAM_TWO').lossStreak = 1;
  game.economy.awardRoundEnd({ winningTeamId: 'TEAM_ONE', bombPlanted: false, plantingTeamId: null });
  assert.equal(a.money, EconomyConfig.roundWinReward);
  assert.equal(b.money, EconomyConfig.lossBonusBase);

  // Third consecutive loss pays more.
  b.money = 0;
  game.teams.get('TEAM_TWO').lossStreak = 3;
  game.economy.awardRoundEnd({ winningTeamId: 'TEAM_ONE', bombPlanted: false, plantingTeamId: null });
  assert.equal(b.money, EconomyConfig.lossBonusBase + EconomyConfig.lossBonusIncrement * 2);
});

test('the loss bonus is capped', () => {
  const { game, b } = twoPlayers();
  b.money = 0;
  game.teams.get('TEAM_TWO').lossStreak = 99;
  game.economy.awardRoundEnd({ winningTeamId: 'TEAM_ONE', bombPlanted: false, plantingTeamId: null });
  assert.equal(b.money, EconomyConfig.lossBonusMax);
});

test('losing after planting the bomb pays extra', () => {
  const { game, b } = twoPlayers();
  b.money = 0;
  game.teams.get('TEAM_TWO').lossStreak = 1;
  game.economy.awardRoundEnd({ winningTeamId: 'TEAM_ONE', bombPlanted: true, plantingTeamId: 'TEAM_TWO' });
  assert.equal(b.money, EconomyConfig.lossBonusBase + EconomyConfig.lossWithPlantBonus);
});

test('planting and defusing pay the individual objective rewards', () => {
  const { game, a, b } = twoPlayers();
  a.money = 0;
  b.money = 0;
  const changes = collectEvents(game.bus, GameEvents.MONEY_CHANGED);
  game.bus.emit(GameEvents.BOMB_PLANTED, { character: a, siteId: 'A', position: a.position });
  game.bus.emit(GameEvents.BOMB_DEFUSED, { character: b });
  assert.equal(a.money, EconomyConfig.plantReward);
  assert.equal(b.money, EconomyConfig.defuseReward);
  assert.ok(changes.length >= 2, 'money changes are announced for the UI');
});
