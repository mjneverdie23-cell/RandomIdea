// Lamplit client: wires sign-in, the 3D room, avatars, network, sound, shop, profile,
// friends, the tour and the UI together.

import * as THREE from '../vendor/three.module.min.js';
import { DESKS, DESK_COUNT, round2 } from '../shared/layout.js';
import { PROTOCOL, STATE, COOLDOWN } from '../shared/protocol.js';
import { displayName, subjectName, randomName, SWEATERS } from '../shared/words.js';
import { ITEMS, ITEM, itemName, sanitizeLook } from '../shared/catalog.js';
import { World } from './world.js';
import { Avatars } from './avatars.js';
import { Labels } from './labels.js';
import { Net } from './net.js';
import { Settings } from './store.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { ICONS, EMOTE_ICONS } from './icons.js';
import { Preview } from './preview.js';
import { Tutorial } from './tutorial.js';
import { DESK_WORK_ITEMS } from './look.js';
import { shopModelLook } from './views.js';
import { getToken, setToken, timeZone, continueAsGuest, signUp, logIn, logOut, whoAmI } from './api.js';
import { t, setLang, getLang, formatMinutes } from './i18n.js';

const MIN = 60_000;
const settings = new Settings();
setLang(settings.lang);
const sound = new Sound(settings);

// ------------------------------------------------------------------ rendering

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
const world = new World(renderer);
const avatars = new Avatars(world.scene);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 140);
const labels = new Labels(document.getElementById('labels'));
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

const tapRing = new THREE.Mesh(
  new THREE.RingGeometry(0.16, 0.24, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffe1a8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
);
tapRing.position.y = 0.02;
world.scene.add(tapRing);
let tapRingAge = 1;

const maxRatio = () => (settings.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2));
let pixelRatio = maxRatio();
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  preview?.resize();
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ state

const room = {
  selfId: 0,
  hall: 0,
  cap: 100,
  members: new Map(),
  desks: new Int32Array(DESK_COUNT),
  tea: new Map(),
  lit: 0,
  mins24: 0,
  g: null,
};
const self = () => room.members.get(room.selfId);
/** Your profile as the server last described it (lumens, wardrobe, stats, account). */
let me = null;
let friends = null;
let joined = false;
let doneSent = false;
let lastGift = -Infinity;
let deskCard = -1;
let lastEarn = null;
let tour = null;
let toured = false;
let copiedUntil = 0;
const shop = { cat: 'clothes', selected: null };
let preview = null;

// ------------------------------------------------------------------ network

