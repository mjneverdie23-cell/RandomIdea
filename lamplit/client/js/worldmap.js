// The world map screen (world map mode): every country on an Equal Earth map. The
// countries you can visit light up and wear a pin; the rest say "coming soon". The map
// data (~26 KB compressed) is only loaded the first time the map opens.

import { t, getLang } from './i18n.js';
import { ICONS } from './icons.js';
import { esc } from './views.js';
import { COUNTRIES } from '../shared/places.js';

/** Icons for each destination's pin and card. */
export const COUNTRY_ICONS = { egypt: 'pyramid', italy: 'arch', japan: 'torii', town: 'lamp' };
/** Which side of its pin each label sits on, so neighbours don't collide. */
const LABEL_SIDE = { egypt: 'right', italy: 'left', japan: 'right' };

let data = null;
export async function loadMap() {
  data ??= await import('./worldmap-data.js');
  return data;
}

const displayNames = new Map();
/** A country's name in the viewer's language, from its ISO code. */
export function regionName(a2, fallback) {
  const lang = getLang();
  if (!a2 || typeof Intl === 'undefined' || !Intl.DisplayNames) return fallback;
  try {
    if (!displayNames.has(lang)) displayNames.set(lang, new Intl.DisplayNames([lang], { type: 'region' }));
    return displayNames.get(lang).of(a2) || fallback;
  } catch {
    return fallback;
  }
}

const AVAILABLE = Object.fromEntries(Object.entries(COUNTRIES).map(([k, c]) => [c.code, k]));
let svgCache = null;

/** The map itself: ocean, graticule, countries. Built once. */
function mapSVG(d) {
  if (svgCache) return svgCache;
  const lines = [];
  for (let x = 0; x <= d.MAP_W; x += d.MAP_W / 12) lines.push(`<path d="M${x.toFixed(1)} 0V${d.MAP_H}"/>`);
  for (let y = 0; y <= d.MAP_H; y += d.MAP_H / 6) lines.push(`<path d="M0 ${y.toFixed(1)}H${d.MAP_W}"/>`);
  const paths = d.COUNTRIES.map(([a2, name, p]) => {
    const country = AVAILABLE[a2];
    return `<path d="${p}" class="land${country ? ` avail avail-${country}` : ''}" data-a2="${a2}" data-name="${esc(name)}"${country ? ` data-country="${country}"` : ''}/>`;
  }).join('');
  svgCache = `<svg class="map-svg" viewBox="0 0 ${d.MAP_W} ${d.MAP_H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="World map">
    <g class="graticule">${lines.join('')}</g>
    <g class="countries">${paths}</g>
  </svg>`;
  return svgCache;
}

/**
 * The whole screen. model: { here (country or 'town'), selected, counts: {country: n},
 * inFocus }.
 */
export function worldHTML(d, { here, selected, counts, inFocus }) {
  const pins = Object.entries(d.PINS)
    .map(([c, [x, y]]) => {
      const cls = ['map-pin', `pin-${c}`, `lbl-${LABEL_SIDE[c] ?? 'right'}`, here === c ? 'here' : '', selected === c ? 'selected' : ''].join(' ');
      return `<button class="${cls.trim()}" style="left:${((x / d.MAP_W) * 100).toFixed(2)}%;top:${((y / d.MAP_H) * 100).toFixed(2)}%" data-action="worldPick" data-v="${c}" aria-label="${esc(t(`country_${c}`))}">
        <span class="pin-dot" aria-hidden="true"></span>
        <span class="pin-badge">${ICONS[COUNTRY_ICONS[c]] ?? ''}<b>${esc(t(`country_${c}`))}</b></span>
      </button>`;
    })
    .join('');
  const card = (c) => {
    const isHere = here === c;
    const n = counts[c] ?? 0;
    const action = isHere
      ? `<span class="badge">${esc(t('worldHere'))}</span>`
      : `<button class="btn ${c === 'town' ? '' : 'primary'} small" data-action="worldTravel" data-v="${c}" ${inFocus ? 'disabled' : ''}>${ICONS[c === 'town' ? 'lamp' : 'plane']}<span>${esc(t(c === 'town' ? 'worldHome' : 'worldTravel'))}</span></button>`;
    return `<li class="dest dest-${c}${selected === c ? ' selected' : ''}${isHere ? ' here' : ''}" data-dest="${c}">
      <button class="dest-art" data-action="worldPick" data-v="${c}" aria-label="${esc(t(`country_${c}`))}"><span class="dest-icon" aria-hidden="true">${ICONS[COUNTRY_ICONS[c]] ?? ''}</span></button>
      <div class="dest-body">
        <div class="dest-head"><b>${esc(t(`country_${c}`))}</b><span class="muted small">${esc(t(c === 'town' ? 'placePeople' : 'placePeople', { n: n.toLocaleString() }))}</span></div>
        <p class="muted small">${esc(t(`countryAbout_${c}`))}</p>
        ${action}
      </div>
    </li>`;
  };
  const dests = [...Object.keys(COUNTRIES), 'town'].map(card).join('');
  return `<div class="world-card" role="dialog" aria-modal="true" aria-label="${esc(t('worldMap'))}">
    <button class="icon-btn sheet-close" data-action="closeWorld" aria-label="${esc(t('close'))}">${ICONS.close}</button>
    <h2>${esc(t('worldTitle'))}</h2>
    <p class="muted">${esc(t('worldHint'))}</p>
    <div class="world-map">${mapSVG(d)}${pins}<div class="map-tip" hidden></div></div>
    <ul class="dests">${dests}</ul>
    ${inFocus ? `<p class="muted small">${esc(t('switchInFocus'))}</p>` : ''}
  </div>`;
}

/** Hover and tap handling on the map's countries. Returns a cleanup function. */
export function bindMap(root, { onPick, onSoon }) {
  const map = root.querySelector('.world-map');
  const tip = root.querySelector('.map-tip');
  if (!map || !tip) return () => {};
  const label = (path) => {
    const country = path.dataset.country;
    const name = country ? t(`country_${country}`) : regionName(path.dataset.a2, path.dataset.name);
    return country ? name : `${name} · ${t('worldSoon')}`;
  };
  const move = (e) => {
    const path = e.target.closest?.('path.land');
    if (!path) {
      tip.hidden = true;
      return;
    }
    const r = map.getBoundingClientRect();
    tip.textContent = label(path);
    tip.hidden = false;
    tip.style.transform = `translate(${Math.min(r.width - tip.offsetWidth - 6, Math.max(6, e.clientX - r.left + 12))}px, ${Math.max(4, e.clientY - r.top - 34)}px)`;
  };
  const leave = () => {
    tip.hidden = true;
  };
  const click = (e) => {
    const path = e.target.closest?.('path.land');
    if (!path) return;
    if (path.dataset.country) onPick(path.dataset.country);
    else {
      path.classList.remove('flash');
      void path.getBoundingClientRect();
      path.classList.add('flash');
      onSoon(regionName(path.dataset.a2, path.dataset.name));
    }
  };
  map.addEventListener('pointermove', move);
  map.addEventListener('pointerleave', leave);
  map.addEventListener('click', click);
  return () => {
    map.removeEventListener('pointermove', move);
    map.removeEventListener('pointerleave', leave);
    map.removeEventListener('click', click);
  };
}
