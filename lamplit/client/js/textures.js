// Procedural canvas textures, so the game ships without image files.

import * as THREE from '../vendor/three.module.min.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

/** Deterministic pseudo-random numbers so textures look the same on every load. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function finish(c, { repeat, color = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = aniso;
  return t;
}

export function woodFloor() {
  const [c, g] = canvas(512, 512);
  const r = rng(11);
  const plankH = 64;
  for (let y = 0; y < 512; y += plankH) {
    let x = -Math.floor(r() * 300);
    while (x < 512) {
      const len = 220 + r() * 260;
      const tone = 48 + r() * 18;
      g.fillStyle = `hsl(24, ${32 + r() * 10}%, ${tone * 0.42}%)`;
      g.fillRect(x, y, len, plankH);
      for (let k = 0; k < 14; k++) {
        g.strokeStyle = `rgba(20, 10, 4, ${0.05 + r() * 0.08})`;
        g.lineWidth = 1 + r() * 1.5;
        g.beginPath();
        const yy = y + r() * plankH;
        g.moveTo(x, yy);
        g.bezierCurveTo(x + len * 0.3, yy + (r() - 0.5) * 8, x + len * 0.7, yy + (r() - 0.5) * 8, x + len, yy + (r() - 0.5) * 4);
        g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(x, y, 2, plankH);
      x += len;
    }
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0, y, 512, 2);
  }
  return finish(c, { repeat: [5, 6], aniso: 8 });
}

/** Dark plaster above, wood panelling below. v=0 is the floor. */
export function wall() {
  const [c, g] = canvas(256, 512);
  const r = rng(5);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#141b2e');
  grad.addColorStop(1, '#1d2640');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.025})`;
    g.fillRect(r() * 256, r() * 512, 2, 2);
  }
  const panelTop = 512 - 512 * (1.25 / 7);
  g.fillStyle = '#2b1e16';
  g.fillRect(0, panelTop, 256, 512 - panelTop);
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 3;
  g.strokeRect(16, panelTop + 14, 224, 512 - panelTop - 30);
  g.fillStyle = '#3a291e';
  g.fillRect(0, panelTop - 8, 256, 10);
  return finish(c, { repeat: [7, 1] });
}

/** A run of shelves full of book spines, tiled along the side walls. */
export function bookshelf() {
  const [c, g] = canvas(512, 512);
  const r = rng(23);
  g.fillStyle = '#2a1c14';
  g.fillRect(0, 0, 512, 512);
  const shelves = 5;
  const rowH = 512 / shelves;
  const palette = ['#7a2e2e', '#2e4a7a', '#2e6a4a', '#8a6a2e', '#5a3a6a', '#9a8a6a', '#3a3a3a', '#6a2e4a', '#2e5a6a', '#a0522d'];
  for (let s = 0; s < shelves; s++) {
    const base = (s + 1) * rowH - 10;
    let x = 6;
    while (x < 506) {
      const w = 8 + r() * 16;
      const h = rowH * (0.55 + r() * 0.35);
      if (r() < 0.06) {
        x += w * 2;
        continue;
      }
      g.fillStyle = palette[Math.floor(r() * palette.length)];
      g.fillRect(x, base - h, w - 1, h);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(x + 2, base - h + 8, w - 5, 2);
      g.fillRect(x + 2, base - 14, w - 5, 2);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + w - 3, base - h, 2, h);
      x += w;
    }
    g.fillStyle = '#3d2a1d';
    g.fillRect(0, base, 512, 10);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, base + 8, 512, 2);
  }
  return finish(c, { repeat: [14, 1] });
}

export function nightSky({ moon = false, seed = 3 } = {}) {
  const [c, g] = canvas(256, 512);
  const r = rng(seed);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#060a1c');
  grad.addColorStop(0.6, '#13204a');
  grad.addColorStop(1, '#2a3a6e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 160; i++) {
    const a = 0.3 + r() * 0.7;
    g.fillStyle = `rgba(255, 250, 235, ${a * (1 - i / 220)})`;
    const s = r() < 0.1 ? 2 : 1;
    g.fillRect(r() * 256, r() * 380, s, s);
  }
  if (moon) {
    const mx = 170;
    const my = 120;
    const halo = g.createRadialGradient(mx, my, 10, mx, my, 110);
    halo.addColorStop(0, 'rgba(240, 236, 210, 0.35)');
    halo.addColorStop(1, 'rgba(240, 236, 210, 0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, 256, 300);
    g.fillStyle = '#f3efd8';
    g.beginPath();
    g.arc(mx, my, 28, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(180, 175, 150, 0.35)';
    for (const [dx, dy, rr] of [[-8, -6, 6], [9, 7, 4], [2, 12, 3]]) {
      g.beginPath();
      g.arc(mx + dx, my + dy, rr, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Rooftops and trees at the bottom edge.
  g.fillStyle = '#05070f';
  let x = 0;
  while (x < 256) {
    const w = 20 + r() * 40;
    const h = 30 + r() * 50;
    g.fillRect(x, 512 - h, w, h);
    x += w;
  }
  return finish(c);
}

/** Thin streaks for rain running down the glass; scrolled over time. */
export function rain() {
  const [c, g] = canvas(256, 512);
  const r = rng(77);
  g.clearRect(0, 0, 256, 512);
  for (let i = 0; i < 220; i++) {
    const x = r() * 256;
    const y = r() * 512;
    const len = 10 + r() * 34;
    g.strokeStyle = `rgba(200, 215, 255, ${0.08 + r() * 0.22})`;
    g.lineWidth = r() < 0.2 ? 1.5 : 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - len * 0.08, y + len);
    g.stroke();
  }
  return finish(c, { repeat: [3, 2] });
}

/** Soft radial falloff used for every glow (tinted by instance or vertex colour). */
export function glow() {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return finish(c, { color: false });
}

/** Vertical fade used for moonlight shafts from the windows. */
export function shaft() {
  const [c, g] = canvas(64, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  const side = g.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.25, 'rgba(0,0,0,0)');
  side.addColorStop(0.75, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = side;
  g.fillRect(0, 0, 64, 256);
  return finish(c, { color: false });
}

export function rug(hue = 355) {
  const [c, g] = canvas(128, 512);
  g.fillStyle = `hsl(${hue}, 45%, 22%)`;
  g.fillRect(0, 0, 128, 512);
  g.strokeStyle = `hsl(${hue + 20}, 55%, 52%)`;
  g.lineWidth = 4;
  g.strokeRect(10, 10, 108, 492);
  g.strokeStyle = `hsl(${hue}, 30%, 12%)`;
  g.lineWidth = 2;
  g.strokeRect(18, 18, 92, 476);
  g.fillStyle = `hsla(${hue + 30}, 50%, 55%, 0.35)`;
  for (let y = 40; y < 490; y += 36) {
    g.beginPath();
    g.moveTo(64, y);
    g.lineTo(80, y + 14);
    g.lineTo(64, y + 28);
    g.lineTo(48, y + 14);
    g.closePath();
    g.fill();
  }
  return finish(c, { repeat: [1, 4] });
}

/** A texture whose canvas the caller redraws (clock face, room board). */
export function dynamic(w, h) {
  const [c, g] = canvas(w, h);
  return { canvas: c, ctx: g, texture: finish(c) };
}

// ------------------------------------------------------------------ places

const hsl = (h, s, l, a = 1) => `hsla(${h}, ${s}%, ${l}%, ${a})`;

/** Wooden planks in rows. Light oak by default. */
export function planks({ hue = 32, sat = 42, light = 62, spread = 9, plankH = 48, seed = 11, repeat = [6, 6], aniso = 8 } = {}) {
  const [c, g] = canvas(512, 512);
  const r = rng(seed);
  for (let y = 0; y < 512; y += plankH) {
    let x = -Math.floor(r() * 300);
    while (x < 512) {
      const len = 200 + r() * 260;
      g.fillStyle = hsl(hue + (r() - 0.5) * 6, sat + (r() - 0.5) * 8, light + (r() - 0.5) * spread);
      g.fillRect(x, y, len, plankH);
      for (let k = 0; k < 12; k++) {
        g.strokeStyle = `rgba(60, 30, 10, ${0.04 + r() * 0.07})`;
        g.lineWidth = 1 + r() * 1.5;
        g.beginPath();
        const yy = y + r() * plankH;
        g.moveTo(x, yy);
        g.bezierCurveTo(x + len * 0.3, yy + (r() - 0.5) * 6, x + len * 0.7, yy + (r() - 0.5) * 6, x + len, yy + (r() - 0.5) * 3);
        g.stroke();
      }
      g.fillStyle = 'rgba(40, 20, 8, 0.35)';
      g.fillRect(x, y, 2, plankH);
      x += len;
    }
    g.fillStyle = 'rgba(40, 20, 8, 0.38)';
    g.fillRect(0, y, 512, 2);
  }
  return finish(c, { repeat, aniso });
}

/** Herringbone parquet. */
export function herringbone({ hue = 30, sat = 48, light = 52, seed = 4, repeat = [5, 5] } = {}) {
  const [c, g] = canvas(512, 512);
  const r = rng(seed);
  const L = 128;
  const Wd = 32;
  g.fillStyle = hsl(hue, sat, light - 12);
  g.fillRect(0, 0, 512, 512);
  for (let row = -4; row < 20; row++) {
    for (let col = -2; col < 10; col++) {
      for (const flip of [0, 1]) {
        const x = col * 64 + (flip ? 32 : 0);
        const y = row * 32 + col * 32 + (flip ? -32 : 0);
        g.save();
        g.translate(x, y);
        g.rotate(flip ? -Math.PI / 4 : Math.PI / 4);
        g.fillStyle = hsl(hue + (r() - 0.5) * 8, sat + (r() - 0.5) * 10, light + (r() - 0.5) * 10);
        g.fillRect(0, 0, L * 0.7, Wd * 0.7);
        g.strokeStyle = 'rgba(50, 25, 10, 0.4)';
        g.lineWidth = 1.5;
        g.strokeRect(0, 0, L * 0.7, Wd * 0.7);
        g.restore();
      }
    }
  }
  return finish(c, { repeat, aniso: 8 });
}

/**
 * Painted plaster above, wood panelling below. v = 0 is the floor; `wainscot` is the
 * fraction of the wall height covered by panels.
 */
export function plaster({ top = '#f1e6d2', bottom = '#e7d7bd', panel = '#8a5d3b', rail = '#6b4529', wainscot = 0.17, speckle = 0.03, seed = 5, repeat = [7, 1] } = {}) {
  const [c, g] = canvas(256, 512);
  const r = rng(seed);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${r() * speckle})` : `rgba(0,0,0,${r() * speckle})`;
    g.fillRect(r() * 256, r() * 512, 2, 2);
  }
  if (wainscot > 0) {
    const panelTop = 512 * (1 - wainscot);
    g.fillStyle = panel;
    g.fillRect(0, panelTop, 256, 512 - panelTop);
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.lineWidth = 3;
    g.strokeRect(14, panelTop + 12, 228, 512 - panelTop - 26);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 2;
    g.strokeRect(18, panelTop + 16, 220, 512 - panelTop - 34);
    g.fillStyle = rail;
    g.fillRect(0, panelTop - 7, 256, 9);
  }
  return finish(c, { repeat });
}

