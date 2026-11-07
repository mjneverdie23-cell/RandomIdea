// All sound is synthesised at runtime with the Web Audio API: rain on the windows,
// pages and pencils from the people around you (more of them when more lamps are lit),
// the click of a lamp, and a soft bell when a session ends.

export class Sound {
  constructor({ volume = 0.7, muted = false, rain = true, roomSounds = true } = {}) {
    this.ctx = null;
    this.volume = volume;
    this.muted = muted;
    this.rainOn = rain;
    this.roomOn = roomSounds;
    this.activity = 0;
  }

  /** Must be called from a user gesture (the Enter button). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.white = this.noiseBuffer(1.5, false);
    this.startRain();
    this.roomTimer = setInterval(() => this.roomTick(), 850);
  }

  setVolume(v) {
    this.volume = v;
    this.applyMaster();
  }

  setMuted(m) {
    this.muted = m;
    this.applyMaster();
  }

  setRain(on) {
    this.rainOn = on;
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(on ? 0.34 : 0, this.ctx.currentTime, 0.6);
  }

  setRoomSounds(on) {
    this.roomOn = on;
  }

  /** Number of lamps lit nearby; drives how often pages turn. */
  setActivity(n) {
    this.activity = n;
  }

  applyMaster() {
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.08);
  }

  noiseBuffer(seconds, pink) {
    const ctx = this.ctx;
    const len = Math.floor(seconds * ctx.sampleRate);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (!pink) {
        d[i] = w;
        continue;
      }
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  /** Rain: looped pink noise with the loop seam cross-faded away, plus drips. */
  startRain() {
    const ctx = this.ctx;
    const seconds = 7;
    const fade = Math.floor(ctx.sampleRate * 0.5);
    const raw = this.noiseBuffer(seconds + 0.5, true).getChannelData(0);
    const len = raw.length - fade;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const out = buf.getChannelData(ch);
      const shift = ch * 9973;
      for (let i = 0; i < len; i++) {
        const j = (i + shift) % len;
        let v = raw[j];
        if (j < fade) v = raw[j] * (j / fade) + raw[len + j] * (1 - j / fade);
        out[i] = v;
      }
      for (let k = 0; k < 260; k++) {
        const at = Math.floor(Math.random() * (len - 2000));
        const f = 2200 + Math.random() * 3000;
        const amp = 0.02 + Math.random() * 0.05;
        for (let n = 0; n < 1500; n++) out[at + n] += Math.sin((n / ctx.sampleRate) * f * Math.PI * 2) * amp * Math.exp(-n / 180);
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 180;
    // Slow swells, like gusts against the glass, applied before the on/off gain so
    // switching rain off silences them too.
    const swell = ctx.createGain();
    swell.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.22;
    lfo.connect(lfoDepth).connect(swell.gain);
    lfo.start();
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    src.connect(lp).connect(hp).connect(swell).connect(this.rainGain).connect(this.master);
    src.start();
    this.setRain(this.rainOn);
  }

  /** A burst of filtered white noise. */
  noise({ at = 0, dur = 0.05, type = 'bandpass', freq = 2000, q = 1, gain = 0.2, sweepTo = null, pan = 0 }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) p.pan.value = pan;
    src.connect(f).connect(g);
    (p ? g.connect(p) : g).connect(this.sfx);
    src.start(t, Math.random() * Math.max(0, this.white.duration - dur - 0.1), dur + 0.05);
  }

  tone({ at = 0, freq = 880, dur = 1, gain = 0.15, type = 'sine' }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** The pull-chain click of a banker's lamp. */
  lamp(on) {
    const clicks = on ? [0, 0.075] : [0];
    for (const at of clicks) {
      this.noise({ at, dur: 0.035, type: 'highpass', freq: 2500, gain: 0.35 });
      this.tone({ at, freq: 1900, dur: 0.03, gain: 0.05, type: 'triangle' });
    }
  }

  /** A soft bell for a finished session. */
  bell() {
    const f = 659;
    this.tone({ freq: f, dur: 3.2, gain: 0.2 });
    this.tone({ freq: f * 2.76, dur: 1.8, gain: 0.05 });
    this.tone({ freq: f * 5.4, dur: 0.9, gain: 0.02 });
    this.tone({ at: 0.35, freq: f * 1.5, dur: 2.6, gain: 0.1 });
  }

  /** A cup of tea arriving. */
  chime() {
    this.tone({ freq: 988, dur: 0.7, gain: 0.08 });
    this.tone({ at: 0.12, freq: 1319, dur: 0.9, gain: 0.07 });
  }

  tap() {
    this.tone({ freq: 1250, dur: 0.05, gain: 0.03, type: 'triangle' });
  }

  roomTick() {
    if (!this.ctx || !this.roomOn || this.muted || document.hidden) return;
    const p = Math.min(0.6, this.activity / 30);
    if (Math.random() > p) return;
    const pan = (Math.random() - 0.5) * 1.6;
    if (Math.random() < 0.55) {
      // A page turning.
      this.noise({ dur: 0.32 + Math.random() * 0.15, freq: 1400, sweepTo: 4200, q: 0.7, gain: 0.03 + Math.random() * 0.03, pan });
    } else {
      // A pencil writing a few words.
      const n = 4 + Math.floor(Math.random() * 6);
      let at = 0;
      for (let k = 0; k < n; k++) {
        this.noise({ at, dur: 0.04 + Math.random() * 0.05, type: 'highpass', freq: 3500, gain: 0.012 + Math.random() * 0.012, pan });
        at += 0.07 + Math.random() * 0.09;
      }
    }
  }
}
