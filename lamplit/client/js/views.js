// HTML for the sign-in panel, the shop, your profile, settings and the account sheet.
// Pure functions of their models; ui.js puts them on screen and main.js handles the
// data-action buttons inside them.

import { t, getLang, formatMinutes, LANGS } from './i18n.js';
import { ICONS } from './icons.js';
import { ITEMS, ITEM, CATEGORIES, itemName } from '../shared/catalog.js';
import { SWEATERS, LAMPS, displayName } from '../shared/words.js';
import { STATE } from '../shared/protocol.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const CAT_KEYS = { clothes: 'catClothes', accessories: 'catAccessories', pets: 'catPets', held: 'catHeld' };
const ERRORS = {
  invalid: 'errInvalid',
  taken: 'errTaken',
  username: 'errUsername',
  password: 'errPassword',
  slow: 'errSlow',
  network: 'errNetwork',
};

export const authError = (code) => (code ? t(ERRORS[code] ?? 'errNetwork') : '');

/** Username + password form for logging in or signing up. */
function credentialsForm(mode, error, busy, idPrefix, primary = true) {
  const signup = mode === 'signup';
  return `<form class="auth-form" data-form="${mode}" novalidate>
    <label class="field-label" for="${idPrefix}-user">${esc(t('username'))}</label>
    <input id="${idPrefix}-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" required>
    ${signup ? `<small class="muted">${esc(t('usernameHint'))}</small>` : ''}
    <label class="field-label" for="${idPrefix}-pass">${esc(t('password'))}</label>
    <input id="${idPrefix}-pass" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" maxlength="128" required>
    ${signup ? `<small class="muted">${esc(t('passwordHint'))}</small>` : ''}
    <p class="form-error" role="alert">${esc(authError(error))}</p>
    <button class="btn wide${primary ? ' primary' : ''}" type="submit" ${busy ? 'disabled' : ''}>${esc(signup ? t('createAccount') : t('authLogin'))}</button>
  </form>`;
}

function tabs(mode, action) {
  return `<div class="seg wide" role="tablist">
    <button role="tab" class="${mode === 'login' ? 'on' : ''}" aria-selected="${mode === 'login'}" data-action="${action}" data-v="login">${esc(t('authLogin'))}</button>
    <button role="tab" class="${mode === 'signup' ? 'on' : ''}" aria-selected="${mode === 'signup'}" data-action="${action}" data-v="signup">${esc(t('authSignup'))}</button>
  </div>`;
}

/** The sign-in panel on the splash screen. */
export function authHTML(s) {
  if (s.state === 'checking') return '<span class="spinner" aria-hidden="true"></span>';
  if (s.state === 'known') {
    return `<div class="auth-known">
      <p class="welcome-name">${esc(t('welcomeBackName', { name: displayName(s.me.name, getLang()) }))}</p>
      <button class="btn primary big" data-action="enter">${esc(t('enter'))}</button>
      <p class="muted small">${esc(s.me.guest ? t('playingAsGuest') : t('signedInAs', { u: s.me.username }))} · <button class="link" data-action="switchAccount">${esc(t('switchAccount'))}</button></p>
    </div>`;
  }
  // No account needed: "continue as guest" comes first, signing in is optional.
  return `<div class="auth-card">
    <button class="btn primary big wide" data-action="guest" ${s.busy ? 'disabled' : ''}>${esc(t('authGuest'))}</button>
    <p class="muted small">${esc(t('guestNote'))}</p>
    <div class="or"><span>${esc(t('authOr'))}</span></div>
    ${tabs(s.mode, 'authTab')}
    ${credentialsForm(s.mode, s.error, s.busy, 'splash', false)}
  </div>`;
}

/** Sign up (keeping a guest's progress) or log in, from inside the game. */
export function accountHTML(s) {
  return `<div class="sheet-body">
    <h2>${esc(t('accountTitle'))}</h2>
    <p class="muted">${esc(t('signupKeep'))}</p>
    ${tabs(s.mode, 'accountTab')}
    ${credentialsForm(s.mode, s.error, s.busy, 'sheet')}
  </div>`;
}

// ------------------------------------------------------------------ shop

function lookWith(look, item) {
  const out = { ...look };
  if (item) out[item.slot] = item.id;
  return out;
}

export function shopModelLook(me, selected) {
  return lookWith(me.look, ITEM[selected]);
}

