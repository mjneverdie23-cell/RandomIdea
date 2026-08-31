/**
 * Hold-to-view scoreboard: both teams, their side, and per-player stats.
 */
export class Scoreboard {
  constructor({ root, game }) {
    this.game = game;
    this.element = document.createElement('div');
    this.element.className = 'overlay';
    this.element.id = 'scoreboard';
    this.element.innerHTML = `<div class="panel"><h2>Scoreboard</h2><div class="subtitle"></div><table></table></div>`;
    root.appendChild(this.element);
    this.table = this.element.querySelector('table');
  }

  toggle(force) {
    const next = force ?? !this.element.classList.contains('show');
    this.element.classList.toggle('show', next);
    if (next) this.render();
    return next;
  }

  render() {
    const game = this.game;
    const match = game.match.describe();
    this.element.querySelector('.subtitle').textContent =
      `Round ${match.roundNumber} - first to ${match.roundsToWin} - sides switch after round ${match.switchSidesAfterRound}`;

    const header = `<thead><tr>
      <th>Player</th><th>Class</th><th>K</th><th>D</th><th>A</th><th>DMG</th><th>Plants</th><th>Defuses</th><th>Money</th>
    </tr></thead>`;

    const body = game.teams.all.map((team) => {
      const rows = game.teams.membersOf(team.id)
        .slice()
        .sort((a, b) => b.score.kills - a.score.kills)
        .map((character) => `
          <tr class="${character.health.alive ? '' : 'dead'} ${character === game.localPlayer ? 'local' : ''}">
            <td>${character.name}${character.isBot ? ' <span style="opacity:.5">(bot)</span>' : ''}</td>
            <td>${character.classDef.displayName}</td>
            <td class="num">${character.score.kills}</td>
            <td class="num">${character.score.deaths}</td>
            <td class="num">${character.score.assists}</td>
            <td class="num">${Math.round(character.score.damageDealt)}</td>
            <td class="num">${character.score.plants}</td>
            <td class="num">${character.score.defuses}</td>
            <td class="num">$${character.money}</td>
          </tr>`).join('');
      return `<tr><td colspan="9" class="team-header ${team.id === 'TEAM_ONE' ? 'team-one' : 'team-two'}">
          ${team.name} - ${team.score} - ${team.side}
        </td></tr>${rows}`;
    }).join('');

    this.table.innerHTML = `${header}<tbody>${body}</tbody>`;
  }
}
