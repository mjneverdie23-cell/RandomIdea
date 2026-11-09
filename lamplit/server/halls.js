// All room logic, independent of sockets so it can be tested directly.
//
// A "client" is anything with `id`, `send(obj)`, `sendRaw(string)` and optionally
// `close(reason)`. Every member belongs to a profile (a guest or an account); a profile can
// only be in the rooms once, so reconnecting or opening a second tab takes over your seat.
//
// Each room ("hall") is a copy of one place: the library, the coffee shop, the net café or
// the town square outside them. Walking through a door moves you to a room of another place.

import { WALK_SPEED, buildWalkGrid, spawnPoint, round2 } from '../shared/layout.js';
import { PLACES, PLACE_KINDS, PLACE_CAP, DEFAULT_PLACE, placeIndex } from '../shared/places.js';
import { findPath, pathLength, samplePath } from '../shared/path.js';
import { STATE, COOLDOWN, OPEN_FOCUS_CAP, TEA_MS, RESUME_GRACE_MS, STANDING_GRACE_MS } from '../shared/protocol.js';
import { sanitizeLook } from '../shared/catalog.js';
import { validTimeZone } from './accounts.js';

const GRIDS = Object.fromEntries(PLACE_KINDS.map((k) => [k, buildWalkGrid(PLACES[k])]));
const MIN = 60_000;
const HOUR = 60 * MIN;
/** How far a client-reported position may drift from the server's own estimate. */
const POS_TOLERANCE = 1.5;
/** A timed session the client never reports as done is completed this long after it ends. */
const DONE_GRACE_MS = 2 * MIN;
/** A `done` report may arrive this early (clock skew) and still count. */
const DONE_EARLY_MS = 5000;

export class Hall {
  /** `n` numbers the rooms of each kind of place: the second coffee shop is n = 2. */
  constructor(id, capacity, kind = DEFAULT_PLACE, n = 1) {
    this.id = id;
    this.capacity = capacity;
    this.kind = kind;
    this.place = PLACES[kind];
    this.grid = GRIDS[kind];
    this.n = n;
    /** @type {Map<number, object>} member id -> member */
    this.members = new Map();
    /** Member id sitting at each desk, 0 when free. */
    this.desks = new Array(this.place.desks.length).fill(0);
    /** desk -> time the cup of tea disappears */
    this.tea = new Map();
    this.events = [];
    this.statsDirty = true;
    this.hourKeys = new Float64Array(24).fill(-1);
    this.hourMinutes = new Float64Array(24);
  }

  get count() {
    return this.members.size;
  }

  get lit() {
    let n = 0;
    for (const m of this.members.values()) if (m.state === STATE.FOCUS) n++;
    return n;
  }

  /** Records finished focus minutes in a rolling 24-hour window (hourly buckets). */
  addMinutes(minutes, now) {
    const hour = Math.floor(now / HOUR);
    const k = hour % 24;
    if (this.hourKeys[k] !== hour) {
      this.hourKeys[k] = hour;
      this.hourMinutes[k] = 0;
    }
    this.hourMinutes[k] += minutes;
  }

  minutes24(now) {
    const hour = Math.floor(now / HOUR);
    let sum = 0;
    for (let k = 0; k < 24; k++) if (this.hourKeys[k] > hour - 24) sum += this.hourMinutes[k];
    return sum;
  }

  push(ev) {
    this.events.push(ev);
  }
}

export class HallManager {
  constructor({ profiles, capacity = 100, maxHalls = 100, maxQueue = 5000, now = () => Date.now(), random = Math.random } = {}) {
    if (!profiles) throw new Error('HallManager needs a ProfileService');
    this.profiles = profiles;
    this.capacity = Math.max(1, Math.min(100, capacity));
    this.maxHalls = Math.max(1, maxHalls);
    this.maxQueue = maxQueue;
    this.now = now;
    this.random = random;
    /** @type {Map<number, Hall>} */
    this.halls = new Map();
    /** client id -> member, for connected members */
    this.byClient = new Map();
    /** profile id -> member, for every member (connected or briefly dropped) */
    this.byProfile = new Map();
    /** visitors waiting for a seat when every hall is full */
    this.queue = [];
    this.nextMemberId = 1;
    this.lastHousekeeping = 0;
    this.lastGlobal = 0;
    this.lastStats = 0;
    this.statusCache = null;
    this.ensureHall(1, DEFAULT_PLACE);
  }

