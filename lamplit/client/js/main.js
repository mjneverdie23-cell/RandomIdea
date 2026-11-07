// Lamplit client: wires the 3D room, avatars, network, sound and UI together.

import * as THREE from '../vendor/three.module.min.js';
import { DESKS, DESK_COUNT, round2 } from '../shared/layout.js';
import { PROTOCOL, STATE, OPEN_FOCUS_CAP, COOLDOWN } from '../shared/protocol.js';
import { displayName, subjectName, randomName, SWEATERS } from '../shared/words.js';
import { World } from './world.js';
import { Avatars } from './avatars.js';
import { Labels } from './labels.js';
import { Net } from './net.js';
import { Store } from './store.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { ICONS, EMOTE_ICONS } from './icons.js';
import { t, setLang, getLang, formatMinutes } from './i18n.js';

const MIN = 60_000;
const store = new Store();
setLang(store.profile.lang);
const sound = new Sound(store.profile);

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

// A little ring where you tap the floor.
const tapRing = new THREE.Mesh(
  new THREE.RingGeometry(0.16, 0.24, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffe1a8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
);
tapRing.position.y = 0.02;
world.scene.add(tapRing);
let tapRingAge = 1;

let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ room state (mirror of the server)

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
let joined = false;
let doneSent = false;
let lastGift = -Infinity;
let deskCard = -1;
let welcomedOnce = false;

// ------------------------------------------------------------------ network

const net = new Net(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
const params = new URLSearchParams(location.search);
const urlRoom = Number.parseInt(params.get('room') || '', 10);

function hello() {
  const p = store.profile;
  const msg = { t: 'hello', v: PROTOCOL, name: p.name, color: p.color, lamp: p.lamp };
  const hall = Number.isInteger(urlRoom) && urlRoom > 0 ? urlRoom : p.hall;
  if (hall) msg.hall = hall;
  const resume = store.resumeToken;
  if (resume) msg.resume = resume;
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
  store.resumeToken = msg.resume;
  store.update({ hall: msg.hall });
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
  onGlobal(msg.g);
  reconcileSession();
  labels.setSelf(displayName(store.profile.name, getLang()));
  ui.overlay(null);
  ui.showHud(true);
  if (!welcomedOnce) {
    welcomedOnce = true;
    const streak = store.streak();
    if (streak >= 2) ui.toast(t('welcomeBack', { n: streak }), 'lamp');
  }
  refresh();
}

function toMember(v) {
  return { id: v.id, nm: v.nm, col: v.col, lp: v.lp, desk: v.desk, st: v.st, since: v.since, mins: v.mins, tag: v.tag, pos: v.pos, path: v.path ?? null, t0: v.t0 ?? 0 };
}

function addMember(v, instant) {
  let m = room.members.get(v.id);
  if (m) {
    Object.assign(m, toMember(v));
  } else {
    m = toMember(v);
    room.members.set(m.id, m);
  }
  avatars.add(m);
  avatars.repaint(m);
  if (m.desk >= 0) {
    room.desks[m.desk] = m.id;
    world.setOccupied(m.desk, m.lp);
    world.setLamp(m.desk, m.st === STATE.FOCUS, { instant });
    if (m.id === room.selfId) world.setOwnDesk(m.desk);
  }
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
        m.col = ev[3];
        m.lp = ev[4];
        avatars.repaint(m);
        if (m.desk >= 0) world.setShade(m.desk, m.lp);
        break;
      }
      case 'hs':
        setRoomStats([ev[1], ev[2]]);
        break;
      default:
    }
  }
  if (ended) finishLocalSession(ended, finished);
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
    world.setOccupied(desk, m.lp);
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
      // They were sitting: animate getting up from the chair.
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

/** Applies a state change. For your own avatar, returns the previous session if one ended. */
function onState([, id, st, since, mins, tag]) {
  const m = room.members.get(id);
  if (!m) return null;
  const prev = { st: m.st, since: m.since, mins: m.mins, tag: m.tag };
  m.st = st;
  m.since = since;
  m.mins = mins;
  m.tag = tag;
  if (m.desk >= 0) world.setLamp(m.desk, st === STATE.FOCUS);
  if (id !== room.selfId) return null;
  if (st === STATE.FOCUS && !(prev.st === STATE.FOCUS && prev.since === since)) {
    startLocalSession(m);
    sound.lamp(true);
  }
  if (prev.st === STATE.BREAK && st === STATE.SEATED) {
    sound.chime();
    ui.toast(t('breakOver'), 'lamp');
  }
  if (prev.st === STATE.FOCUS && !(st === STATE.FOCUS && since === prev.since)) return prev;
  return null;
}

