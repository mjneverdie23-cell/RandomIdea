// Wire protocol shared by client and server. Messages are small JSON objects with a
// type field `t`. The server never trusts the client: every incoming message goes through
// sanitizeClientMessage(), which returns a clean copy or null.

import { WORLD_LIMIT } from './layout.js';
import { MAX_DESKS, isPlace } from './places.js';
import { ADJECTIVES, ANIMALS, SUBJECTS, SWEATERS, LAMPS, EMOTES } from './words.js';
import { isItem, SLOTS } from './catalog.js';

export const PROTOCOL = 3;
export const MAX_MESSAGE_BYTES = 512;

/** What a visitor is doing. Walking is tracked separately (a member with a path). */
export const STATE = Object.freeze({ STAND: 0, SEATED: 1, FOCUS: 2, BREAK: 3 });

export const FOCUS_PRESETS = Object.freeze([25, 50, 90]);
export const FOCUS_MIN = 5;
export const FOCUS_MAX = 180;
/** An open-ended session ("∞") is credited for at most this many minutes. */
export const OPEN_FOCUS_CAP = 240;
export const BREAK_MIN = 1;
export const BREAK_MAX = 30;
/** How long a cup of tea someone sends stays on your desk. */
export const TEA_MS = 5 * 60 * 1000;
/** How long a dropped connection keeps its desk before the seat is freed. */
export const RESUME_GRACE_MS = 2 * 60 * 1000;
/** A dropped visitor who had not sat down is removed much sooner. */
export const STANDING_GRACE_MS = 15 * 1000;
export const GOAL_MIN = 15;
export const GOAL_MAX = 720;

/** Minimum milliseconds between two actions of the same kind, per visitor. */
export const COOLDOWN = Object.freeze({
  go: 150,
  sit: 400,
  stand: 400,
  session: 600,
  emote: 2000,
  gift: 20000,
  switch: 1500,
  style: 1500,
  shop: 250,
  friend: 1500,
  me: 1000,
});

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isPoint = (p) =>
  Array.isArray(p) &&
  p.length === 2 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Math.abs(p[0]) <= WORLD_LIMIT &&
  Math.abs(p[1]) <= WORLD_LIMIT;
const pt = (p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
export const isName = (n) =>
  Array.isArray(n) && n.length === 3 && isInt(n[0], 0, ADJECTIVES.length - 1) && isInt(n[1], 0, ANIMALS.length - 1) && isInt(n[2], 1, 99);
export const isToken = (s) => typeof s === 'string' && s.length >= 20 && s.length <= 64 && /^[A-Za-z0-9_-]+$/.test(s);
export const isFriendCode = (s) => typeof s === 'string' && /^[2-9A-HJ-NP-Z]{8}$/.test(s);
const isTimeZone = (s) => typeof s === 'string' && s.length <= 64 && /^[A-Za-z0-9_+\-/]+$/.test(s);

export const isValidFocusMinutes = (m) => m === 0 || isInt(m, FOCUS_MIN, FOCUS_MAX);

/** Returns a sanitised copy of a client message, or null if it is malformed. */
export function sanitizeClientMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return null;
  switch (msg.t) {
    case 'hello': {
      if (!isInt(msg.v, 0, 1000) || !isToken(msg.auth)) return null;
      const out = { t: 'hello', v: msg.v, auth: msg.auth };
      if (msg.hall !== undefined && msg.hall !== null) {
        if (!isInt(msg.hall, 1, 100000)) return null;
        out.hall = msg.hall;
      }
      if (msg.tz !== undefined && msg.tz !== null) {
        if (!isTimeZone(msg.tz)) return null;
        out.tz = msg.tz;
      }
      if (msg.place !== undefined && msg.place !== null) {
        if (!isPlace(msg.place)) return null;
        out.place = msg.place;
      }
      return out;
    }
    case 'go':
      return isPoint(msg.from) && isPoint(msg.to) ? { t: 'go', from: pt(msg.from), to: pt(msg.to) } : null;
    case 'sit':
      return isInt(msg.desk, 0, MAX_DESKS - 1) && isPoint(msg.from) ? { t: 'sit', desk: msg.desk, from: pt(msg.from) } : null;
    case 'stand':
    case 'stop':
    case 'done':
    case 'leave':
    case 'me':
    case 'tutorial':
    case 'friends':
      return { t: msg.t };
    case 'focus':
      return isValidFocusMinutes(msg.mins) && isInt(msg.tag, 0, SUBJECTS.length - 1) ? { t: 'focus', mins: msg.mins, tag: msg.tag } : null;
    case 'rest':
      return isInt(msg.mins, BREAK_MIN, BREAK_MAX) ? { t: 'rest', mins: msg.mins } : null;
    case 'emote':
      return isInt(msg.e, 0, EMOTES.length - 1) ? { t: 'emote', e: msg.e } : null;
    case 'gift':
      return isInt(msg.desk, 0, MAX_DESKS - 1) ? { t: 'gift', desk: msg.desk } : null;
    case 'switch':
      return isInt(msg.hall, 1, 100000) ? { t: 'switch', hall: msg.hall } : null;
    case 'enter':
      return isPlace(msg.place) ? { t: 'enter', place: msg.place } : null;
    case 'style': {
      const out = { t: 'style' };
      if (msg.name !== undefined) {
        if (!isName(msg.name)) return null;
        out.name = [...msg.name];
      }
      if (msg.color !== undefined) {
        if (!isInt(msg.color, 0, SWEATERS.length - 1)) return null;
        out.color = msg.color;
      }
      if (msg.lamp !== undefined) {
        if (!isInt(msg.lamp, 0, LAMPS.length - 1)) return null;
        out.lamp = msg.lamp;
      }
      return Object.keys(out).length > 1 ? out : null;
    }
    case 'buy':
    case 'equip':
      return isItem(msg.item) ? { t: msg.t, item: msg.item } : null;
    case 'unequip':
      return SLOTS.includes(msg.slot) ? { t: 'unequip', slot: msg.slot } : null;
    case 'goal':
      return isInt(msg.mins, GOAL_MIN, GOAL_MAX) ? { t: 'goal', mins: msg.mins } : null;
    case 'friendAdd':
      return isFriendCode(msg.code) ? { t: 'friendAdd', code: msg.code } : null;
    case 'friendAccept':
    case 'friendDecline':
    case 'friendRemove':
      return isInt(msg.id, 1, Number.MAX_SAFE_INTEGER) ? { t: msg.t, id: msg.id } : null;
    case 'ping':
      return Number.isFinite(msg.c) ? { t: 'ping', c: msg.c } : null;
    default:
      return null;
  }
}
