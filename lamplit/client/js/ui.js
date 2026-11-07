// The HTML layer over the 3D room: header, the dock at the bottom (which changes with
// what you are doing), sheets (rooms, stats, settings, a finished session, someone's
// desk), toasts and the connection overlay. Buttons carry data-action attributes that
// map onto the `actions` object passed in by main.js.

import { t, getLang, formatMinutes, formatClock, LANGS } from './i18n.js';
import { ICONS, EMOTE_ICONS } from './icons.js';
import { SUBJECTS, SWEATERS, LAMPS, subjectName } from '../shared/words.js';
import { FOCUS_PRESETS } from '../shared/protocol.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const EMOTE_KEYS = ['wave', 'stretch', 'cheer'];
const GOALS = [30, 60, 120, 180, 240, 360];

export class UI {
  constructor(actions) {
    this.actions = actions;
    this.el = {
      hud: $('#hud'),
      roomPill: $('#room-pill'),
      live: $('#live-text'),
      liveWrap: $('#live'),
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
      focusbar: $('#focusbar'),
      focusTime: $('#focus-time'),
    };
    this.dockKey = '';
    this.model = null;
    this.sheetKind = null;
    this.sheetData = null;
    this.confirming = false;

    document.addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('input', (e) => {
      const name = e.target?.dataset?.input;
      if (name) this.actions[name]?.(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.sheetKind) this.closeSheet();
      else this.actions.focusView?.(0);
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
    if (this.sheetKind) this.renderSheet();
  }

  // ---------------------------------------------------------------- splash & header

  setSplashLive(g) {
    this.el.splashLive.textContent = g ? t('liveSplash', { fo: g.fo.toLocaleString(), on: g.on.toLocaleString() }) : '';
    this.el.splashLive.hidden = !g;
  }

  hideSplash() {
    const s = this.el.splash;
    s.classList.add('leaving');
    setTimeout(() => {
      s.hidden = true;
    }, 450);
  }

  showHud(on) {
    this.el.hud.hidden = !on;
  }

  setRoom(hall, count, cap) {
    this.el.roomPill.innerHTML = `<span>${esc(t('room', { n: hall }))}</span><span class="room-count"> · ${esc(t('roomCount', { n: count, cap }))}</span>`;
  }

  setLive(g) {
    const fo = g.fo.toLocaleString();
    this.el.live.innerHTML = `<span class="live-long">${esc(t('liveHud', { fo }))}</span><span class="live-short">${esc(fo)}</span>`;
    this.el.liveWrap.title = t('liveHudTitle', { fo, on: g.on.toLocaleString(), rooms: g.h.length });
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
    el.innerHTML = `${icon ? ICONS[icon] : ''}<span>${esc(text)}</span>`;
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
    const key = [model.mode, model.desk, model.since, model.planned, model.mins, model.tag, model.subject, this.confirming, getLang()].join('|');
    if (key === this.dockKey) return;
    this.dockKey = key;
    d.dataset.mode = model.mode;
    d.innerHTML = this.dockHTML(model);
    this.timerEl = $('#timer', d);
    this.timerLabel = $('#timer-label', d);
    this.progressEl = $('#progress', d);
    this.tick(model.now ?? Date.now());
  }

  dockHTML(m) {
    const lang = getLang();
    switch (m.mode) {
      case 'standing':
        return `<div class="hint"><span class="beacon" aria-hidden="true"></span>${esc(t('pickDesk'))}</div>`;
      case 'walking':
        return `<div class="hint">${esc(t('walking', { n: m.desk + 1 }))}</div>`;
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
          <div class="row"><button class="btn ghost" data-action="focusView" data-v="1">${ICONS.focus}<span>${esc(t('focusView'))}</span></button><span class="spacer"></span><button class="btn ghost" data-action="end">${esc(t('endSession'))}</button></div>
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
    this.renderSheet();
    this.el.sheet.hidden = false;
    this.el.backdrop.hidden = false;
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

  renderSheet() {
    const body = this[`${this.sheetKind}HTML`](this.sheetData);
    const html = `<button class="icon-btn sheet-close" data-action="closeSheet" aria-label="${esc(t('close'))}">${ICONS.close}</button>${body}`;
    // Only touch the DOM when something changed, so a tap is never lost to a re-render.
    if (html === this.sheetHTML && this.el.sheet.dataset.kind === this.sheetKind) return;
    this.sheetHTML = html;
    this.el.sheet.dataset.kind = this.sheetKind;
    this.el.sheet.innerHTML = html;
  }

  streakText(n) {
    return n === 1 ? t('day1') : t('days', { n });
  }

  goalHTML(today, goal) {
    const done = today >= goal;
    return `<div class="goal"><div class="progress goal-bar"><i style="transform:scaleX(${clamp01(today / goal).toFixed(3)})"></i></div>
      <span class="muted small">${esc(done ? t('goalDone') : t('goalLeft', { t: formatMinutes(goal - today) }))}</span></div>`;
  }

  completeHTML({ minutes, today, streak, goal }) {
    return `<div class="sheet-body center">
      <div class="seal">${ICONS.check}</div>
      <h2>${esc(t('sessionComplete'))}</h2>
      <p class="gain">${esc(t('plusMin', { n: minutes }))}</p>
      <div class="tiles two">
        <div class="tile"><b>${esc(formatMinutes(today))}</b><span>${esc(t('today'))}</span></div>
        <div class="tile"><b>${esc(this.streakText(streak))}</b><span>${esc(t('streak'))}</span></div>
      </div>
      ${this.goalHTML(today, goal)}
      <div class="stack">
        <button class="btn primary wide" data-action="break5">${esc(t('takeBreak', { n: 5 }))}</button>
        <button class="btn wide" data-action="another">${ICONS.lamp}<span>${esc(t('another'))}</span></button>
        <button class="btn ghost wide" data-action="closeSheet">${esc(t('done'))}</button>
      </div>
    </div>`;
  }

  hallsHTML({ g, current, inFocus }) {
    const rows = g.h
      .map(([id, n]) => {
        const here = id === current;
        const full = n >= g.cap;
        const right = here
          ? `<span class="badge">${esc(t('youAreHere'))}</span>`
          : full
            ? `<span class="badge muted">${esc(t('full'))}</span>`
            : `<button class="btn small" data-action="switchRoom" data-v="${id}" ${inFocus ? 'disabled' : ''}>${esc(t('join'))}</button>`;
        return `<li class="room${here ? ' here' : ''}">
          <div class="room-meta"><b>${esc(t('room', { n: id }))}</b><span class="muted">${n}/${g.cap}</span></div>
          <div class="meter"><i style="transform:scaleX(${clamp01(n / g.cap).toFixed(3)})"></i></div>
          ${right}
        </li>`;
      })
      .join('');
    return `<div class="sheet-body">
      <h2>${esc(t('rooms'))}</h2>
      <p class="muted">${esc(t('roomsHint'))}</p>
      <ul class="room-list">${rows}</ul>
      ${inFocus ? `<p class="muted small">${esc(t('switchInFocus'))}</p>` : ''}
    </div>`;
  }

  statsHTML({ today, streak, total, sessions, last7, goal }) {
    const lang = getLang();
    const fmt = new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', { weekday: 'short' });
    const max = Math.max(60, ...last7.map((d) => d.minutes));
    const bars = last7
      .map(
        (d, i) => `<div class="bar${i === 6 ? ' today' : ''}" title="${esc(formatMinutes(d.minutes))}">
          <em>${d.minutes ? esc(formatMinutes(d.minutes)) : ''}</em><i style="transform:scaleY(${(d.minutes / max).toFixed(3)})"></i><span>${esc(fmt.format(d.date))}</span></div>`,
      )
      .join('');
    const goals = GOALS.map((v) => `<button class="chip${v === goal ? ' on' : ''}" data-action="goal" data-v="${v}" aria-pressed="${v === goal}">${esc(formatMinutes(v))}</button>`).join('');
    return `<div class="sheet-body">
      <h2>${esc(t('stats'))}</h2>
      <div class="tiles">
        <div class="tile"><b>${esc(formatMinutes(today))}</b><span>${esc(t('today'))}</span></div>
        <div class="tile"><b>${esc(this.streakText(streak))}</b><span>${esc(t('streak'))}</span></div>
        <div class="tile"><b>${esc(formatMinutes(total))}</b><span>${esc(t('total'))}</span></div>
        <div class="tile"><b>${sessions}</b><span>${esc(t('sessions'))}</span></div>
      </div>
      <h3>${esc(t('last7'))}</h3>
      <div class="bars">${bars}</div>
      <h3>${esc(t('dailyGoal'))}</h3>
      <div class="chips wrap">${goals}</div>
      ${this.goalHTML(today, goal)}
    </div>`;
  }

  settingsHTML({ profile, name, locked }) {
    const lang = getLang();
    const swatches = SWEATERS.map(
      (c, i) => `<button class="swatch${i === profile.color ? ' on' : ''}" style="--c:${hex(c)}" data-action="color" data-v="${i}" aria-label="${esc(t('sweater'))} ${i + 1}" aria-pressed="${i === profile.color}"></button>`,
    ).join('');
    const lamps = LAMPS.map((l, i) => {
      const isLocked = locked(i);
      return `<button class="lamp-opt${i === profile.lamp ? ' on' : ''}" style="--c:${hex(l.shade)}" data-action="lamp" data-v="${i}" ${isLocked ? 'disabled' : ''} aria-pressed="${i === profile.lamp}">
        <i aria-hidden="true"></i><span>${esc(l[lang] ?? l.en)}</span>${isLocked ? `<small>${ICONS.lock}${esc(t('unlockAt', { n: l.hours }))}</small>` : ''}</button>`;
    }).join('');
    const langs = LANGS.map((l) => `<button class="${l === lang ? 'on' : ''}" data-action="setLang" data-v="${l}" aria-pressed="${l === lang}">${l === 'en' ? 'English' : '한국어'}</button>`).join('');
    return `<div class="sheet-body">
      <h2>${esc(t('settings'))}</h2>
      <section class="set"><h3>${esc(t('yourName'))}</h3>
        <div class="row"><span class="name-tag">${esc(name)}</span><span class="spacer"></span><button class="btn small" data-action="newName">${ICONS.reroll}<span>${esc(t('newName'))}</span></button></div>
      </section>
      <section class="set"><h3>${esc(t('language'))}</h3><div class="seg">${langs}</div></section>
      <section class="set"><h3>${esc(t('sound'))}</h3>
        <label class="slider"><span>${esc(t('volume'))}</span><input type="range" min="0" max="100" value="${Math.round(profile.volume * 100)}" data-input="volume"></label>
        <label class="toggle"><input type="checkbox" ${profile.rain ? 'checked' : ''} data-input="rain"><span>${esc(t('rain'))}</span></label>
        <label class="toggle"><input type="checkbox" ${profile.roomSounds ? 'checked' : ''} data-input="roomSounds"><span>${esc(t('roomSounds'))}</span></label>
      </section>
      <section class="set"><h3>${esc(t('sweater'))}</h3><div class="swatches">${swatches}</div></section>
      <section class="set"><h3>${esc(t('lamp'))}</h3><div class="lamps">${lamps}</div></section>
    </div>`;
  }

  deskHTML({ desk, name, sweater, status, subject, teaWait }) {
    return `<div class="sheet-body">
      <div class="who"><span class="avatar-dot" style="--c:${hex(sweater)}"></span><div><b>${esc(name)}</b><span class="muted">${esc(t('desk', { n: desk + 1 }))}</span></div></div>
      <p class="status">${esc(status)}</p>
      ${subject ? `<p class="muted">${esc(t('subject'))} · ${esc(subject)}</p>` : ''}
      <button class="btn primary wide" data-action="gift" data-v="${desk}" ${teaWait > 0 ? 'disabled' : ''}>${ICONS.tea}<span>${esc(t('sendTea'))}</span></button>
      ${teaWait > 0 ? `<p class="muted small">${esc(t('teaWait', { n: Math.ceil(teaWait / 1000) }))}</p>` : ''}
      <p class="muted small">${esc(t('noChat'))}</p>
    </div>`;
  }
}
