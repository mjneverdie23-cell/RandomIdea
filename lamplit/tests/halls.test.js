import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HallManager, Hall } from '../server/halls.js';
import { DESKS } from '../shared/layout.js';
import { STATE, PROTOCOL, RESUME_GRACE_MS, OPEN_FOCUS_CAP, TEA_MS } from '../shared/protocol.js';

const MIN = 60_000;

class FakeClient {
  static next = 1;
  constructor() {
    this.id = FakeClient.next++;
    this.inbox = [];
    this.closed = null;
  }
  send(obj) {
    this.inbox.push(obj);
  }
  sendRaw(raw) {
    this.inbox.push(JSON.parse(raw));
  }
  close(reason) {
    this.closed = reason;
  }
  last(t) {
    return this.inbox.filter((m) => m.t === t).at(-1);
  }
  events(kind) {
    return this.inbox.filter((m) => m.t === 'b').flatMap((m) => m.ev).filter((e) => !kind || e[0] === kind);
  }
}

function setup(opts = {}) {
  const clock = { t: 1_700_000_000_000 };
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const mgr = new HallManager({ now: () => clock.t, random, ...opts });
  const advance = (ms) => {
    clock.t += ms;
    mgr.tick();
  };
  const join = (extra = {}) => {
    const c = new FakeClient();
    const result = mgr.join(c, { t: 'hello', v: PROTOCOL, name: [1, 2, 3], color: 0, lamp: 0, ...extra });
    return { c, result, id: c.last('welcome')?.id };
  };
  const me = (c) => mgr.byClient.get(c.id);
  return { mgr, clock, advance, join, me };
}

test('joining sends a welcome and tells the room', () => {
  const { mgr, join, advance } = setup();
  const a = join();
  assert.equal(a.result, 'joined');
  const w = a.c.last('welcome');
  assert.equal(w.hall, 1);
  assert.equal(w.members.length, 1);
  assert.ok(w.resume.length >= 8);
  const b = join();
  advance(250);
  assert.ok(a.c.events('j').some((e) => e[1].id === b.id), 'first visitor sees the second arrive');
  assert.equal(mgr.status().online, 2);
});

test('rooms fill busiest-first, open new rooms, then queue', () => {
  const { mgr, join } = setup({ capacity: 2, maxHalls: 2 });
  const a = join();
  const b = join();
  const c = join();
  assert.equal(a.c.last('welcome').hall, 1);
  assert.equal(b.c.last('welcome').hall, 1);
  assert.equal(c.c.last('welcome').hall, 2);
  join();
  const e = join();
  assert.equal(e.result, 'queued');
  assert.equal(e.c.last('queue').pos, 1);
  mgr.leave(a.c, { immediate: true });
  assert.equal(e.c.last('welcome')?.hall, 1, 'queued visitor gets the freed seat');
});

test('an empty extra room is closed, room 1 is kept', () => {
  const { mgr, join } = setup({ capacity: 1, maxHalls: 3 });
  const a = join();
  const b = join();
  assert.equal(b.c.last('welcome').hall, 2);
  mgr.leave(b.c, { immediate: true });
  assert.ok(!mgr.halls.has(2));
  mgr.leave(a.c, { immediate: true });
  assert.ok(mgr.halls.has(1));
});

test('a desk can only be claimed by one visitor', () => {
  const { mgr, join, me, advance } = setup();
  const a = join();
  const b = join();
  const from = me(a.c).pos;
  mgr.handle(a.c, { t: 'sit', desk: 12, from });
  mgr.handle(b.c, { t: 'sit', desk: 12, from: me(b.c).pos });
  assert.equal(b.c.last('err').code, 'taken');
  assert.equal(me(a.c).desk, 12);
  assert.equal(mgr.halls.get(1).desks[12], a.id);
  advance(250);
  const go = b.c.events('go').find((e) => e[1] === a.id);
  assert.deepEqual(go[2].at(-1), [DESKS[12].approach.x, DESKS[12].approach.z], 'the walk ends behind the chair');
});

