/**
 * Buy menu.
 *
 * The panel renders whatever ShopSystem reports for the local player, including
 * *why* an item is unavailable - so adding items or changing restrictions in
 * config needs no change here.
 */
import { GameEvents } from '../core/events/GameEvents.js';

export class ShopUI {
  constructor({ root, game }) {
    this.game = game;
    this.element = document.createElement('div');
    this.element.className = 'overlay';
    this.element.id = 'shop';
    this.element.innerHTML = `
      <div class="panel interactive">
        <h2>Loadout</h2>
        <div class="subtitle"></div>
        <div class="categories"></div>
        <div class="footer">
          <span>Click to buy - purchases are final. Press [B] or [Esc] to close.</span>
          <span class="wallet">$0</span>
        </div>
      </div>`;
    root.appendChild(this.element);
    this.categoriesNode = this.element.querySelector('.categories');
    this.element.addEventListener('click', (event) => {
      const button = event.target.closest('.shop-item');
      if (!button) return;
      this.game.shop.buy(this.game.localPlayer, button.dataset.itemId);
      this.render();
    });

    // Money can change while the menu is open (round rewards, a late kill),
    // so keep affordability in sync rather than only refreshing on purchase.
    game.bus.on(GameEvents.MONEY_CHANGED, ({ character }) => {
      if (this.isOpen && character === this.game.localPlayer) this.render();
    });
  }

  get isOpen() { return this.element.classList.contains('show'); }

  toggle(force) {
    const next = force ?? !this.isOpen;
    this.element.classList.toggle('show', next);
    if (next) this.render();
    return next;
  }

  render() {
    const player = this.game.localPlayer;
    if (!player) return;
    const categories = this.game.shop.listFor(player);

    this.element.querySelector('.subtitle').textContent =
      `${player.classDef.displayName} (${player.classDef.role}) - only gear this class can carry is shown.`;
    this.element.querySelector('.wallet').textContent = `$${player.money}`;

    this.categoriesNode.innerHTML = categories.map((category) => `
      <div class="category">
        <h3>${category.displayName}</h3>
        ${category.items.map((item) => `
          <button class="shop-item ${item.reason === 'ALREADY_OWNED' ? 'owned' : ''}"
                  data-item-id="${item.id}" ${item.available ? '' : 'disabled'}
                  title="${item.reason ?? ''}">
            ${item.name}<span class="price">$${item.price}</span>
            <span class="stats">${describeItem(item)}</span>
          </button>`).join('')}
      </div>`).join('');
  }
}

function describeItem(item) {
  if (item.stats) {
    return `dmg ${item.stats.damage} - ${item.stats.fireRate} rpm - mag ${item.stats.magSize} - ${item.stats.range}m`;
  }
  return item.description ?? '';
}
