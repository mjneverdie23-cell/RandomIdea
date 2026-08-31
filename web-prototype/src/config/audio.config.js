/**
 * Sound registry.
 *
 * PLACEHOLDER: the prototype ships with no audio files. AudioManager
 * synthesises short tones for every cue so the game is audible, and logs a
 * warning when a cue has no `src`. Point `src` at a real file to replace a
 * placeholder - nothing else changes.
 */
export const AudioConfig = Object.freeze({
  masterVolume: 0.5,
  categories: { sfx: 1.0, ui: 0.8, music: 0.4, voice: 0.9 },

  /** cue id -> { src, category, volume, synth } */
  cues: {
    'weapon.fire.PISTOL':  { src: null, category: 'sfx', volume: 0.35, synth: { type: 'square',   freq: 320, duration: 0.08 } },
    'weapon.fire.SMG':     { src: null, category: 'sfx', volume: 0.3,  synth: { type: 'square',   freq: 380, duration: 0.06 } },
    'weapon.fire.RIFLE':   { src: null, category: 'sfx', volume: 0.4,  synth: { type: 'sawtooth', freq: 240, duration: 0.09 } },
    'weapon.fire.SNIPER':  { src: null, category: 'sfx', volume: 0.5,  synth: { type: 'sawtooth', freq: 160, duration: 0.22 } },
    'weapon.fire.SHOTGUN': { src: null, category: 'sfx', volume: 0.5,  synth: { type: 'sawtooth', freq: 120, duration: 0.18 } },
    'weapon.fire.LMG':     { src: null, category: 'sfx', volume: 0.42, synth: { type: 'sawtooth', freq: 200, duration: 0.08 } },
    'weapon.fire.MELEE':   { src: null, category: 'sfx', volume: 0.3,  synth: { type: 'triangle', freq: 520, duration: 0.1 } },
    'weapon.dryfire':      { src: null, category: 'sfx', volume: 0.25, synth: { type: 'square',   freq: 90,  duration: 0.05 } },
    'weapon.reload':       { src: null, category: 'sfx', volume: 0.3,  synth: { type: 'triangle', freq: 220, duration: 0.14 } },
    'weapon.switch':       { src: null, category: 'sfx', volume: 0.25, synth: { type: 'triangle', freq: 300, duration: 0.07 } },
    'hit.flesh':           { src: null, category: 'sfx', volume: 0.4,  synth: { type: 'sine',     freq: 160, duration: 0.07 } },
    'hit.marker':          { src: null, category: 'ui',  volume: 0.35, synth: { type: 'sine',     freq: 900, duration: 0.05 } },
    'hit.headshot':        { src: null, category: 'ui',  volume: 0.5,  synth: { type: 'sine',     freq: 1300, duration: 0.08 } },
    'character.death':     { src: null, category: 'sfx', volume: 0.5,  synth: { type: 'sawtooth', freq: 110, duration: 0.4 } },
    'character.hurt':      { src: null, category: 'sfx', volume: 0.4,  synth: { type: 'triangle', freq: 200, duration: 0.15 } },
    'ability.use':         { src: null, category: 'sfx', volume: 0.4,  synth: { type: 'sine',     freq: 660, duration: 0.25 } },
    'grenade.explode':     { src: null, category: 'sfx', volume: 0.6,  synth: { type: 'sawtooth', freq: 70,  duration: 0.5 } },
    'bomb.plant':          { src: null, category: 'sfx', volume: 0.5,  synth: { type: 'square',   freq: 440, duration: 0.3 } },
    'bomb.beep':           { src: null, category: 'sfx', volume: 0.35, synth: { type: 'sine',     freq: 1000, duration: 0.06 } },
    'bomb.defused':        { src: null, category: 'sfx', volume: 0.6,  synth: { type: 'sine',     freq: 520, duration: 0.5 } },
    'bomb.explode':        { src: null, category: 'sfx', volume: 0.8,  synth: { type: 'sawtooth', freq: 55,  duration: 1.2 } },
    'round.start':         { src: null, category: 'ui',  volume: 0.5,  synth: { type: 'sine',     freq: 700, duration: 0.35 } },
    'round.win':           { src: null, category: 'ui',  volume: 0.6,  synth: { type: 'sine',     freq: 880, duration: 0.6 } },
    'round.loss':          { src: null, category: 'ui',  volume: 0.6,  synth: { type: 'sine',     freq: 220, duration: 0.6 } },
    'match.win':           { src: null, category: 'ui',  volume: 0.7,  synth: { type: 'sine',     freq: 1046, duration: 1.2 } },
    'ui.buy':              { src: null, category: 'ui',  volume: 0.4,  synth: { type: 'sine',     freq: 780, duration: 0.1 } },
    'ui.error':            { src: null, category: 'ui',  volume: 0.4,  synth: { type: 'square',   freq: 140, duration: 0.12 } },
  },

  /** PLACEHOLDER: drop a looping track here and set `enabled` to true. */
  music: { enabled: false, src: null, volume: 0.3 },
});
