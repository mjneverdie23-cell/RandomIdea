import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HallManager, Hall } from '../server/halls.js';
import { openDb } from '../server/db.js';
import { ProfileService } from '../server/profiles.js';
import { PLACES } from '../shared/places.js';

const DESKS = PLACES.library.desks;
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
  const db = openDb(':memory:');
  const profiles = new ProfileService(db, { startLumens: 1000, random });
  const mgr = new HallManager({ profiles, now: () => clock.t, random, ...opts });
  const advance = (ms) => {
    clock.t += ms;
    mgr.tick();
  };
  /** Joins with a fresh guest profile, or with `token` to come back as someone. */
  const join = ({ token, ...extra } = {}) => {
    const c = new FakeClient();
    const auth = token ?? profiles.createGuest(clock.t, 'UTC').token;
    const result = mgr.join(c, { t: 'hello', v: PROTOCOL, auth, tz: 'UTC', ...extra });
    return { c, result, id: c.last('welcome')?.id, token: auth };
  };
  const me = (c) => mgr.byClient.get(c.id);
  return { mgr, clock, advance, join, me, profiles, db };
}

test('joining sends a welcome and tells the room', () => {
  const { mgr, join, advance } = setup();
  const a = join();
  assert.equal(a.result, 'joined');
  const w = a.c.last('welcome');
  assert.equal(w.hall, 1);
  assert.equal(w.members.length, 1);
  assert.equal(w.me.lumens, 1000, 'your profile arrives with the welcome');
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
  mgr.leave(a.c); // connection dropped
  advance(30_000);
  assert.equal(mgr.halls.get(1).desks[44], a.id, 'desk held during the grace period');
  const again = join({ token: a.token });
  assert.equal(again.result, 'resumed');
  const w = again.c.last('welcome');
  assert.equal(w.id, a.id);
  const self = w.members.find((m) => m.id === a.id);
  assert.equal(self.desk, 44);
  assert.equal(self.st, STATE.FOCUS);
});

test('the seat is freed once the grace period passes', () => {
  const { mgr, join, me, advance } = setup();
  const a = join();
  mgr.handle(a.c, { t: 'sit', desk: 44, from: me(a.c).pos });
  mgr.leave(a.c);
  advance(RESUME_GRACE_MS + 2000);
  assert.equal(mgr.halls.get(1).desks[44], 0);
  assert.equal(join({ token: a.token }).result, 'joined', 'comes back as a new arrival');
});

