// The HTML layer over the 3D room: header, the dock at the bottom (which changes with
// what you are doing), sheets (shop, profile, settings, rooms, account, a finished
// session, someone's desk), toasts, the connection overlay and the sign-in panel.
// Buttons carry data-action attributes that map onto the `actions` object from main.js.

import { t, getLang, formatMinutes, formatClock, placeName, placeLabel, placeIn } from './i18n.js';
import { ICONS, EMOTE_ICONS } from './icons.js';
import { SUBJECTS, subjectName } from '../shared/words.js';
import { FOCUS_PRESETS } from '../shared/protocol.js';
import { PLACE_KINDS, TOWN, COUNTRIES, countryOf } from '../shared/places.js';
import { authHTML, accountHTML, shopHTML, profileHTML, settingsHTML, esc } from './views.js';

const $ = (sel, root = document) => root.querySelector(sel);
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const EMOTE_KEYS = ['wave', 'stretch', 'cheer'];
/** Icons for each place (and for going outside). */
const PLACE_ICONS = { library: 'book', cafe: 'tea', netcafe: 'screen', square: 'tree', pyramid: 'pyramid', giza: 'sun', colosseum: 'arch', rome: 'tree', temple: 'torii', garden: 'tree', basilica: 'spires', barcelona: 'sun' };
const VIEWS = { shop: shopHTML, profile: profileHTML, settings: settingsHTML, account: accountHTML };