  // ---------------------------------------------------------------- joining & leaving

  /** Returns 'joined', 'resumed', 'queued' or 'rejected'. */
  join(client, hello) {
    const now = this.now();
    const profile = this.profiles.byToken(hello.auth, now);
    if (!profile) {
      client.send({ t: 'bye', reason: 'auth' });
      client.close?.('auth');
      return 'rejected';
    }
    const tz = validTimeZone(hello.tz) ? hello.tz : profile.tz || 'UTC';
    if (tz !== profile.tz) this.profiles.setTimeZone(profile.id, tz, now);
    const existing = this.byProfile.get(profile.id);
    if (existing) {
      // The same person reconnected, or opened another tab or device: take over the seat.
      if (existing.client) {
        const old = existing.client;
        this.byClient.delete(old.id);
        existing.client = null;
        old.close?.('replaced');
      }
      existing.tz = tz;
      this.reattach(existing, client, now);
      return 'resumed';
    }
    const hall = this.pickHall(hello.hall, hello.place ?? DEFAULT_PLACE);
    if (!hall) {
      if (this.queue.length >= this.maxQueue) {
        client.send({ t: 'bye', reason: 'full' });
        client.close?.('full');
        return 'rejected';
      }
      this.queue.push({ client, hello, profile, tz });
      client.send({ t: 'queue', pos: this.queue.length, total: this.queue.length });
      return 'queued';
    }
    this.admit(client, hello, hall, now, profile, tz);
    return 'joined';
  }

  /**
   * A dropped connection keeps its desk for RESUME_GRACE_MS so a phone that locked its
   * screen (or a reloaded tab) can come back to the same seat and session. Visitors who
   * never sat down are dropped after STANDING_GRACE_MS so quick bounces don't fill rooms.
   * `immediate` removes the visitor at once.
   */
  leave(client, { immediate = false } = {}) {
    const m = this.byClient.get(client.id);
    if (!m) {
      const i = this.queue.findIndex((q) => q.client === client);
      if (i >= 0) this.queue.splice(i, 1);
      return;
    }
    this.byClient.delete(client.id);
    m.client = null;
    const now = this.now();
    if (immediate) this.remove(m, now);
    else m.ghostUntil = now + (m.desk >= 0 ? RESUME_GRACE_MS : STANDING_GRACE_MS);
  }

  /** A room with space: the preferred one if it has room, else the busiest of that kind of place. */
  pickHall(preferred, kind = DEFAULT_PLACE) {
    if (preferred) {
      const h = this.halls.get(preferred);
      if (h && h.count < h.capacity) return h;
    }
    // Fill the busiest room first so rooms feel alive.
    let best = null;
    for (const h of this.halls.values()) {
      if (h.kind !== kind || h.count >= h.capacity) continue;
      if (!best || h.count > best.count || (h.count === best.count && h.id < best.id)) best = h;
    }
    if (best) return best;
    if (this.halls.size < this.maxHalls) return this.ensureHall(this.freeHallId(), kind);
    return null;
  }

  ensureHall(id, kind = DEFAULT_PLACE) {
    let h = this.halls.get(id);
    if (!h) {
      h = new Hall(id, Math.min(this.capacity, PLACE_CAP[kind]), kind, this.freeNumber(kind));
      this.halls.set(id, h);
    }
    return h;
  }

  freeHallId() {
    let id = 1;
    while (this.halls.has(id)) id++;
    return id;
  }

