/**
 * Start screen (controls + class pick entry point) and the match-end screen.
 */
import { InputConfig } from '../config/input.config.js';
import { GameEvents } from '../core/events/GameEvents.js';

export class StartScreen {
  constructor({ root, onStart, onChooseClass }) {
    this.element = document.createElement('div');
    this.element.className = 'overlay show';
    this.element.id = 'start-screen';
    this.element.innerHTML = `
      <div class="panel interactive">
        <h1>RAPTOR STRIKE</h1>
        <div class="tagline">Tactical dinosaur shooter - prototype build. Plant the bomb, or stop it.</div>
        <div class="keys">${controlRows()}</div>
        <button class="button" data-action="start">Click to play</button>
        <button class="button secondary" data-action="class">Choose class</button>
      </div>`;
    root.appendChild(this.element);
    this.element.addEventListener('click', (event) => {
      const action = event.target.dataset.action;
      if (action === 'start') { this.hide(); onStart(); }
      if (action === 'class') onChooseClass();
    });
  }

  show() { this.element.classList.add('show'); }
  hide() { this.element.classList.remove('show'); }
  get isOpen() { return this.element.classList.contains('show'); }
}

export class MatchEndScreen {
  constructor({ root, game, onRestart }) {
    this.game = game;
    this.element = document.createElement('div');
    this.element.className = 'overlay';
    this.element.id = 'match-end';
    this.element.innerHTML = `
      <div class="panel interactive">
        <div class="winner"></div>
        <div class="final-score"></div>
        <div class="summary"></div>
        <button class="button" data-action="restart">Play again</button>
      </div>`;
    root.appendChild(this.element);
    this.element.addEventListener('click', (event) => {
      if (event.target.dataset.action === 'restart') onRestart();
    });

    game.bus.on(GameEvents.MATCH_ENDED, (payload) => this.show(payload));
  }

  show({ winningTeamId, score, reason }) {
    const team = this.game.teams.get(winningTeamId);
    this.element.querySelector('.winner').textContent = team ? `${team.name} win the match` : 'Match drawn';
    this.element.querySelector('.final-score').textContent = Object.entries(score)
      .map(([teamId, value]) => `${this.game.teams.get(teamId).name} ${value}`)
      .join('   -   ');
    const rows = this.game.world.characters
      .slice()
      .sort((a, b) => b.score.kills - a.score.kills)
      .slice(0, 5)
      .map((c) => `${c.name} (${c.classDef.displayName}) ${c.score.kills}/${c.score.deaths}/${c.score.assists}`)
      .join('<br>');
    this.element.querySelector('.summary').innerHTML = `<br><b>Top fraggers</b><br>${rows}<br><br><small>${reason}</small>`;
    this.element.classList.add('show');
  }

  hide() { this.element.classList.remove('show'); }
}

function controlRows() {
  const b = InputConfig.bindings;
  const pretty = (codes) => codes.map((code) => code.replace('Key', '').replace('Digit', '').replace('Arrow', '')).join(' / ');
  return [
    ['Move', pretty(b.moveForward.concat(b.moveLeft, b.moveBackward, b.moveRight).slice(0, 4))],
    ['Jump / Crouch', `${pretty(b.jump)} / ${pretty(b.crouch)}`],
    ['Sprint', pretty(b.sprint)],
    ['Fire / Aim', 'Left mouse / Right mouse'],
    ['Reload', pretty(b.reload)],
    ['Plant, defuse, pick up bomb', `Hold ${pretty(b.use)}`],
    ['Weapon slots', `${pretty(b.slotPrimary)} ${pretty(b.slotSecondary)} ${pretty(b.slotMelee)} ${pretty(b.slotGrenade)}`],
    ['Throw grenade', pretty(b.grenade)],
    ['Abilities', `${pretty(b.abilityPrimary)} / ${pretty(b.abilitySecondary)}`],
    ['Buy menu', pretty(b.shop)],
    ['Scoreboard', pretty(b.scoreboard)],
    ['Overhead debug camera', pretty(b.toggleFreeCam)],
  ].map(([label, keys]) => `<div><b>${keys}</b> ${label}</div>`).join('');
}
