/**
 * Dinosaur class picker.
 *
 * Cards are generated from CLASS_DEFINITIONS, so adding a class to the config
 * makes it selectable here automatically.
 */
import { CLASS_DEFINITIONS } from '../config/classes.config.js';
import { getAbilityDefinition } from '../config/abilities.config.js';

export class ClassSelectUI {
  constructor({ root, game, onSelect }) {
    this.game = game;
    this.onSelect = onSelect;
    this.element = document.createElement('div');
    this.element.className = 'overlay';
    this.element.id = 'class-select';
    this.element.innerHTML = `
      <div class="panel interactive">
        <h2>Choose your dinosaur</h2>
        <div class="subtitle">Class can be changed during any buy phase. Each class has its own shop.</div>
        <div class="classes"></div>
        <button class="button" data-action="close">Confirm</button>
      </div>`;
    root.appendChild(this.element);

    this.element.addEventListener('click', (event) => {
      const card = event.target.closest('.class-card');
      if (card) {
        this.game.setLocalPlayerClass(card.dataset.classId);
        this.render();
        return;
      }
      if (event.target.dataset.action === 'close') this.toggle(false);
    });
    this.render();
  }

  toggle(force) {
    const next = force ?? !this.element.classList.contains('show');
    this.element.classList.toggle('show', next);
    if (next) this.render();
    else this.onSelect?.();
    return next;
  }

  render() {
    const current = this.game.localPlayer?.classId;
    this.element.querySelector('.classes').innerHTML = Object.values(CLASS_DEFINITIONS).map((definition) => `
      <button class="class-card ${definition.id === current ? 'selected' : ''}" data-class-id="${definition.id}">
        <h3>${definition.displayName}</h3>
        <div class="role">${definition.role} - ${definition.species}</div>
        <div class="desc">${definition.description}</div>
        <div class="stat"><span>Health</span><span>${definition.stats.maxHealth}</span></div>
        <div class="stat"><span>Speed</span><span>${definition.stats.moveSpeed.toFixed(1)}</span></div>
        <div class="stat"><span>Armour</span><span>${definition.stats.startingArmor}/${definition.stats.maxArmor}</span></div>
        <div class="stat"><span>Damage taken</span><span>x${definition.stats.damageTakenMultiplier}</span></div>
        <div class="abilities">${definition.abilities.map((id) => getAbilityDefinition(id)?.displayName ?? id).join(' - ')}</div>
      </button>`).join('');
  }
}