const net = new Net(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
const params = new URLSearchParams(location.search);
const urlRoom = Number.parseInt(params.get('room') || '', 10);

function hello() {
  const msg = { t: 'hello', v: PROTOCOL, auth: getToken(), tz: timeZone() };
  const hall = Number.isInteger(urlRoom) && urlRoom > 0 ? urlRoom : settings.hall;
  if (hall) msg.hall = hall;
  return msg;
}

net.on('status', (s) => {
  if (s === 'connecting' && !joined) ui.overlay('connecting');
  else if (s !== 'connecting') ui.overlay(s);
});

net.on('message', (msg) => {
  switch (msg.t) {
    case 'welcome':
      return onWelcome(msg);
    case 'b':
      return onBatch(msg.ev);
    case 'g':
      return onGlobal(msg);
    case 'me':
      return setMe(msg.p);
    case 'earn':
      return onEarn(msg);
    case 'bought':
      sound.chime();
      return ui.toast(t('bought', { item: itemName(msg.item, getLang()) }), 'bag');
    case 'friends':
      friends = msg;
      return refreshProfile();
    case 'notice':
      return onNotice(msg);
    case 'queue':
      return ui.overlay('queue', { n: msg.pos });
    case 'err':
      return onError(msg);
    case 'bye':
      return onBye(msg.reason);
    default:
  }
});

function onWelcome(msg) {
  joined = true;
  net.setServerTime(msg.now);
  settings.update({ hall: msg.hall });
  if (params.get('room') !== String(msg.hall)) {
    params.set('room', String(msg.hall));
    history.replaceState(null, '', `${location.pathname}?${params}`);
  }
  room.selfId = msg.id;
  room.hall = msg.hall;
  room.cap = msg.cap;
  room.members.clear();
  room.desks.fill(0);
  room.tea.clear();
  avatars.clear();
  avatars.selfId = msg.id;
  labels.clear();
  for (let i = 0; i < DESK_COUNT; i++) world.setFree(i);
  world.setOwnDesk(-1);
  for (const v of msg.members) addMember(v, true);
  for (const [desk, until] of msg.tea) {
    room.tea.set(desk, until);
    world.setTea(desk, true);
  }
  setRoomStats(msg.hs);
  setMe(msg.me);
  onGlobal(msg.g);
  ui.overlay(null);
  ui.showHud(true);
  refresh();
  maybeStartTour();
}

function addMember(v, instant) {
  let m = room.members.get(v.id);
  const fields = { id: v.id, nm: v.nm, lk: v.lk, desk: v.desk, st: v.st, since: v.since, mins: v.mins, tag: v.tag, pos: v.pos, path: v.path ?? null, t0: v.t0 ?? 0 };
  if (m) Object.assign(m, fields);
  else {
    m = fields;
    room.members.set(m.id, m);
  }
  avatars.add(m);
  avatars.repaint(m);
  if (m.desk >= 0) {
    room.desks[m.desk] = m.id;
    occupyDesk(m);
    world.setLamp(m.desk, m.st === STATE.FOCUS, { instant });
    if (m.id === room.selfId) world.setOwnDesk(m.desk);
  }
}

/** Shows someone's things on their desk: lamp shade, and the notebook unless they brought work. */
function occupyDesk(m) {
  world.setOccupied(m.desk, m.look.l, !DESK_WORK_ITEMS.has(m.look.held));
}

function removeMember(id) {
  const m = room.members.get(id);
  if (!m) return;
  if (m.desk >= 0 && room.desks[m.desk] === id) {
    room.desks[m.desk] = 0;
    world.setFree(m.desk);
    if (deskCard === m.desk) ui.closeSheet();
  }
  room.members.delete(id);
  avatars.remove(id);
  labels.forget(id);
}

function onBatch(events) {
  let ended = null;
  let finished = null;
  for (const ev of events) {
    switch (ev[0]) {
      case 'j':
        addMember(ev[1], false);
        break;
      case 'l':
        removeMember(ev[1]);
        break;
      case 'go': {
        const m = room.members.get(ev[1]);
        if (m) {
          m.path = ev[2];
          m.t0 = ev[3];
          m.standT = 0;
        }
        break;
      }
      case 'seat':
        onSeat(ev[1], ev[2], ev[3]);
        break;
      case 'st': {
        const prev = onState(ev);
        if (prev) ended = prev;
        break;
      }
      case 'em':
        avatars.emote(ev[1], ev[2], net.now());
        labels.bubble(ev[1], EMOTE_ICONS[ev[2]] ?? '', 1800, 'emote');
        break;
      case 'tea':
        onTea(ev[1], ev[2], ev[3]);
        break;
      case 'fin':
        if (ev[1] === room.selfId) finished = ev[2];
        else labels.bubble(ev[1], `${ICONS.check}<span>${formatMinutes(ev[2])}</span>`, 2800, 'fin');
        break;
      case 'look': {
        const m = room.members.get(ev[1]);
        if (!m) break;
        m.nm = ev[2];
        m.lk = ev[3];
        avatars.repaint(m);
        if (m.desk >= 0) occupyDesk(m);
        if (m.id === room.selfId) labels.setSelf(displayName(m.nm, getLang()));
        break;
      }
      case 'hs':
        setRoomStats([ev[1], ev[2]]);
        break;
      default:
    }
  }
  if (ended) sessionEnded(ended, finished);
  if (deskCard >= 0) refreshDeskCard();
  refresh();
}

function onSeat(id, desk, pos) {
  const m = room.members.get(id);
  if (!m) return;
  if (desk >= 0) {
    if (m.desk >= 0 && m.desk !== desk && room.desks[m.desk] === id) {
      room.desks[m.desk] = 0;
      world.setFree(m.desk);
    }
    m.desk = desk;
    m.sitT = 0;
    room.desks[desk] = id;
    occupyDesk(m);
    if (id === room.selfId) world.setOwnDesk(desk);
    return;
  }
  const old = m.desk;
  if (old >= 0) {
    if (room.desks[old] === id) {
      room.desks[old] = 0;
      world.setFree(old);
    }
    if (!m.path) {
      m.standFrom = { x: DESKS[old].seat.x, z: DESKS[old].seat.z };
      m.standT = net.now();
    }
  }
  m.desk = -1;
  m.path = null;
  if (pos) m.pos = pos;
  if (id === room.selfId) {
    world.setOwnDesk(-1);
    setFocusView(false);
  }
}

/** Applies a state change. For you, returns the previous state if a focus session ended. */
function onState([, id, st, since, mins, tag]) {
  const m = room.members.get(id);
  if (!m) return null;
  const prev = { st: m.st, since: m.since, mins: m.mins, tag: m.tag };
  Object.assign(m, { st, since, mins, tag });
  if (m.desk >= 0) world.setLamp(m.desk, st === STATE.FOCUS);
  if (id !== room.selfId) return null;
  if (st === STATE.FOCUS && !(prev.st === STATE.FOCUS && prev.since === since)) {
    doneSent = false;
    sound.lamp(true);
  }
  if (prev.st === STATE.BREAK && st === STATE.SEATED) {
    sound.chime();
    ui.toast(t('breakOver'), 'lamp');
  }
  if (prev.st === STATE.FOCUS && !(st === STATE.FOCUS && since === prev.since)) return prev;
  return null;
}

/** One of your sessions ended: finished (the server says how many minutes) or stopped. */
function sessionEnded(prev, finished) {
  doneSent = false;
  setFocusView(false);
  if (!finished) {
    sound.lamp(false);
    return;
  }
  sound.bell();
  const earned = lastEarn && Date.now() - lastEarn.at < 10_000 ? lastEarn.n : 0;
  ui.openSheet('complete', { minutes: finished, lumens: earned, today: me?.today ?? 0, streak: me?.streak ?? 0, goal: me?.goal ?? 120 });
}

function onEarn(msg) {
  lastEarn = { n: msg.n, at: Date.now() };
  ui.bumpLumens(msg.n);
  if (!msg.done) ui.toast(t('earnedToast', { n: msg.n, m: msg.mins }), 'spark');
}

function onTea(from, desk, until) {
  if (until <= 0) {
    room.tea.delete(desk);
    world.setTea(desk, false);
    return;
  }
  room.tea.set(desk, until);
  world.setTea(desk, true);
  const mine = self();
  const lang = getLang();
  if (mine && mine.desk === desk && from !== room.selfId) {
    const f = room.members.get(from);
    ui.toast(t('teaReceived', { name: f ? displayName(f.nm, lang) : '…' }), 'tea');
    labels.bubble(room.selfId, ICONS.tea, 2400, 'tea');
    sound.chime();
  } else if (from === room.selfId) {
    const to = room.members.get(room.desks[desk]);
    ui.toast(t('teaSent', { name: to ? displayName(to.nm, lang) : '…' }), 'tea');
  }
}

function onGlobal(g) {
  if (!g) return;
  room.g = g;
  const mine = g.h.find(([id]) => id === room.hall);
  if (room.hall) ui.setRoom(room.hall, mine ? mine[1] : room.members.size, room.cap, g.fo);
  ui.refreshSheet('halls', hallsModel());
}

function onNotice(msg) {
  const name = msg.name ? displayName(msg.name, getLang()) : '';
  const key = { friendRequest: 'noticeFriendRequest', friendAccepted: 'noticeFriendAccepted', friendSent: 'noticeFriendSent' }[msg.kind];
  if (key) ui.toast(t(key, { name }), 'friend');
  if (msg.kind === 'friendRequest' || msg.kind === 'friendAccepted') sound.chime();
}

const ERROR_TEXT = {
  taken: 'taken',
  nopath: 'noPath',
  full: 'roomFull',
  funds: 'errFunds',
  locked: 'errLocked',
  guest: 'errGuest',
  nocode: 'errNocode',
  self: 'errSelf',
  already: 'errAlready',
  pending: 'errPending',
  limit: 'errLimit',
};

function onError(msg) {
  if (msg.code === 'cooldown') ui.toast(t('teaWait', { n: Math.ceil((msg.left || 0) / 1000) }), 'tea');
  else if (msg.code === 'early') {
    setTimeout(() => {
      doneSent = false;
    }, 2000);
  } else if (ERROR_TEXT[msg.code]) ui.toast(t(ERROR_TEXT[msg.code]));
}

function onBye(reason) {
  if (reason === 'replaced') {
    net.disconnect();
    joined = false;
    ui.overlay('replaced');
  } else if (reason === 'version') {
    net.disconnect();
    ui.overlay('version');
  } else if (reason === 'auth') {
    // The login stopped working (logged out elsewhere, or expired): back to sign-in.
    setToken(null);
    leaveRoom();
    showSignIn({ state: 'new', mode: 'login', error: null, note: t('signedOut') });
  }
  // Anything else ('restart', 'rate', 'full'): the socket closes and we reconnect.
}

function setRoomStats([lit, mins]) {
  room.lit = lit;
  room.mins24 = mins;
  sound.setActivity(lit);
  drawBoard();
}

function drawBoard() {
  const h = room.mins24 / 60;
  world.drawBoard({
    title: `${t('brand')} · ${t('room', { n: room.hall || 1 })}`,
    items: [
      { value: `${room.lit}`, label: t('lampsLit') },
      { value: h < 10 ? h.toFixed(1) : Math.round(h).toLocaleString(), label: t('focusHours') },
    ],
  });
}

/** A fresh profile from the server: balance, wardrobe, stats. */
function setMe(p) {
  if (!p) return;
  me = { ...p, look: sanitizeLook(p.look) };
  ui.setLumens(me.lumens);
  preview?.setLook(shop.selected && ui.sheetKind === 'shop' ? shopModelLook(me, shop.selected) : me.look);
  refreshShop();
  refreshProfile();
  ui.refreshSheet('settings', settingsModel());
}

function tickSession() {
  const mine = self();
  if (!mine || mine.st !== STATE.FOCUS || mine.mins === 0 || doneSent) return;
  if (net.now() >= mine.since + mine.mins * MIN) {
    doneSent = true;
    net.send({ t: 'done' });
  }
}

// ------------------------------------------------------------------ signing in

let authState = { state: 'checking' };
/** The profile behind a remembered login, so a returning guest who signs up keeps everything. */
let knownProfile = null;

function showSignIn(state) {
  authState = state;
  ui.showSplash();
  ui.renderAuth(state);
  if (state.note) ui.toast(state.note);
}

async function checkToken() {
  const token = getToken();
  if (!token) {
    showSignIn({ state: 'new', mode: 'login', error: null });
    return;
  }
  showSignIn({ state: 'checking' });
  const r = await whoAmI(token);
  knownProfile = r.ok ? r.data.profile : null;
  if (r.ok) showSignIn({ state: 'known', me: r.data.profile });
  else if (r.status === 401) {
    setToken(null);
    showSignIn({ state: 'new', mode: 'login', error: null });
  } else showSignIn({ state: 'new', mode: 'login', error: 'network' });
}

/** Handles a result from /api/guest, /api/signup or /api/login. */
function signedIn(r, { inGame = false, mode = 'login' } = {}) {
  if (!r.ok) {
    const error = r.status === 429 ? 'slow' : r.data?.error || 'network';
    if (inGame) ui.refreshSheet('account', { mode, error, busy: false });
    else showSignIn({ ...authState, busy: false, error });
    return;
  }
  const previousId = me?.id;
  setToken(r.data.token);
  if (inGame && r.data.profile.id === previousId) {
    // A guest became an account: same profile, same seat.
    ui.closeSheet();
    setMe(r.data.profile);
    ui.toast(t('signupDone', { u: r.data.profile.username }), 'user');
    net.send({ t: 'me' });
    return;
  }
  ui.closeSheet();
  if (inGame) leaveRoom();
  me = r.data.profile;
  enter();
}

function enter() {
  sound.unlock();
  ui.hideSplash();
  ui.overlay('connecting');
  net.connect(hello);
}

/** Disconnects and clears the room (logging out, switching account). */
function leaveRoom() {
  net.disconnect();
  joined = false;
  room.selfId = 0;
  room.members.clear();
  avatars.clear();
  labels.clear();
  for (let i = 0; i < DESK_COUNT; i++) world.setFree(i);
  ui.closeSheet();
  ui.dock(null);
  ui.showHud(false);
  ui.overlay(null);
  setFocusView(false);
  tour?.end(false);
}

// ------------------------------------------------------------------ the tour

function freeDeskRect() {
  let best = null;
  const v = new THREE.Vector3();
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (const d of DESKS) {
    if (room.desks[d.i]) continue;
    v.set(d.x, 0.7, d.z + 0.3).project(camera);
    if (v.z > 1) continue;
    const x = ((v.x + 1) / 2) * w;
    const y = ((1 - v.y) / 2) * h;
    if (x < 70 || x > w - 70 || y < 110 || y > h - 200) continue;
    const score = Math.abs(x - w / 2) + Math.abs(y - h * 0.55);
    if (!best || score < best.score) best = { x, y, score };
  }
  return best ? new DOMRect(best.x - 60, best.y - 50, 120, 100) : null;
}

const rectOf = (sel) => () => {
  const el = document.querySelector(sel);
  // offsetParent is null for position:fixed elements, so check for boxes instead.
  if (!el || el.hidden || el.getClientRects().length === 0) return null;
  return el.getBoundingClientRect();
};

function startTour() {
  tour?.end(false);
  const steps = [
    { title: t('tour1Title'), body: t('tour1Body') },
    { title: t('tour2Title'), body: t('tour2Body'), target: freeDeskRect, waitFor: 'sat' },
    { title: t('tour3Title'), body: t('tour3Body'), target: rectOf('#dock') },
    { title: t('tour4Title'), body: t('tour4Body'), target: rectOf('#lumens-btn') },
    { title: t('tour5Title'), body: t('tour5Body'), target: rectOf('#shop-btn') },
    { title: t('tour6Title'), body: t('tour6Body'), target: rectOf('#profile-btn') },
    { title: t('tour7Title'), body: t('tour7Body'), target: rectOf('#emotes') },
    { title: t('tour8Title'), body: t('tour8Body') },
  ];
  tour = new Tutorial(steps, () => {
    tour = null;
    toured = true;
    settings.update({ toured: true });
    net.send({ t: 'tutorial' });
  });
  tour.start();
}

function maybeStartTour() {
  if (toured || tour || !me || me.tutorial || settings.toured) return;
  toured = true;
  setTimeout(startTour, 700);
}

// ------------------------------------------------------------------ dock & sheets

function dockModel() {
  const mine = self();
  if (!joined || !mine) return null;
  const base = { desk: mine.desk, mins: settings.mins, tag: settings.tag, since: mine.since, planned: mine.mins, subject: subjectName(mine.tag, getLang()), now: net.now() };
  if (mine.desk < 0) return { ...base, mode: 'standing' };
  if (mine.path || (mine.sitT && net.now() - mine.sitT < 500)) return { ...base, mode: 'walking' };
  if (mine.st === STATE.FOCUS) return { ...base, mode: 'focus' };
  if (mine.st === STATE.BREAK) return { ...base, mode: 'break' };
  return { ...base, mode: 'seated' };
}

let lastMode = '';
function refresh() {
  const model = dockModel();
  ui.dock(model);
  const mine = self();
  world.setMarkers(Boolean(joined && mine && mine.desk < 0));
  if (model?.mode === 'seated' && lastMode !== 'seated') tour?.notify('sat');
  lastMode = model?.mode ?? '';
}

function hallsModel() {
  return { g: room.g ?? { h: [], cap: room.cap }, current: room.hall, inFocus: self()?.st === STATE.FOCUS };
}

function deskModel(desk) {
  const m = room.members.get(room.desks[desk]);
  if (!m) return null;
  const lang = getLang();
  let status = t('settlingIn');
  if (m.st === STATE.FOCUS) status = t('focusingFor', { t: formatMinutes((net.now() - m.since) / MIN) });
  else if (m.st === STATE.BREAK) status = t('takingBreak');
  return {
    desk,
    name: displayName(m.nm, lang),
    sweater: SWEATERS[m.look?.c] ?? SWEATERS[0],
    status,
    subject: m.st === STATE.FOCUS ? subjectName(m.tag, lang) : '',
    teaWait: Math.max(0, COOLDOWN.gift - (Date.now() - lastGift)),
  };
}

function refreshDeskCard() {
  const model = deskModel(deskCard);
  if (model) ui.refreshSheet('desk', model);
  else ui.closeSheet();
}

function shopModel() {
  return { me, cat: shop.cat, selected: shop.selected, thumbs: shopThumbs() };
}

function shopThumbs() {
  const ids = ITEMS.filter((it) => it.cat === shop.cat).map((it) => it.id);
  const p = getPreview();
  const urls = p ? p.thumbnails(ids, me?.look.c ?? 0) : ids.map(() => '');
  return Object.fromEntries(ids.map((id, i) => [id, urls[i]]));
}

function refreshShop() {
  if (ui.sheetKind === 'shop' && me) ui.refreshSheet('shop', shopModel());
}

function profileModel() {
  return { me, friends, hall: room.hall, now: net.now(), inFocus: self()?.st === STATE.FOCUS, copied: Date.now() < copiedUntil };
}

function refreshProfile() {
  if (ui.sheetKind === 'profile' && me) ui.refreshSheet('profile', profileModel());
}

function settingsModel() {
  return { settings, me };
}

function setFocusView(on) {
  cam.focusView = Boolean(on) && self()?.desk >= 0;
  ui.setFocusView(cam.focusView);
}

function sendStyle(changes) {
  net.send({ t: 'style', ...changes });
}

function getPreview() {
  if (!preview) {
    try {
      preview = new Preview();
    } catch {
      preview = null;
    }
  }
  return preview;
}

// ------------------------------------------------------------------ UI actions

const ui = new UI({
  // Signing in
  enter() {
    enter();
  },
  authTab(mode) {
    showSignIn({ state: 'new', mode, error: null });
  },
  switchAccount() {
    showSignIn({ state: 'new', mode: 'login', error: null });
  },
  async guest() {
    showSignIn({ ...authState, busy: true, error: null });
    signedIn(await continueAsGuest());
  },
  async formSubmit(kind, data, form) {
    const inGame = Boolean(form.closest('#sheet'));
    if (kind === 'friend') {
      const code = String(data.code || '')
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, '');
      if (!/^[2-9A-HJ-NP-Z]{8}$/.test(code)) {
        ui.toast(t('errNocode'));
        return;
      }
      net.send({ t: 'friendAdd', code });
      form.reset();
      return;
    }
    const username = String(data.username || '').trim();
    const password = String(data.password || '');
    if (inGame) ui.refreshSheet('account', { mode: kind, error: null, busy: true });
    else showSignIn({ ...authState, busy: true, error: null });
    const guestToken = me?.guest || knownProfile?.guest ? getToken() : null;
    const r = kind === 'signup' ? await signUp(username, password, guestToken) : await logIn(username, password);
    signedIn(r, { inGame, mode: kind });
  },
  account(mode) {
    ui.openSheet('account', { mode, error: null, busy: false });
  },
  accountTab(mode) {
    ui.refreshSheet('account', { mode, error: null, busy: false });
  },
  async logout() {
    const token = getToken();
    setToken(null);
    leaveRoom();
    await logOut(token);
    me = null;
    showSignIn({ state: 'new', mode: 'login', error: null });
  },

  // Studying
  mins(v) {
    settings.update({ mins: v });
    refresh();
  },
  tag(v) {
    settings.update({ tag: v });
    refresh();
  },
  focus() {
    net.send({ t: 'focus', mins: settings.mins, tag: settings.tag });
  },
  back() {
    net.send({ t: 'focus', mins: settings.mins, tag: settings.tag });
  },
  stand() {
    net.send({ t: 'stand' });
  },
  end() {
    ui.confirmEnd(true);
  },
  endYes() {
    ui.confirmEnd(false);
    net.send({ t: 'stop' });
  },
  endNo() {
    ui.confirmEnd(false);
  },
  break5() {
    net.send({ t: 'rest', mins: 5 });
    ui.closeSheet();
  },
  another() {
    net.send({ t: 'focus', mins: settings.mins, tag: settings.tag });
    ui.closeSheet();
  },
  focusView(on) {
    setFocusView(on);
  },
  emote(e) {
    net.send({ t: 'emote', e });
    ui.cooldownEmotes(COOLDOWN.emote);
  },
  gift(desk) {
    lastGift = Date.now();
    net.send({ t: 'gift', desk });
    ui.closeSheet();
  },
  halls() {
    ui.openSheet('halls', hallsModel());
  },
  switchRoom(id) {
    net.send({ t: 'switch', hall: id });
    ui.closeSheet();
  },

  // Shop
  shop() {
    if (!me) return;
    shop.selected = null;
    ui.openSheet('shop', shopModel());
  },
  shopCat(cat) {
    shop.cat = cat;
    shop.selected = null;
    preview?.setLook(me.look);
    ui.refreshSheet('shop', shopModel());
  },
  shopPick(id) {
    shop.selected = shop.selected === id ? null : id;
    preview?.setLook(shop.selected ? shopModelLook(me, shop.selected) : me.look);
    ui.refreshSheet('shop', shopModel());
  },
  buy(id) {
    net.send({ t: 'buy', item: id });
    setTimeout(() => net.send({ t: 'equip', item: id }), 300);
  },
  wear(id) {
    net.send({ t: 'equip', item: id });
  },
  takeOff(slot) {
    net.send({ t: 'unequip', slot });
  },
  color(i) {
    sendStyle({ color: i });
  },

  // Profile
  profile() {
    if (!me) return;
    friends = null;
    ui.openSheet('profile', profileModel());
    if (!me.guest) net.send({ t: 'friends' });
  },
  newName() {
    sendStyle({ name: randomName() });
  },
  lamp(i) {
    sendStyle({ lamp: i });
  },
  goal(v) {
    net.send({ t: 'goal', mins: v });
  },
  async copyCode() {
    try {
      await navigator.clipboard.writeText(me.code);
    } catch {
      // clipboard blocked: the code is on screen to copy by hand
    }
    copiedUntil = Date.now() + 2000;
    refreshProfile();
    setTimeout(refreshProfile, 2100);
  },
  friendAccept(id) {
    net.send({ t: 'friendAccept', id });
  },
  friendRemove(id) {
    net.send({ t: 'friendRemove', id });
  },

  // Settings
  settings() {
    ui.openSheet('settings', settingsModel());
  },
  setLang(l) {
    settings.update({ lang: l });
    setLang(l);
    ui.renderStatic();
    if (room.g) onGlobal(room.g);
    if (me) ui.setLumens(me.lumens);
    ui.setSound(settings.muted);
    const mine = self();
    if (mine) labels.setSelf(displayName(mine.nm, l));
    drawBoard();
    refresh();
  },
  sound() {
    sound.unlock();
    settings.update({ muted: !settings.muted });
    sound.setMuted(settings.muted);
    ui.setSound(settings.muted);
  },
  volume(v) {
    const vol = Number(v) / 100;
    settings.update({ volume: vol, muted: vol === 0 ? settings.muted : false });
    sound.setVolume(vol);
    sound.setMuted(settings.muted);
    ui.setSound(settings.muted);
  },
  rain(on) {
    settings.update({ rain: on });
    sound.setRain(on);
  },
  roomSounds(on) {
    settings.update({ roomSounds: on });
    sound.setRoomSounds(on);
  },
  quality(q) {
    settings.update({ quality: q });
    pixelRatio = maxRatio();
    world.dust.visible = q !== 'low';
    resize();
    ui.refreshSheet('settings', settingsModel());
  },
  tour() {
    ui.closeSheet();
    setTimeout(startTour, 300);
  },

  // Sheets
  closeSheet() {
    ui.closeSheet();
  },
  sheetClosed(kind) {
    if (kind === 'desk') deskCard = -1;
    if (kind === 'shop' || kind === 'profile') preview?.unmount();
  },
  sheetRendered(kind, sheet) {
    const slot = sheet.querySelector('[data-preview]');
    if (!slot) return;
    const p = getPreview();
    if (!p) return;
    p.setLook(kind === 'shop' && shop.selected ? shopModelLook(me, shop.selected) : me.look);
    p.mount(slot);
  },
  useHere() {
    ui.overlay('connecting');
    net.connect(hello);
  },
  reload() {
    location.reload();
  },
});
ui.setSound(settings.muted);
world.dust.visible = settings.quality !== 'low';
resize();