function onTea(from, desk, until) {
  if (until <= 0) {
    room.tea.delete(desk);
    world.setTea(desk, false);
    return;
  }
  room.tea.set(desk, until);
  world.setTea(desk, true);
  const me = self();
  const lang = getLang();
  if (me && me.desk === desk && from !== room.selfId) {
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
  room.g = g;
  ui.setLive(g);
  const mine = g.h.find(([id]) => id === room.hall);
  if (room.hall) ui.setRoom(room.hall, mine ? mine[1] : room.members.size, room.cap);
  ui.refreshSheet('halls', hallsModel());
}

function onError(msg) {
  switch (msg.code) {
    case 'taken':
      ui.toast(t('taken'));
      break;
    case 'nopath':
      ui.toast(t('noPath'));
      break;
    case 'full':
      ui.toast(t('roomFull'));
      break;
    case 'cooldown':
      ui.toast(t('teaWait', { n: Math.ceil((msg.left || 0) / 1000) }), 'tea');
      break;
    case 'early':
      setTimeout(() => {
        doneSent = false;
      }, 2000);
      break;
    default:
  }
}

function onBye(reason) {
  if (reason === 'replaced') {
    net.disconnect();
    joined = false;
    ui.overlay('replaced');
  } else if (reason === 'version') {
    net.disconnect();
    ui.overlay('version');
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

// ------------------------------------------------------------------ your focus sessions

function startLocalSession(m) {
  store.activeSession = { since: m.since, mins: m.mins, tag: m.tag };
  doneSent = false;
}

/** A session of yours ended. `finished` is the minutes credited by the server, or null if stopped early. */
function finishLocalSession(prev, finished) {
  store.activeSession = null;
  doneSent = false;
  const now = net.now();
  if (finished) {
    const minutes = prev.mins > 0 ? prev.mins : Math.min(OPEN_FOCUS_CAP, Math.floor((now - prev.since) / MIN));
    store.addFocus(minutes, true);
    sound.bell();
    setFocusView(false);
    ui.openSheet('complete', { minutes, today: store.today(), streak: store.streak(), goal: store.profile.goal });
    return;
  }
  const minutes = Math.floor(Math.min(now - prev.since, (prev.mins || OPEN_FOCUS_CAP) * MIN) / MIN);
  store.addFocus(minutes, false);
  sound.lamp(false);
  setFocusView(false);
  if (minutes > 0) ui.toast(`${t('sessionEnded')} · ${t('plusMin', { n: minutes })}`, 'lamp');
}

/** After (re)joining, settle any session that ended while we were away. */
function reconcileSession() {
  const active = store.activeSession;
  const me = self();
  if (me && me.st === STATE.FOCUS && active && active.since === me.since) return;
  if (active) {
    store.activeSession = null;
    const now = net.now();
    const capMs = (active.mins || OPEN_FOCUS_CAP) * MIN;
    const minutes = Math.floor(Math.min(Math.max(0, now - active.since), capMs) / MIN);
    const completed = active.mins > 0 && now - active.since >= active.mins * MIN;
    if (minutes > 0) {
      store.addFocus(minutes, completed);
      ui.toast(t('awayEnded', { n: minutes }), 'lamp');
    }
  }
  if (me && me.st === STATE.FOCUS) startLocalSession(me);
}

function tickSession() {
  const me = self();
  if (!me || me.st !== STATE.FOCUS || me.mins === 0 || doneSent) return;
  if (net.now() >= me.since + me.mins * MIN) {
    doneSent = true;
    net.send({ t: 'done' });
  }
}

// ------------------------------------------------------------------ dock & sheets

function dockModel() {
  const me = self();
  if (!joined || !me) return null;
  const p = store.profile;
  const base = { desk: me.desk, mins: p.mins, tag: p.tag, since: me.since, planned: me.mins, subject: subjectName(me.tag, getLang()), now: net.now() };
  if (me.desk < 0) return { ...base, mode: 'standing' };
  if (me.path || (me.sitT && net.now() - me.sitT < 500)) return { ...base, mode: 'walking' };
  if (me.st === STATE.FOCUS) return { ...base, mode: 'focus' };
  if (me.st === STATE.BREAK) return { ...base, mode: 'break' };
  return { ...base, mode: 'seated' };
}

function refresh() {
  ui.dock(dockModel());
  const me = self();
  world.setMarkers(Boolean(joined && me && me.desk < 0));
}

function hallsModel() {
  const me = self();
  return { g: room.g ?? { h: [], cap: room.cap }, current: room.hall, inFocus: me?.st === STATE.FOCUS };
}

function deskModel(desk) {
  const m = room.members.get(room.desks[desk]);
  if (!m) return null;
  const lang = getLang();
  const now = net.now();
  let status = t('settlingIn');
  if (m.st === STATE.FOCUS) status = t('focusingFor', { t: formatMinutes((now - m.since) / MIN) });
  else if (m.st === STATE.BREAK) status = t('takingBreak');
  return {
    desk,
    name: displayName(m.nm, lang),
    sweater: SWEATERS[m.col] ?? SWEATERS[0],
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

let styleTimer = 0;
let lastStyle = -Infinity;
/** Sends name/colour/lamp changes, at most once per server cooldown. */
function queueStyle() {
  clearTimeout(styleTimer);
  const send = () => {
    lastStyle = Date.now();
    const p = store.profile;
    net.send({ t: 'style', name: p.name, color: p.color, lamp: p.lamp });
  };
  const wait = COOLDOWN.style + 100 - (Date.now() - lastStyle);
  if (wait <= 0) send();
  else styleTimer = setTimeout(send, wait);
}

function settingsModel() {
  return { profile: store.profile, name: displayName(store.profile.name, getLang()), locked: (i) => store.lampLocked(i) };
}

function statsModel() {
  return { today: store.today(), streak: store.streak(), total: store.stats.total, sessions: store.stats.sessions, last7: store.last7(), goal: store.profile.goal };
}

function setFocusView(on) {
  cam.focusView = Boolean(on) && self()?.desk >= 0;
  ui.setFocusView(cam.focusView);
}

// ------------------------------------------------------------------ UI actions

const ui = new UI({
  enter() {
    sound.unlock();
    ui.hideSplash();
    ui.overlay('connecting');
    net.connect(hello);
  },
  setLang(l) {
    store.update({ lang: l });
    setLang(l);
    ui.renderStatic();
    if (room.g) ui.setLive(room.g);
    if (room.hall) onGlobal(room.g ?? { h: [], on: 0, fo: 0 });
    ui.setSound(store.profile.muted);
    labels.setSelf(displayName(store.profile.name, l));
    drawBoard();
    refresh();
    ui.refreshSheet('settings', settingsModel());
  },
  mins(v) {
    store.update({ mins: v });
    refresh();
  },
  tag(v) {
    store.update({ tag: v });
    refresh();
  },
  focus() {
    const p = store.profile;
    net.send({ t: 'focus', mins: p.mins, tag: p.tag });
  },
  back() {
    const p = store.profile;
    net.send({ t: 'focus', mins: p.mins, tag: p.tag });
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
    const p = store.profile;
    net.send({ t: 'focus', mins: p.mins, tag: p.tag });
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
  stats() {
    ui.openSheet('stats', statsModel());
  },
  goal(v) {
    store.update({ goal: v });
    ui.refreshSheet('stats', statsModel());
  },
  settings() {
    ui.openSheet('settings', settingsModel());
  },
  sound() {
    sound.unlock();
    store.update({ muted: !store.profile.muted });
    sound.setMuted(store.profile.muted);
    ui.setSound(store.profile.muted);
  },
  volume(v) {
    const vol = Number(v) / 100;
    store.update({ volume: vol, muted: vol === 0 ? store.profile.muted : false });
    sound.setVolume(vol);
    sound.setMuted(store.profile.muted);
    ui.setSound(store.profile.muted);
  },
  rain(on) {
    store.update({ rain: on });
    sound.setRain(on);
  },
  roomSounds(on) {
    store.update({ roomSounds: on });
    sound.setRoomSounds(on);
  },
  color(i) {
    store.update({ color: i });
    const me = self();
    if (me) {
      me.col = i;
      avatars.repaint(me);
    }
    queueStyle();
    ui.refreshSheet('settings', settingsModel());
  },
  lamp(i) {
    if (store.lampLocked(i)) return;
    store.update({ lamp: i });
    const me = self();
    if (me) {
      me.lp = i;
      if (me.desk >= 0) world.setShade(me.desk, i);
    }
    queueStyle();
    ui.refreshSheet('settings', settingsModel());
  },
  newName() {
    store.update({ name: randomName() });
    const me = self();
    if (me) me.nm = store.profile.name;
    labels.setSelf(displayName(store.profile.name, getLang()));
    queueStyle();
    ui.refreshSheet('settings', settingsModel());
  },
  closeSheet() {
    ui.closeSheet();
  },
  sheetClosed(kind) {
    if (kind === 'desk') deskCard = -1;
  },
  useHere() {
    store.resumeToken = null;
    ui.overlay('connecting');
    net.connect(hello);
  },
  reload() {
    location.reload();
  },
});
ui.setSound(store.profile.muted);

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
  const me = self();
  if (!joined || !me) {
    // Slow drift over the room behind the splash screen.
    camTarget.set(Math.sin(time * 0.05) * 2.5, 0.8, 1.5);
    yaw = Math.sin(time * 0.07) * 0.35;
    pitch = 0.48;
    dist = 21;
  } else if (cam.focusView && me.desk >= 0) {
    const d = DESKS[me.desk];
    camTarget.set(d.x + 0.05, 0.95, d.z + 0.15);
    yaw = cam.yaw * 0.4;
    pitch = 0.62;
    dist = 2.6;
  } else {
    // Look a little ahead of you (toward the windows) so you see the room, not the floor.
    const w = avatars.where(room.selfId);
    const ahead = me.desk >= 0 && !me.path ? 1.5 : 3.5;
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
  const me = self();
  if (me && me.desk >= 0 && !me.path) {
    const a = DESKS[me.desk].approach;
    return [a.x, a.z];
  }
  const w = avatars.where(room.selfId);
  return w ? [round2(w.x), round2(w.z)] : [0, 15];
}

function onTap(x, y) {
  const me = self();
  if (!joined || !me) return;
  if (cam.focusView) {
    setFocusView(false);
    return;
  }
  setRay(x, y);
  const desk = world.pickDesk(raycaster, camera, ndc);
  if (desk >= 0) return onDeskTap(desk, me);
  const p = world.pickFloor(raycaster);
  if (!p) return;
  if (me.st === STATE.FOCUS) {
    ui.toast(t('inFocus'));
    return;
  }
  const from = selfPosition();
  if (me.desk >= 0) net.send({ t: 'stand' });
  net.send({ t: 'go', from, to: [round2(p.x), round2(p.z)] });
  tapRing.position.set(p.x, 0.02, p.z);
  tapRingAge = 0;
}

function onDeskTap(desk, me) {
  const owner = room.desks[desk];
  if (owner === room.selfId) return;
  if (owner) {
    deskCard = desk;
    ui.openSheet('desk', deskModel(desk));
    return;
  }
  if (me.st === STATE.FOCUS) {
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

setInterval(() => {
  if (!joined) return;
  tickSession();
  ui.tick(net.now());
  refresh();
  if (deskCard >= 0) refreshDeskCard();
}, 250);

fetch('/api/status')
  .then((r) => (r.ok ? r.json() : null))
  .then((s) => s && ui.setSplashLive({ fo: s.focusing, on: s.online }))
  .catch(() => {});

// Lower the resolution on devices that struggle.
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

  if (dt > 0.034) slowFrames++;
  else slowFrames = Math.max(0, slowFrames - 1);
  if (slowFrames > 90 && pixelRatio > 1) {
    pixelRatio = Math.max(1, pixelRatio - 0.25);
    slowFrames = 0;
    resize();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For automated checks and debugging from the console.
window.lamplit = {
  room,
  net,
  store,
  world,
  avatars,
  cam,
  ui,
  /** World position of the middle of a desk and its chair. */
  deskPos(i) {
    return [DESKS[i].x, 0.6, DESKS[i].z + 0.3];
  },
  /** Screen position (CSS pixels) of a world point. */
  screenOf(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight, visible: v.z < 1 };
  },
};
