#!/usr/bin/env node
// Simulated visitors, for demos and load tests. They speak the real protocol: each one
// continues as a guest, spends its lumens in the shop, walks in, takes a free desk,
// lights the lamp, finishes sessions, takes breaks, waves, sends tea, sometimes steps out
// to the town square (strolling, sitting on benches, wandering into another building)
// and sometimes leaves.
//
//   node tools/bots.js --count 80                      # spread across every place
//   node tools/bots.js --count 40 --place cafe         # fill the coffee shop
//   node tools/bots.js --count 5000 --ramp 200 --quiet # load test (see README)
//
// Every bot creates a guest profile, so start the server with a higher sign-in rate
// limit, e.g. AUTH_PER_MIN=100000 AUTH_BURST=100000 MAX_CONN_PER_IP=100000 npm start
//
// Options: --url ws://localhost:8080/ws  --count N  --room N  --ramp N per second
//          --place library|cafe|netcafe|square|pyramid|giza|colosseum|rome|temple|garden|mix
//          --duration seconds (0 = forever)  --short (5-minute sessions)  --quiet

import WebSocket from 'ws';
import { PROTOCOL, STATE, FOCUS_PRESETS } from '../shared/protocol.js';
import { WALK_SPEED } from '../shared/layout.js';
import { PLACES, isPlace } from '../shared/places.js';
import { SWEATERS, SUBJECTS } from '../shared/words.js';
import { ITEMS } from '../shared/catalog.js';

function parseArgs(argv) {
  const out = { url: 'ws://localhost:8080/ws', count: 40, room: 0, ramp: 10, duration: 0, short: false, quiet: false, place: 'mix' };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'short' || key === 'quiet') out[key] = true;
    else if (key in out) out[key] = key === 'url' || key === 'place' ? argv[++i] : Number(argv[++i]);
  }
  return out;
}

const opts = parseArgs(process.argv);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const rand = (a, b) => a + Math.random() * (b - a);

const stats = { open: 0, joined: 0, welcomeMs: [], msgs: 0, bytes: 0, errors: 0, closed: 0, bought: 0 };
const httpBase = opts.url.replace(/^ws/, 'http').replace(/\/ws$/, '');
const ZONES = ['Asia/Seoul', 'Asia/Tokyo', 'Asia/Taipei', 'Asia/Ho_Chi_Minh', 'Europe/London', 'America/New_York'];
/**
 * Where a bot starts out: most study in town (the library, the café, the net café), a few
 * are outside in the square, and some are abroad in Egypt, Italy or Japan.
 */
function startPlace() {
  if (isPlace(opts.place)) return opts.place;
  const r = Math.random();
  if (r < 0.3) return 'library';
  if (r < 0.48) return 'cafe';
  if (r < 0.6) return 'netcafe';
  if (r < 0.66) return 'square';
  return pick(['pyramid', 'colosseum', 'temple', 'pyramid', 'colosseum', 'temple', 'giza', 'rome', 'garden']);
}

class Bot {
  constructor(n) {
    this.n = n;
    this.timers = new Set();
    this.memberDesk = new Map();
    this.kind = startPlace();
    this.place = PLACES[this.kind];
    this.desks = new Int32Array(this.place.desks.length);
    this.self = 0;
    this.desk = -1;
    this.state = STATE.STAND;
    this.pos = [0, 15];
    this.token = null;
    this.tz = pick(ZONES);
    this.stopped = false;
  }