// ------------------------------------------------------------------ camera

const cam = {
  yaw: 0,
  pitch: 0.56,
  dist: 13,
  focusView: false,
  target: new THREE.Vector3(0, 0.9, 8),
  cur: { yaw: 0, pitch: 0.5, dist: 20 },
};
const camTarget = new THREE.Vector3();

function updateCamera(dt, time) {
  let yaw = cam.yaw;
  let pitch = cam.pitch;
  let dist = cam.dist;
  const mine = self();
  if (!joined || !mine) {
    camTarget.set(Math.sin(time * 0.05) * 2.5, 0.8, 1.5);
    yaw = Math.sin(time * 0.07) * 0.35;
    pitch = 0.48;
    dist = 21;
  } else if (cam.focusView && mine.desk >= 0) {
    const d = DESKS[mine.desk];
    camTarget.set(d.x + 0.05, 0.95, d.z + 0.15);
    yaw = cam.yaw * 0.4;
    pitch = 0.62;
    dist = 2.6;
  } else {
    // Look a little ahead of you (toward the windows) so you see the room, not the floor.
    const w = avatars.where(room.selfId);
    const ahead = mine.desk >= 0 && !mine.path ? 1.5 : 3.5;
    if (w) camTarget.set(w.x - Math.sin(cam.cur.yaw) * ahead, 0.9, w.z - Math.cos(cam.cur.yaw) * ahead);
  }
  const k = 1 - Math.exp(-dt * 4.5);
  cam.target.lerp(camTarget, k);
  cam.cur.yaw += (yaw - cam.cur.yaw) * k;
  cam.cur.pitch += (pitch - cam.cur.pitch) * k;
  cam.cur.dist += (dist - cam.cur.dist) * k;
  const cp = Math.cos(cam.cur.pitch);
  camera.position.set(
    cam.target.x + Math.sin(cam.cur.yaw) * cp * cam.cur.dist,
    cam.target.y + Math.sin(cam.cur.pitch) * cam.cur.dist,
    cam.target.z + Math.cos(cam.cur.yaw) * cp * cam.cur.dist,
  );
  camera.lookAt(cam.target);
}

