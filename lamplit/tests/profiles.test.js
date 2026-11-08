import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { ProfileService } from '../server/profiles.js';
import { hashPassword, verifyPassword, validUsername, dayKey } from '../server/accounts.js';
import { sanitizeLook, ITEMS, ITEM } from '../shared/catalog.js';

const T = Date.UTC(2026, 10, 8, 12, 0, 0);
const DAY = 86_400_000;
const fresh = () => new ProfileService(openDb(':memory:'), { startLumens: 100 });

test('passwords are salted scrypt hashes', async () => {
  const h1 = await hashPassword('hunter22hunter');
  const h2 = await hashPassword('hunter22hunter');
  assert.notEqual(h1, h2);
  assert.ok(h1.startsWith('scrypt$'));
  assert.equal(await verifyPassword('hunter22hunter', h1), true);
  assert.equal(await verifyPassword('wrong-password', h1), false);
  assert.equal(await verifyPassword('anything-at-all', null), false);
});

test('usernames: 3-20 letters, digits or underscores', () => {
  for (const ok of ['ada', 'Study_Owl_2026', 'x'.repeat(20)]) assert.ok(validUsername(ok), ok);
  for (const bad of ['ab', 'x'.repeat(21), 'has space', 'émile', '<b>', '']) assert.ok(!validUsername(bad), bad);
});

test('a guest who signs up keeps everything', async () => {
  const s = fresh();
  const g = s.createGuest(T, 'Asia/Seoul');
  s.buy(g.id, 'book', T);
  s.credit(g.id, 30, false, 'Asia/Seoul', T);
  const r = await s.signup({ username: 'Ada', password: 'long enough', guestToken: g.token }, T);
  assert.ok(r.ok);
  assert.equal(r.id, g.id, 'same profile');
  const me = s.me(r.id, 'Asia/Seoul', T);
  assert.equal(me.guest, false);
  assert.equal(me.lumens, 100 - 60 + 30);
  assert.deepEqual(me.owned, ['book']);
  assert.match(me.code, /^[2-9A-HJ-NP-Z]{8}$/);
});

test('sign-up rules and log-in', async () => {
  const s = fresh();
  assert.equal((await s.signup({ username: 'ab', password: 'long enough' }, T)).error, 'username');
  assert.equal((await s.signup({ username: 'ada', password: 'short' }, T)).error, 'password');
  assert.ok((await s.signup({ username: 'ada', password: 'long enough' }, T)).ok);
  assert.equal((await s.signup({ username: 'ADA', password: 'long enough' }, T)).error, 'taken', 'case-insensitive');
  assert.equal((await s.login({ username: 'ada', password: 'nope nope' }, T)).error, 'invalid');
  assert.equal((await s.login({ username: 'nobody', password: 'long enough' }, T)).error, 'invalid');
  const ok = await s.login({ username: 'Ada', password: 'long enough' }, T);
  assert.ok(ok.ok);
  assert.equal(s.byToken(ok.token, T).username, 'ada');
  s.logout(ok.token);
  assert.equal(s.byToken(ok.token, T), null, 'logged-out token no longer works');
});

test('tokens expire', () => {
  const s = fresh();
  const g = s.createGuest(T);
  assert.ok(s.byToken(g.token, T + 89 * DAY));
  assert.equal(s.byToken(g.token, T + 91 * DAY), null);
});

test('stats: today, streak and the last seven days in your own time zone', () => {
  const s = fresh();
  const g = s.createGuest(T);
  // 23:30 in Seoul on three days in a row is still "that day" there.
  for (let k = 3; k >= 1; k--) s.credit(g.id, 20, true, 'Asia/Seoul', T - k * DAY + 2.5 * 3600_000);
  const me = s.me(g.id, 'Asia/Seoul', T + 2.5 * 3600_000);
  assert.equal(me.today, 0);
  assert.equal(me.streak, 3, 'yesterday counts toward the streak');
  assert.deepEqual(me.last7.map((d) => d.minutes), [0, 0, 0, 20, 20, 20, 0]);
  assert.equal(me.sessions, 3);
  assert.equal(me.total, 60);
  assert.equal(dayKey('Asia/Seoul', Date.UTC(2026, 0, 1, 16, 0)), '2026-01-02');
  assert.equal(dayKey('not/a_zone', Date.UTC(2026, 0, 1, 16, 0)), '2026-01-01', 'unknown zones fall back to UTC');
});

test('looks are sanitised and every catalogue item has a valid slot and price', () => {
  assert.deepEqual(sanitizeLook({ o: 'nope', hat: 'laptop', c: 99, held: 'book' }), { ...sanitizeLook({}), held: 'book' });
  const ids = new Set();
  for (const it of ITEMS) {
    assert.ok(!ids.has(it.id), `duplicate ${it.id}`);
    ids.add(it.id);
    assert.ok(Number.isInteger(it.price) && it.price >= 0);
    assert.ok(it.en && it.ko, `${it.id} has both names`);
    assert.equal(ITEM[it.id], it);
  }
});

test('prototype names are not items (regression: they used to pass validation and crash a purchase)', () => {
  const s = fresh();
  const g = s.createGuest(T);
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(ITEM[id], undefined, id);
    assert.deepEqual(s.buy(g.id, id, T), { ok: false, error: 'unknown' });
    assert.equal(s.equip(g.id, id), null);
  }
});