  /** The lowest room number not in use for this kind of place. */
  freeNumber(kind) {
    const used = new Set();
    for (const h of this.halls.values()) if (h.kind === kind) used.add(h.n);
    let n = 1;
    while (used.has(n)) n++;
    return n;
  }

  admit(client, hello, hall, now, profile, tz) {
    const m = {
      id: this.nextMemberId++,
      client,
      profileId: profile.id,
      tz,
      name: profile.name,
      look: sanitizeLook(profile.look),
      hallId: hall.id,
      desk: -1,
      state: STATE.STAND,
      since: now,
      mins: 0,
      tag: 0,
      pos: spawnPoint(hall.place, this.random),
      path: null,
      t0: 0,
      len: 0,
      last: Object.create(null),
      ghostUntil: 0,
    };
    hall.members.set(m.id, m);
    this.byClient.set(client.id, m);
    this.byProfile.set(m.profileId, m);
    this.welcome(hall, m, now);
    hall.push(['j', this.view(m, now)]);
  }

  reattach(m, client, now) {
    m.client = client;
    m.ghostUntil = 0;
    this.byClient.set(client.id, m);
    this.welcome(this.halls.get(m.hallId), m, now);
  }

  /** Removes a member for good: credits their session, frees the desk, tells the room. */
  remove(m, now) {
    const hall = this.halls.get(m.hallId);
    if (!hall || !hall.members.has(m.id)) return;
    if (m.desk >= 0) this.freeDesk(hall, m, now);
    else this.endSession(hall, m, now);
    hall.members.delete(m.id);
    if (this.byProfile.get(m.profileId) === m) this.byProfile.delete(m.profileId);
    hall.push(['l', m.id]);
    this.retireIfEmpty(hall);
    this.admitQueue(now);
  }

  /** Empty rooms close, except the first room of each place. */
  retireIfEmpty(hall) {
    if (hall.count === 0 && hall.n !== 1) this.halls.delete(hall.id);
  }

