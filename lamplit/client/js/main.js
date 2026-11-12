// Lamplit client: wires sign-in, the 3D room, avatars, network, sound, shop, profile,
// friends, the tour and the UI together.

import * as THREE from '../vendor/three.module.min.js';
import { round2, seatLift } from '../shared/layout.js';
import { PLACES, PLACE_KINDS, DEFAULT_PLACE, OUTSIDE, COUNTRIES, countryOf, isPlace } from '../shared/places.js';
import { PROTOCOL, STATE, COOLDOWN } from '../shared/protocol.js';
import { displayName, subjectName, randomName, SWEATERS } from '../shared/words.js';
import { ITEMS, ITEM, itemName, sanitizeLook } from '../shared/catalog.js';
import { PlaceView } from './place.js';
import { library } from './scenes/library.js';
import { cafe } from './scenes/cafe.js';
import { netcafe } from './scenes/netcafe.js';
import { square } from './scenes/square.js';
import { pyramid, giza } from './scenes/egypt.js';
import { colosseum, rome } from './scenes/italy.js';
import { temple, garden } from './scenes/japan.js';
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
import { shopModelLook, esc } from './views.js';
import { loadMap, worldHTML, bindMap } from './worldmap.js';
import { getToken, setToken, timeZone, continueAsGuest, signUp, logIn, logOut, whoAmI } from './api.js';
import { t, setLang, getLang, formatMinutes, placeName, placeLabel, placeIn } from './i18n.js';

const MIN = 60_000;
const settings = new Settings();
setLang(settings.lang);
const sound = new Sound(settings);

// ------------------------------------------------------------------ rendering

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
const scene = new THREE.Scene();
const avatars = new Avatars(scene);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 140);

// Each place is built the first time you go there, then kept for coming back.
const RECIPES = { library, cafe, netcafe, square, pyramid, giza, colosseum, rome, temple, garden };
const views = new Map();
function viewFor(kind) {
  if (!views.has(kind)) {
    const v = new PlaceView(renderer, PLACES[kind], RECIPES[kind]);
    v.setQuality(settings.quality);
    views.set(kind, v);
  }
  return views.get(kind);
}
/** The place on screen. */
let world = null;
let place = null;

function usePlace(kind) {
  const next = viewFor(kind);
  if (world === next) return;
  world?.setHover(-1);
  world?.hide(scene);
  world = next;
  place = PLACES[kind];
  world.show(scene, renderer);
  avatars.setDesks(place.desks);
  camera.far = world.cam.far;
  camera.updateProjectionMatrix();
  cam.pitch = world.cam.pitch;
  cam.dist = world.cam.dist;
  cam.yaw = 0;
  sound.setPlace?.(kind);
}
const labels = new Labels(document.getElementById('labels'));
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

