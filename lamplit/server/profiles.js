// Accounts, the lumen economy, the wardrobe and friends, on top of the database.
// Used by the HTTP API (sign up, log in) and by the room manager (everything else).

import { hashPassword, verifyPassword, validUsername, validPassword, dayKey, validTimeZone } from './accounts.js';
import { ITEM, defaultLook, sanitizeLook, lumensFor, WELCOME_LUMENS } from '../shared/catalog.js';
import { randomName, SWEATERS, LAMPS } from '../shared/words.js';

const DAY = 86_400_000;
const TOKEN_TTL = 90 * DAY;
const MAX_FRIENDS = 200;

export class ProfileService {
  constructor(db, { startLumens = WELCOME_LUMENS, random = Math.random } = {}) {
    this.db = db;
    this.startLumens = startLumens;
    this.random = random;
  }

  createGuest(now, tz) {
    const look = defaultLook(Math.floor(this.random() * SWEATERS.length));
    const id = this.db.createProfile({ name: randomName(this.random), look, lumens: this.startLumens, now });
    if (validTimeZone(tz)) this.db.setTz(id, tz, now);
    return { id, token: this.db.issueToken(id, now, TOKEN_TTL) };
  }

  /**
   * Creates an account. If `guestToken` belongs to a guest, that guest becomes the account
   * and keeps everything it earned. Returns { ok, token, id } or { ok: false, error }.
   */
  async signup({ username, password, guestToken, tz }, now) {
    if (!validUsername(username)) return { ok: false, error: 'username' };
    if (!validPassword(password)) return { ok: false, error: 'password' };
    if (this.db.profileByUsername(username)) return { ok: false, error: 'taken' };
    const hash = await hashPassword(password);
    let id;
    const guest = guestToken ? this.db.profileByToken(guestToken, now) : null;
    if (guest && !guest.username) {
      id = guest.id;
    } else {
      id = this.createGuest(now, tz).id;
    }
    if (!this.db.setCredentials(id, username, hash)) return { ok: false, error: 'taken' };
    if (validTimeZone(tz)) this.db.setTz(id, tz, now);
    return { ok: true, id, token: this.db.issueToken(id, now, TOKEN_TTL) };
  }

  async login({ username, password, tz }, now) {
    const p = validUsername(username) ? this.db.profileByUsername(username) : null;
    const ok = await verifyPassword(String(password ?? ''), p?.passHash ?? null);
    if (!p || !ok) return { ok: false, error: 'invalid' };
    if (validTimeZone(tz)) this.db.setTz(p.id, tz, now);
    return { ok: true, id: p.id, token: this.db.issueToken(p.id, now, TOKEN_TTL) };
  }

  logout(token) {
    this.db.revokeToken(token);
  }

  byToken(token, now) {
    return token ? this.db.profileByToken(token, now) : null;
  }

  get(id) {
    return this.db.profile(id);
  }

  setTimeZone(id, tz, now) {
    if (validTimeZone(tz)) this.db.setTz(id, tz, now);
  }

  /** Everything the client shows about you: balance, wardrobe, stats, account. */
  me(id, tz, now) {
    const p = this.db.profile(id);
    if (!p) return null;
    const zone = validTimeZone(tz) ? tz : p.tz || 'UTC';
    const byDay = new Map(this.db.days(id, dayKey(zone, now - 400 * DAY)).map((d) => [d.day, d.minutes]));
    const last7 = [];
    for (let k = 6; k >= 0; k--) {
      const day = dayKey(zone, now - k * DAY);
      last7.push({ day, minutes: byDay.get(day) || 0 });
    }
    let streak = 0;
    for (let k = byDay.get(dayKey(zone, now)) ? 0 : 1; k < 400; k++) {
      if (!byDay.get(dayKey(zone, now - k * DAY))) break;
      streak++;
    }
    return {
      id: p.id,
      guest: !p.username,
      username: p.username,
      code: p.username ? p.code : null,
      name: p.name,
      look: sanitizeLook(p.look),
      lumens: p.lumens,
      total: p.total,
      sessions: p.sessions,
      goal: p.goal,
      tutorial: p.tutorial,
      owned: [...this.db.owned(id)],
      today: last7[6].minutes,
      streak,
      last7,
    };
  }