export function shopHTML({ me, cat, selected, thumbs }) {
  const lang = getLang();
  const owned = new Set(me.owned);
  const tabsHtml = CATEGORIES.map(
    (c) => `<button role="tab" class="${c === cat ? 'on' : ''}" aria-selected="${c === cat}" data-action="shopCat" data-v="${c}">${esc(t(CAT_KEYS[c]))}</button>`,
  ).join('');
  const items = ITEMS.filter((it) => it.cat === cat);
  const cards = items
    .map((it) => {
      const has = it.price === 0 || owned.has(it.id);
      const wearing = me.look[it.slot] === it.id;
      const badge = wearing ? `<span class="badge on">${esc(t('wearing'))}</span>` : has ? `<span class="badge">${esc(it.price === 0 ? t('free') : t('owned'))}</span>` : `<span class="price">✦${it.price}</span>`;
      const img = thumbs[it.id] ? `<img src="${thumbs[it.id]}" alt="" width="80" height="80">` : '<span class="thumb-ph"></span>';
      return `<button class="item${it.id === selected ? ' sel' : ''}${wearing ? ' wearing' : ''}" data-action="shopPick" data-v="${it.id}" aria-pressed="${it.id === selected}">
        ${img}<span class="item-name">${esc(itemName(it.id, lang))}</span>${badge}</button>`;
    })
    .join('');
  let action = `<p class="muted small center">${esc(t('pickItem'))}</p>`;
  const it = ITEM[selected];
  if (it) {
    const has = it.price === 0 || owned.has(it.id);
    const wearing = me.look[it.slot] === it.id;
    let btn;
    if (wearing && it.slot !== 'o') btn = `<button class="btn wide" data-action="takeOff" data-v="${it.slot}">${esc(t('takeOff'))}</button>`;
    else if (wearing) btn = `<button class="btn wide" disabled>${esc(t('wearing'))}</button>`;
    else if (has) btn = `<button class="btn primary wide" data-action="wear" data-v="${it.id}">${esc(t('wear'))}</button>`;
    else if (me.lumens >= it.price) btn = `<button class="btn primary wide" data-action="buy" data-v="${it.id}">${esc(t('buyFor', { n: it.price }))}</button>`;
    else btn = `<button class="btn wide" disabled>${esc(t('needMore', { n: it.price - me.lumens }))}</button>`;
    action = `<div class="shop-action"><b>${esc(itemName(it.id, lang))}</b>${btn}</div>`;
  }
  const swatches =
    cat === 'clothes'
      ? `<div class="swatches small">${SWEATERS.map(
          (c, i) => `<button class="swatch${i === me.look.c ? ' on' : ''}" style="--c:${hex(c)}" data-action="color" data-v="${i}" aria-label="${esc(t('sweater'))} ${i + 1}" aria-pressed="${i === me.look.c}"></button>`,
        ).join('')}</div>`
      : '';
  return `<div class="sheet-body shop">
    <div class="sheet-title"><h2>${esc(t('shop'))}</h2><span class="balance" title="${esc(t('lumensTitle', { n: me.lumens }))}">✦ ${me.lumens.toLocaleString()}</span></div>
    <div class="preview-slot" data-preview></div>
    <div class="seg wide tabs4" role="tablist">${tabsHtml}</div>
    ${swatches}
    <div class="item-grid">${cards}</div>
    ${action}
    <p class="muted small">${esc(t('earnHint'))}</p>
  </div>`;
}

// ------------------------------------------------------------------ profile