  later(ms, fn) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.stopped) fn();
    }, ms);
    this.timers.add(id);
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  /** Continues as a guest the first time; reconnects reuse the same profile. */
  async signIn() {
    while (!this.token && !this.stopped) {
      try {
        const res = await fetch(`${httpBase}/api/guest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tz: this.tz }) });
        if (res.ok) this.token = (await res.json()).token;
        else await new Promise((r) => setTimeout(r, 2000));
      } catch {
        stats.errors++;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  async connect() {
    this.startedAt = Date.now();
    await this.signIn();
    if (this.stopped) return;
    const ws = new WebSocket(opts.url);
    this.ws = ws;
    ws.on('open', () => {
      stats.open++;
      const hello = { t: 'hello', v: PROTOCOL, auth: this.token, tz: this.tz, place: this.kind };
      if (opts.room) hello.hall = opts.room;
      this.send(hello);
    });
    ws.on('message', (data) => {
      stats.msgs++;
      stats.bytes += data.length;
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      this.onMessage(msg);
    });
    ws.on('close', () => {
      stats.open--;
      stats.closed++;
      for (const id of this.timers) clearTimeout(id);
      this.timers.clear();
      if (!this.stopped) this.later(rand(2000, 6000), () => this.connect());
    });
    ws.on('error', () => {
      stats.errors++;
    });
  }

  stop() {
    this.stopped = true;
    for (const id of this.timers) clearTimeout(id);
    this.send({ t: 'leave' });
    this.ws?.close();
  }

  onMessage(msg) {
    if (msg.t === 'welcome') {
      stats.joined++;
      stats.welcomeMs.push(Date.now() - this.startedAt);
      this.self = msg.id;
      this.kind = msg.place;
      this.place = PLACES[msg.place];
      this.pendingEnter = null;
      this.desks = new Int32Array(this.place.desks.length);
      this.memberDesk.clear();
      for (const m of msg.members) {
        if (m.desk >= 0) {
          this.desks[m.desk] = m.id;
          this.memberDesk.set(m.id, m.desk);
        }
        if (m.id === msg.id) this.pos = m.pos;
      }
      this.desk = -1;
      this.state = STATE.STAND;
      this.goShopping(msg.me);
      // Outside, a bot strolls and sits for a good while before heading in to study.
      if (!this.place.indoor) this.later(rand(800, 3000), () => this.stroll(8 + Math.floor(Math.random() * 8)));
      else this.later(rand(500, 4000), () => this.findDesk());
    } else if (msg.t === 'b') {
      for (const ev of msg.ev) this.onEvent(ev);
    } else if (msg.t === 'err' && msg.code === 'taken') {
      this.later(rand(300, 1200), () => this.findDesk());
    } else if (msg.t === 'err' && msg.code === 'wait' && this.pendingEnter) {
      this.later((msg.left ?? 1500) + 200, () => this.enter(this.pendingEnter));
    }
  }

  onEvent(ev) {
    const [kind, id] = ev;
    if (kind === 'seat') {
      const old = this.memberDesk.get(id);
      if (old !== undefined && this.desks[old] === id) this.desks[old] = 0;
      if (ev[2] >= 0) {
        this.desks[ev[2]] = id;
        this.memberDesk.set(id, ev[2]);
      } else {
        this.memberDesk.delete(id);
      }
      if (id === this.self) this.desk = ev[2];
    } else if (kind === 'l') {
      const old = this.memberDesk.get(id);
      if (old !== undefined && this.desks[old] === id) this.desks[old] = 0;
      this.memberDesk.delete(id);
    } else if (kind === 'go' && id === this.self) {
      const path = ev[2];
      const len = path.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) : 0), 0);
      this.pos = path[path.length - 1];
      if (this.desk >= 0 && !this.place.desks[this.desk]?.rest) this.later((len / WALK_SPEED) * 1000 + rand(800, 3000), () => this.startFocus());
      this.walkMs = (len / WALK_SPEED) * 1000;
    } else if (kind === 'st' && id === this.self) {
      this.state = ev[2];
    } else if (kind === 'fin' && id === this.self) {
      this.afterSession();
    }
  }

  /** Buys and wears a few random things it can afford, one per kind of slot. */
  goShopping(me) {
    if (!me || me.owned.length > 0) return;
    let budget = me.lumens;
    const slots = new Set();
    const wishlist = ITEMS.filter((it) => it.price > 0).sort(() => Math.random() - 0.5);
    let delay = 300;
    for (const it of wishlist) {
      if (it.price > budget || slots.has(it.slot) || Math.random() < 0.35) continue;
      budget -= it.price;
      slots.add(it.slot);
      this.later(delay, () => {
        this.send({ t: 'buy', item: it.id });
        stats.bought++;
      });
      this.later(delay + 350, () => this.send({ t: 'equip', item: it.id }));
      delay += 800;
    }
    if (Math.random() < 0.5) this.later(delay, () => this.send({ t: 'style', color: Math.floor(Math.random() * SWEATERS.length) }));
  }

  findDesk() {
    if (this.desk >= 0) return;
    const free = [];
    for (let i = 0; i < this.desks.length; i++) if (!this.desks[i]) free.push(i);
    if (free.length === 0) {
      this.later(rand(5000, 10000), () => this.findDesk());
      return;
    }
    this.send({ t: 'sit', desk: pick(free), from: this.pos });
  }

  enter(place) {
    if (this.kind === place) return;
    this.pendingEnter = place;
    this.send({ t: 'enter', place });
  }

  /** Outside: walk about, sit on a bench for a while, then head into a building to study. */
  stroll(steps) {
    if (this.place.indoor) return;
    if (steps <= 0) {
      const door = pick(this.place.doors);
      if (this.desk >= 0) this.send({ t: 'stand' });
      this.send({ t: 'go', from: this.pos, to: [door.x, door.z] });
      this.later(1500, () => this.later(this.walkMs ?? 8000, () => this.enter(door.to)));
      return;
    }
    if (Math.random() < 0.35 && this.desk < 0) {
      this.findDesk();
      this.later(rand(30_000, 90_000), () => {
        this.send({ t: 'stand' });
        this.later(rand(800, 2000), () => this.stroll(steps - 1));
      });
      return;
    }
    if (this.desk >= 0) this.send({ t: 'stand' });
    const { width: w, depth: d } = this.place;
    this.send({ t: 'go', from: this.pos, to: [Math.round(rand(-w / 3, w / 3) * 100) / 100, Math.round(rand(-d / 3, d / 2.4) * 100) / 100] });
    this.later(rand(6000, 14_000), () => this.stroll(steps - 1));
  }

  startFocus() {
    if (this.desk < 0) return;
    const mins = opts.short ? 5 : Math.random() < 0.12 ? 0 : pick(FOCUS_PRESETS);
    this.send({ t: 'focus', mins, tag: Math.floor(Math.random() * SUBJECTS.length) });
    this.session = { mins, started: Date.now() };
    const length = (mins || rand(20, 70)) * 60_000;
    this.later(length + 300, () => (mins ? this.send({ t: 'done' }) : (this.send({ t: 'stop' }), this.afterSession())));
    this.scheduleFidget(length);
  }

  scheduleFidget(remaining) {
    const wait = rand(20_000, 90_000);
    if (wait > remaining) return;
    this.later(wait, () => {
      if (this.state !== STATE.FOCUS) return;
      const r = Math.random();
      if (r < 0.5) this.send({ t: 'emote', e: 1 });
      else if (r < 0.65) {
        const others = [];
        for (let i = 0; i < this.desks.length; i++) if (this.desks[i] && this.desks[i] !== this.self) others.push(i);
        if (others.length) this.send({ t: 'gift', desk: pick(others) });
      } else if (r < 0.8) this.send({ t: 'emote', e: 2 });
      this.scheduleFidget(remaining - wait);
    });
  }

  afterSession() {
    const r = Math.random();
    if (r < 0.5) {
      this.send({ t: 'rest', mins: 5 });
      this.later(5 * 60_000 + rand(2000, 20_000), () => this.startFocus());
    } else if (r < 0.8) {
      this.later(rand(2000, 15_000), () => this.startFocus());
    } else if (r < 0.86) {
      this.send({ t: 'stand' });
      this.later(rand(3000, 8000), () => {
        const d = this.place.desks[Math.max(0, this.desk)] ?? this.place.desks[0];
        const { width: w, depth: dd } = this.place;
        this.send({ t: 'go', from: [d.approach.x, d.approach.z], to: [rand(-w / 3, w / 3), rand(-dd / 3, dd / 3)] });
        this.later(rand(6000, 15_000), () => this.findDesk());
      });
    } else if (r < 0.94) {
      // A walk outside: through the door (to the square, or the outdoors abroad).
      this.send({ t: 'stand' });
      const door = this.place.doors[0];
      this.later(rand(1000, 3000), () => {
        this.send({ t: 'go', from: this.pos, to: [door.x, door.z] });
        this.later(rand(7000, 12_000), () => this.enter(door.to));
      });
    } else {
      this.send({ t: 'leave' });
      this.ws.close();
    }
  }
}

const bots = [];
let started = 0;
const rampTimer = setInterval(() => {
  const n = Math.min(opts.ramp, opts.count - started);
  for (let i = 0; i < n; i++) {
    const b = new Bot(started++);
    bots.push(b);
    b.connect();
  }
  if (started >= opts.count) clearInterval(rampTimer);
}, 1000);

let lastMsgs = 0;
let lastBytes = 0;
const report = setInterval(() => {
  const w = [...stats.welcomeMs].sort((a, b) => a - b);
  const p = (q) => (w.length ? w[Math.min(w.length - 1, Math.floor(q * w.length))] : 0);
  const line = `bots ${started}/${opts.count} open ${stats.open} joined ${stats.joined} | welcome p50 ${p(0.5)}ms p95 ${p(0.95)}ms | ${((stats.msgs - lastMsgs) / 5).toFixed(0)} msg/s ${((stats.bytes - lastBytes) / 5 / 1024).toFixed(1)} KiB/s in | bought ${stats.bought} | errors ${stats.errors} closed ${stats.closed}`;
  lastMsgs = stats.msgs;
  lastBytes = stats.bytes;
  if (!opts.quiet || started >= opts.count) console.log(line);
}, 5000);

function shutdown() {
  clearInterval(rampTimer);
  clearInterval(report);
  for (const b of bots) b.stop();
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (opts.duration > 0) setTimeout(shutdown, opts.duration * 1000);