/** Brick wall. */
export function brick({ base = '#a5573c', mortar = '#d9c9b5', seed = 8, repeat = [6, 3] } = {}) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = mortar;
  g.fillRect(0, 0, 256, 256);
  const bh = 32;
  const bw = 64;
  const tint = new THREE.Color(base);
  for (let row = 0; row < 256 / bh; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < 256 + bw; x += bw) {
      const k = 0.82 + r() * 0.3;
      g.fillStyle = `rgb(${Math.min(255, tint.r * 255 * k) | 0}, ${Math.min(255, tint.g * 255 * k) | 0}, ${Math.min(255, tint.b * 255 * k) | 0})`;
      g.fillRect(x + off + 2, row * bh + 2, bw - 4, bh - 4);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(x + off + 2, row * bh + 2, bw - 4, 3);
    }
  }
  return finish(c, { repeat, aniso: 8 });
}

/** Cut stone blocks for grand facades. */
export function stoneBlocks({ base = '#e9dfca', seed = 12, repeat = [4, 3] } = {}) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '90,70,40'}, ${r() * 0.06})`;
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  g.strokeStyle = 'rgba(80, 60, 30, 0.22)';
  g.lineWidth = 2;
  for (let row = 0; row < 4; row++) {
    const y = row * 64;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
    const off = row % 2 ? 64 : 0;
    for (let x = off; x < 256; x += 128) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + 64);
      g.stroke();
    }
  }
  return finish(c, { repeat, aniso: 8 });
}

export function grass({ seed = 31, repeat = [24, 24] } = {}) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = '#7fae55';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const x = r() * 256;
    const y = r() * 256;
    const rad = 20 + r() * 50;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const light = r() < 0.5;
    grad.addColorStop(0, light ? 'rgba(180, 210, 110, 0.25)' : 'rgba(60, 110, 50, 0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 2600; i++) {
    g.strokeStyle = r() < 0.5 ? 'rgba(70, 120, 45, 0.5)' : 'rgba(160, 200, 100, 0.45)';
    g.lineWidth = 1;
    const x = r() * 256;
    const y = r() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 4);
    g.stroke();
  }
  return finish(c, { repeat, aniso: 8 });
}

/** Stone paving: square slabs, or bricks laid in a running bond. */
export function paving({ base = '#d9cfc0', joint = 'rgba(90, 80, 70, 0.35)', kind = 'slabs', seed = 17, repeat = [8, 8] } = {}) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  const tint = new THREE.Color(base);
  const cell = kind === 'bricks' ? [64, 32] : [64, 64];
  for (let row = 0; row < 256 / cell[1]; row++) {
    const off = kind === 'bricks' && row % 2 ? cell[0] / 2 : 0;
    for (let x = -cell[0]; x < 256 + cell[0]; x += cell[0]) {
      const k = 0.9 + r() * 0.16;
      g.fillStyle = `rgb(${Math.min(255, tint.r * 255 * k) | 0}, ${Math.min(255, tint.g * 255 * k) | 0}, ${Math.min(255, tint.b * 255 * k) | 0})`;
      g.fillRect(x + off + 1.5, row * cell[1] + 1.5, cell[0] - 3, cell[1] - 3);
    }
  }
  g.strokeStyle = joint;
  g.lineWidth = 2;
  for (let row = 0; row <= 256 / cell[1]; row++) {
    g.beginPath();
    g.moveTo(0, row * cell[1]);
    g.lineTo(256, row * cell[1]);
    g.stroke();
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.05})`;
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  return finish(c, { repeat, aniso: 8 });
}

