// Settings kept in this browser (language, sound, last session length...). Your name,
// wardrobe, lumens and stats live on the server with your profile. Storage can be missing
// or throw (private windows, blocked site data), so every access is guarded.

import { SUBJECTS } from '../shared/words.js';
import { isValidFocusMinutes } from '../shared/protocol.js';
import { detectLang, LANGS } from './i18n.js';
import { isPlace } from '../shared/places.js';

const KEY = 'lamplit:settings';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export class Settings {
  constructor() {
    const s = read();
    this.lang = LANGS.includes(s.lang) ? s.lang : detectLang();
    this.volume = typeof s.volume === 'number' && s.volume >= 0 && s.volume <= 1 ? s.volume : 0.7;
    this.muted = s.muted === true;
    // Rain was the night reading room's sound; the sunny places start without it.
    this.rain = s.rain === true;
    this.roomSounds = s.roomSounds !== false;
    this.mins = isValidFocusMinutes(s.mins) ? s.mins : 25;
    this.tag = Number.isInteger(s.tag) && s.tag >= 0 && s.tag < SUBJECTS.length ? s.tag : 0;
    this.hall = Number.isInteger(s.hall) && s.hall > 0 ? s.hall : null;
    this.place = isPlace(s.place) ? s.place : null;
    this.quality = ['auto', 'high', 'low'].includes(s.quality) ? s.quality : 'auto';
    this.toured = s.toured === true;
  }

  update(changes) {
    Object.assign(this, changes);
    try {
      const { lang, volume, muted, rain, roomSounds, mins, tag, hall, place, quality, toured } = this;
      localStorage.setItem(KEY, JSON.stringify({ lang, volume, muted, rain, roomSounds, mins, tag, hall, place, quality, toured }));
    } catch {
      // storage unavailable: settings last for this visit only
    }
  }
}
