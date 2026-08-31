/**
 * Keyboard + mouse -> Intent.
 *
 * This is the only file that knows about the DOM's input events. It writes the
 * same `intent` structure bots produce, so gameplay code stays platform-free
 * (a gamepad or a network client would slot in right here).
 */
import { InputConfig } from '../config/input.config.js';
import { WeaponSlot } from '../config/weapons.config.js';

export class BrowserInput {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.element        element to request pointer lock on
   * @param {() => object|null} deps.getPlayer
   * @param {object} deps.actions             UI callbacks (toggleShop, toggleScoreboard, ...)
   */
  constructor({ element, getPlayer, actions = {}, config = InputConfig }) {
    this.element = element;
    this.getPlayer = getPlayer;
    this.actions = actions;
    this.config = config;

    this.keys = new Set();
    this.mouseButtons = new Set();
    this.pointerLocked = false;
    this.enabled = true;
    /** Accumulated mouse movement since the last update. */
    this._deltaYaw = 0;
    this._deltaPitch = 0;

    this._bind();
  }

  _bind() {
    const onKeyDown = (event) => {
      if (event.repeat) return;
      this.keys.add(event.code);
      this._handleActionKey(event);
    };
    const onKeyUp = (event) => {
      this.keys.delete(event.code);
      if (this._matches('scoreboard', event.code)) this.actions.toggleScoreboard?.(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); });

    this.element.addEventListener('mousedown', (event) => {
      if (!this.pointerLocked) return;
      this.mouseButtons.add(event.button);
    });
    window.addEventListener('mouseup', (event) => this.mouseButtons.delete(event.button));
    this.element.addEventListener('contextmenu', (event) => event.preventDefault());

    document.addEventListener('mousemove', (event) => {
      if (!this.pointerLocked) return;
      const player = this.getPlayer();
      const weapon = player?.inventory.activeWeapon;
      const aiming = player?.intent.aim && weapon && weapon.def.adsZoom > 1;
      const sensitivity = this.config.mouse.sensitivity *
        (aiming ? this.config.mouse.adsSensitivityMultiplier / Math.max(1, weapon.def.adsZoom / 2) : 1);
      this._deltaYaw -= event.movementX * sensitivity;
      this._deltaPitch += (this.config.mouse.invertY ? 1 : -1) * event.movementY * sensitivity;
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.element;
      document.body.classList.toggle('pointer-unlocked', !this.pointerLocked);
      if (!this.pointerLocked) this.mouseButtons.clear();
      this.actions.onPointerLockChange?.(this.pointerLocked);
    });
  }

  requestPointerLock() {
    this.element.requestPointerLock?.();
  }

  _matches(action, code) {
    return (this.config.bindings[action] ?? []).includes(code);
  }

  _isDown(action) {
    return (this.config.bindings[action] ?? []).some((code) => this.keys.has(code));
  }

  /** One-shot keys (menus, slot switching, abilities). */
  _handleActionKey(event) {
    const code = event.code;
    const player = this.getPlayer();

    if (code === 'Escape') { this.actions.closeOverlays?.(); return; }
    if (this._matches('shop', code)) { event.preventDefault(); this.actions.toggleShop?.(); return; }
    if (this._matches('scoreboard', code)) { event.preventDefault(); this.actions.toggleScoreboard?.(true); return; }
    if (this._matches('toggleFreeCam', code)) { this.actions.toggleFreeCam?.(); return; }
    if (!player || !this.enabled) return;

    if (this._matches('slotPrimary', code)) player.intent.switchToSlot = WeaponSlot.PRIMARY;
    else if (this._matches('slotSecondary', code)) player.intent.switchToSlot = WeaponSlot.SECONDARY;
    else if (this._matches('slotMelee', code)) player.intent.switchToSlot = WeaponSlot.MELEE;
    else if (this._matches('slotGrenade', code)) player.intent.switchToSlot = WeaponSlot.GRENADE;
    else if (this._matches('reload', code)) player.intent.reload = true;
    else if (this._matches('grenade', code)) player.intent.throwGrenade = true;
    else if (this._matches('drop', code)) player.intent.drop = true;
    else if (this._matches('abilityPrimary', code)) player.intent.useAbility = 0;
    else if (this._matches('abilitySecondary', code)) player.intent.useAbility = 1;
  }

  /** Continuous state -> intent. Call once per rendered frame. */
  update() {
    const player = this.getPlayer();
    if (!player) return;
    const intent = player.intent;

    // Look
    intent.yaw += this._deltaYaw;
    intent.pitch = Math.max(-this.config.pitchLimit, Math.min(this.config.pitchLimit, intent.pitch + this._deltaPitch));
    this._deltaYaw = 0;
    this._deltaPitch = 0;

    if (!this.enabled) {
      intent.moveForward = 0;
      intent.moveRight = 0;
      intent.fire = false;
      intent.jump = false;
      intent.use = false;
      intent.sprint = false;
      return;
    }

    intent.moveForward = (this._isDown('moveForward') ? 1 : 0) - (this._isDown('moveBackward') ? 1 : 0);
    intent.moveRight = (this._isDown('moveRight') ? 1 : 0) - (this._isDown('moveLeft') ? 1 : 0);
    intent.jump = this._isDown('jump');
    intent.crouch = this._isDown('crouch');
    intent.sprint = this._isDown('sprint');
    intent.use = this._isDown('use');
    intent.fire = this.mouseButtons.has(this.config.mouse.fireButton);
    intent.aim = this.mouseButtons.has(this.config.mouse.aimButton);
  }

  /** Disables movement/fire while an overlay owns the mouse. */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      const player = this.getPlayer();
      if (player) {
        player.intent.fire = false;
        player.intent.moveForward = 0;
        player.intent.moveRight = 0;
      }
    }
  }
}
