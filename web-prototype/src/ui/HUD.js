/**
 * The heads-up display.
 *
 * The HUD is a pure consumer: it reads simulation state and listens to events,
 * and never writes anything back. Every element is built here so restyling or
 * replacing a widget means touching one file (plus styles.css).
 */
import { GameEvents } from '../core/events/GameEvents.js';
import { RoundPhase, RoundEndReason, Side } from '../config/gameplay.config.js';
import { BombState } from '../core/systems/BombSystem.js';
import { InputConfig } from '../config/input.config.js';

const REASON_TEXT = {
  [RoundEndReason.BOMB_DETONATED]: 'Bomb detonated',
  [RoundEndReason.BOMB_DEFUSED]: 'Bomb defused',
  [RoundEndReason.ATTACKERS_ELIMINATED]: 'Attackers eliminated',
  [RoundEndReason.DEFENDERS_ELIMINATED]: 'Defenders eliminated',
  [RoundEndReason.TIME_EXPIRED]: 'Time expired',
};

export class HUD {
  constructor({ root, game }) {
    this.game = game;
    this.root = root;
    this.element = document.createElement('div');
    this.element.innerHTML = TEMPLATE;
    root.appendChild(this.element);

    this.$ = (selector) => this.element.querySelector(selector);
    this.killfeedEntries = [];
    this._bannerTimer = 0;
    this._hitmarkerTimer = 0;
    this._damageTimer = 0;

    this._bindEvents(game.bus);
  }

  _bindEvents(bus) {
    bus.on(GameEvents.KILL_FEED, (payload) => this.addKillFeedEntry(payload));

    bus.on(GameEvents.WEAPON_HIT, ({ character, target, isHeadshot }) => {
      if (character !== this.game.localPlayer || !target) return;
      this.showHitmarker(isHeadshot ? 'headshot' : 'hit');
    });

    bus.on(GameEvents.CHARACTER_DIED, ({ victim, attacker }) => {
      if (attacker === this.game.localPlayer && victim !== attacker) this.showHitmarker('kill');
    });

    bus.on(GameEvents.CHARACTER_DAMAGED, ({ target }) => {
      if (target === this.game.localPlayer) this.flashDamage();
    });

    bus.on(GameEvents.ROUND_ENDED, ({ winningTeamId, reason }) => {
      const team = this.game.teams.get(winningTeamId);
      const isLocalWin = this.game.localPlayer && winningTeamId === this.game.localPlayer.teamId;
      this.showBanner(
        `${team?.name ?? 'Nobody'} win the round`,
        REASON_TEXT[reason] ?? reason,
        isLocalWin ? 'var(--good)' : 'var(--danger)',
      );
    });

    bus.on(GameEvents.ROUND_PHASE_CHANGED, ({ phase }) => {
      if (phase === RoundPhase.LIVE) this.showBanner('GO!', '', 'var(--hud-text)', 1.1);
      if (phase === RoundPhase.BUY) this.hideBanner();
    });

    bus.on(GameEvents.SIDES_SWITCHED, () => {
      this.showBanner('SIDES SWITCHED', 'Second half - money reset', 'var(--attackers)', 4);
    });

    bus.on(GameEvents.PURCHASE_REJECTED, ({ character, reason }) => {
      if (character !== this.game.localPlayer) return;
      this.showBanner('Purchase failed', humanizeReason(reason), 'var(--danger)', 1.4);
    });
  }

  // ------------------------------------------------------------------ frame --
  update(dt) {
    const game = this.game;
    const player = game.localPlayer;
    const round = game.round;
    const bomb = game.bomb;

    this._updateScoreboardBar();
    this._updateClock(round);
    this._updateObjective(bomb, round);
    if (player) {
      this._updateVitals(player);
      this._updateWeapon(player);
      this._updateAbilities(player);
      this._updateInteraction(player, bomb);
      this.$('#crosshair').classList.toggle('hidden', !player.health.alive || (player.intent.aim && (player.inventory.activeWeapon?.def.adsZoom ?? 1) >= 2));
    }

    this._tickTimers(dt);
  }

