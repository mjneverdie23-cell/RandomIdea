/**
 * Teams and sides.
 *
 * A *team* is persistent (it keeps its score and roster all match); a *side*
 * (attackers/defenders) is a role that swaps at halftime. Every other system
 * asks TeamManager which side a team is on rather than assuming it, which is
 * what makes the side switch a one-line operation.
 */
import { Side, TeamId } from '../../config/gameplay.config.js';
import { GameEvents } from '../events/GameEvents.js';

export class TeamManager {
  constructor({ bus, names = { TEAM_ONE: 'Raptors', TEAM_TWO: 'Titans' } } = {}) {
    this.bus = bus;
    this.teams = {
      [TeamId.TEAM_ONE]: {
        id: TeamId.TEAM_ONE, name: names.TEAM_ONE, side: Side.ATTACKERS,
        score: 0, lossStreak: 0, members: [],
      },
      [TeamId.TEAM_TWO]: {
        id: TeamId.TEAM_TWO, name: names.TEAM_TWO, side: Side.DEFENDERS,
        score: 0, lossStreak: 0, members: [],
      },
    };
  }

  get all() { return Object.values(this.teams); }

  get(teamId) { return this.teams[teamId] ?? null; }

  sideOf(teamId) { return this.teams[teamId]?.side ?? null; }

  teamOnSide(side) { return this.all.find((team) => team.side === side) ?? null; }

  teamIdOnSide(side) { return this.teamOnSide(side)?.id ?? null; }

  isAttacker(character) { return this.sideOf(character.teamId) === Side.ATTACKERS; }
  isDefender(character) { return this.sideOf(character.teamId) === Side.DEFENDERS; }

  addMember(character, teamId) {
    const team = this.teams[teamId];
    if (!team) throw new Error(`Unknown team: ${teamId}`);
    character.teamId = teamId;
    if (!team.members.includes(character)) team.members.push(character);
    return team;
  }

  removeMember(character) {
    for (const team of this.all) {
      const index = team.members.indexOf(character);
      if (index >= 0) team.members.splice(index, 1);
    }
  }

  membersOf(teamId, { aliveOnly = false } = {}) {
    const members = this.teams[teamId]?.members ?? [];
    return aliveOnly ? members.filter((m) => m.health.alive) : [...members];
  }

  membersOnSide(side, { aliveOnly = false } = {}) {
    const team = this.teamOnSide(side);
    return team ? this.membersOf(team.id, { aliveOnly }) : [];
  }

  aliveCount(teamId) { return this.membersOf(teamId, { aliveOnly: true }).length; }

  /** Swaps attacker/defender roles between the two teams. Scores are untouched. */
  switchSides(roundNumber = 0) {
    for (const team of this.all) {
      team.side = team.side === Side.ATTACKERS ? Side.DEFENDERS : Side.ATTACKERS;
    }
    this.bus?.emit(GameEvents.SIDES_SWITCHED, { roundNumber, sides: this.describeSides() });
  }

  describeSides() {
    return Object.fromEntries(this.all.map((team) => [team.id, team.side]));
  }

  describe() {
    return this.all.map((team) => ({
      id: team.id, name: team.name, side: team.side, score: team.score,
      lossStreak: team.lossStreak, alive: this.aliveCount(team.id), size: team.members.length,
    }));
  }
}
