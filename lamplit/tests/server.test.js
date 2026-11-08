// End-to-end: a real server on a random port, real WebSocket clients.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../server/app.js';
import { PROTOCOL, STATE } from '../shared/protocol.js';

let app;
let base;

before(async () => {
  app = startServer(
    {
      port: 0,
      host: '127.0.0.1',
      dbPath: ':memory:',
      startLumens: 100,
      hallCapacity: 100,
      maxHalls: 10,
      maxQueue: 10,
      tickMs: 50,
      maxConnectionsPerIp: 50,
      authPerMinute: 600,
      authBurst: 30,
      trustProxy: false,
      allowedOrigins: [],
    },
    { log: () => {} },
  );
  const port = await app.ready;
  base = `127.0.0.1:${port}`;
});

after(async () => {
  await app.close();
});

function client() {
  const ws = new WebSocket(`ws://${base}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (w.match(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const opened = new Promise((resolve) => ws.once('open', resolve));
  return {
    ws,
    inbox,
    opened,
    send: (obj) => ws.send(JSON.stringify(obj)),
    wait(match, ms = 3000) {
      const found = inbox.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { match, resolve };
        waiters.push(w);
        setTimeout(() => reject(new Error('timed out waiting for message')), ms);
      });
    },
    event: (kind, pred = () => true) => (m) => m.t === 'b' && m.ev.some((e) => e[0] === kind && pred(e)),
  };
}

async function post(path, body, token) {
  const res = await fetch(`http://${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const guestToken = async () => (await post('/api/guest', { tz: 'UTC' })).body.token;
let defaultToken;
const hello = (extra = {}) => ({ t: 'hello', v: PROTOCOL, auth: defaultToken, tz: 'UTC', ...extra });

test('serves the game and its shared modules with compression', async () => {
  const page = await fetch(`http://${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Lamplit/);
  const shared = await fetch(`http://${base}/shared/layout.js`, { headers: { 'accept-encoding': 'br' } });
  assert.equal(shared.status, 200);
  assert.ok(page.headers.get('content-security-policy'));
  const three = await fetch(`http://${base}/vendor/three.module.min.js`, { method: 'HEAD', headers: { 'accept-encoding': 'gzip, br' } });
  assert.equal(three.headers.get('content-encoding'), 'br');
  assert.ok(Number(three.headers.get('content-length')) < 200_000, 'three.js is under 200 KB compressed');
  const traversal = await fetch(`http://${base}/shared/..%2F..%2Fserver/halls.js`);
  assert.equal(traversal.status, 404);
  const status = await (await fetch(`http://${base}/api/status`)).json();
  assert.equal(typeof status.online, 'number');
});

test('two visitors see each other, sit, and see the lamp turn on', async () => {
  const a = client();
  const b = client();
  await Promise.all([a.opened, b.opened]);
  a.send(hello({ auth: await guestToken() }));
  const wa = await a.wait((m) => m.t === 'welcome');
  b.send(hello({ auth: await guestToken() }));
  const wb = await b.wait((m) => m.t === 'welcome');
  assert.equal(wa.hall, wb.hall);
  await a.wait(a.event('j', (e) => e[1].id === wb.id));

  const me = wa.members.find((m) => m.id === wa.id);
  a.send({ t: 'sit', desk: 42, from: me.pos });
  await b.wait(b.event('seat', (e) => e[1] === wa.id && e[2] === 42));
  a.send({ t: 'focus', mins: 25, tag: 6 });
  const st = await b.wait(b.event('st', (e) => e[1] === wa.id && e[2] === STATE.FOCUS));
  const ev = st.ev.find((e) => e[0] === 'st' && e[1] === wa.id && e[2] === STATE.FOCUS);
  assert.equal(ev[4], 25);
  assert.equal(ev[5], 6);

  b.send({ t: 'sit', desk: 42, from: wb.members.find((m) => m.id === wb.id).pos });
  const err = await b.wait((m) => m.t === 'err');
  assert.equal(err.code, 'taken');
  a.ws.close();
  b.ws.close();
});

test('ping is answered with server time', async () => {
  const c = client();
  await c.opened;
  c.send({ t: 'ping', c: 123 });
  const pong = await c.wait((m) => m.t === 'pong');
  assert.equal(pong.c, 123);
  assert.ok(Math.abs(pong.s - Date.now()) < 5000);
  c.ws.close();
});

test('a wrong protocol version is turned away', async () => {
  const c = client();
  await c.opened;
  c.send({ ...hello({ auth: await guestToken() }), v: PROTOCOL + 1 });
  const bye = await c.wait((m) => m.t === 'bye');
  assert.equal(bye.reason, 'version');
});

test('garbage and oversized messages do not break the server', async () => {
  const c = client();
  await c.opened;
  c.ws.send('not json');
  c.ws.send(JSON.stringify({ t: 'sit', desk: 'x' }));
  c.send(hello({ auth: await guestToken() }));
  const w = await c.wait((m) => m.t === 'welcome');
  assert.ok(w.id > 0);
  const closed = new Promise((resolve) => c.ws.once('close', resolve));
  c.ws.send('x'.repeat(4096));
  await closed;
  const d = client();
  await d.opened;
  d.send(hello({ auth: await guestToken() }));
  assert.ok((await d.wait((m) => m.t === 'welcome')).id > 0, 'server still accepts visitors');
  d.ws.close();
});

test('coming back with the same login keeps the desk after a dropped connection', async () => {
  const token = await guestToken();
  const a = client();
  await a.opened;
  a.send(hello({ auth: token }));
  const w = await a.wait((m) => m.t === 'welcome');
  a.send({ t: 'sit', desk: 7, from: w.members.find((m) => m.id === w.id).pos });
  await a.wait(a.event('seat', (e) => e[1] === w.id && e[2] === 7));
  a.ws.terminate();
  await new Promise((r) => setTimeout(r, 100));
  const again = client();
  await again.opened;
  again.send(hello({ auth: token }));
  const w2 = await again.wait((m) => m.t === 'welcome');
  assert.equal(w2.id, w.id);
  assert.equal(w2.members.find((m) => m.id === w.id).desk, 7);
  again.ws.close();
});

test('auth API: guest, sign up (keeping progress), log in, me, log out', async () => {
  const g = await post('/api/guest', { tz: 'Asia/Seoul' });
  assert.equal(g.status, 200);
  assert.equal(g.body.profile.guest, true);
  assert.equal(g.body.profile.lumens, 100);
  const bad = await post('/api/signup', { username: 'x', password: 'long enough' }, g.body.token);
  assert.deepEqual([bad.status, bad.body.error], [400, 'username']);
  const up = await post('/api/signup', { username: 'reader_1', password: 'long enough' }, g.body.token);
  assert.equal(up.status, 200);
  assert.equal(up.body.profile.id, g.body.profile.id, 'the guest became the account');
  assert.equal(up.body.profile.guest, false);
  const taken = await post('/api/signup', { username: 'READER_1', password: 'long enough' });
  assert.equal(taken.status, 409);
  const wrong = await post('/api/login', { username: 'reader_1', password: 'not it at all' });
  assert.equal(wrong.status, 401);
  const login = await post('/api/login', { username: 'reader_1', password: 'long enough' });
  assert.equal(login.status, 200);
  const me = await fetch(`http://${base}/api/me`, { headers: { authorization: `Bearer ${login.body.token}` } });
  assert.equal((await me.json()).profile.username, 'reader_1');
  await post('/api/logout', {}, login.body.token);
  const after = await fetch(`http://${base}/api/me`, { headers: { authorization: `Bearer ${login.body.token}` } });
  assert.equal(after.status, 401);
  const noJson = await fetch(`http://${base}/api/login`, { method: 'POST', body: 'username=a' });
  assert.equal(noJson.status, 415);
});

test('a socket without a valid login is told to sign in', async () => {
  const c = client();
  await c.opened;
  c.send(hello({ auth: 'A'.repeat(43) }));
  const bye = await c.wait((m) => m.t === 'bye');
  assert.equal(bye.reason, 'auth');
});

test('buying and wearing over the socket', async () => {
  const c = client();
  await c.opened;
  c.send(hello({ auth: await guestToken() }));
  const w = await c.wait((m) => m.t === 'welcome');
  assert.equal(w.me.lumens, 100);
  c.send({ t: 'buy', item: 'glasses' });
  await c.wait((m) => m.t === 'bought');
  await new Promise((r) => setTimeout(r, 300));
  c.send({ t: 'equip', item: 'glasses' });
  const look = await c.wait(c.event('look', (e) => e[1] === w.id && e[3].face === 'glasses'));
  assert.ok(look);
  c.ws.close();
});