  _updateScoreboardBar() {
    const teams = this.game.teams.all;
    teams.forEach((team, index) => {
      const node = this.$(index === 0 ? '#score-one' : '#score-two');
      node.querySelector('.value').textContent = team.score;
      node.querySelector('.team-name').textContent = team.name;
      node.querySelector('.side-tag').textContent = team.side === Side.ATTACKERS ? 'ATTACK' : 'DEFEND';
    });
  }

  _updateClock(round) {
    const time = round.timeRemaining;
    const label = this.$('#hud-clock .time');
    label.textContent = formatTime(time);
    label.classList.toggle('urgent', time <= 10 && round.phase === RoundPhase.LIVE);
    this.$('#hud-clock .phase').textContent = phaseLabel(round.phase);
    this.$('#hud-clock .round-number').textContent =
      round.phase === RoundPhase.WARMUP ? 'warmup' : `round ${this.game.match.roundNumber} / to ${this.game.match.roundsToWin}`;
  }

  _updateObjective(bomb, round) {
    const node = this.$('#hud-objective');
    const player = this.game.localPlayer;
    const side = player ? this.game.teams.sideOf(player.teamId) : null;
    let text = '';
    let planted = false;

    if (round.phase === RoundPhase.BUY) {
      text = `BUY PHASE - press [${keyLabel('shop')}] to open the shop`;
    } else if (round.phase === RoundPhase.WARMUP) {
      text = 'WARMUP - free roam, no scoring';
    } else if (bomb.state === BombState.PLANTED) {
      planted = true;
      text = `BOMB PLANTED AT ${bomb.siteId} - ${bomb.fuseRemaining.toFixed(1)}s`;
      if (bomb.defusing) text += ` - defusing ${(bomb.defuseProgress * 100).toFixed(0)}%`;
    } else if (bomb.state === BombState.DROPPED) {
      text = 'BOMB DROPPED';
    } else if (side === Side.ATTACKERS) {
      text = player?.inventory.hasBomb
        ? `YOU CARRY THE BOMB - reach site A or B and hold [${keyLabel('use')}]`
        : `PLANT THE BOMB - carrier: ${bomb.carrier?.name ?? 'nobody'}`;
    } else if (side === Side.DEFENDERS) {
      text = 'DEFEND BOTH SITES';
    }
    node.textContent = text;
    node.classList.toggle('planted', planted);
    node.style.display = text ? 'block' : 'none';
  }

  _updateVitals(player) {
    const health = Math.ceil(player.health.health);
    this.$('#hud-vitals .value').textContent = health;
    this.$('#hud-vitals .armor').textContent = `${Math.ceil(player.health.armor)}${player.health.hasHelmet ? ' +H' : ''}`;
    this.$('#hud-vitals .health-bar > i').style.width = `${Math.max(0, (health / player.health.maxHealth) * 100)}%`;
    this.$('#hud-vitals .class-line').textContent =
      `${player.classDef.displayName} - ${player.classDef.role}${player.health.alive ? '' : ' - DEAD (spectating)'}`;
  }