test('focus sessions: early done is refused, completion is credited to the room', () => {
  const { mgr, join, me, advance, clock } = setup();
  const a = join();
  mgr.handle(a.c, { t: 'focus', mins: 25, tag: 1 });
  assert.equal(a.c.last('err').code, 'notseated');
  mgr.handle(a.c, { t: 'sit', desk: 3, from: me(a.c).pos });
  advance(10_000);
  mgr.handle(a.c, { t: 'focus', mins: 25, tag: 1 });
  assert.equal(me(a.c).state, STATE.FOCUS);
  advance(10 * MIN);
  mgr.handle(a.c, { t: 'done' });
  assert.equal(a.c.last('err').code, 'early');
  advance(15 * MIN);
  mgr.handle(a.c, { t: 'done' });
  assert.equal(me(a.c).state, STATE.SEATED);
  advance(250);
  assert.ok(a.c.events('fin').some((e) => e[1] === a.id && e[2] === 25));
  assert.equal(mgr.halls.get(1).minutes24(clock.t), 25);
});

test('stopping early credits only the minutes actually focused', () => {
  const { mgr, join, me, advance, clock } = setup();
  const a = join();
  mgr.handle(a.c, { t: 'sit', desk: 3, from: me(a.c).pos });
  advance(10_000);
  mgr.handle(a.c, { t: 'focus', mins: 50, tag: 0 });
  advance(7 * MIN + 30_000);
  mgr.handle(a.c, { t: 'stop' });
  assert.equal(me(a.c).state, STATE.SEATED);
  assert.equal(mgr.halls.get(1).minutes24(clock.t), 7);
});

test('unreported sessions finish on their own; open sessions are capped', () => {
  const { mgr, join, me, advance, clock } = setup();
  const a = join();
  const b = join();
  mgr.handle(a.c, { t: 'sit', desk: 1, from: me(a.c).pos });
  mgr.handle(b.c, { t: 'sit', desk: 2, from: me(b.c).pos });
  advance(10_000);
  mgr.handle(a.c, { t: 'focus', mins: 25, tag: 0 });
  mgr.handle(b.c, { t: 'focus', mins: 0, tag: 0 });
  advance(28 * MIN);
  assert.equal(me(a.c).state, STATE.SEATED, 'timed session auto-completed after the grace period');
  assert.equal(me(b.c).state, STATE.FOCUS);
  advance(OPEN_FOCUS_CAP * MIN);
  assert.equal(me(b.c).state, STATE.SEATED, 'open session ends at the cap');
  assert.equal(mgr.halls.get(1).minutes24(clock.t), 25 + OPEN_FOCUS_CAP);
});

test('breaks end by themselves', () => {
  const { mgr, join, me, advance } = setup();
  const a = join();
  mgr.handle(a.c, { t: 'sit', desk: 9, from: me(a.c).pos });
  advance(10_000);
  mgr.handle(a.c, { t: 'rest', mins: 5 });
  assert.equal(me(a.c).state, STATE.BREAK);
  advance(5 * MIN + 1000);
  assert.equal(me(a.c).state, STATE.SEATED);
});

test('standing up frees the desk and removes any tea', () => {
  const { mgr, join, me, advance } = setup();
  const a = join();
  const b = join();
  mgr.handle(a.c, { t: 'sit', desk: 20, from: me(a.c).pos });
  advance(40_000); // long enough to finish the walk from the entrance
  mgr.handle(b.c, { t: 'gift', desk: 20 });
  const hall = mgr.halls.get(1);
  assert.ok(hall.tea.has(20));
  advance(1000);
  mgr.handle(a.c, { t: 'stand' });
  assert.equal(hall.desks[20], 0);
  assert.ok(!hall.tea.has(20));
  assert.equal(me(a.c).state, STATE.STAND);
  assert.deepEqual(me(a.c).pos, [DESKS[20].approach.x, DESKS[20].approach.z]);
});

test('tea: only to someone else, with a cooldown, and it goes cold', () => {
  const { mgr, join, me, advance } = setup();
  const a = join();
  const b = join();
  mgr.handle(a.c, { t: 'sit', desk: 30, from: me(a.c).pos });
  mgr.handle(b.c, { t: 'sit', desk: 31, from: me(b.c).pos });
  advance(1000);
  mgr.handle(a.c, { t: 'gift', desk: 30 });
  assert.equal(a.c.last('err').code, 'nogift', 'not to yourself');
  mgr.handle(a.c, { t: 'gift', desk: 50 });
  assert.equal(a.c.last('err').code, 'nogift', 'not to an empty desk');
  mgr.handle(a.c, { t: 'gift', desk: 31 });
  mgr.handle(a.c, { t: 'gift', desk: 31 });
  assert.equal(a.c.last('err').code, 'cooldown');
  advance(250);
  assert.equal(b.c.events('tea').filter((e) => e[1] === a.id).length, 1);
  advance(TEA_MS + 1000);
  assert.ok(!mgr.halls.get(1).tea.has(31));
});

