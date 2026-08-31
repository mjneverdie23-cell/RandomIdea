/**
 * Audio.
 *
 * PLACEHOLDER IMPLEMENTATION: with no sound files shipped, every cue is a short
 * synthesised tone described in audio.config.js. Give a cue a `src` and it
 * plays that file instead - no other code changes.
 *
 * Cues are mapped to game events in `_bindEvents`, so adding a sound to an
 * existing event is a two-line change.
 */
import { AudioConfig } from '../config/audio.config.js';
import { GameEvents } from '../core/events/GameEvents.js';

export class AudioManager {
  constructor({ bus, game, config = AudioConfig }) {
    this.bus = bus;
    this.game = game;
    this.config = config;
    this.context = null;
    this.master = null;
    this.buffers = new Map();
    this.enabled = true;
    this._warned = new Set();

    this._bindEvents();
  }

  /** Must be called from a user gesture (browsers block audio otherwise). */
  async unlock() {
    if (this.context) return;
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) { this.enabled = false; return; }
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = this.config.masterVolume;
    this.master.connect(this.context.destination);
    await this.context.resume();
    await this._preloadFiles();
  }

  async _preloadFiles() {
    const entries = Object.entries(this.config.cues).filter(([, cue]) => cue.src);
    await Promise.all(entries.map(async ([id, cue]) => {
      try {
        const response = await fetch(cue.src);
        const data = await response.arrayBuffer();
        this.buffers.set(id, await this.context.decodeAudioData(data));
      } catch (error) {
        console.warn(`[audio] failed to load ${cue.src}`, error);
      }
    }));
  }

  /**
   * Plays a cue.
   * @param {string} cueId
   * @param {{position?: object, volume?: number}} options position enables distance falloff
   */
  play(cueId, { position = null, volume = 1 } = {}) {
    if (!this.enabled || !this.context) return;
    const cue = this.config.cues[cueId];
    if (!cue) {
      if (!this._warned.has(cueId)) {
        this._warned.add(cueId);
        console.warn(`[audio] no cue registered for "${cueId}"`);
      }
      return;
    }

    let gainValue = (cue.volume ?? 1) * (this.config.categories[cue.category] ?? 1) * volume;
    if (position) gainValue *= this._distanceAttenuation(position);
    if (gainValue <= 0.001) return;

    const gain = this.context.createGain();
    gain.gain.value = gainValue;
    gain.connect(this.master);

    const buffer = this.buffers.get(cueId);
    if (buffer) {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start();
      return;
    }

    // PLACEHOLDER tone.
    const synth = cue.synth ?? { type: 'sine', freq: 440, duration: 0.1 };
    const oscillator = this.context.createOscillator();
    oscillator.type = synth.type;
    oscillator.frequency.value = synth.freq;
    const now = this.context.currentTime;
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + synth.duration);
    oscillator.connect(gain);
    oscillator.start(now);
    oscillator.stop(now + synth.duration + 0.02);
  }

  _distanceAttenuation(position) {
    const listener = this.game.localPlayer;
    if (!listener) return 1;
    const dx = listener.position.x - position.x;
    const dz = listener.position.z - position.z;
    const distance = Math.hypot(dx, dz);
    const falloffStart = 6;
    const falloffEnd = 70;
    if (distance <= falloffStart) return 1;
    if (distance >= falloffEnd) return 0;
    return 1 - (distance - falloffStart) / (falloffEnd - falloffStart);
  }

  _bindEvents() {
    const bus = this.bus;
    bus.on(GameEvents.WEAPON_FIRED, ({ weapon, origin }) =>
      this.play(`weapon.fire.${weapon.category}`, { position: origin }));
    bus.on(GameEvents.WEAPON_DRY_FIRE, ({ character }) =>
      this.play('weapon.dryfire', { position: character.position }));
    bus.on(GameEvents.WEAPON_RELOAD_STARTED, ({ character }) =>
      this.play('weapon.reload', { position: character.position }));
    bus.on(GameEvents.WEAPON_SWITCHED, ({ character }) =>
      this.play('weapon.switch', { position: character.position }));

    bus.on(GameEvents.CHARACTER_DAMAGED, ({ target, attacker, isHeadshot }) => {
      this.play('hit.flesh', { position: target.position });
      if (attacker === this.game.localPlayer) this.play(isHeadshot ? 'hit.headshot' : 'hit.marker');
      if (target === this.game.localPlayer) this.play('character.hurt');
    });
    bus.on(GameEvents.CHARACTER_DIED, ({ victim }) =>
      this.play('character.death', { position: victim.position }));

    bus.on(GameEvents.ABILITY_USED, ({ character }) =>
      this.play('ability.use', { position: character.position }));
    bus.on(GameEvents.GRENADE_EXPLODED, ({ position }) =>
      this.play('grenade.explode', { position }));

    bus.on(GameEvents.BOMB_PLANTED, ({ position }) => this.play('bomb.plant', { position }));
    bus.on('bomb:beep', ({ position }) => this.play('bomb.beep', { position }));
    bus.on(GameEvents.BOMB_DEFUSED, () => this.play('bomb.defused'));
    bus.on(GameEvents.BOMB_EXPLODED, ({ position }) => this.play('bomb.explode', { position }));

    bus.on(GameEvents.ROUND_PHASE_CHANGED, ({ phase }) => {
      if (phase === 'LIVE') this.play('round.start');
    });
    bus.on(GameEvents.ROUND_ENDED, ({ winningTeamId }) => {
      const player = this.game.localPlayer;
      if (!player) return;
      this.play(winningTeamId === player.teamId ? 'round.win' : 'round.loss');
    });
    bus.on(GameEvents.MATCH_ENDED, () => this.play('match.win'));
    bus.on(GameEvents.ITEM_PURCHASED, () => this.play('ui.buy'));
    bus.on(GameEvents.PURCHASE_REJECTED, () => this.play('ui.error'));
  }
}