// ------------------------------------------------------------------ input

const pointers = new Map();
let dragged = false;
let pinch = null;
let hoverAt = null;

function setRay(x, y) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
  dragged = false;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.dist };
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) {
    if (e.pointerType === 'mouse') hoverAt = { x: e.clientX, y: e.clientY };
    return;
  }
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) dragged = true;
  if (pointers.size === 1 && dragged) {
    cam.yaw = Math.max(-1.1, Math.min(1.1, cam.yaw - dx * 0.005));
    cam.pitch = Math.max(0.3, Math.min(1.25, cam.pitch + dy * 0.004));
  } else if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 10) cam.dist = Math.max(4, Math.min(26, (pinch.dist * pinch.d) / d));
  }
});

const endPointer = (e) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (e.type === 'pointerup' && p && !dragged && pointers.size === 0) onTap(e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
  hoverAt = null;
  world.setHover(-1);
  ui.tooltip(null);
  canvas.style.cursor = '';
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    cam.dist = Math.max(4, Math.min(26, cam.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
  },
  { passive: false },
);

function selfPosition() {
  const mine = self();
  if (mine && mine.desk >= 0 && !mine.path) {
    const a = DESKS[mine.desk].approach;
    return [a.x, a.z];
  }
  const w = avatars.where(room.selfId);
  return w ? [round2(w.x), round2(w.z)] : [0, 15];
}

function onTap(x, y) {
  const mine = self();
  if (!joined || !mine) return;
  if (cam.focusView) {
    setFocusView(false);
    return;
  }
  setRay(x, y);
  const desk = world.pickDesk(raycaster, camera, ndc);
  if (desk >= 0) return onDeskTap(desk, mine);
  const p = world.pickFloor(raycaster);
  if (!p) return;
  if (mine.st === STATE.FOCUS) {
    ui.toast(t('inFocus'));
    return;
  }
  const from = selfPosition();
  if (mine.desk >= 0) net.send({ t: 'stand' });
  net.send({ t: 'go', from, to: [round2(p.x), round2(p.z)] });
  tapRing.position.set(p.x, 0.02, p.z);
  tapRingAge = 0;
}

function onDeskTap(desk, mine) {
  const owner = room.desks[desk];
  if (owner === room.selfId) return;
  if (owner) {
    deskCard = desk;
    ui.openSheet('desk', deskModel(desk));
    return;
  }
  if (mine.st === STATE.FOCUS) {
    ui.toast(t('inFocus'));
    return;
  }
  sound.tap();
  net.send({ t: 'sit', desk, from: selfPosition() });
}

function updateHover() {
  if (!hoverAt || !joined || pointers.size > 0) return;
  setRay(hoverAt.x, hoverAt.y);
  const desk = world.pickDesk(raycaster, camera, ndc);
  world.setHover(desk);
  canvas.style.cursor = desk >= 0 ? 'pointer' : '';
  if (desk < 0) {
    ui.tooltip(null);
    return;
  }
  const m = room.members.get(room.desks[desk]);
  let text = `${t('desk', { n: desk + 1 })}`;
  if (m) {
    const name = displayName(m.nm, getLang());
    text = m.st === STATE.FOCUS ? `${name} · ${t('focusingFor', { t: formatMinutes((net.now() - m.since) / MIN) })}` : `${name} · ${t('desk', { n: desk + 1 })}`;
  }
  ui.tooltip(text, hoverAt.x, hoverAt.y);
}

// ------------------------------------------------------------------ lifecycle

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    net.reconnectNow();
    tickSession();
  }
});
window.addEventListener('pageshow', (e) => {
  if (e.persisted) net.reconnectNow();
});