function statsHTML(me) {
  const lang = getLang();
  const fmt = new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', { weekday: 'short', timeZone: 'UTC' });
  const max = Math.max(60, ...me.last7.map((d) => d.minutes));
  const bars = me.last7
    .map((d, i) => {
      const date = new Date(`${d.day}T12:00:00Z`);
      return `<div class="bar${i === 6 ? ' today' : ''}" title="${esc(formatMinutes(d.minutes))}">
        <em>${d.minutes ? esc(formatMinutes(d.minutes)) : ''}</em><i style="transform:scaleY(${(d.minutes / max).toFixed(3)})"></i><span>${esc(fmt.format(date))}</span></div>`;
    })
    .join('');
  const streak = me.streak === 1 ? t('day1') : t('days', { n: me.streak });
  const goals = [30, 60, 120, 180, 240, 360]
    .map((v) => `<button class="chip${v === me.goal ? ' on' : ''}" data-action="goal" data-v="${v}" aria-pressed="${v === me.goal}">${esc(formatMinutes(v))}</button>`)
    .join('');
  const done = me.today >= me.goal;
  return `<div class="tiles">
      <div class="tile"><b>${esc(formatMinutes(me.today))}</b><span>${esc(t('today'))}</span></div>
      <div class="tile"><b>${esc(streak)}</b><span>${esc(t('streak'))}</span></div>
      <div class="tile"><b>${esc(formatMinutes(me.total))}</b><span>${esc(t('total'))}</span></div>
      <div class="tile"><b>${me.sessions}</b><span>${esc(t('sessions'))}</span></div>
    </div>
    <h3>${esc(t('last7'))}</h3>
    <div class="bars">${bars}</div>
    <h3>${esc(t('dailyGoal'))}</h3>
    <div class="chips wrap">${goals}</div>
    <div class="goal"><div class="progress goal-bar"><i style="transform:scaleX(${Math.min(1, me.today / me.goal).toFixed(3)})"></i></div>
    <span class="muted small">${esc(done ? t('goalDone') : t('goalLeft', { t: formatMinutes(me.goal - me.today) }))}</span></div>`;
}

function friendStatus(f, now) {
  if (!f.online) return t('friendAway');
  if (f.st === STATE.FOCUS) return t('friendFocus', { n: f.hall, t: formatMinutes((now - f.since) / 60_000) });
  if (f.st === STATE.BREAK) return t('friendBreak', { n: f.hall });
  return t('friendHere', { n: f.hall });
}

function friendsHTML(me, lists, hall, now, inFocus) {
  if (me.guest) {
    return `<p class="muted">${esc(t('friendsGuest'))}</p><button class="btn primary" data-action="account" data-v="signup">${esc(t('authSignup'))}</button>`;
  }
  const lang = getLang();
  const dot = (c) => `<span class="avatar-dot sm" style="--c:${hex(SWEATERS[c] ?? SWEATERS[0])}"></span>`;
  const form = `<form class="friend-add" data-form="friend">
    <input name="code" placeholder="${esc(t('friendCodePlaceholder'))}" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="${esc(t('friendCodePlaceholder'))}">
    <button class="btn small" type="submit">${esc(t('addFriend'))}</button></form>`;
  if (!lists) return `${form}<span class="spinner" aria-hidden="true"></span>`;
  const incoming = lists.incoming.length
    ? `<h4>${esc(t('requests'))}</h4><ul class="people">${lists.incoming
        .map(
          (p) => `<li>${dot(p.c)}<span class="who-name">${esc(displayName(p.name, lang))}</span>
          <button class="btn small primary" data-action="friendAccept" data-v="${p.id}">${esc(t('accept'))}</button>
          <button class="btn small ghost" data-action="friendRemove" data-v="${p.id}">${esc(t('decline'))}</button></li>`,
        )
        .join('')}</ul>`
    : '';
  const friends = lists.friends.length
    ? `<ul class="people">${lists.friends
        .map((f) => {
          const join = f.online && f.hall !== hall ? `<button class="btn small" data-action="switchRoom" data-v="${f.hall}" ${inFocus ? 'disabled' : ''}>${esc(t('joinRoom'))}</button>` : '';
          return `<li>${dot(f.c)}<span class="who-name">${esc(displayName(f.name, lang))}<small class="${f.online ? 'online' : 'muted'}">${esc(friendStatus(f, now))}</small></span>
            ${join}<button class="icon-btn tiny" data-action="friendRemove" data-v="${f.id}" aria-label="${esc(t('remove'))}" title="${esc(t('remove'))}">${ICONS.close}</button></li>`;
        })
        .join('')}</ul>`
    : `<p class="muted small">${esc(t('noFriends'))}</p>`;
  const outgoing = lists.outgoing.length
    ? `<h4>${esc(t('sentRequests'))}</h4><ul class="people">${lists.outgoing
        .map((p) => `<li>${dot(p.c)}<span class="who-name">${esc(displayName(p.name, lang))}</span><button class="btn small ghost" data-action="friendRemove" data-v="${p.id}">${esc(t('cancel'))}</button></li>`)
        .join('')}</ul>`
    : '';
  return `${form}${incoming}${friends}${outgoing}`;
}