/** Low-pile carpet with a faint geometric pattern. */
export function carpet({ base = '#231a3d', accent = '#3b2d66', seed = 21, repeat = [10, 10] } = {}) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.03})`;
    g.fillRect(r() * 256, r() * 256, 1, 1);
  }
  g.strokeStyle = accent;
  g.lineWidth = 3;
  for (let y = 0; y < 256; y += 64) {
    for (let x = 0; x < 256; x += 64) {
      g.beginPath();
      g.moveTo(x + 32, y + 8);
      g.lineTo(x + 56, y + 32);
      g.lineTo(x + 32, y + 56);
      g.lineTo(x + 8, y + 32);
      g.closePath();
      g.stroke();
    }
  }
  return finish(c, { repeat, aniso: 8 });
}

/** Shelves full of book spines; `wood` colours the shelf boards. */
export function shelfOfBooks({ wood = '#6b4529', back = '#3d2817', seed = 23, repeat = [14, 1], rows = 5 } = {}) {
  const [c, g] = canvas(512, 512);
  const r = rng(seed);
  g.fillStyle = back;
  g.fillRect(0, 0, 512, 512);
  const rowH = 512 / rows;
  const palette = ['#9b3b36', '#2f5687', '#33775a', '#b5893c', '#6b4a85', '#c9b48a', '#424242', '#8a3a5c', '#2f6f7f', '#b0603a', '#d8c9a6', '#5d7a3a'];
  for (let s = 0; s < rows; s++) {
    const base = (s + 1) * rowH - 10;
    let x = 6;
    while (x < 506) {
      const w = 8 + r() * 16;
      const h = rowH * (0.55 + r() * 0.35);
      if (r() < 0.05) {
        x += w * 2;
        continue;
      }
      g.fillStyle = palette[Math.floor(r() * palette.length)];
      g.fillRect(x, base - h, w - 1, h);
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.fillRect(x + 2, base - h + 8, w - 5, 2);
      g.fillRect(x + 2, base - 14, w - 5, 2);
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(x + w - 3, base - h, 2, h);
      x += w;
    }
    g.fillStyle = wood;
    g.fillRect(0, base, 512, 10);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, base + 8, 512, 2);
  }
  return finish(c, { repeat });
}

/** A daytime sky with soft clouds, for windows. */
export function sky({ top = '#6fa9e6', bottom = '#d8ecfb', clouds = 7, seed = 2, horizon = null } = {}) {
  const [c, g] = canvas(256, 512);
  const r = rng(seed);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < clouds; i++) {
    const cx = r() * 256;
    const cy = 60 + r() * 300;
    for (let k = 0; k < 6; k++) {
      const x = cx + (r() - 0.5) * 70;
      const y = cy + (r() - 0.5) * 18;
      const rad = 14 + r() * 26;
      const cg = g.createRadialGradient(x, y, 0, x, y, rad);
      cg.addColorStop(0, 'rgba(255,255,255,0.85)');
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = cg;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }
  if (horizon === 'trees') {
    g.fillStyle = '#6d9a5a';
    for (let x = -20; x < 280; x += 18 + r() * 10) {
      g.beginPath();
      g.arc(x, 512 - 30 - r() * 20, 24 + r() * 14, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#5b8a4a';
    g.fillRect(0, 490, 256, 22);
  } else if (horizon === 'roofs') {
    let x = 0;
    while (x < 256) {
      const w = 30 + r() * 46;
      const h = 40 + r() * 90;
      g.fillStyle = ['#c9b8a6', '#b9a28c', '#d7c6ae', '#a99484'][Math.floor(r() * 4)];
      g.fillRect(x, 512 - h, w, h);
      g.fillStyle = 'rgba(70, 90, 120, 0.35)';
      for (let wy = 512 - h + 10; wy < 500; wy += 18) for (let wx = x + 6; wx < x + w - 8; wx += 12) g.fillRect(wx, wy, 6, 9);
      x += w + 2;
    }
  }
  return finish(c);
}

/** The street seen through the coffee shop's windows: sky, trees and houses opposite. */
export function streetView({ seed = 6 } = {}) {
  const [c, g] = canvas(512, 256);
  const r = rng(seed);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#8cc1ee');
  grad.addColorStop(0.7, '#f3e7c9');
  grad.addColorStop(1, '#f8d9a8');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);
  let x = -10;
  while (x < 520) {
    const w = 60 + r() * 70;
    const h = 90 + r() * 70;
    g.fillStyle = ['#e7c9a9', '#cfd8c4', '#e9b8a0', '#d9cbb4', '#c7b8d4'][Math.floor(r() * 5)];
    g.fillRect(x, 256 - h, w, h);
    g.fillStyle = 'rgba(255, 245, 225, 0.75)';
    for (let wy = 256 - h + 14; wy < 230; wy += 26) for (let wx = x + 8; wx < x + w - 14; wx += 20) g.fillRect(wx, wy, 10, 14);
    x += w + 6;
  }
  for (let i = 0; i < 9; i++) {
    const tx = r() * 512;
    g.fillStyle = '#6c4a2e';
    g.fillRect(tx - 3, 180, 6, 76);
    g.fillStyle = r() < 0.4 ? '#f2b6c6' : '#7fb069';
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      g.arc(tx + (r() - 0.5) * 40, 160 + (r() - 0.5) * 30, 18 + r() * 10, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = '#9b9b9b';
  g.fillRect(0, 238, 512, 18);
  return finish(c);
}

/** A lit shop interior as seen from outside through big windows. */
export function shopWindow({ warm = true, seed = 3 } = {}) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  if (warm) {
    grad.addColorStop(0, '#ffe2ad');
    grad.addColorStop(1, '#d99a5a');
  } else {
    grad.addColorStop(0, '#5b4dd6');
    grad.addColorStop(1, '#1c1640');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4; i++) {
    const x = 30 + i * 64;
    const lg = g.createRadialGradient(x, 30, 0, x, 30, 40);
    lg.addColorStop(0, warm ? 'rgba(255,255,230,0.95)' : 'rgba(120,240,255,0.9)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.fillRect(x - 40, 0, 80, 80);
  }
  g.fillStyle = warm ? 'rgba(90, 50, 25, 0.55)' : 'rgba(10, 6, 30, 0.7)';
  for (let i = 0; i < 6; i++) {
    const x = r() * 236;
    g.fillRect(x, 170 + r() * 20, 26 + r() * 20, 6);
    g.fillRect(x + 8, 176, 4, 80);
  }
  if (!warm) {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `hsla(${180 + r() * 140}, 90%, 65%, 0.8)`;
      g.fillRect(10 + i * 30, 140, 22, 14);
    }
  }
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.beginPath();
  g.moveTo(0, 256);
  g.lineTo(90, 0);
  g.lineTo(130, 0);
  g.lineTo(40, 256);
  g.fill();
  return finish(c);
}

/**
 * A sign with one or two lines of text. `glow` draws neon-style light around the
 * letters on a transparent or dark background.
 */
export function sign({ text, sub = '', w = 512, h = 128, bg = '#2d3b2f', fg = '#f4e7c3', font = 'Georgia, "Nanum Myeongjo", serif', weight = 700, size = 0.48, subSize = 0.2, glow = null, border = null, radius = 14 } = {}) {
  const [c, g] = canvas(w, h);
  g.clearRect(0, 0, w, h);
  const rounded = (x, y, rw, rh, rad) => (g.roundRect ? g.roundRect(x, y, rw, rh, rad) : g.rect(x, y, rw, rh));
  if (bg) {
    g.fillStyle = bg;
    g.beginPath();
    rounded(0, 0, w, h, radius);
    g.fill();
  }
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = Math.max(3, h * 0.04);
    g.beginPath();
    rounded(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12, radius * 0.7);
    g.stroke();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lines = sub ? [[text, size, 0.42], [sub, subSize, 0.8]] : [[text, size, 0.53]];
  for (const [str, sz, y] of lines) {
    g.font = `${weight} ${Math.round(h * sz)}px ${font}`;
    if (glow) {
      g.shadowColor = glow;
      g.shadowBlur = h * 0.18;
      g.fillStyle = glow;
      g.fillText(str, w / 2, h * y);
      g.shadowBlur = h * 0.06;
    }
    g.fillStyle = fg;
    g.fillText(str, w / 2, h * y);
    g.shadowBlur = 0;
  }
  return finish(c);
}

/** Bold abstract posters for the net café walls. */
export function poster({ seed = 1 } = {}) {
  const [c, g] = canvas(128, 192);
  const r = rng(seed);
  const hue = Math.floor(r() * 360);
  const grad = g.createLinearGradient(0, 0, 128, 192);
  grad.addColorStop(0, hsl(hue, 80, 22));
  grad.addColorStop(1, hsl((hue + 60) % 360, 85, 45));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 192);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = hsl((hue + 120 + i * 30) % 360, 90, 60, 0.7);
    g.beginPath();
    if (r() < 0.5) g.arc(r() * 128, r() * 150, 10 + r() * 30, 0, Math.PI * 2);
    else {
      g.moveTo(r() * 128, r() * 150);
      g.lineTo(r() * 128, r() * 150);
      g.lineTo(r() * 128, r() * 150);
    }
    g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(14, 160, 70 + r() * 30, 8);
  g.fillRect(14, 174, 40 + r() * 30, 5);
  return finish(c);
}

/** A monitor screen: a study app with a document and a timer. */
export function screen({ seed = 9 } = {}) {
  const [c, g] = canvas(128, 80);
  const r = rng(seed);
  g.fillStyle = '#e9f4ff';
  g.fillRect(0, 0, 128, 80);
  g.fillStyle = '#3a7bd5';
  g.fillRect(0, 0, 128, 10);
  g.fillStyle = '#ffffff';
  g.fillRect(8, 16, 78, 58);
  g.fillStyle = '#9fb3c8';
  for (let y = 22; y < 70; y += 6) g.fillRect(12, y, 30 + r() * 40, 2);
  g.fillStyle = '#ffd38a';
  g.beginPath();
  g.arc(108, 34, 14, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3a7bd5';
  g.fillRect(94, 56, 28, 6);
  return finish(c);
}

/** A soft round cloud for the outdoor sky. */
export function cloud({ seed = 5 } = {}) {
  const [c, g] = canvas(256, 128);
  const r = rng(seed);
  for (let k = 0; k < 14; k++) {
    const x = 50 + r() * 156;
    const y = 50 + r() * 40;
    const rad = 26 + r() * 30;
    const cg = g.createRadialGradient(x, y, 0, x, y, rad);
    cg.addColorStop(0, 'rgba(255,255,255,0.95)');
    cg.addColorStop(0.6, 'rgba(255,255,255,0.6)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cg;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return finish(c);
}

/** A soft dark spot used as a contact shadow. */
export function blob() {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.6)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return finish(c, { color: false });
}

/** Rippling water, scrolled slowly. */
export function water({ seed = 14 } = {}) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = '#4fa3c7';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.12 + r() * 0.25})`;
    g.lineWidth = 1 + r() * 2;
    const x = r() * 256;
    const y = r() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + 10, y - 3, x + 20 + r() * 20, y);
    g.stroke();
  }
  return finish(c, { repeat: [3, 3] });
}

