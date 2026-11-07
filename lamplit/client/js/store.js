// Everything Lamplit remembers lives in this browser only. Storage can be missing or
// throw (private windows, blocked site data), so every access is guarded and the game
// works without it.

import { ADJECTIVES, ANIMALS, SWEATERS, LAMPS, SUBJECTS, randomName } from '../shared/words.js';
import { isValidFocusMinutes } from '../shared/protocol.js';
import { detectLang, LANGS } from './i18n.js';

const KEY = 'lamplit:v1';
const RESUME_KEY = 'lamplit:resume';
const ACTIVE_KEY = 'lamplit:active';

function readJSON(storage, key) {
  try {
    return JSON.parse(storage.getItem(key)) ?? null;
  } catch {
    return null;
  }
}

function writeJSON(storage, key, value) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: keep going without it
  }
}

const local = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
const session = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const isIdx = (v, n) => Number.isInteger(v) && v >= 0 && v < n;

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class Store {
  constructor() {
    const raw = (local() && readJSON(local(), KEY)) || {};
    const p = raw.profile || {};
    const name = Array.isArray(p.name) && isIdx(p.name[0], ADJECTIVES.length) && isIdx(p.name[1], ANIMALS.length) && Number.isInteger(p.name[2]) && p.name[2] >= 1 && p.name[2] <= 99 ? p.name : randomName();
    this.profile = {
      name,
      color: isIdx(p.color, SWEATERS.length) ? p.color : Math.floor(Math.random() * SWEATERS.length),
      lamp: isIdx(p.lamp, LAMPS.length) ? p.lamp : 0,
      lang: LANGS.includes(p.lang) ? p.lang : detectLang(),
      volume: typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1 ? p.volume : 0.7,
      muted: p.muted === true,
      rain: p.rain !== false,
      roomSounds: p.roomSounds !== false,
      mins: isValidFocusMinutes(p.mins) ? p.mins : 25,
      tag: isIdx(p.tag, SUBJECTS.length) ? p.tag : 0,
      goal: Number.isInteger(p.goal) && p.goal >= 15 && p.goal <= 720 ? p.goal : 120,
      hall: Number.isInteger(p.hall) && p.hall > 0 ? p.hall : null,
    };
    const s = raw.stats || {};
    this.stats = {
      days: s.days && typeof s.days === 'object' ? s.days : {},
      sessions: Number.isInteger(s.sessions) ? s.sessions : 0,
      total: Number.isFinite(s.total) ? s.total : 0,
    };
    if (this.lampLocked(this.profile.lamp)) this.profile.lamp = 0;
    this.save();
  }

  save() {
    const store = local();
    if (store) writeJSON(store, KEY, { profile: this.profile, stats: this.stats });
  }

  update(changes) {
    Object.assign(this.profile, changes);
    this.save();
  }

  /** Adds focused minutes to today. `completed` counts a finished session. */
  addFocus(minutes, completed) {
    const m = Math.max(0, Math.floor(minutes));
    if (m > 0) {
      const k = dayKey(new Date());
      this.stats.days[k] = (this.stats.days[k] || 0) + m;
      this.stats.total += m;
    }
    if (completed) this.stats.sessions += 1;
    // Keep about four months of daily history.
    const keys = Object.keys(this.stats.days).sort();
    while (keys.length > 120) delete this.stats.days[keys.shift()];
    this.save();
  }

  today() {
    return this.stats.days[dayKey(new Date())] || 0;
  }

  streak() {
    const d = new Date();
    if (!this.stats.days[dayKey(d)]) d.setDate(d.getDate() - 1);
    let n = 0;
    while (this.stats.days[dayKey(d)] > 0) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  /** [{date, minutes}] for the last seven days, oldest first. */
  last7() {
    const out = [];
    const d = new Date();
    d.setDate(d.getDate() - 6);
    for (let i = 0; i < 7; i++) {
      out.push({ date: new Date(d), minutes: this.stats.days[dayKey(d)] || 0 });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  lampLocked(i) {
    return this.stats.total < (LAMPS[i]?.hours ?? 0) * 60;
  }

  // Per-tab state that lets a reload or a dropped connection pick up where it left off.
  get resumeToken() {
    const s = session();
    try {
      return s ? s.getItem(RESUME_KEY) : null;
    } catch {
      return null;
    }
  }

  set resumeToken(token) {
    const s = session();
    try {
      if (s) token ? s.setItem(RESUME_KEY, token) : s.removeItem(RESUME_KEY);
    } catch {
      // ignore
    }
  }

  get activeSession() {
    const s = session();
    return s ? readJSON(s, ACTIVE_KEY) : null;
  }

  set activeSession(v) {
    const s = session();
    if (s) writeJSON(s, ACTIVE_KEY, v);
  }
}