  _updateWeapon(player) {
    const weapon = player.inventory.activeWeapon;
    const ammoNode = this.$('#hud-weapon .ammo');
    if (weapon) {
      const mag = weapon.hasInfiniteAmmo ? '-' : weapon.ammoInMag;
      const reserve = weapon.hasInfiniteAmmo ? '' : ` / ${weapon.reserveAmmo}`;
      ammoNode.innerHTML = `${mag}<span class="reserve">${reserve}</span>`;
      ammoNode.classList.toggle('empty', !weapon.hasInfiniteAmmo && weapon.ammoInMag === 0);
      this.$('#hud-weapon .name').textContent = weapon.reloading ? `${weapon.displayName} - RELOADING` : weapon.displayName;
    } else {
      ammoNode.textContent = '-';
      this.$('#hud-weapon .name').textContent = 'unarmed';
    }
    this.$('#hud-weapon .money').textContent = `$${player.money}`;

    const inventory = player.inventory;
    const slotText = ['primary', 'secondary', 'melee']
      .map((slot) => {
        const item = inventory.getWeapon(slot);
        if (!item) return null;
        const active = inventory.activeSlot === slot;
        return active ? `<b>${item.displayName}</b>` : item.displayName;
      })
      .filter(Boolean)
      .join(' | ');
    const grenades = inventory.totalGrenades();
    this.$('#hud-weapon .slots').innerHTML =
      slotText + (grenades ? ` | ${grenades} nade${grenades > 1 ? 's' : ''}` : '') +
      (inventory.hasDefuseKit ? ' | KIT' : '') + (inventory.hasBomb ? ' | <b>BOMB</b>' : '');
  }

  _updateAbilities(player) {
    const container = this.$('#hud-abilities');
    const abilities = player.abilities.describe();
    if (container.childElementCount !== abilities.length) {
      container.innerHTML = abilities.map(() => '<div class="ability-chip"></div>').join('');
    }
    const keys = [keyLabel('abilityPrimary'), keyLabel('abilitySecondary')];
    abilities.forEach((ability, index) => {
      const chip = container.children[index];
      chip.classList.toggle('ready', ability.ready);
      chip.innerHTML =
        `<span class="key">${keys[index] ?? index + 1}</span>` +
        `<span class="name">${ability.name}</span>` +
        `<span class="cooldown">${ability.ready ? 'READY' : `${ability.cooldownRemaining.toFixed(1)}s`}</span>`;
    });
  }

  _updateInteraction(player, bomb) {
    const node = this.$('#interaction');
    const bar = this.$('#interaction .bar > i');
    const key = keyLabel('use');
    let show = false;
    let text = '';
    let progress = 0;

    if (bomb.planting === player) {
      show = true; text = 'PLANTING'; progress = bomb.plantProgress;
    } else if (bomb.defusing === player) {
      show = true;
      text = player.inventory.hasDefuseKit ? 'DEFUSING (kit)' : 'DEFUSING';
      progress = bomb.defuseProgress;
    } else if (bomb.canPlant(player)) {
      show = true; text = `Hold [${key}] to plant`;
    } else if (bomb.canDefuse(player)) {
      show = true; text = `Hold [${key}] to defuse`;
    } else if (bomb.canPickUp(player)) {
      show = true; text = `Hold [${key}] to pick up the bomb`;
    }

    node.classList.toggle('show', show);
    if (show) {
      this.$('#interaction .label').textContent = text;
      bar.style.width = `${progress * 100}%`;
    }
  }

  // ----------------------------------------------------------- transient UI --
  addKillFeedEntry({ attackerName, attackerTeam, victimName, victimTeam, weaponId, headshot }) {
    const feed = this.$('#killfeed');
    const entry = document.createElement('div');
    entry.className = 'entry';
    entry.innerHTML =
      `<span class="${teamClass(attackerTeam)}">${attackerName}</span> ` +
      `<span class="weapon">${weaponId}</span>${headshot ? ' <span class="hs">HS</span>' : ''} ` +
      `<span class="${teamClass(victimTeam)}">${victimName}</span>`;
    feed.prepend(entry);
    this.killfeedEntries.push({ entry, life: 6 });
    while (this.killfeedEntries.length > 6) {
      const oldest = this.killfeedEntries.shift();
      oldest.entry.remove();
    }
  }

  showHitmarker(kind) {
    const marker = this.$('#hitmarker');
    marker.classList.add('show');
    marker.classList.toggle('kill', kind === 'kill');
    this._hitmarkerTimer = kind === 'kill' ? 0.4 : 0.15;
  }

  flashDamage() {
    this.$('#damage-flash').classList.add('show');
    this._damageTimer = 0.12;
  }

