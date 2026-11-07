#!/usr/bin/env node
// Simulated visitors, for demos and load tests. They speak the real protocol: walk in,
// take a free desk, light the lamp, finish sessions, take breaks, wave, send tea and
// sometimes leave.
//
//   node tools/bots.js --count 60 --room 1            # liven up room 1
//   node tools/bots.js --count 5000 --ramp 200 --quiet # load test (see README)
//
// Options: --url ws://localhost:8080/ws  --count N  --room N  --ramp N per second
//          --duration seconds (0 = forever)  --short (5-minute sessions)  --quiet

import WebSocket from 'ws';
import { PROTOCOL, STATE, FOCUS_PRESETS } from '../shared/protocol.js';
import { DESKS, DESK_COUNT, WALK_SPEED } from '../shared/layout.js';
import { randomName, SWEATERS, SUBJECTS } from '../shared/words.js';

function parseArgs(argv) {
  const out = { url: 'ws://localhost:8080/ws', count: 40, room: 0, ramp: 10, duration: 0, short: false, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'short' || key === 'quiet') out[key] = true;
    else if (key in out) out[key] = key === 'url' ? argv[++i] : Number(argv[++i]);
  }
  return out;
}

const opts = parseArgs(process.argv);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const rand = (a, b) => a + Math.random() * (b - a);

const stats = { open: 0, joined: 0, welcomeMs: [], msgs: 0, bytes: 0, errors: 0, closed: 0 };

class Bot {
  constructor(n) {
    this.n = n;
    this.timers = new Set();
    this.memberDesk = new Map();
    this.desks = new Int32Array(DESK_COUNT);
    this.self = 0;
    this.desk = -1;
    this.state = STATE.STAND;
    this.pos = [0, 15];
    this.name = randomName();
    this.color = Math.floor(Math.random() * SWEATERS.length);
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

  connect() {
    this.startedAt = Date.now();
    const ws = new WebSocket(opts.url);
    this.ws = ws;
    ws.on('open', () => {
      stats.open++;
      const hello = { t: 'hello', v: PROTOCOL, name: this.name, color: this.color, lamp: Math.random() < 0.8 ? 0 : 1 + Math.floor(Math.random() * 3) };
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
      this.desks.fill(0);
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
      this.later(rand(500, 4000), () => this.findDesk());
    } else if (msg.t === 'b') {
      for (const ev of msg.ev) this.onEvent(ev);
    } else if (msg.t === 'err' && msg.code === 'taken') {
      this.later(rand(300, 1200), () => this.findDesk());
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
      if (this.desk >= 0) this.later((len / WALK_SPEED) * 1000 + rand(800, 3000), () => this.startFocus());
    } else if (kind === 'st' && id === this.self) {
      this.state = ev[2];
    } else if (kind === 'fin' && id === this.self) {
      this.afterSession();
    }
  }

  findDesk() {
    if (this.desk >= 0) return;
    const free = [];
    for (let i = 0; i < DESK_COUNT; i++) if (!this.desks[i]) free.push(i);
    if (free.length === 0) {
      this.later(rand(5000, 10000), () => this.findDesk());
      return;
    }
    this.send({ t: 'sit', desk: pick(free), from: this.pos });
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
        for (let i = 0; i < DESK_COUNT; i++) if (this.desks[i] && this.desks[i] !== this.self) others.push(i);
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
    } else if (r < 0.92) {
      this.send({ t: 'stand' });
      this.later(rand(3000, 8000), () => {
        const d = pick(DESKS);
        this.send({ t: 'go', from: [d.approach.x, d.approach.z], to: [rand(-10, 10), rand(-14, 14)] });
        this.later(rand(6000, 15_000), () => this.findDesk());
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
  const line = `bots ${started}/${opts.count} open ${stats.open} joined ${stats.joined} | welcome p50 ${p(0.5)}ms p95 ${p(0.95)}ms | ${((stats.msgs - lastMsgs) / 5).toFixed(0)} msg/s ${((stats.bytes - lastBytes) / 5 / 1024).toFixed(1)} KiB/s in | errors ${stats.errors} closed ${stats.closed}`;
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