let friendsPoll = 0;
setInterval(() => {
  if (!joined) return;
  tickSession();
  ui.tick(net.now());
  refresh();
  if (deskCard >= 0) refreshDeskCard();
  // Keep friends' whereabouts fresh while the profile is open.
  if (ui.sheetKind === 'profile' && me && !me.guest && ++friendsPoll % 40 === 0) net.send({ t: 'friends' });
}, 250);

fetch('/api/status')
  .then((r) => (r.ok ? r.json() : null))
  .then((s) => s && ui.setSplashLive({ fo: s.focusing, on: s.online }))
  .catch(() => {});
checkToken();

let slowFrames = 0;
let last = performance.now();
function frame(nowMs) {
  const dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs;
  const time = nowMs / 1000;
  const serverNow = net.now();
  const arrived = avatars.update(serverNow, time, dt);
  if (arrived.includes(room.selfId)) setTimeout(refresh, 520);
  world.update(dt, time);
  updateCamera(dt, time);
  world.cullFor(camera);
  updateHover();
  if (tapRingAge < 1) {
    tapRingAge += dt * 1.4;
    tapRing.material.opacity = 0.9 * (1 - tapRingAge);
    tapRing.scale.setScalar(1 + tapRingAge * 1.2);
  }
  labels.update(camera, avatars, room.selfId, window.innerWidth, window.innerHeight, joined && !cam.focusView);
  renderer.render(world.scene, camera);

  // Lower the resolution on devices that struggle (Auto quality only).
  if (settings.quality === 'auto') {
    if (dt > 0.034) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 90 && pixelRatio > 1) {
      pixelRatio = Math.max(1, pixelRatio - 0.25);
      slowFrames = 0;
      resize();
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For automated checks and debugging from the console.
window.lamplit = {
  room,
  net,
  world,
  avatars,
  cam,
  ui,
  get me() {
    return me;
  },
  deskPos(i) {
    return [DESKS[i].x, 0.6, DESKS[i].z + 0.3];
  },
  screenOf(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight, visible: v.z < 1 };
  },
  startTour,
};