  showBanner(title, reason = '', color = 'var(--hud-text)', seconds = 3.5) {
    const banner = this.$('#banner');
    banner.classList.add('show', 'hud-panel');
    banner.style.color = color;
    banner.innerHTML = `${title}<span class="reason">${reason}</span>`;
    this._bannerTimer = seconds;
  }

  hideBanner() {
    this.$('#banner').classList.remove('show');
    this._bannerTimer = 0;
  }

  _tickTimers(dt) {
    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) this.hideBanner();
    }
    if (this._hitmarkerTimer > 0) {
      this._hitmarkerTimer -= dt;
      if (this._hitmarkerTimer <= 0) this.$('#hitmarker').classList.remove('show', 'kill');
    }
    if (this._damageTimer > 0) {
      this._damageTimer -= dt;
      if (this._damageTimer <= 0) this.$('#damage-flash').classList.remove('show');
    }
    for (let i = this.killfeedEntries.length - 1; i >= 0; i--) {
      const item = this.killfeedEntries[i];
      item.life -= dt;
      if (item.life <= 0.6) item.entry.classList.add('fading');
      if (item.life <= 0) {
        item.entry.remove();
        this.killfeedEntries.splice(i, 1);
      }
    }
  }

  setDebugText(text) {
    const node = this.$('#debug');
    node.classList.toggle('show', !!text);
    node.textContent = text ?? '';
  }
}

function teamClass(teamId) {
  return teamId === 'TEAM_ONE' ? 'team-one' : teamId === 'TEAM_TWO' ? 'team-two' : '';
}

function formatTime(seconds) {
  const clamped = Math.max(0, seconds);
  const minutes = Math.floor(clamped / 60);
  const rest = Math.floor(clamped % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function phaseLabel(phase) {
  switch (phase) {
    case RoundPhase.BUY: return 'buy phase';
    case RoundPhase.LIVE: return 'live';
    case RoundPhase.ROUND_END: return 'round over';
    case RoundPhase.MATCH_END: return 'match over';
    default: return 'warmup';
  }
}

function keyLabel(action) {
  const binding = InputConfig.bindings[action]?.[0] ?? '';
  return binding.replace('Key', '').replace('Digit', '').replace('Left', ' L');
}

function humanizeReason(reason) {
  return String(reason).toLowerCase().replace(/_/g, ' ');
}

const TEMPLATE = `
  <div id="hud-top">
    <div class="hud-panel score team-one" id="score-one">
      <span class="team-name"></span><span class="value">0</span><span class="side-tag"></span>
    </div>
    <div class="hud-panel" id="hud-clock">
      <span class="time">0:00</span>
      <span class="phase">warmup</span>
      <span class="round-number"></span>
    </div>
    <div class="hud-panel score team-two" id="score-two">
      <span class="team-name"></span><span class="value">0</span><span class="side-tag"></span>
    </div>
  </div>

  <div class="hud-panel" id="hud-objective"></div>

  <div class="hud-panel" id="hud-vitals">
    <div class="row"><span class="value">100</span><span class="label">HP</span>
      <span class="armor">0</span><span class="label">ARMOR</span></div>
    <div class="health-bar"><i style="width:100%"></i></div>
    <div class="class-line"></div>
  </div>

  <div class="hud-panel" id="hud-weapon">
    <div class="ammo">-</div>
    <div class="name">unarmed</div>
    <div class="money">$0</div>
    <div class="slots"></div>
  </div>

  <div id="hud-abilities"></div>
  <div id="killfeed"></div>

  <div id="crosshair"><i class="h"></i><i class="v"></i></div>
  <div id="hitmarker"><i class="h" style="left:0;right:0;height:2px;top:8px"></i><i class="v" style="top:0;bottom:0;width:2px;left:8px"></i></div>

  <div class="hud-panel" id="interaction">
    <div class="label"></div>
    <div class="bar"><i></i></div>
  </div>

  <div id="banner"></div>
  <div id="damage-flash"></div>
  <div id="debug"></div>
`;