export class UI {
  constructor(actions) {
    this.actions = actions;
    this.el = {
      hud: $('#hud'),
      roomPill: $('#room-pill'),
      lumens: $('#lumens-btn'),
      soundBtn: $('#sound-btn'),
      dock: $('#dock'),
      emotes: $('#emotes'),
      toasts: $('#toasts'),
      tooltip: $('#tooltip'),
      sheet: $('#sheet'),
      backdrop: $('#backdrop'),
      overlay: $('#overlay'),
      splash: $('#splash'),
      splashLive: $('#splash-live'),
      auth: $('#auth'),
      focusbar: $('#focusbar'),
      focusTime: $('#focus-time'),
      fade: $('#fade'),
      fadeLabel: $('#fade-label'),
      world: $('#world'),
    };
    this.dockKey = '';
    this.model = null;
    this.sheetKind = null;
    this.sheetData = null;
    this.confirming = false;

    document.addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-form]');
      if (!form) return;
      e.preventDefault();
      this.actions.formSubmit?.(form.dataset.form, Object.fromEntries(new FormData(form)), form);
    });
    document.addEventListener('input', (e) => {
      const name = e.target?.dataset?.input;
      if (name) this.actions[name]?.(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!this.el.world.hidden) this.actions.closeWorld?.();
      else if (this.sheetKind) this.closeSheet();
      else this.actions.focusView?.(0);
    });
    this.el.world.addEventListener('click', (e) => {
      if (e.target === this.el.world) this.actions.closeWorld?.();
    });
    this.el.backdrop.addEventListener('click', () => this.closeSheet());
    this.renderStatic();
  }

  onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const fn = this.actions[btn.dataset.action];
    if (!fn) return;
    e.preventDefault();
    const raw = btn.dataset.v;
    fn(raw === undefined ? undefined : Number.isNaN(Number(raw)) ? raw : Number(raw), btn);
  }

  /** Text that does not depend on game state; re-run after a language change. */
  renderStatic() {
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon];
    for (const el of document.querySelectorAll('[data-i18n-label]')) {
      el.setAttribute('aria-label', t(el.dataset.i18nLabel));
      el.title = t(el.dataset.i18nLabel);
    }
    this.el.emotes.innerHTML = EMOTE_ICONS.map(
      (icon, i) => `<button class="emote-btn" data-action="emote" data-v="${i}" aria-label="${esc(t(EMOTE_KEYS[i]))}" title="${esc(t(EMOTE_KEYS[i]))}">${icon}</button>`,
    ).join('');
    for (const b of document.querySelectorAll('.lang-switch button')) b.setAttribute('aria-pressed', String(b.dataset.v === getLang()));
    this.dockKey = '';
    if (this.model) this.dock(this.model);
    if (this.sheetKind) this.renderSheet(true);
    if (this.authState) this.renderAuth(this.authState);
  }

  // ---------------------------------------------------------------- splash, sign-in & header

  setSplashLive(g) {
    this.el.splashLive.textContent = g ? t('liveSplash', { fo: g.fo.toLocaleString(), on: g.on.toLocaleString() }) : '';
    this.el.splashLive.hidden = !g;
  }

  /** state: { state: 'checking' | 'known' | 'new', me?, mode, error, busy } */
  renderAuth(state) {
    this.authState = state;
    const prev = this.el.auth.querySelector('form');
    const keep = prev && state.state === 'new' && prev.dataset.form === state.mode ? Object.fromEntries(new FormData(prev)) : null;
    this.el.auth.innerHTML = authHTML(state);
    if (keep) {
      const form = this.el.auth.querySelector('form');
      if (form.username) form.username.value = keep.username ?? '';
      if (form.password) form.password.value = keep.password ?? '';
    }
  }

  hideSplash() {
    const s = this.el.splash;
    s.classList.add('leaving');
    setTimeout(() => {
      s.hidden = true;
    }, 450);
  }

  showSplash() {
    const s = this.el.splash;
    s.hidden = false;
    s.classList.remove('leaving');
  }

  showHud(on) {
    this.el.hud.hidden = !on;
  }

  /** The header: where you are ("Coffee shop 2") and how many people are studying. */
  setRoom(label, count, cap, fo) {
    this.el.roomPill.innerHTML = `<span>${esc(label)}</span><span class="room-count"> · ${esc(t('liveHud', { fo: (fo ?? 0).toLocaleString() }))}</span>`;
    this.el.roomPill.parentElement.title = `${label} · ${t('roomCount', { n: count, cap })} · ${t('placesTitle')}`;
  }

  /** Fades the screen out (going through a door, or flying abroad) and back in. */
  fade(on, label = '') {
    if (on) this.el.fadeLabel.innerHTML = label ? `${ICONS.plane}<span>${esc(label)}</span>` : '';
    this.el.fade.classList.toggle('on', Boolean(on));
    this.el.fade.classList.toggle('flying', Boolean(on && label));
  }

  // ---------------------------------------------------------------- the world map

  get worldOpen() {
    return !this.el.world.hidden;
  }

  /** Shows (or re-renders) the world map screen; returns its element. */
  showWorld(html) {
    const w = this.el.world;
    const scroll = w.querySelector('.world-card')?.scrollTop ?? 0;
    if (w.dataset.html !== html) {
      w.dataset.html = html;
      w.innerHTML = html;
      const card = w.querySelector('.world-card');
      if (card) card.scrollTop = scroll;
    }
    if (w.hidden) {
      w.hidden = false;
      requestAnimationFrame(() => w.classList.add('in'));
    }
    return w;
  }

  hideWorld() {
    const w = this.el.world;
    w.classList.remove('in');
    setTimeout(() => {
      if (!w.classList.contains('in')) w.hidden = true;
    }, 220);
  }

  setLumens(n) {
    this.el.lumens.innerHTML = `<span class="spark" aria-hidden="true">✦</span><span>${n.toLocaleString()}</span>`;
    this.el.lumens.title = t('lumensTitle', { n });
    this.el.lumens.setAttribute('aria-label', t('lumensTitle', { n }));
  }

  /** A little "+✦25" that floats up from the balance. */
  bumpLumens(n) {
    const el = document.createElement('span');
    el.className = 'lumen-pop';
    el.textContent = t('earned', { n });
    this.el.lumens.append(el);
    setTimeout(() => el.remove(), 1600);
  }

  setSound(muted) {
    this.el.soundBtn.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
    const label = t(muted ? 'sound_on' : 'sound_off');
    this.el.soundBtn.setAttribute('aria-label', label);
    this.el.soundBtn.title = label;
  }

  // ---------------------------------------------------------------- overlay, toasts, tooltip

  overlay(kind, vars = {}) {
    const o = this.el.overlay;
    if (!kind) {
      o.hidden = true;
      return;
    }
    const spinner = '<span class="spinner" aria-hidden="true"></span>';
    const html = {
      connecting: `${spinner}<p>${esc(t('connecting'))}</p>`,
      reconnecting: `${spinner}<p>${esc(t('reconnecting'))}</p>`,
      offline: `${spinner}<p>${esc(t('offline'))}</p>`,
      queue: `${spinner}<p>${esc(t('queue', { n: vars.n }))}</p>`,
      replaced: `<p>${esc(t('replaced'))}</p><button class="btn primary" data-action="useHere">${esc(t('useHere'))}</button>`,
      version: `<p>${esc(t('newVersion'))}</p><button class="btn primary" data-action="reload">${esc(t('reload'))}</button>`,
    }[kind];
    o.innerHTML = `<div class="overlay-card" role="status">${html}</div>`;
    o.hidden = false;
  }

  toast(text, icon) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${icon ? ICONS[icon] ?? '' : ''}<span>${esc(text)}</span>`;
    this.el.toasts.append(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 300);
    }, 3400);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstElementChild.remove();
  }

  tooltip(text, x, y) {
    const tip = this.el.tooltip;
    if (!text) {
      tip.hidden = true;
      return;
    }
    tip.textContent = text;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.transform = `translate(${Math.min(window.innerWidth - w - 8, x + 14)}px, ${Math.max(8, y - 34)}px)`;
  }

  // ---------------------------------------------------------------- dock

  /** model: { mode, desk, mins, tag, since, planned, subject } or null. */
  dock(model) {
    const d = this.el.dock;
    if (!model) {
      d.hidden = true;
      this.el.emotes.hidden = true;
      this.model = null;
      this.dockKey = '';
      return;
    }
    if (model.mode !== 'focus') this.confirming = false;
    d.hidden = false;
    this.el.emotes.hidden = false;
    this.model = model;
    const key = [model.mode, model.desk, model.since, model.planned, model.mins, model.tag, model.subject, model.kind, model.heading, this.confirming, getLang()].join('|');
    if (key === this.dockKey) return;
    this.dockKey = key;
    d.dataset.mode = model.mode;
    d.innerHTML = this.dockHTML(model);
    this.timerEl = $('#timer', d);
    this.timerLabel = $('#timer-label', d);
    this.progressEl = $('#progress', d);
    this.earnEl = $('#earning', d);
    this.tick(model.now ?? Date.now());
  }

  dockHTML(m) {
    const lang = getLang();
    switch (m.mode) {
      case 'standing': {
        const doors =
          m.doors.map((to) => `<button class="chip door-chip" data-action="door" data-v="${to}">${ICONS[PLACE_ICONS[to]] ?? ''}<span>${esc(m.indoor ? t('goOutside') : placeName(to))}</span></button>`).join('') +
          (m.indoor ? '' : `<button class="chip door-chip world-chip" data-action="world">${ICONS.globe}<span>${esc(t('worldMap'))}</span></button>`);
        return `<div class="card standing">
          <div class="hint inline"><span class="beacon" aria-hidden="true"></span>${esc(t(m.indoor ? 'pickDesk' : 'pickPlace'))}</div>
          <div class="chips door-chips">${doors}</div>
        </div>`;
      }
      case 'walking':
        if (m.heading) return `<div class="hint">${esc(t('headingTo', { place: placeIn(m.heading) }))}</div>`;
        return `<div class="hint">${esc(m.bench ? t('walkingBench') : t('walking', { n: m.desk + 1 }))}</div>`;
      case 'bench':
        return `<div class="card bench">
          <div class="card-head"><span class="eyebrow">${esc(t('bench'))}</span><button class="link" data-action="stand">${esc(t('standUp'))}</button></div>
          <p class="muted small">${esc(t('benchHint'))}</p>
        </div>`;
      case 'seated': {
        const lengths = [...FOCUS_PRESETS, 0]
          .map((v) => `<button class="chip${v === m.mins ? ' on' : ''}" data-action="mins" data-v="${v}" aria-pressed="${v === m.mins}" ${v === 0 ? `title="${esc(t('openLong'))}"` : ''}>${v === 0 ? t('open') : esc(t('minShort', { n: v }))}</button>`)
          .join('');
        const subjects = SUBJECTS.map(
          (_, i) => `<button class="chip${i === m.tag ? ' on' : ''}" data-action="tag" data-v="${i}" aria-pressed="${i === m.tag}">${esc(subjectName(i, lang))}</button>`,
        ).join('');
        return `<div class="card">
          <div class="card-head"><span class="eyebrow">${esc(t('desk', { n: m.desk + 1 }))}</span><button class="link" data-action="stand">${esc(t('standUp'))}</button></div>
          <div class="field"><span class="field-label">${esc(t('sessionLength'))}</span><div class="chips">${lengths}</div></div>
          <div class="field"><span class="field-label">${esc(t('subject'))}</span><div class="chips scroll">${subjects}</div></div>
          <button class="btn primary wide lamp-btn" data-action="focus">${ICONS.lamp}<span>${esc(t('lampOn'))}</span></button>
        </div>`;
      }
      case 'focus':
        if (this.confirming) {
          return `<div class="card">
            <p class="confirm">${esc(t('endConfirm'))}</p>
            <div class="row"><button class="btn danger" data-action="endYes">${esc(t('endYes'))}</button><span class="spacer"></span><button class="btn" data-action="endNo">${esc(t('keepGoing'))}</button></div>
          </div>`;
        }
        return `<div class="card focus">
          <div class="timer-row"><div class="timer"><span class="time" id="timer">--:--</span><span class="timer-label" id="timer-label"></span></div><span class="tag">${esc(m.subject)}</span></div>
          <div class="progress${m.planned ? '' : ' open'}"><i id="progress"></i></div>
          <div class="row"><span class="earning" id="earning"></span><span class="spacer"></span><button class="btn ghost" data-action="focusView" data-v="1">${ICONS.focus}<span>${esc(t('focusView'))}</span></button><button class="btn ghost" data-action="end">${esc(t('endSession'))}</button></div>
        </div>`;
      case 'break':
        return `<div class="card">
          <div class="timer-row"><div class="timer"><span class="eyebrow">${esc(t('onBreak'))}</span><span class="time" id="timer">--:--</span><span class="timer-label" id="timer-label"></span></div></div>
          <div class="progress break"><i id="progress"></i></div>
          <div class="row"><button class="btn primary" data-action="back">${ICONS.lamp}<span>${esc(t('backToStudy'))}</span></button><span class="spacer"></span><button class="btn ghost" data-action="stand">${esc(t('standUp'))}</button></div>
        </div>`;
      default:
        return '';
    }
  }

  confirmEnd(on) {
    this.confirming = on;
    if (this.model) this.dock(this.model);
  }

  /** Updates the running timer (called a few times a second). */
  tick(now) {
    const m = this.model;
    if (!m || !this.timerEl) return;
    const elapsed = now - m.since;
    let text;
    if (m.mode === 'focus' && m.planned > 0) {
      text = formatClock(m.planned * 60_000 - elapsed);
      this.timerLabel.textContent = t('left');
      this.progressEl.style.transform = `scaleX(${clamp01(elapsed / (m.planned * 60_000)).toFixed(4)})`;
    } else if (m.mode === 'focus') {
      text = formatClock(elapsed);
      this.timerLabel.textContent = t('elapsed');
      this.progressEl.style.transform = `scaleX(${clamp01((elapsed % 3_600_000) / 3_600_000).toFixed(4)})`;
    } else if (m.mode === 'break') {
      text = formatClock(m.planned * 60_000 - elapsed);
      this.timerLabel.textContent = t('left');
      this.progressEl.style.transform = `scaleX(${clamp01(1 - elapsed / (m.planned * 60_000)).toFixed(4)})`;
    }
    if (m.mode === 'focus' && this.earnEl) {
      const cap = (m.planned || 240) * 60_000;
      this.earnEl.textContent = `✦ ${Math.floor(Math.min(elapsed, cap) / 60_000)}`;
    }
    if (text !== undefined) {
      this.timerEl.textContent = text;
      this.el.focusTime.textContent = text;
    }
  }

  cooldownEmotes(ms) {
    const buttons = this.el.emotes.querySelectorAll('button');
    for (const b of buttons) b.disabled = true;
    setTimeout(() => {
      for (const b of buttons) b.disabled = false;
    }, ms);
  }

  setFocusView(on) {
    document.body.classList.toggle('focus-view', on);
    this.el.focusbar.hidden = !on;
  }

  // ---------------------------------------------------------------- sheets

  openSheet(kind, data) {
    this.sheetKind = kind;
    this.sheetData = data;
    this.renderSheet(true);
    this.el.sheet.hidden = false;
    this.el.backdrop.hidden = false;
    this.el.sheet.scrollTop = 0;
    requestAnimationFrame(() => document.body.classList.add('sheet-open'));
  }

  /** Re-renders a sheet if it is the one showing. */
  refreshSheet(kind, data) {
    if (this.sheetKind !== kind) return;
    this.sheetData = data;
    this.renderSheet();
  }

  closeSheet() {
    if (!this.sheetKind) return;
    const kind = this.sheetKind;
    this.sheetKind = null;
    document.body.classList.remove('sheet-open');
    setTimeout(() => {
      if (!this.sheetKind) {
        this.el.sheet.hidden = true;
        this.el.backdrop.hidden = true;
      }
    }, 240);
    this.actions.sheetClosed?.(kind);
  }

  renderSheet(force = false) {
    const kind = this.sheetKind;
    const body = VIEWS[kind] ? VIEWS[kind](this.sheetData) : this[`${kind}HTML`](this.sheetData);
    const html = `<button class="icon-btn sheet-close" data-action="closeSheet" aria-label="${esc(t('close'))}">${ICONS.close}</button>${body}`;
    // Only touch the DOM when something changed, so a tap is never lost to a re-render.
    if (!force && html === this.sheetHTML && this.el.sheet.dataset.kind === kind) return;
    const sheet = this.el.sheet;
    // Keep what someone is typing, and where they've scrolled to.
    const typed = [...sheet.querySelectorAll('input[name]')].map((i) => [i.closest('form')?.dataset.form, i.name, i.value]);
    const focused = document.activeElement?.name;
    const scroll = sheet.scrollTop;
    const grid = sheet.querySelector('.item-grid')?.scrollTop ?? 0;
    this.sheetHTML = html;
    sheet.dataset.kind = kind;
    sheet.innerHTML = html;
    for (const [form, name, value] of typed) {
      const input = sheet.querySelector(`[data-form="${form}"] input[name="${name}"]`);
      if (input) input.value = value;
    }
    if (focused) sheet.querySelector(`input[name="${focused}"]`)?.focus({ preventScroll: true });
    sheet.scrollTop = scroll;
    const g = sheet.querySelector('.item-grid');
    if (g) g.scrollTop = grid;
    this.actions.sheetRendered?.(kind, sheet);
  }

  completeHTML({ minutes, lumens, today, streak, goal }) {
    return `<div class="sheet-body center">
      <div class="seal">${ICONS.check}</div>
      <h2>${esc(t('sessionComplete'))}</h2>
      <p class="gain">${esc(t('plusMin', { n: minutes }))}${lumens ? ` <span class="spark-gain">${esc(t('earned', { n: lumens }))}</span>` : ''}</p>
      <div class="tiles two">
        <div class="tile"><b>${esc(formatMinutes(today))}</b><span>${esc(t('today'))}</span></div>
        <div class="tile"><b>${esc(streak === 1 ? t('day1') : t('days', { n: streak }))}</b><span>${esc(t('streak'))}</span></div>
      </div>
      <div class="goal"><div class="progress goal-bar"><i style="transform:scaleX(${clamp01(today / goal).toFixed(3)})"></i></div>
      <span class="muted small">${esc(today >= goal ? t('goalDone') : t('goalLeft', { t: formatMinutes(goal - today) }))}</span></div>
      <div class="stack">
        <button class="btn primary wide" data-action="break5">${esc(t('takeBreak', { n: 5 }))}</button>
        <button class="btn wide" data-action="another">${ICONS.lamp}<span>${esc(t('another'))}</span></button>
        <button class="btn ghost wide" data-action="closeSheet">${esc(t('done'))}</button>
      </div>
    </div>`;
  }

  /** The places sheet: each place with how many are there, and its rooms. */
  hallsHTML({ g, current, kind, inFocus }) {
    // The places of where you are: the town, or the country you're visiting.
    const country = countryOf(kind);
    const area = country ? COUNTRIES[country].places : TOWN;
    const cards = area.map((k) => {
      const ki = PLACE_KINDS.indexOf(k);
      const rooms = g.h.filter((h) => h[2] === ki).sort((a, b) => a[3] - b[3]);
      const people = rooms.reduce((sum, h) => sum + h[1], 0);
      const here = k === kind;
      const roomRows =
        rooms.length > 1 || (here && rooms.length === 1 && rooms[0][0] !== current)
          ? `<ul class="room-list">${rooms
              .map(([id, n, , num, cap]) => {
                const mine = id === current;
                const right = mine
                  ? `<span class="badge">${esc(t('youAreHere'))}</span>`
                  : n >= cap
                    ? `<span class="badge muted">${esc(t('full'))}</span>`
                    : `<button class="btn small" data-action="switchRoom" data-v="${id}" ${inFocus ? 'disabled' : ''}>${esc(t('join'))}</button>`;
                return `<li class="room${mine ? ' here' : ''}">
                  <div class="room-meta"><b>${esc(placeLabel(k, num))}</b><span class="muted">${n}/${cap}</span></div>
                  <div class="meter"><i style="transform:scaleX(${clamp01(n / cap).toFixed(3)})"></i></div>
                  ${right}
                </li>`;
              })
              .join('')}</ul>`
          : '';
      const action = here
        ? `<span class="badge">${esc(t('youAreHere'))}</span>`
        : `<button class="btn small primary" data-action="goPlace" data-v="${k}" ${inFocus ? 'disabled' : ''}>${esc(t('goThere'))}</button>`;
      return `<li class="place-card place-${k}${here ? ' here' : ''}">
        <div class="place-head"><span class="place-icon" aria-hidden="true">${ICONS[PLACE_ICONS[k]] ?? ''}</span>
          <div class="place-meta"><b>${esc(placeName(k))}</b><span class="muted small">${esc(t(`placeAbout_${k}`))}</span></div>
          ${action}</div>
        <p class="muted small place-count">${esc(t(k === 'square' ? 'placeOutside' : 'placePeople', { n: people.toLocaleString() }))}</p>
        ${roomRows}
      </li>`;
    }).join('');
    const banner = `<div class="world-banner">
      <span class="world-globe" aria-hidden="true">${ICONS.globe}</span>
      <div class="world-banner-text"><b>${esc(t('worldBanner'))}</b><span class="muted small">${esc(t('worldBannerBody'))}</span></div>
      <button class="btn small primary" data-action="world">${esc(t('worldOpen'))}</button>
    </div>`;
    const home = country
      ? `<button class="btn wide home-btn" data-action="goPlace" data-v="square" ${inFocus ? 'disabled' : ''}>${ICONS.lamp}<span>${esc(t('worldBack'))}</span></button>`
      : '';
    return `<div class="sheet-body">
      <h2>${esc(country ? t(`country_${country}`) : t('placesTitle'))}</h2>
      <p class="muted">${esc(t('placesHint'))}</p>
      ${banner}
      <ul class="place-list">${cards}</ul>
      ${home}
      ${inFocus ? `<p class="muted small">${esc(t('switchInFocus'))}</p>` : ''}
    </div>`;
  }

  deskHTML({ desk, bench, name, sweater, status, subject, teaWait }) {
    const tea = bench
      ? `<p class="muted">${esc(t('benchRest'))}</p>`
      : `<button class="btn primary wide" data-action="gift" data-v="${desk}" ${teaWait > 0 ? 'disabled' : ''}>${ICONS.tea}<span>${esc(t('sendTea'))}</span></button>
      ${teaWait > 0 ? `<p class="muted small">${esc(t('teaWait', { n: Math.ceil(teaWait / 1000) }))}</p>` : ''}`;
    return `<div class="sheet-body">
      <div class="who"><span class="avatar-dot" style="--c:${hex(sweater)}"></span><div><b>${esc(name)}</b><span class="muted">${esc(bench ? t('bench') : t('desk', { n: desk + 1 }))}</span></div></div>
      <p class="status">${esc(bench ? t('restingOutside') : status)}</p>
      ${subject ? `<p class="muted">${esc(t('subject'))} · ${esc(subject)}</p>` : ''}
      ${tea}
      <p class="muted small">${esc(t('noChat'))}</p>
    </div>`;
  }
}