test('the same account in a second tab takes over the seat', () => {
  const { mgr, join } = setup();
  const a = join();
  const b = join({ token: a.token });
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

// ---------------------------------------------------------------- accounts, lumens, shop, friends

test('an unknown token is turned away', () => {
  const { mgr } = setup();
  const c = new FakeClient();
  assert.equal(mgr.join(c, { t: 'hello', v: PROTOCOL, auth: 'x'.repeat(43) }), 'rejected');
  assert.equal(c.last('bye').reason, 'auth');
});

test('finishing a session earns lumens: one per minute plus a bonus', () => {
  const { mgr, join, me, advance } = setup();
  const a = join();
  mgr.handle(a.c, { t: 'sit', desk: 3, from: me(a.c).pos });
  advance(10_000);
  mgr.handle(a.c, { t: 'focus', mins: 25, tag: 0 });
  advance(25 * MIN - 2000); // `done` may arrive a moment early (clock skew)
  mgr.handle(a.c, { t: 'done' });
  const earn = a.c.last('earn');
  assert.deepEqual([earn.n, earn.mins, earn.done], [35, 25, true]);
  const p = a.c.last('me').p;
  assert.equal(p.lumens, 1035);
  assert.equal(p.today, 25);
  assert.equal(p.sessions, 1);
  assert.equal(p.streak, 1);
});

test('stopping early earns the minutes but no bonus', () => {
  const { mgr, join, me, advance } = setup();
  const a = join();
  mgr.handle(a.c, { t: 'sit', desk: 3, from: me(a.c).pos });
  advance(10_000);
  mgr.handle(a.c, { t: 'focus', mins: 50, tag: 0 });
  advance(12 * MIN + 20_000);
  mgr.handle(a.c, { t: 'stop' });
  assert.equal(a.c.last('earn').n, 12);
  assert.equal(a.c.last('me').p.sessions, 0);
});

test('the shop: buying needs enough lumens and only happens once', () => {
  const { mgr, join, advance } = setup({});
  const a = join();
  mgr.handle(a.c, { t: 'buy', item: 'crown' }); // 900 of 1000
  assert.equal(a.c.last('bought').item, 'crown');
  assert.equal(a.c.last('me').p.lumens, 100);
  advance(300);
  mgr.handle(a.c, { t: 'buy', item: 'crown' });
  assert.equal(a.c.last('err').code, 'owned');
  advance(300);
  mgr.handle(a.c, { t: 'buy', item: 'laptop' });
  assert.equal(a.c.last('err').code, 'funds');
  assert.equal(a.c.last('me').p.lumens, 100, 'nothing spent on a failed purchase');
  assert.deepEqual(a.c.last('me').p.owned, ['crown']);
});

test('wearing: only what you own, and the room sees the change', () => {
  const { mgr, join, advance } = setup();
  const a = join();
  const b = join();
  mgr.handle(a.c, { t: 'equip', item: 'beanie' });
  assert.equal(a.c.last('err').code, 'notowned');
  advance(300);
  mgr.handle(a.c, { t: 'buy', item: 'beanie' });
  advance(300);
  mgr.handle(a.c, { t: 'equip', item: 'beanie' });
  advance(300);
  mgr.handle(a.c, { t: 'buy', item: 'cat' });
  advance(300);
  mgr.handle(a.c, { t: 'equip', item: 'cat' });
  advance(300);
  const look = b.c.events('look').filter((e) => e[1] === a.id).at(-1)[3];
  assert.equal(look.hat, 'beanie');
  assert.equal(look.pet, 'cat');
  mgr.handle(a.c, { t: 'unequip', slot: 'hat' });
  advance(300);
  assert.equal(a.c.last('me').p.look.hat, null);
  const c = join();
  assert.equal(c.c.last('welcome').members.find((m) => m.id === a.id).lk.pet, 'cat', 'newcomers see your pet too');
});

test('lamp shades unlock with focus hours; colour and name can change', () => {
  const { mgr, join, advance } = setup();
  const a = join();
  mgr.handle(a.c, { t: 'style', lamp: 1 });
  assert.equal(a.c.last('err').code, 'locked');
  advance(2000);
  mgr.handle(a.c, { t: 'style', color: 5, name: [2, 3, 44] });
  const p = a.c.last('me').p;
  assert.equal(p.look.c, 5);
  assert.deepEqual(p.name, [2, 3, 44]);
});

test('friends: accounts add each other by code and see where the other is', async () => {
  const { mgr, join, advance, profiles, clock } = setup();
  const ra = await profiles.signup({ username: 'ada', password: 'correct horse' }, clock.t);
  const rb = await profiles.signup({ username: 'bob', password: 'battery staple' }, clock.t);
  const guest = join();
  const a = join({ token: ra.token });
  const b = join({ token: rb.token });
  const codeB = b.c.last('welcome').me.code;
  assert.match(codeB, /^[2-9A-HJ-NP-Z]{8}$/);
  assert.equal(guest.c.last('welcome').me.code, null, 'guests have no friend code');
  mgr.handle(guest.c, { t: 'friendAdd', code: codeB });
  assert.equal(guest.c.last('err').code, 'guest');
  mgr.handle(a.c, { t: 'friendAdd', code: codeB });
  assert.equal(b.c.last('notice').kind, 'friendRequest');
  assert.equal(b.c.last('friends').incoming[0].id, ra.id);
  advance(2000);
  mgr.handle(b.c, { t: 'friendAccept', id: ra.id });
  assert.equal(a.c.last('notice').kind, 'friendAccepted');
  advance(2000);
  mgr.handle(a.c, { t: 'friends' });
  const f = a.c.last('friends').friends[0];
  assert.deepEqual([f.id, f.online, f.hall, f.place, f.n], [rb.id, true, 1, 'library', 1]);
  advance(2000);
  mgr.handle(b.c, { t: 'enter', place: 'cafe' });
  advance(2000);
  mgr.handle(a.c, { t: 'friends' });
  const moved = a.c.last('friends').friends[0];
  assert.deepEqual([moved.place, moved.n], ['cafe', 1], 'friends see you move to the coffee shop');
  advance(2000);
  mgr.handle(b.c, { t: 'friendRemove', id: ra.id });
  assert.equal(a.c.last('friends').friends.length, 0);
});

// ---------------------------------------------------------------- places

test('rooms belong to a place; new visitors start in the library unless they ask for another', () => {
  const { mgr, join } = setup();
  const a = join();
  assert.deepEqual([a.c.last('welcome').place, a.c.last('welcome').n], ['library', 1]);
  const b = join({ place: 'netcafe' });
  const w = b.c.last('welcome');
  assert.equal(w.place, 'netcafe');
  assert.equal(w.n, 1);
  assert.notEqual(w.hall, 1);
  assert.equal(mgr.halls.get(w.hall).desks.length, PLACES.netcafe.desks.length);
  const summary = mgr.globalSummary().h;
  assert.deepEqual(summary.find((h) => h[0] === w.hall), [w.hall, 1, 2, 1, PLACES.netcafe.desks.length], '[id, people, place, number, capacity]');
});

test('going out to the square and into the coffee shop: you appear at the door you used', () => {
  const { mgr, join, me, advance } = setup();
  const a = join();
  const b = join();
  mgr.handle(a.c, { t: 'sit', desk: 4, from: me(a.c).pos });
  advance(60_000);
  mgr.handle(a.c, { t: 'focus', mins: 25, tag: 0 });
  advance(5 * MIN);
  mgr.handle(a.c, { t: 'enter', place: 'square' });
  const out = a.c.last('welcome');
  assert.equal(out.place, 'square');
  assert.equal(a.c.last('earn').mins, 5, 'leaving ends the session and credits it');
  const arrive = PLACES.square.arrive.library;
  const [x, z] = me(a.c).pos;
  assert.ok(Math.abs(x - arrive.x) <= arrive.w / 2 && Math.abs(z - arrive.z) <= arrive.d / 2, 'in front of the library');
  assert.equal(mgr.halls.get(1).desks[4], 0, 'the desk is free again');
  advance(250);
  assert.ok(b.c.events('l').some((e) => e[1] === a.id), 'the library sees you leave');

  mgr.handle(a.c, { t: 'enter', place: 'cafe' });
  assert.equal(a.c.last('err').code, 'wait', 'one door at a time');
  advance(2000);
  mgr.handle(a.c, { t: 'enter', place: 'cafe' });
  assert.equal(a.c.last('welcome').place, 'cafe');
  const spawn = PLACES.cafe.spawn;
  assert.ok(Math.abs(me(a.c).pos[0] - spawn.x) <= spawn.w / 2, 'just inside the coffee shop door');
  advance(2000);
  mgr.handle(a.c, { t: 'enter', place: 'cafe' });
  assert.equal(a.c.last('err').code, 'here');
});

test('benches: you can sit outside but not start a session, and tea is for desks', () => {
  const { mgr, join, me, advance } = setup();
  const a = join({ place: 'square' });
  const b = join({ place: 'square' });
  mgr.handle(a.c, { t: 'sit', desk: 0, from: me(a.c).pos });
  assert.equal(me(a.c).desk, 0);
  advance(30_000);
  mgr.handle(a.c, { t: 'focus', mins: 25, tag: 0 });
  assert.equal(a.c.last('err').code, 'bench');
  assert.equal(me(a.c).state, STATE.SEATED);
  mgr.handle(a.c, { t: 'rest', mins: 5 });
  assert.equal(a.c.last('err').code, 'bench');
  mgr.handle(b.c, { t: 'gift', desk: 0 });
  assert.equal(b.c.last('err').code, 'nogift');
  mgr.handle(a.c, { t: 'sit', desk: PLACES.square.desks.length, from: me(a.c).pos });
  assert.equal(me(a.c).desk, 0, 'no seat past the last bench');
});

test('each place fills its own rooms; empty extra rooms close, the first of each place stays', () => {
  const { mgr, join } = setup({ capacity: 1, maxHalls: 6 });
  const a = join({ place: 'cafe' });
  const b = join({ place: 'cafe' });
  const wa = a.c.last('welcome');
  const wb = b.c.last('welcome');
  assert.deepEqual([wa.place, wa.n, wb.place, wb.n], ['cafe', 1, 'cafe', 2]);
  mgr.leave(b.c, { immediate: true });
  assert.ok(!mgr.halls.has(wb.hall), 'the second coffee shop closed');
  mgr.leave(a.c, { immediate: true });
  assert.ok(mgr.halls.has(wa.hall), 'the first coffee shop stays open');
  const c = join({ place: 'cafe' });
  assert.equal(c.c.last('welcome').hall, wa.hall);
});
