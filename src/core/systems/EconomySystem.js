/**
 * Money: kill rewards, objective rewards, round-win/loss income and the
 * consecutive-loss bonus.
 *
 * The system is event-driven - it listens for kills, plants and defuses rather
 * than being called by the combat or bomb code, so those systems never need to
 * know the economy exists.
 */
import { EconomyConfig } from '../../config/gameplay.config.js';
import { getWeaponDefinition, EQUIPMENT_DEFINITIONS } from '../../config/weapons.config.js';
import { GameEvents } from '../events/GameEvents.js';

export class EconomySystem {
  constructor({ bus, teams, config = EconomyConfig }) {
    this.bus = bus;
    this.teams = teams;
    this.config = config;
    this._subscriptions = [
      bus.on(GameEvents.CHARACTER_DIED, (payload) => this._onDeath(payload)),
      bus.on(GameEvents.BOMB_PLANTED, ({ character }) => this.addMoney(character, this.config.plantReward, 'plant')),
      bus.on(GameEvents.BOMB_DEFUSED, ({ character }) => this.addMoney(character, this.config.defuseReward, 'defuse')),
    ];
  }

  dispose() { for (const off of this._subscriptions) off(); }

  addMoney(character, amount, reason = 'unknown') {
    if (!character || amount === 0) return character?.money ?? 0;
    const before = character.money;
    character.money = Math.max(0, Math.min(this.config.maxMoney, character.money + amount));
    const delta = character.money - before;
    if (delta !== 0) {
      this.bus.emit(GameEvents.MONEY_CHANGED, { character, amount: character.money, delta, reason });
    }
    return character.money;
  }

  spend(character, amount, reason = 'purchase') {
    if (character.money < amount) return false;
    this.addMoney(character, -amount, reason);
    return true;
  }

  /** Sets everyone to the configured starting money (match start / side switch). */
  grantStartingMoney(characters, amount = this.config.startingMoney) {
    for (const character of characters) {
      character.money = 0;
      this.addMoney(character, amount, 'reset');
    }
  }

  _onDeath({ victim, attacker, weaponId }) {
    if (!attacker) {
      this.addMoney(victim, this.config.suicidePenalty, 'suicide');
      return;
    }
    if (attacker === victim) {
      this.addMoney(victim, this.config.suicidePenalty, 'suicide');
      return;
    }
    if (attacker.teamId === victim.teamId) {
      this.addMoney(attacker, this.config.teamKillPenalty, 'teamkill');
      return;
    }
    const weaponDef = getWeaponDefinition(weaponId);
    const reward = weaponDef?.killReward
      ?? EQUIPMENT_DEFINITIONS[weaponId]?.grenade?.killReward
      ?? 300;
    this.addMoney(attacker, reward, 'kill');
  }

  /**
   * End-of-round income for both teams.
   * @param {{winningTeamId: string, bombPlanted: boolean, plantingTeamId: string|null}} result
   */
  awardRoundEnd({ winningTeamId, bombPlanted = false, plantingTeamId = null }) {
    for (const team of this.teams.all) {
      const won = team.id === winningTeamId;
      let amount;
      if (won) {
        amount = this.config.roundWinReward;
      } else {
        // lossStreak was incremented by MatchManager before this runs.
        const streak = Math.max(1, team.lossStreak);
        amount = Math.min(
          this.config.lossBonusMax,
          this.config.lossBonusBase + this.config.lossBonusIncrement * (streak - 1),
        );
        if (bombPlanted && team.id === plantingTeamId) amount += this.config.lossWithPlantBonus;
      }
      for (const member of team.members) {
        this.addMoney(member, amount, won ? 'roundWin' : 'roundLoss');
      }
    }
  }

  /** Extra payout for the objective, on top of the win reward. */
  awardObjectiveBonus(teamId, reason) {
    const bonus = reason === 'BOMB_DETONATED' ? this.config.bombDetonatedBonus
      : reason === 'BOMB_DEFUSED' ? this.config.bombDefusedBonus : 0;
    if (!bonus) return;
    for (const member of this.teams.membersOf(teamId)) this.addMoney(member, bonus, 'objective');
  }
}
