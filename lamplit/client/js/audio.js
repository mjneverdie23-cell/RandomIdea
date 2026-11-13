// All sound is synthesised at runtime with the Web Audio API. Each place has its own
// background: the hush of the library, the murmur of the coffee shop, the hum and
// keyboards of the net café, the fountain and birds of the town square. On top: pages and
// pencils from the people around you (more of them when more lamps are lit), optional
// rain, the click of a lamp, doors, and a soft bell when a session ends.

export class Sound {
  constructor({ volume = 0.7, muted = false, rain = true, roomSounds = true } = {}) {
    this.ctx = null;
    this.volume = volume;
    this.muted = muted;
    this.rainOn = rain;
    this.roomOn = roomSounds;
    this.activity = 0;
    this.place = 'library';
    this.bed = null;
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
    this.loop = this.loopBuffer(6);
    this.startRain();
    this.startBed(this.place);
    this.roomTimer = setInterval(() => this.roomTick(), 850);
  }

  /** The place you're in: crossfades to its background sound. */
  setPlace(kind) {
    if (kind === this.place && this.bed) return;
    this.place = kind;
    if (this.ctx) this.startBed(kind);
  }

  /** Looped stereo pink noise with the loop seam cross-faded away. */
  loopBuffer(seconds) {
    const ctx = this.ctx;
    const fade = Math.floor(ctx.sampleRate * 0.5);
    const raw = this.noiseBuffer(seconds + 0.5, true).getChannelData(0);
    const len = raw.length - fade;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const out = buf.getChannelData(ch);
      const shift = ch * 7919;
      for (let i = 0; i < len; i++) {
        const j = (i + shift) % len;
        out[i] = j < fade ? raw[j] * (j / fade) + raw[len + j] * (1 - j / fade) : raw[j];
      }
    }
    return buf;
  }

  /** A background bed per place: filtered noise, gently swelling. */
  startBed(kind) {
    const ctx = this.ctx;
    const old = this.bed;
    if (old) {
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
      setTimeout(() => old.nodes.forEach((n) => n.stop?.()), 3000);
    }
    const recipes = {
      library: [{ type: 'lowpass', f: 700, q: 0.5, gain: 0.025, lfo: 0.05 }],
      cafe: [
        { type: 'bandpass', f: 520, q: 0.9, gain: 0.16, lfo: 0.35 },
        { type: 'bandpass', f: 1300, q: 1.4, gain: 0.05, lfo: 0.6 },
      ],
      netcafe: [
        { type: 'lowpass', f: 220, q: 0.7, gain: 0.12, lfo: 0.02 },
        { type: 'highpass', f: 5500, q: 0.5, gain: 0.012, lfo: 0.03 },
      ],
      square: [
        { type: 'bandpass', f: 1400, q: 0.6, gain: 0.07, lfo: 0.2 },
        { type: 'lowpass', f: 380, q: 0.6, gain: 0.12, lfo: 0.07 },
      ],
      // Deep stone hush and the roar of torches.
      pyramid: [
        { type: 'lowpass', f: 140, q: 0.7, gain: 0.16, lfo: 0.04 },
        { type: 'bandpass', f: 900, q: 0.8, gain: 0.025, lfo: 1.3 },
      ],
      // Desert wind and blowing sand.
      giza: [
        { type: 'lowpass', f: 420, q: 0.6, gain: 0.16, lfo: 0.09 },
        { type: 'bandpass', f: 2600, q: 0.9, gain: 0.025, lfo: 0.15 },
      ],
      // Wind across the open bowl, and the murmur of visitors far off.
      colosseum: [
        { type: 'lowpass', f: 320, q: 0.6, gain: 0.12, lfo: 0.06 },
        { type: 'bandpass', f: 480, q: 1.0, gain: 0.05, lfo: 0.3 },
      ],
      // The city: distant traffic and voices, and the fountain.
      rome: [
        { type: 'bandpass', f: 420, q: 0.8, gain: 0.1, lfo: 0.25 },
        { type: 'bandpass', f: 1500, q: 0.6, gain: 0.06, lfo: 0.2 },
      ],
      // Near silence in the hall.
      temple: [{ type: 'lowpass', f: 260, q: 0.5, gain: 0.03, lfo: 0.03 }],
      // A trickle of water and leaves in the breeze.
      garden: [
        { type: 'bandpass', f: 2200, q: 1.2, gain: 0.03, lfo: 0.4 },
        { type: 'lowpass', f: 500, q: 0.6, gain: 0.07, lfo: 0.08 },
      ],
      // A vast, echoing hush, and visitors murmuring far down the nave.
      basilica: [
        { type: 'lowpass', f: 200, q: 0.6, gain: 0.06, lfo: 0.03 },
        { type: 'bandpass', f: 600, q: 0.9, gain: 0.025, lfo: 0.12 },
      ],
      // The city's hum, voices on the Rambla, the fountain.
      barcelona: [
        { type: 'bandpass', f: 380, q: 0.8, gain: 0.09, lfo: 0.22 },
        { type: 'bandpass', f: 1700, q: 0.6, gain: 0.05, lfo: 0.18 },
      ],
    };
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    const nodes = [];
    for (const r of recipes[kind] ?? []) {
      const src = ctx.createBufferSource();
      src.buffer = this.loop;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = r.type;
      f.frequency.value = r.f;
      f.Q.value = r.q;
      const g = ctx.createGain();
      g.gain.value = r.gain;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = r.lfo;
      const depth = ctx.createGain();
      depth.gain.value = r.gain * 0.45;
      lfo.connect(depth).connect(g.gain);
      src.connect(f).connect(g).connect(gain);
      src.start(ctx.currentTime, Math.random() * 3);
      lfo.start();
      nodes.push(src, lfo);
    }
    gain.gain.setTargetAtTime(this.roomOn ? 1 : 0, ctx.currentTime, 0.8);
    this.bed = { gain, nodes };
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
    if (this.bed) this.bed.gain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.4);
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

  /** A soft swelling chord, like an organ heard from the far end of a church. */
  swell(freqs, { dur = 7, gain = 0.018 } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const f of freqs) {
      for (const [mult, level] of [[1, 1], [2, 0.35], [3, 0.12]]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain * level, t + dur * 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.sfx);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
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

  /** Going through a door: the coffee shop's bell, or a soft door and latch. */
  door(to) {
    if (!this.ctx) return;
    if (to === 'cafe' || this.place === 'cafe') {
      this.tone({ freq: 1568, dur: 1.4, gain: 0.07 });
      this.tone({ at: 0.09, freq: 2093, dur: 1.2, gain: 0.05 });
      this.tone({ at: 0.18, freq: 1568, dur: 1.0, gain: 0.04 });
    }
    this.noise({ dur: 0.7, type: 'lowpass', freq: 500, sweepTo: 1400, q: 0.5, gain: 0.05 });
    this.noise({ at: 0.5, dur: 0.05, type: 'bandpass', freq: 2400, q: 2, gain: 0.08 });
  }

  /** A short bird call: a few quick whistles. */
  chirp(pan) {
    const ctx = this.ctx;
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1800;
    for (let k = 0; k < n; k++) {
      const t = ctx.currentTime + k * (0.09 + Math.random() * 0.05);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.25), t);
      o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), t + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.025, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (p) p.pan.value = pan;
      o.connect(g);
      (p ? g.connect(p) : g).connect(this.sfx);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  roomTick() {
    if (!this.ctx || !this.roomOn || this.muted || document.hidden) return;
    const pan = (Math.random() - 0.5) * 1.6;
    const place = this.place;
    if (place === 'square') {
      if (Math.random() < 0.3) this.chirp(pan);
      return;
    }
    if (place === 'giza') {
      // A camel's bell now and then.
      if (Math.random() < 0.08) {
        const f = 1900 + Math.random() * 400;
        for (let k = 0; k < 3; k++) this.tone({ at: k * 0.32, freq: f * (k % 2 ? 1.12 : 1), dur: 0.6, gain: 0.025 });
      }
      return;
    }
    if (place === 'rome') {
      if (Math.random() < 0.06) {
        // A scooter buzzing past.
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        const t0 = ctx.currentTime;
        o.frequency.setValueAtTime(95, t0);
        o.frequency.linearRampToValueAtTime(130, t0 + 1.2);
        o.frequency.linearRampToValueAtTime(85, t0 + 2.6);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 700;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.02, t0 + 1.0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
        o.connect(f).connect(g).connect(this.sfx);
        o.start(t0);
        o.stop(t0 + 2.7);
      } else if (Math.random() < 0.15) this.chirp(pan);
      return;
    }
    if (place === 'garden') {
      if (Math.random() < 0.05) {
        // The bamboo water knocker: a hollow knock.
        this.tone({ freq: 420, dur: 0.25, gain: 0.08, type: 'triangle' });
        this.tone({ freq: 840, dur: 0.12, gain: 0.03 });
      } else if (Math.random() < 0.25) this.chirp(pan);
      return;
    }
    if (place === 'basilica') {
      if (Math.random() < 0.02) {
        // The organ, far off: a slow chord swelling and fading.
        const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6]];
        this.swell(chords[Math.floor(Math.random() * chords.length)]);
      } else if (Math.random() < 0.06) {
        // Footsteps echoing down the nave.
        for (let k = 0; k < 4; k++) this.noise({ at: k * 0.55, dur: 0.05, type: 'lowpass', freq: 500, gain: 0.03, pan });
      }
      return;
    }
    if (place === 'barcelona') {
      if (Math.random() < 0.035) {
        // A guitar somewhere down the Rambla: four notes falling to E.
        [440, 392, 349.2, 329.6].forEach((f, k) => {
          this.tone({ at: k * 0.22, freq: f, dur: 1.1, gain: 0.03, type: 'triangle' });
          this.tone({ at: k * 0.22, freq: f * 2, dur: 0.5, gain: 0.008 });
        });
      } else if (Math.random() < 0.12) {
        // Parakeets squawking overhead.
        for (let k = 0; k < 2; k++) this.noise({ at: k * 0.16, dur: 0.11, type: 'bandpass', freq: 2400, sweepTo: 3600, q: 4, gain: 0.03, pan });
      } else if (Math.random() < 0.1) this.chirp(pan);
      return;
    }
    if (place === 'temple' && Math.random() < 0.03) {
      // A singing bowl, struck softly.
      const f = 392;
      this.tone({ freq: f, dur: 5, gain: 0.06 });
      this.tone({ freq: f * 2.71, dur: 3, gain: 0.025 });
      this.tone({ freq: f * 5.2, dur: 1.6, gain: 0.01 });
      return;
    }
    if (place === 'pyramid' && Math.random() < 0.3) {
      // Torches crackling.
      for (let k = 0; k < 3; k++) this.noise({ at: k * 0.05 + Math.random() * 0.1, dur: 0.03, type: 'bandpass', freq: 1200 + Math.random() * 1600, q: 2, gain: 0.03, pan });
    }
    if (place === 'cafe' && Math.random() < 0.12) {
      // Cups and spoons.
      const f = 2400 + Math.random() * 1600;
      this.tone({ freq: f, dur: 0.25, gain: 0.018 });
      this.tone({ at: 0.05, freq: f * 1.33, dur: 0.18, gain: 0.012 });
      return;
    }
    if (place === 'cafe' && Math.random() < 0.025) {
      // The espresso machine steaming milk.
      this.noise({ dur: 2.2, type: 'bandpass', freq: 3200, sweepTo: 2200, q: 1.5, gain: 0.03, pan: -0.4 });
      return;
    }
    const p = Math.min(0.6, this.activity / 30);
    if (Math.random() > p) return;
    if (place === 'netcafe') {
      // Typing, or a couple of mouse clicks.
      const n = Math.random() < 0.3 ? 2 : 5 + Math.floor(Math.random() * 9);
      let at = 0;
      for (let k = 0; k < n; k++) {
        this.noise({ at, dur: 0.025, type: 'highpass', freq: 3000 + Math.random() * 2000, gain: 0.02 + Math.random() * 0.015, pan });
        at += n === 2 ? 0.11 : 0.06 + Math.random() * 0.07;
      }
      return;
    }
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