const tapRing = new THREE.Mesh(
  new THREE.RingGeometry(0.16, 0.24, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffe1a8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
);
tapRing.position.y = 0.02;
scene.add(tapRing);
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
  kind: null,
  n: 1,
  cap: 100,
  members: new Map(),
  desks: new Int32Array(0),
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
/** A door you're walking to: { to, x, z }. */
let pendingDoor = null;
/** Going through a door: { to, at } until the new place's welcome arrives. */
let transition = null;
let copiedUntil = 0;
const shop = { cat: 'clothes', selected: null };
let preview = null;

// ------------------------------------------------------------------ network

const net = new Net(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
const params = new URLSearchParams(location.search);
const urlRoom = Number.parseInt(params.get('room') || '', 10);

function hello() {
  const msg = { t: 'hello', v: PROTOCOL, auth: getToken(), tz: timeZone(), place: room.kind ?? settings.place ?? DEFAULT_PLACE };
  const hall = Number.isInteger(urlRoom) && urlRoom > 0 ? urlRoom : room.hall || settings.hall;
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
  const cameFrom = joined && room.kind !== msg.place ? room.kind : null;
  joined = true;
  net.setServerTime(msg.now);
  settings.update({ hall: msg.hall, place: msg.place });
  if (params.get('room') !== String(msg.hall)) {
    params.set('room', String(msg.hall));
    history.replaceState(null, '', `${location.pathname}?${params}`);
  }
  const moved = room.hall !== msg.hall;
  usePlace(msg.place);
  room.selfId = msg.id;
  room.hall = msg.hall;
  room.kind = msg.place;
  room.n = msg.n;
  room.cap = msg.cap;
  room.members.clear();
  room.desks = new Int32Array(place.desks.length);
  room.tea.clear();
  avatars.clear();
  avatars.selfId = msg.id;
  labels.clear();
  for (let i = 0; i < world.N; i++) world.setFree(i);
  world.setOwnDesk(-1);
  pendingDoor = null;
  if (moved || cameFrom) {
    // A new place: face the door you came through, and cut the camera straight there.
    cam.yaw = world.cam.arrive[cameFrom] ?? world.cam.spawnYaw ?? 0;
    cam.snap = true;
    setFocusView(false);
  }
  if (transition) {
    transition = null;
    requestAnimationFrame(() => requestAnimationFrame(() => ui.fade(false)));
  }
  for (const v of msg.members) addMember(v, true);
  // Arriving somewhere new, you face the way the camera looks.
  if (moved || cameFrom) avatars.face(msg.id, cam.yaw + Math.PI);
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
      m.standFrom = { x: place.desks[old].seat.x, z: place.desks[old].seat.z, lift: seatLift(place.desks[old].kit) };
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
  if (room.hall) ui.setRoom(placeLabel(room.kind, room.n), mine ? mine[1] : room.members.size, room.cap, g.fo);
  ui.refreshSheet('halls', hallsModel());
  refreshTags();
  if (atlas.open) renderAtlas();
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
  bench: 'errBench',
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
  if (transition && (msg.code === 'wait' || msg.code === 'full' || msg.code === 'here')) {
    // Going through a door: wait for the cooldown and try again, or give up.
    const to = transition.to;
    if (msg.code === 'wait') {
      setTimeout(() => transition?.to === to && net.send({ t: 'enter', place: to }), Math.max(50, msg.left || 0) + 60);
      return;
    }
    transition = null;
    ui.fade(false);
    if (msg.code === 'full') ui.toast(to ? t('placeFull', { place: placeIn(to) }) : t('roomFull'));
    return;
  }
  if (msg.code === 'wait') return;
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
  if (!world) return;
  const h = room.mins24 / 60;
  world.drawBoard({
    title: `${t('brand')} · ${placeLabel(room.kind ?? world.kind, room.n || 1)}`,
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
  room.hall = 0;
  room.kind = null;
  room.members.clear();
  avatars.clear();
  labels.clear();
  pendingDoor = null;
  transition = null;
  ui.fade(false);
  if (atlas.open) closeAtlas();
  for (let i = 0; i < world.N; i++) world.setFree(i);
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
  for (const d of place.desks) {
    if (room.desks[d.i] || d.rest) continue;
    v.set((d.x + d.seat.x) / 2, 0.7, (d.z + d.seat.z) / 2).project(camera);
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
  // Outside there are no desks: the second step points you to the buildings instead.
  const findDesk = place.indoor
    ? { title: t('tour2Title'), body: t('tour2Body'), target: freeDeskRect, waitFor: 'sat' }
    : { title: t('tour2OutTitle'), body: t('tour2OutBody'), target: rectOf('#dock') };
  const steps = [
    { title: t('tour1Title'), body: t('tour1Body') },
    findDesk,
    ...(place.indoor ? [{ title: t('tour3Title'), body: t('tour3Body'), target: rectOf('#dock') }] : []),
    { title: t('tour4Title'), body: t('tour4Body'), target: rectOf('#lumens-btn') },
    { title: t('tour5Title'), body: t('tour5Body'), target: rectOf('#shop-btn') },
    { title: t('tour6Title'), body: t('tour6Body'), target: rectOf('#profile-btn') },
    { title: t('tour9Title'), body: t('tour9Body'), target: rectOf('#hud .room-btn') },
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
  const base = {
    desk: mine.desk,
    mins: settings.mins,
    tag: settings.tag,
    since: mine.since,
    planned: mine.mins,
    subject: subjectName(mine.tag, getLang()),
    now: net.now(),
    kind: place.kind,
    indoor: place.indoor,
    doors: place.doors.map((d) => d.to),
    heading: pendingDoor?.to ?? null,
  };
  if (mine.desk < 0) return { ...base, mode: mine.path && pendingDoor ? 'walking' : 'standing' };
  const bench = place.desks[mine.desk]?.rest;
  if (mine.path || (mine.sitT && net.now() - mine.sitT < 500)) return { ...base, bench, mode: 'walking' };
  if (bench) return { ...base, mode: 'bench' };
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
  return { g: room.g ?? { h: [], cap: room.cap }, current: room.hall, kind: room.kind, inFocus: self()?.st === STATE.FOCUS };
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
    bench: place.desks[desk]?.rest ?? false,
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

// ------------------------------------------------------------------ the world map

/** World map mode: whether the map is open, and the destination picked on it. */
const atlas = { open: false, selected: null, data: null, unbind: null };

function atlasModel() {
  const counts = { town: 0 };
  for (const [, n, ki] of room.g?.h ?? []) {
    const c = countryOf(PLACE_KINDS[ki]) ?? 'town';
    counts[c] = (counts[c] ?? 0) + n;
  }
  return { here: countryOf(room.kind) ?? 'town', selected: atlas.selected, counts, inFocus: self()?.st === STATE.FOCUS };
}

function renderAtlas() {
  if (!atlas.data) return;
  const el = ui.showWorld(worldHTML(atlas.data, atlasModel()));
  atlas.unbind?.();
  atlas.unbind = bindMap(el, {
    onPick: (c) => ui.actions.worldPick(c),
    onSoon: (name) => ui.toast(t('worldSoonToast', { country: name }), 'globe'),
  });
}

async function openAtlas() {
  if (!joined) return;
  atlas.open = true;
  atlas.selected = atlas.selected ?? (countryOf(room.kind) ? null : 'egypt');
  try {
    atlas.data = await loadMap();
  } catch {
    atlas.open = false;
    ui.toast(t('errNetwork'));
    return;
  }
  if (atlas.open) renderAtlas();
}

function closeAtlas() {
  atlas.open = false;
  atlas.unbind?.();
  atlas.unbind = null;
  ui.hideWorld();
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
    if (id === room.hall) return;
    ui.closeSheet();
    travel({ t: 'switch', hall: id }, null);
  },
  /** From the places sheet: straight to the busiest room of a place. */
  goPlace(kind) {
    ui.closeSheet();
    if (kind === room.kind) return;
    travel({ t: 'enter', place: kind }, kind);
  },
  /** From the dock: walk to the door that leads to a place. */
  door(kind) {
    goToDoor(kind);
  },

  // World map mode
  world() {
    ui.closeSheet();
    openAtlas();
  },
  worldPick(c) {
    atlas.selected = c;
    renderAtlas();
    ui.el.world.querySelector(`[data-dest="${c}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },
  worldTravel(c) {
    closeAtlas();
    const to = c === 'town' ? OUTSIDE : COUNTRIES[c]?.start;
    if (!to || to === room.kind || self()?.st === STATE.FOCUS) return;
    travel({ t: 'enter', place: to }, to);
  },
  closeWorld() {
    closeAtlas();
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
    refreshTags();
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
    for (const v of views.values()) v.setQuality(q);
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
resize();

// ------------------------------------------------------------------ camera

const cam = {
  yaw: 0,
  pitch: 0.56,
  dist: 13,
  focusView: false,
  snap: false,
  target: new THREE.Vector3(0, 0.9, 8),
  cur: { yaw: 0, pitch: 0.5, dist: 20 },
  /** How far back the camera can get before a building is in the way. */
  reach: Infinity,
};
const camTarget = new THREE.Vector3();
const camRay = new THREE.Raycaster();
const camDir = new THREE.Vector3();
const camLook = new THREE.Vector3();
const NO_BLOCKERS = [];
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function updateCamera(dt, time) {
  let yaw = cam.yaw;
  let pitch = cam.pitch;
  let dist = cam.dist;
  const mine = self();
  if (!joined || !mine) {
    const sp = world.cam.splash;
    camTarget.set(sp.x + Math.sin(time * 0.05) * 2.5, 0.8, sp.z);
    yaw = (sp.yaw ?? 0) + Math.sin(time * 0.07) * sp.swing;
    pitch = sp.pitch;
    dist = sp.dist;
  } else if (cam.focusView && mine.desk >= 0) {
    const d = place.desks[mine.desk];
    const c = Math.cos(d.rot);
    const sn = Math.sin(d.rot);
    camTarget.set(d.x + 0.05 * c + 0.15 * sn, 0.95, d.z - 0.05 * sn + 0.15 * c);
    yaw = d.rot + cam.yaw * 0.4;
    pitch = 0.62;
    dist = 2.6;
  } else {
    // Look a little ahead of you so you see the room, not the floor.
    const w = avatars.where(room.selfId);
    const ahead = mine.desk >= 0 && !mine.path ? 1.5 : world.cam.ahead ?? 3.5;
    if (w) camTarget.set(w.x - Math.sin(cam.cur.yaw) * ahead, 0.9, w.z - Math.cos(cam.cur.yaw) * ahead);
  }
  // Portrait phones see a narrow slice of the world: stand the camera back a little.
  if (!cam.focusView) dist *= camera.aspect < 0.8 ? 1.22 : 1;
  const snapped = cam.snap;
  const k = snapped ? 1 : 1 - Math.exp(-dt * 4.5);
  if (snapped && joined && mine) {
    const w = avatars.where(room.selfId);
    const ahead = world.cam.ahead ?? 3.5;
    if (w) camTarget.set(w.x - Math.sin(yaw) * ahead, 0.9, w.z - Math.cos(yaw) * ahead);
  }
  cam.snap = false;
  cam.target.lerp(camTarget, k);
  cam.cur.yaw += wrapAngle(yaw - cam.cur.yaw) * k;
  cam.cur.pitch += (pitch - cam.cur.pitch) * k;
  cam.cur.dist += (dist - cam.cur.dist) * k;
  // Outdoors a building can get between you and the camera (turn round by a door): then the
  // camera comes in front of it, drops toward shoulder height and looks out past you, rather
  // than going through the wall or staring down at your feet.
  const blockers = joined && !cam.focusView ? world.camBlockers : NO_BLOCKERS;
  aim(cam.cur.pitch);
  const reach = castCamera(blockers, cam.cur.dist);
  // In at once so nothing ever blocks the view; back out gently once it's clear.
  cam.reach = snapped || reach < cam.reach ? reach : cam.reach + (reach - cam.reach) * (1 - Math.exp(-dt * 2.5));
  const pulled = Math.max(0, 1 - cam.reach / cam.cur.dist);
  if (pulled < 0.001) {
    camera.position.copy(cam.target).addScaledVector(camDir, cam.cur.dist);
    camera.lookAt(cam.target);
    return;
  }
  const low = cam.cur.pitch + (Math.min(cam.cur.pitch, 0.24) - cam.cur.pitch) * pulled;
  aim(low);
  camera.position.copy(cam.target).addScaledVector(camDir, castCamera(blockers, cam.reach));
  const look = low - Math.min(low * 0.4, 0.12) * pulled;
  camLook.set(-Math.sin(cam.cur.yaw) * Math.cos(look), -Math.sin(look), -Math.cos(cam.cur.yaw) * Math.cos(look)).add(camera.position);
  camera.lookAt(camLook);
}

/** Point camDir from the target back toward the camera, at the current yaw and this pitch. */
function aim(pitch) {
  const c = Math.cos(pitch);
  camDir.set(Math.sin(cam.cur.yaw) * c, Math.sin(pitch), Math.cos(cam.cur.yaw) * c);
}

/** How far back along camDir the camera can go (up to `far`) before a blocker is in the way. */
function castCamera(blockers, far) {
  if (!blockers.length) return far;
  camRay.set(cam.target, camDir);
  camRay.far = far;
  const hit = camRay.intersectObjects(blockers, false)[0];
  return hit ? Math.max(1.6, hit.distance - 0.6) : far;
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
    const limit = world.cam.yawLimit;
    cam.yaw = limit ? Math.max(-limit, Math.min(limit, cam.yaw - dx * 0.005)) : wrapAngle(cam.yaw - dx * 0.005);
    cam.pitch = Math.max(0.3, Math.min(1.25, cam.pitch + dy * 0.004));
  } else if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 10) cam.dist = Math.max(world.cam.minDist, Math.min(world.cam.maxDist, (pinch.dist * pinch.d) / d));
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
    cam.dist = Math.max(world.cam.minDist, Math.min(world.cam.maxDist, cam.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
  },
  { passive: false },
);

function selfPosition() {
  const mine = self();
  if (mine && mine.desk >= 0 && !mine.path) {
    const a = place.desks[mine.desk].approach;
    return [a.x, a.z];
  }
  const w = avatars.where(room.selfId);
  return w ? [round2(w.x), round2(w.z)] : [place.spawn.x, place.spawn.z];
}

/** Walks to the door that leads to `to`, then goes through it. */
function goToDoor(to) {
  if (to === 'world') {
    openAtlas();
    return;
  }
  const mine = self();
  if (!joined || !mine || transition) return;
  if (mine.st === STATE.FOCUS) {
    ui.toast(t('inFocus'));
    return;
  }
  const d = place.doors.find((x) => x.to === to);
  if (!d) return;
  const from = selfPosition();
  sound.tap();
  pendingDoor = { to, x: d.x, z: d.z };
  if (mine.desk < 0 && Math.hypot(from[0] - d.x, from[1] - d.z) < 0.9) {
    enterDoor();
    return;
  }
  if (mine.desk >= 0) net.send({ t: 'stand' });
  net.send({ t: 'go', from, to: [d.x, d.z] });
  tapRing.position.set(d.x, 0.02, d.z);
  tapRingAge = 0;
  refresh();
}

/** You reached the door: fade out and ask for the next place. */
function enterDoor() {
  const to = pendingDoor?.to;
  pendingDoor = null;
  if (!to) return;
  travel({ t: 'enter', place: to }, to);
}

function travel(msg, to) {
  if (transition) return;
  sound.door?.(to ?? '');
  transition = { to, at: Date.now() };
  // Crossing to another country (or home) is a flight.
  const from = countryOf(room.kind);
  const dest = to ? countryOf(to) : from;
  ui.fade(true, to && dest !== from ? t('worldFlying', { country: t(`country_${dest ?? 'town'}`) }) : '');
  setTimeout(() => net.send(msg), 260);
  setTimeout(() => {
    if (transition && Date.now() - transition.at >= 5900) {
      transition = null;
      ui.fade(false);
    }
  }, 6000);
}

// ------------------------------------------------------------------ name tags over doors

/** Floating tags over each door: where it leads and how many people are there. */
const tagEls = new Map();
const tagVec = new THREE.Vector3();
function placeCounts() {
  const counts = {};
  for (const [, n, ki] of room.g?.h ?? []) {
    const k = PLACE_KINDS[ki];
    if (k) counts[k] = (counts[k] ?? 0) + n;
  }
  return counts;
}
function refreshTags() {
  const counts = placeCounts();
  for (const el of tagEls.values()) {
    const kind = el.dataset.kind;
    const n = (counts[kind] ?? 0).toLocaleString();
    const html =
      kind === 'world'
        ? `${ICONS.plane}<span>${esc(t('worldMap'))}</span>`
        : `${esc(placeName(kind))}<small>${esc(t(PLACES[kind]?.indoor ? 'placePeople' : 'placeOutside', { n }))}</small>`;
    if (el.dataset.html !== html) {
      el.dataset.html = html;
      el.innerHTML = html;
    }
  }
}
function updateTags() {
  const show = joined && world && !cam.focusView && !transition && !tour;
  const tags = show ? (world.tags ?? []) : [];
  const wanted = new Set(tags.map((tg) => `${world.kind}:${tg.kind}`));
  for (const [key, el] of tagEls) {
    if (!wanted.has(key)) {
      el.remove();
      tagEls.delete(key);
    }
  }
  if (!tags.length) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  let added = false;
  for (const tg of tags) {
    const key = `${world.kind}:${tg.kind}`;
    let el = tagEls.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'place-tag';
      el.dataset.kind = tg.kind;
      document.getElementById('labels').append(el);
      tagEls.set(key, el);
      added = true;
    }
    tagVec.set(tg.at[0], tg.at[1], tg.at[2]).project(camera);
    const visible = tagVec.z < 1 && Math.abs(tagVec.x) < 1.1 && Math.abs(tagVec.y) < 1.1;
    el.style.opacity = visible ? '1' : '0';
    if (visible) el.style.transform = `translate3d(${(((tagVec.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - tagVec.y) / 2) * h).toFixed(1)}px, 0) translate(-50%, -100%)`;
  }
  if (added) refreshTags();
}

/** Called every frame: go through the door once you've walked up to it. */
function checkDoor() {
  if (!pendingDoor) return;
  const mine = self();
  const w = avatars.where(room.selfId);
  if (!mine || !w || mine.path) return;
  if (Math.hypot(w.x - pendingDoor.x, w.z - pendingDoor.z) < 0.9) enterDoor();
  else pendingDoor = null;
}

function onTap(x, y) {
  const mine = self();
  if (!joined || !mine) return;
  if (cam.focusView) {
    setFocusView(false);
    return;
  }
  setRay(x, y);
  const doorTo = world.pickDoor(raycaster);
  const desk = world.pickDesk(raycaster, camera, ndc);
  if (doorTo && desk < 0) return goToDoor(doorTo);
  if (desk >= 0) {
    pendingDoor = null;
    return onDeskTap(desk, mine);
  }
  const p = world.pickFloor(raycaster);
  if (!p) return;
  if (mine.st === STATE.FOCUS) {
    ui.toast(t('inFocus'));
    return;
  }
  pendingDoor = null;
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
  const doorTo = desk < 0 ? world.pickDoor(raycaster) : null;
  world.setHover(desk);
  canvas.style.cursor = desk >= 0 || doorTo ? 'pointer' : '';
  if (doorTo) {
    ui.tooltip(doorTo === 'world' ? t('busStop') : t('goTo', { place: placeIn(doorTo) }), hoverAt.x, hoverAt.y);
    return;
  }
  if (desk < 0) {
    ui.tooltip(null);
    return;
  }
  const m = room.members.get(room.desks[desk]);
  const seatName = place.desks[desk].rest ? t('bench') : t('desk', { n: desk + 1 });
  let text = seatName;
  if (m) {
    const name = displayName(m.nm, getLang());
    text = m.st === STATE.FOCUS ? `${name} · ${t('focusingFor', { t: formatMinutes((net.now() - m.since) / MIN) })}` : `${name} · ${seatName}`;
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

// Behind the sign-in panel: the place you were last in, or the town square for newcomers.
usePlace(isPlace(settings.place) ? settings.place : OUTSIDE);

let slowFrames = 0;
let last = performance.now();
function frame(nowMs) {
  const dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs;
  const time = nowMs / 1000;
  const serverNow = net.now();
  const arrived = avatars.update(serverNow, time, dt);
  if (arrived.includes(room.selfId)) {
    checkDoor();
    setTimeout(refresh, 520);
  }
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
  updateTags();
  renderer.render(scene, camera);

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
    const d = place.desks[i];
    return [(d.x + d.seat.x) / 2, 0.6, (d.z + d.seat.z) / 2];
  },
  get place() {
    return place;
  },
  usePlace,
  goToDoor,
  screenOf(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight, visible: v.z < 1 };
  },
  startTour,
};