  /** Credits focused minutes. Returns the lumens earned. */
  credit(id, minutes, completed, tz, now) {
    const gained = lumensFor(minutes, completed);
    if (gained <= 0 && !completed) return 0;
    this.db.credit(id, gained, Math.max(0, Math.floor(minutes)), completed, dayKey(tz || 'UTC', now), now);
    return gained;
  }

  /** { ok: true } or { ok: false, error: 'unknown' | 'owned' | 'funds' }. */
  buy(id, itemId, now) {
    const item = ITEM[itemId];
    if (!item) return { ok: false, error: 'unknown' };
    if (item.price === 0) return { ok: false, error: 'owned' };
    const result = this.db.buy(id, itemId, item.price, now);
    return result === 'ok' ? { ok: true } : { ok: false, error: result };
  }

  /** Puts on an item you own. Returns the new look, or null. */
  equip(id, itemId) {
    const item = ITEM[itemId];
    const p = this.db.profile(id);
    if (!item || !p) return null;
    if (item.price > 0 && !this.db.owns(id, itemId)) return null;
    const look = sanitizeLook(p.look);
    look[item.slot] = itemId;
    this.db.setLook(id, look);
    return look;
  }

  unequip(id, slot) {
    const p = this.db.profile(id);
    if (!p) return null;
    const look = sanitizeLook(p.look);
    look[slot] = slot === 'o' ? 'sweater' : null;
    this.db.setLook(id, look);
    return look;
  }

  /** Name, sweater colour and lamp shade. Lamps unlock with total focus hours. */
  style(id, { name, color, lamp }) {
    const p = this.db.profile(id);
    if (!p) return { ok: false, error: 'unknown' };
    if (lamp !== undefined && p.total < (LAMPS[lamp]?.hours ?? Infinity) * 60) return { ok: false, error: 'locked' };
    const look = sanitizeLook(p.look);
    if (color !== undefined) look.c = color;
    if (lamp !== undefined) look.l = lamp;
    this.db.setLook(id, look);
    if (name) this.db.setName(id, name);
    return { ok: true, look, name: name ?? p.name };
  }

  setGoal(id, minutes) {
    this.db.setGoal(id, minutes);
  }

  finishTutorial(id) {
    this.db.setTutorial(id);
  }

  // ---------------------------------------------------------------- friends

  /**
   * Sends a friend request by friend code, or accepts one if they already asked you.
   * Returns { ok, other, accepted } or { ok: false, error }.
   */
  addFriend(id, code, now) {
    const me = this.db.profile(id);
    if (!me?.username) return { ok: false, error: 'guest' };
    const other = this.db.profileByCode(code);
    if (!other || !other.username) return { ok: false, error: 'nocode' };
    if (other.id === id) return { ok: false, error: 'self' };
    const rel = this.db.relation(id, other.id);
    if (rel?.accepted) return { ok: false, error: 'already' };
    if (rel && rel.a === id) return { ok: false, error: 'pending' };
    if (rel && rel.a === other.id) {
      this.db.accept(other.id, id, now);
      return { ok: true, other, accepted: true };
    }
    if (this.db.friendCount(id) >= MAX_FRIENDS) return { ok: false, error: 'limit' };
    this.db.request(id, other.id, now);
    return { ok: true, other, accepted: false };
  }

  acceptFriend(id, fromId, now) {
    return this.db.accept(fromId, id, now);
  }

  /** Declining a request, cancelling yours, or unfriending. */
  removeFriend(id, otherId) {
    return this.db.unfriend(id, otherId);
  }

  friendLists(id) {
    return { friends: this.db.friends(id), incoming: this.db.incoming(id), outgoing: this.db.outgoing(id) };
  }
}