/** A fridge door full of colourful drinks. */
export function fridge({ seed = 19 } = {}) {
  const [c, g] = canvas(128, 256);
  const r = rng(seed);
  g.fillStyle = '#dff3ff';
  g.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 5; row++) {
    const y = 14 + row * 48;
    g.fillStyle = 'rgba(120, 150, 170, 0.6)';
    g.fillRect(4, y + 38, 120, 3);
    for (let x = 8; x < 118; x += 14) {
      g.fillStyle = hsl(Math.floor(r() * 360), 80, 50);
      g.fillRect(x, y + 8 + r() * 4, 10, 30);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(x + 2, y + 12, 2, 20);
    }
  }
  return finish(c);
}

/** A vertical sky gradient for the dome above the town square. */
export function skyDome({ top = '#4f8fd8', horizon = '#cfe6f7', ground = '#b8d3a0' } = {}) {
  const [c, g] = canvas(4, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(0.48, horizon);
  grad.addColorStop(0.52, horizon);
  grad.addColorStop(1, ground);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return finish(c);
}

/** Distant hills, trees and rooftops for the horizon around the town square. */
export function skyline({ seed = 41 } = {}) {
  const [c, g] = canvas(1024, 256);
  const r = rng(seed);
  g.clearRect(0, 0, 1024, 256);
  g.fillStyle = '#a9c6a0';
  g.beginPath();
  g.moveTo(0, 256);
  for (let x = 0; x <= 1024; x += 32) g.lineTo(x, 150 + Math.sin(x / 120) * 22 + Math.sin(x / 47) * 8);
  g.lineTo(1024, 256);
  g.fill();
  let x = 0;
  while (x < 1024) {
    const w = 28 + r() * 60;
    const h = 40 + r() * 80;
    g.fillStyle = ['#d9cbb8', '#cdbfa9', '#e2d5c0', '#c4b6a6', '#d6c3b5'][Math.floor(r() * 5)];
    g.fillRect(x, 256 - h, w, h);
    g.fillStyle = ['#a35f4a', '#7c6a5e', '#5d7186'][Math.floor(r() * 3)];
    g.fillRect(x - 2, 256 - h - 6, w + 4, 8);
    g.fillStyle = 'rgba(120, 140, 160, 0.5)';
    for (let wy = 256 - h + 12; wy < 240; wy += 16) for (let wx = x + 5; wx < x + w - 8; wx += 11) g.fillRect(wx, wy, 5, 8);
    x += w + r() * 30;
  }
  g.fillStyle = '#7da36a';
  for (let k = 0; k < 60; k++) {
    const tx = r() * 1024;
    g.beginPath();
    g.arc(tx, 236 + r() * 10, 14 + r() * 16, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c);
}

/** Awning stripes, running down the slope. */
export function stripes({ a = '#2f6b55', b = '#f3ead9', n = 8 } = {}) {
  const [c, g] = canvas(256, 64);
  const w = 256 / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? b : a;
    g.fillRect(i * w, 0, w, 64);
  }
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 52, 256, 12);
  return finish(c);
}

/** A wall with rows of windows, some lit; for houses and upper floors. */
export function facade({ wall = '#e8d9c0', frame = '#ffffff', glass = '#8fb3d1', lit = 0.2, rows = 3, cols = 4, seed = 7, sill = true } = {}) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = wall;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.04})`;
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  const cw = 256 / cols;
  const rh = 256 / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const wx = x * cw + cw * 0.22;
      const wy = y * rh + rh * 0.2;
      const ww = cw * 0.56;
      const wh = rh * 0.58;
      g.fillStyle = frame;
      g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      const on = r() < lit;
      const grad = g.createLinearGradient(0, wy, 0, wy + wh);
      grad.addColorStop(0, on ? '#ffe7b0' : glass);
      grad.addColorStop(1, on ? '#f2b870' : '#5f87a8');
      g.fillStyle = grad;
      g.fillRect(wx, wy, ww, wh);
      g.fillStyle = frame;
      g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
      g.fillRect(wx, wy + wh * 0.45, ww, 3);
      if (sill) {
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(wx - 6, wy + wh + 4, ww + 12, 5);
      }
    }
  }
  return finish(c);
}