export function profileHTML({ me, friends, hall, now, inFocus, copied }) {
  const lang = getLang();
  const lamps = LAMPS.map((l, i) => {
    const locked = me.total < l.hours * 60;
    return `<button class="lamp-opt${i === me.look.l ? ' on' : ''}" style="--c:${hex(l.shade)}" data-action="lamp" data-v="${i}" ${locked ? 'disabled' : ''} aria-pressed="${i === me.look.l}">
      <i aria-hidden="true"></i><span>${esc(l[lang] ?? l.en)}</span>${locked ? `<small>${ICONS.lock}${esc(t('unlockAt', { n: l.hours }))}</small>` : ''}</button>`;
  }).join('');
  const account = me.guest
    ? `<div class="callout"><p>${esc(t('signupKeep'))}</p><div class="row"><button class="btn primary small" data-action="account" data-v="signup">${esc(t('authSignup'))}</button><button class="btn small" data-action="account" data-v="login">${esc(t('authLogin'))}</button></div></div>`
    : `<div class="code-row"><span class="muted small">${esc(t('friendCode'))}</span><code>${esc(me.code)}</code><button class="btn small" data-action="copyCode">${esc(copied ? t('copied') : t('copy'))}</button></div>`;
  return `<div class="sheet-body profile">
    <div class="sheet-title"><h2>${esc(t('profile'))}</h2><span class="balance">✦ ${me.lumens.toLocaleString()}</span></div>
    <div class="preview-slot tall" data-preview></div>
    <div class="profile-id">
      <div><b class="name-tag">${esc(displayName(me.name, lang))}</b><small class="muted">${esc(me.guest ? t('playingAsGuest') : t('signedInAs', { u: me.username }))}</small></div>
      <button class="btn small" data-action="newName">${ICONS.reroll}<span>${esc(t('newName'))}</span></button>
    </div>
    ${account}
    <button class="btn wide" data-action="shop">${esc(t('shop'))} · ${esc(t('wear'))}</button>
    <h3>${esc(t('stats'))}</h3>
    ${statsHTML(me)}
    <h3>${esc(t('lamp'))}</h3>
    <div class="lamps">${lamps}</div>
    <h3>${esc(t('friends'))}</h3>
    ${friendsHTML(me, friends, hall, now, inFocus)}
  </div>`;
}

// ------------------------------------------------------------------ settings

export function settingsHTML({ settings, me }) {
  const lang = getLang();
  const langs = LANGS.map((l) => `<button class="${l === lang ? 'on' : ''}" data-action="setLang" data-v="${l}" aria-pressed="${l === lang}">${l === 'en' ? 'English' : '한국어'}</button>`).join('');
  const quality = ['auto', 'high', 'low']
    .map((q) => `<button class="${q === settings.quality ? 'on' : ''}" data-action="quality" data-v="${q}" aria-pressed="${q === settings.quality}">${esc(t(`q${q[0].toUpperCase()}${q.slice(1)}`))}</button>`)
    .join('');
  const account = !me
    ? ''
    : me.guest
      ? `<p class="muted small">${esc(t('playingAsGuest'))}</p><div class="row"><button class="btn primary small" data-action="account" data-v="signup">${esc(t('authSignup'))}</button><button class="btn small" data-action="account" data-v="login">${esc(t('authLogin'))}</button></div>`
      : `<p class="muted small">${esc(t('signedInAs', { u: me.username }))}</p><button class="btn small" data-action="logout">${esc(t('logOut'))}</button>`;
  return `<div class="sheet-body">
    <h2>${esc(t('settings'))}</h2>
    <section class="set"><h3>${esc(t('language'))}</h3><div class="seg">${langs}</div></section>
    <section class="set"><h3>${esc(t('sound'))}</h3>
      <label class="slider"><span>${esc(t('volume'))}</span><input type="range" min="0" max="100" value="${Math.round(settings.volume * 100)}" data-input="volume"></label>
      <label class="toggle"><input type="checkbox" ${settings.rain ? 'checked' : ''} data-input="rain"><span>${esc(t('rain'))}</span></label>
      <label class="toggle"><input type="checkbox" ${settings.roomSounds ? 'checked' : ''} data-input="roomSounds"><span>${esc(t('roomSounds'))}</span></label>
    </section>
    <section class="set"><h3>${esc(t('graphics'))}</h3><div class="seg">${quality}</div></section>
    <section class="set"><h3>${esc(t('account'))}</h3>${account}</section>
    <section class="set"><button class="btn small" data-action="tour">${esc(t('tourAgain'))}</button></section>
  </div>`;
}