test('a dropped visitor keeps their desk and session, and can resume', () => {
  const { mgr, join, me, advance } = setup();
  const a = join();
  mgr.handle(a.c, { t: 'sit', desk: 44, from: me(a.c).pos });
  advance(10_000);
  mgr.handle(a.c, { t: 'focus', mins: 50, tag: 2 });
  const token = a.c.last('welcome').resume;
  mgr.leave(a.c); // connection dropped
  advance(30_000);
  assert.equal(mgr.halls.get(1).desks[44], a.id, 'desk held during the grace period');
  const again = join({ resume: token });
  assert.equal(again.result, 'resumed');
  const w = again.c.last('welcome');
  assert.equal(w.id, a.id);
  const self = w.members.find((m) => m.id === a.id);
  assert.equal(self.desk, 44);
  assert.equal(self.st, STATE.FOCUS);
  assert.notEqual(w.resume, token, 'token rotates');
});

test('the seat is freed once the grace period passes', () => {
  const { mgr, join, me, advance } = setup();
  const a = join();
  mgr.handle(a.c, { t: 'sit', desk: 44, from: me(a.c).pos });
  const token = a.c.last('welcome').resume;
  mgr.leave(a.c);
  advance(RESUME_GRACE_MS + 2000);
  assert.equal(mgr.halls.get(1).desks[44], 0);
  assert.equal(join({ resume: token }).result, 'joined', 'stale token starts fresh');
});

test('resuming while the old socket is still open replaces it', () => {
  const { mgr, join } = setup();
  const a = join();
  const token = a.c.last('welcome').resume;
  const b = join({ resume: token });
  assert.equal(b.result, 'resumed');
  assert.equal(a.c.closed, 'replaced');
  assert.equal(mgr.status().online, 1);
  mgr.leave(a.c); // late close of the old socket must not remove the visitor
  assert.equal(mgr.status().online, 1);
});

test('walking: no walking while seated, and teleport attempts are corrected', () => {
  const { mgr, join, me, advance } = setup();
  const a = join();
  const start = me(a.c).pos;
  mgr.handle(a.c, { t: 'go', from: [-10, -10], to: [0, 0] });
  advance(250);
  const go = a.c.events('go').at(-1);
  assert.deepEqual(go[2][0], start, 'path starts where the server knows the visitor is');
  advance(60_000);
  mgr.handle(a.c, { t: 'sit', desk: 5, from: me(a.c).pos });
  mgr.handle(a.c, { t: 'go', from: me(a.c).pos, to: [0, 0] });
  assert.equal(a.c.last('err').code, 'seated');
});

test('switching rooms frees the desk and welcomes you to the new room', () => {
  const { mgr, join, me } = setup({ capacity: 1, maxHalls: 3 });
  const a = join();
  const b = join();
  mgr.handle(b.c, { t: 'sit', desk: 7, from: me(b.c).pos });
  mgr.handle(a.c, { t: 'switch', hall: 2 });
  assert.equal(a.c.last('err').code, 'full');
  mgr.leave(a.c, { immediate: true });
  const hall2 = mgr.halls.get(2);
  mgr.handle(b.c, { t: 'switch', hall: 1 });
  assert.equal(b.c.last('welcome').hall, 1);
  assert.equal(hall2.desks[7], 0);
  assert.ok(!mgr.halls.has(2), 'room 2 closed once empty');
});

test('rolling 24-hour minutes drop old hours', () => {
  const hall = new Hall(1, 100);
  const t0 = 1_700_000_000_000;
  hall.addMinutes(30, t0);
  hall.addMinutes(15, t0 + 3 * 3600_000);
  assert.equal(hall.minutes24(t0 + 3 * 3600_000), 45);
  assert.equal(hall.minutes24(t0 + 25 * 3600_000), 15);
  assert.equal(hall.minutes24(t0 + 40 * 3600_000), 0);
});

test('room stats include sessions still running', () => {
  const { mgr, join, me, advance, clock } = setup();
  const a = join();
  mgr.handle(a.c, { t: 'sit', desk: 0, from: me(a.c).pos });
  advance(1000);
  mgr.handle(a.c, { t: 'focus', mins: 90, tag: 0 });
  advance(20 * MIN);
  const [lit, mins] = mgr.stats(mgr.halls.get(1), clock.t);
  assert.equal(lit, 1);
  assert.equal(mins, 20);
});