  admitQueue(now) {
    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (this.byProfile.has(next.profile.id)) {
        this.queue.shift();
        this.join(next.client, next.hello);
        continue;
      }
      const hall = this.pickHall(next.hello.hall, next.hello.place ?? DEFAULT_PLACE);
      if (!hall) return;
      this.queue.shift();
      this.admit(next.client, next.hello, hall, now, next.profile, next.tz);
    }
  }

  welcome(hall, m, now) {
    m.client.send({
      t: 'welcome',
      id: m.id,
      hall: hall.id,
      place: hall.kind,
      n: hall.n,
      cap: hall.capacity,
      now,
      members: [...hall.members.values()].map((x) => this.view(x, now)),
      tea: [...hall.tea],
      hs: this.stats(hall, now),
      g: this.globalSummary(),
      me: this.profiles.me(m.profileId, m.tz, now),
    });
  }

  sendMe(m, now) {
    m.client?.send({ t: 'me', p: this.profiles.me(m.profileId, m.tz, now) });
  }

  // ---------------------------------------------------------------- messages

  handle(client, msg) {
    if (msg.t === 'leave') {
      this.leave(client, { immediate: true });
      return;
    }
    const m = this.byClient.get(client.id);
    if (!m) return;
    const hall = this.halls.get(m.hallId);
    const now = this.now();
    switch (msg.t) {
      case 'go':
        return this.onGo(hall, m, msg, now);
      case 'sit':
        return this.onSit(hall, m, msg, now);
      case 'stand':
        if (m.desk >= 0 && this.cool(m, 'stand', now)) this.freeDesk(hall, m, now);
        return;
      case 'focus':
        return this.onFocus(hall, m, msg, now);
      case 'rest':
        return this.onRest(hall, m, msg, now);
      case 'stop':
        if ((m.state === STATE.FOCUS || m.state === STATE.BREAK) && this.cool(m, 'session', now)) {
          this.endSession(hall, m, now);
          this.pushState(hall, m);
        }
        return;
      case 'done':
        return this.onDone(hall, m, now);
      case 'emote':
        if (this.cool(m, 'emote', now)) hall.push(['em', m.id, msg.e]);
        return;
      case 'gift':
        return this.onGift(hall, m, msg, now);
      case 'switch':
        return this.onSwitch(hall, m, msg, now);
      case 'enter':
        return this.onEnter(hall, m, msg, now);
      case 'style':
        return this.onStyle(hall, m, msg, now);
      case 'buy':
        return this.onBuy(m, msg, now);
      case 'equip':
      case 'unequip':
        return this.onWear(hall, m, msg, now);
      case 'goal':
        if (this.cool(m, 'style', now)) {
          this.profiles.setGoal(m.profileId, msg.mins);
          this.sendMe(m, now);
        }
        return;
      case 'tutorial':
        this.profiles.finishTutorial(m.profileId);
        return;
      case 'me':
        if (this.cool(m, 'me', now)) this.sendMe(m, now);
        return;
      case 'friends':
        if (this.cool(m, 'me', now)) this.sendFriends(m);
        return;
      case 'friendAdd':
      case 'friendAccept':
      case 'friendDecline':
      case 'friendRemove':
        return this.onFriend(m, msg, now);
      default:
    }
  }

  onGo(hall, m, msg, now) {
    if (m.desk >= 0) return this.error(m, 'seated');
    if (!this.cool(m, 'go', now)) return;
    const from = this.trustedFrom(m, msg.from, now);
    const path = findPath(hall.grid, from, msg.to);
    if (!path) return this.error(m, 'nopath');
    this.setPath(m, path, now);
    hall.push(['go', m.id, path, now]);
  }

  onSit(hall, m, msg, now) {
    const d = msg.desk;
    if (m.desk === d || d >= hall.desks.length) return;
    const owner = hall.desks[d];
    if (owner && owner !== m.id) return this.error(m, 'taken', { desk: d });
    if (!this.cool(m, 'sit', now)) return;
    let from;
    if (m.desk >= 0) {
      this.freeDesk(hall, m, now);
      from = m.pos;
    } else {
      from = this.trustedFrom(m, msg.from, now);
    }
    const a = hall.place.desks[d].approach;
    const path = findPath(hall.grid, from, [a.x, a.z]);
    if (!path) return this.error(m, 'nopath');
    hall.desks[d] = m.id;
    m.desk = d;
    m.state = STATE.SEATED;
    m.since = now;
    m.mins = 0;
    this.setPath(m, path, now);
    hall.push(['seat', m.id, d]);
    this.pushState(hall, m);
    hall.push(['go', m.id, path, now]);
  }

  onFocus(hall, m, msg, now) {
    if (m.desk < 0) return this.error(m, 'notseated');
    if (hall.place.desks[m.desk].rest) return this.error(m, 'bench');
    if (!this.cool(m, 'session', now)) return;
    this.endSession(hall, m, now);
    m.state = STATE.FOCUS;
    m.since = now;
    m.mins = msg.mins;
    m.tag = msg.tag;
    hall.statsDirty = true;
    this.pushState(hall, m);
  }

  onRest(hall, m, msg, now) {
    if (m.desk < 0) return this.error(m, 'notseated');
    if (hall.place.desks[m.desk].rest) return this.error(m, 'bench');
    if (!this.cool(m, 'session', now)) return;
    this.endSession(hall, m, now);
    m.state = STATE.BREAK;
    m.since = now;
    m.mins = msg.mins;
    this.pushState(hall, m);
  }

  onDone(hall, m, now) {
    if (m.state !== STATE.FOCUS || m.mins === 0) return;
    if (now - m.since < m.mins * MIN - DONE_EARLY_MS) return this.error(m, 'early');
    this.complete(hall, m, now);
  }

  onGift(hall, m, msg, now) {
    const owner = hall.desks[msg.desk];
    if (!owner || owner === m.id || hall.place.desks[msg.desk].rest) return this.error(m, 'nogift');
    if (!this.cool(m, 'gift', now)) return this.error(m, 'cooldown', { left: COOLDOWN.gift - (now - m.last.gift) });
    const until = now + TEA_MS;
    hall.tea.set(msg.desk, until);
    hall.push(['tea', m.id, msg.desk, until]);
  }

  /** Moves to a particular room (from the room list, or to join a friend). */
  onSwitch(hall, m, msg, now) {
    if (msg.hall === hall.id) return;
    const target = this.halls.get(msg.hall);
    if (!target || target.count >= target.capacity) return this.error(m, 'full', { hall: msg.hall });
    if (!this.cool(m, 'switch', now)) return this.error(m, 'wait', { left: COOLDOWN.switch - (now - m.last.switch) });
    this.moveTo(hall, m, target, now);
  }

  /** Goes through a door (or uses the map) into the busiest room of another place. */
  onEnter(hall, m, msg, now) {
    if (msg.place === hall.kind) return this.error(m, 'here');
    if (!this.cool(m, 'switch', now)) return this.error(m, 'wait', { left: COOLDOWN.switch - (now - m.last.switch) });
    const target = this.pickHall(null, msg.place);
    if (!target) return this.error(m, 'full', { place: msg.place });
    this.moveTo(hall, m, target, now);
  }

  /** Leaves one room for another; you appear at the door you came through. */
  moveTo(hall, m, target, now) {
    if (m.desk >= 0) this.freeDesk(hall, m, now);
    hall.members.delete(m.id);
    hall.push(['l', m.id]);
    this.retireIfEmpty(hall);
    m.hallId = target.id;
    m.path = null;
    m.pos = spawnPoint(target.place, this.random, hall.kind);
    m.state = STATE.STAND;
    m.since = now;
    target.members.set(m.id, m);
    this.welcome(target, m, now);
    target.push(['j', this.view(m, now)]);
    this.admitQueue(now);
  }

  onStyle(hall, m, msg, now) {
    if (!this.cool(m, 'style', now)) return;
    const r = this.profiles.style(m.profileId, msg);
    if (!r.ok) return this.error(m, r.error);
    m.look = r.look;
    m.name = r.name;
    hall.push(['look', m.id, m.name, m.look]);
    this.sendMe(m, now);
  }

  onBuy(m, msg, now) {
    if (!this.cool(m, 'shop', now)) return;
    const r = this.profiles.buy(m.profileId, msg.item, now);
    if (!r.ok) return this.error(m, r.error, { item: msg.item });
    m.client?.send({ t: 'bought', item: msg.item });
    this.sendMe(m, now);
  }

  onWear(hall, m, msg, now) {
    if (!this.cool(m, 'shop', now)) return;
    const look = msg.t === 'equip' ? this.profiles.equip(m.profileId, msg.item) : this.profiles.unequip(m.profileId, msg.slot);
    if (!look) return this.error(m, 'notowned', { item: msg.item });
    m.look = look;
    hall.push(['look', m.id, m.name, m.look]);
    this.sendMe(m, now);
  }

  // ---------------------------------------------------------------- friends

  /** What a friend is doing right now, if they're in a room. */
  presence(profileId) {
    const f = this.byProfile.get(profileId);
    const hall = f && this.halls.get(f.hallId);
    if (!hall) return { online: false };
    return { online: true, hall: f.hallId, place: hall.kind, n: hall.n, st: f.state, since: f.since, mins: f.mins };
  }

  sendFriends(m) {
    if (!m.client) return;
    const lists = this.profiles.friendLists(m.profileId);
    const brief = (p) => ({ id: p.id, name: p.name, c: sanitizeLook(p.look).c });
    m.client.send({
      t: 'friends',
      friends: lists.friends.map((p) => ({ ...brief(p), ...this.presence(p.id) })),
      incoming: lists.incoming.map(brief),
      outgoing: lists.outgoing.map(brief),
    });
  }

  notify(profileId, notice) {
    const target = this.byProfile.get(profileId);
    if (!target?.client) return;
    target.client.send({ t: 'notice', ...notice });
    this.sendFriends(target);
  }

  onFriend(m, msg, now) {
    if (!this.cool(m, 'friend', now)) return;
    if (msg.t === 'friendAdd') {
      const r = this.profiles.addFriend(m.profileId, msg.code, now);
      if (!r.ok) return this.error(m, r.error);
      this.notify(r.other.id, { kind: r.accepted ? 'friendAccepted' : 'friendRequest', name: m.name });
      if (r.accepted) m.client?.send({ t: 'notice', kind: 'friendAccepted', name: r.other.name });
      else m.client?.send({ t: 'notice', kind: 'friendSent', name: r.other.name });
    } else if (msg.t === 'friendAccept') {
      if (this.profiles.acceptFriend(m.profileId, msg.id, now)) this.notify(msg.id, { kind: 'friendAccepted', name: m.name });
    } else {
      if (this.profiles.removeFriend(m.profileId, msg.id)) this.notify(msg.id, { kind: 'friendsChanged' });
    }
    this.sendFriends(m);
  }

  // ---------------------------------------------------------------- helpers

  cool(m, kind, now) {
    const last = m.last[kind];
    if (last !== undefined && now - last < COOLDOWN[kind]) return false;
    m.last[kind] = now;
    return true;
  }

  error(m, code, extra) {
    m.client?.send({ t: 'err', code, ...extra });
  }

  /** Where a member is now, finishing their walk if it has ended. */
  position(m, now) {
    if (m.path) {
      const dist = ((now - m.t0) / 1000) * WALK_SPEED;
      if (dist >= m.len) {
        m.pos = m.path[m.path.length - 1];
        m.path = null;
      } else {
        const p = samplePath(m.path, dist);
        return [round2(p.x), round2(p.z)];
      }
    }
    return m.pos;
  }

  trustedFrom(m, from, now) {
    const est = this.position(m, now);
    return Math.hypot(est[0] - from[0], est[1] - from[1]) <= POS_TOLERANCE ? from : est;
  }

  setPath(m, path, now) {
    m.path = path;
    m.t0 = now;
    m.len = pathLength(path);
  }

  /** Stands a member up and frees their desk. They stay where they are (or behind the chair). */
  freeDesk(hall, m, now) {
    const d = m.desk;
    this.endSession(hall, m, now);
    const current = this.position(m, now); // also finishes the walk if it is over
    const a = hall.place.desks[d].approach;
    m.pos = m.path ? current : [a.x, a.z];
    m.path = null;
    hall.desks[d] = 0;
    m.desk = -1;
    m.state = STATE.STAND;
    m.since = now;
    if (hall.tea.delete(d)) hall.push(['tea', 0, d, 0]);
    hall.push(['seat', m.id, -1, m.pos]);
    this.pushState(hall, m);
  }

  /**
   * Ends a focus session or break. Focus time is credited to the room and to the member's
   * profile as lumens. A completed timed session earns its full length plus a bonus.
   * Returns the minutes credited.
   */
  endSession(hall, m, now, completed = false) {
    let credited = 0;
    if (m.state === STATE.FOCUS) {
      const capMin = m.mins > 0 ? m.mins : OPEN_FOCUS_CAP;
      credited = completed && m.mins > 0 ? m.mins : Math.floor(Math.min(now - m.since, capMin * MIN) / MIN);
      if (credited > 0) hall.addMinutes(credited, now);
      hall.statsDirty = true;
      const gained = this.profiles.credit(m.profileId, credited, completed && m.mins > 0, m.tz, now);
      if (m.client && gained > 0) {
        m.client.send({ t: 'earn', n: gained, mins: credited, done: completed });
        this.sendMe(m, now);
      }
    }
    if (m.state === STATE.FOCUS || m.state === STATE.BREAK) {
      m.state = STATE.SEATED;
      m.since = now;
      m.mins = 0;
    }
    return credited;
  }

  complete(hall, m, now) {
    const planned = m.mins > 0 ? m.mins : OPEN_FOCUS_CAP;
    this.endSession(hall, m, now, true);
    this.pushState(hall, m);
    hall.push(['fin', m.id, planned]);
  }

  pushState(hall, m) {
    hall.push(['st', m.id, m.state, m.since, m.mins, m.tag]);
  }

  view(m, now) {
    const pos = this.position(m, now);
    const v = { id: m.id, nm: m.name, lk: m.look, desk: m.desk, st: m.state, since: m.since, mins: m.mins, tag: m.tag, pos };
    if (m.path) {
      v.path = m.path;
      v.t0 = m.t0;
    }
    return v;
  }

  stats(hall, now) {
    let running = 0;
    for (const m of hall.members.values()) {
      if (m.state !== STATE.FOCUS) continue;
      const capMin = m.mins > 0 ? m.mins : OPEN_FOCUS_CAP;
      running += Math.min(now - m.since, capMin * MIN) / MIN;
    }
    return [hall.lit, Math.floor(hall.minutes24(now) + running)];
  }

  globalSummary() {
    let on = 0;
    let fo = 0;
    const h = [];
    for (const hall of this.halls.values()) {
      on += hall.count;
      fo += hall.lit;
      h.push([hall.id, hall.count, placeIndex(hall.kind), hall.n, hall.capacity]);
    }
    h.sort((a, b) => a[0] - b[0]);
    return { on, fo, h, cap: this.capacity, max: this.maxHalls, q: this.queue.length };
  }

  /** Small cached summary for the public status endpoint. */
  status() {
    const now = this.now();
    if (!this.statusCache || now - this.statusCache.at > 2000) {
      const g = this.globalSummary();
      this.statusCache = { at: now, body: { online: g.on, focusing: g.fo, halls: g.h.length, queue: g.q } };
    }
    return this.statusCache.body;
  }

  // ---------------------------------------------------------------- ticking

  /** Call every ~200 ms: sends batched room events and does periodic housekeeping. */
  tick() {
    const now = this.now();
    if (now - this.lastHousekeeping >= 1000) {
      this.lastHousekeeping = now;
      this.housekeeping(now);
    }
    if (now - this.lastStats >= 15_000) {
      this.lastStats = now;
      for (const h of this.halls.values()) h.statsDirty = true;
    }
    for (const hall of this.halls.values()) {
      if (hall.statsDirty && hall.count > 0) {
        hall.statsDirty = false;
        hall.push(['hs', ...this.stats(hall, now)]);
      }
      if (hall.events.length === 0) continue;
      const raw = JSON.stringify({ t: 'b', ev: hall.events });
      hall.events = [];
      for (const m of hall.members.values()) m.client?.sendRaw(raw);
    }
    if (now - this.lastGlobal >= 5000) {
      this.lastGlobal = now;
      this.broadcastGlobal();
    }
  }

  housekeeping(now) {
    for (const hall of [...this.halls.values()]) {
      for (const [desk, until] of hall.tea) {
        if (until <= now) {
          hall.tea.delete(desk);
          hall.push(['tea', 0, desk, 0]);
        }
      }
      for (const m of [...hall.members.values()]) {
        if (!m.client && m.ghostUntil <= now) {
          this.remove(m, now);
          continue;
        }
        if (m.state === STATE.FOCUS) {
          const end = m.mins > 0 ? m.since + m.mins * MIN + DONE_GRACE_MS : m.since + OPEN_FOCUS_CAP * MIN;
          if (now >= end) this.complete(hall, m, now);
        } else if (m.state === STATE.BREAK && now >= m.since + m.mins * MIN) {
          this.endSession(hall, m, now);
          this.pushState(hall, m);
        }
      }
    }
  }

  broadcastGlobal() {
    const raw = JSON.stringify({ t: 'g', ...this.globalSummary() });
    for (const m of this.byClient.values()) m.client.sendRaw(raw);
    this.queue.forEach((q, i) => q.client.send({ t: 'queue', pos: i + 1, total: this.queue.length }));
  }
}
