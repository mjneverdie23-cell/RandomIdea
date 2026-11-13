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
    grad.addColorStop(0, light ? 'rgba(180, 210, 110, 0.12)' : 'rgba(60, 110, 50, 0.12)');
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

// ------------------------------------------------------------------ world places

/** Desert sand with wind ripples. */
export function sand({ seed = 61, repeat = [30, 30], base = '#e3c48f' } = {}) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let y = 4; y < 256; y += 7 + r() * 5) {
    g.strokeStyle = `rgba(150, 105, 55, ${0.06 + r() * 0.06})`;
    g.lineWidth = 1.2;
    g.beginPath();
    for (let x = 0; x <= 256; x += 8) g.lineTo(x, y + Math.sin(x / 22 + y) * 2.5);
    g.stroke();
  }
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(110,70,30,0.12)';
    g.fillRect(r() * 256, r() * 256, 1, 1);
  }
  return finish(c, { repeat, aniso: 8 });
}

/** Little painted symbols: an ankh, an eye, a bird, a scarab, a lotus, water, a sun. */
function glyph(g, kind, x, y, s, color) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.beginPath();
  switch (kind % 8) {
    case 0: // ankh
      g.ellipse(0, -9, 4, 6, 0, 0, Math.PI * 2);
      g.moveTo(0, -3);
      g.lineTo(0, 13);
      g.moveTo(-7, 0);
      g.lineTo(7, 0);
      g.stroke();
      break;
    case 1: // eye
      g.moveTo(-10, 0);
      g.quadraticCurveTo(0, -8, 10, 0);
      g.quadraticCurveTo(0, 6, -10, 0);
      g.stroke();
      g.beginPath();
      g.arc(0, -1, 2.6, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(-2, 4);
      g.lineTo(-4, 11);
      g.moveTo(3, 4);
      g.quadraticCurveTo(8, 10, 12, 8);
      g.stroke();
      break;
    case 2: // bird
      g.ellipse(0, 2, 8, 5, -0.2, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(7, -5, 3.2, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(9, -5);
      g.lineTo(13, -3);
      g.moveTo(-2, 7);
      g.lineTo(-3, 13);
      g.moveTo(2, 7);
      g.lineTo(3, 13);
      g.stroke();
      break;
    case 3: // scarab
      g.ellipse(0, 2, 6, 8, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(0, -8, 3.5, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      for (const s2 of [-1, 1]) {
        g.moveTo(s2 * 5, -2);
        g.lineTo(s2 * 10, -6);
        g.moveTo(s2 * 5, 4);
        g.lineTo(s2 * 10, 8);
      }
      g.stroke();
      break;
    case 4: // lotus
      for (const a of [-0.5, 0, 0.5]) {
        g.save();
        g.rotate(a);
        g.beginPath();
        g.ellipse(0, -6, 3, 8, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      g.fillRect(-1, 2, 2, 11);
      break;
    case 5: // water
      for (let k = 0; k < 3; k++) {
        g.moveTo(-10, -6 + k * 6);
        for (let x = -10; x <= 10; x += 5) g.lineTo(x + 2.5, -6 + k * 6 + (x % 10 === 0 ? -3 : 3));
      }
      g.stroke();
      break;
    case 6: // sun
      g.arc(0, 0, 7, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(-12, 9);
      g.lineTo(12, 9);
      g.stroke();
      break;
    default: // seated figure
      g.arc(0, -9, 3.6, 0, Math.PI * 2);
      g.fill();
      g.fillRect(-4, -5, 8, 9);
      g.fillRect(-4, 4, 10, 3);
      g.fillRect(4, 4, 3, 9);
  }
  g.restore();
}

/** Sandstone blocks with painted friezes of symbols, for the inside of the pyramid. */
export function egyptWall({ seed = 3, repeat = [6, 1], wallHeight = 9 } = {}) {
  const [c, g] = canvas(256, 512);
  const r = rng(seed);
  g.fillStyle = '#d8b37a';
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,240,210,0.08)' : 'rgba(90,60,30,0.08)';
    g.fillRect(r() * 256, r() * 512, 2, 2);
  }
  g.strokeStyle = 'rgba(110, 75, 40, 0.35)';
  g.lineWidth = 2;
  const rowH = 512 / (wallHeight * 1.6);
  for (let row = 0; row * rowH < 512; row++) {
    const y = row * rowH;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
    for (let x = (row % 2) * 48; x < 256; x += 96) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + rowH);
      g.stroke();
    }
  }
  // A painted band at eye height, a band of symbols above it, and stars near the top.
  const band = (y0, h, bg) => {
    g.fillStyle = bg;
    g.fillRect(0, y0, 256, h);
    g.fillStyle = '#c9a43a';
    g.fillRect(0, y0, 256, 3);
    g.fillRect(0, y0 + h - 3, 256, 3);
  };
  const v = (m) => 512 - (m / wallHeight) * 512;
  band(v(2.2), v(1.4) - v(2.2), '#1f5c7a');
  for (let k = 0; k < 8; k++) {
    g.fillStyle = k % 2 ? '#b8452f' : '#e6c46a';
    g.fillRect(k * 32 + 4, v(2.2) + 8, 24, v(1.4) - v(2.2) - 16);
  }
  const symbolsTop = v(4.6);
  const symbolsBottom = v(2.4);
  g.fillStyle = 'rgba(230, 205, 150, 0.6)';
  g.fillRect(0, symbolsTop, 256, symbolsBottom - symbolsTop);
  const colors = ['#1f5c7a', '#b8452f', '#2f6b4a', '#7a4a1f'];
  for (let col = 0; col < 6; col++) {
    for (let row = 0; row < 3; row++) {
      glyph(g, Math.floor(r() * 8), 22 + col * 42, symbolsTop + 26 + row * ((symbolsBottom - symbolsTop - 30) / 3), 0.95, colors[(col + row) % 4]);
    }
    g.fillStyle = 'rgba(90, 60, 30, 0.35)';
    g.fillRect(col * 42 + 42, symbolsTop + 6, 2, symbolsBottom - symbolsTop - 12);
  }
  band(v(8.4), v(7.4) - v(8.4), '#123f5a');
  g.fillStyle = '#f0d27a';
  for (let k = 0; k < 10; k++) {
    const x = 14 + k * 25;
    const y = (v(8.4) + v(7.4)) / 2 + (k % 2 ? -6 : 6);
    g.beginPath();
    for (let p = 0; p < 10; p++) {
      const a = (p / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = p % 2 ? 2.5 : 6;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.fill();
  }
  return finish(c, { repeat });
}

/** A column of symbols for obelisks and pillars. */
export function glyphColumn({ seed = 8, bg = '#d8b37a', ink = '#5a3a1a' } = {}) {
  const [c, g] = canvas(64, 512);
  const r = rng(seed);
  g.fillStyle = bg;
  g.fillRect(0, 0, 64, 512);
  g.strokeStyle = 'rgba(90,60,30,0.4)';
  g.strokeRect(6, 6, 52, 500);
  for (let y = 30; y < 500; y += 34) glyph(g, Math.floor(r() * 8), 32, y, 1.05, ink);
  return finish(c);
}

/** Roman cobblestones ("sampietrini") laid in arcs. */
export function cobbles({ seed = 33, repeat = [14, 14] } = {}) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = '#5b5550';
  g.fillRect(0, 0, 256, 256);
  const s = 16;
  for (let row = 0; row < 256 / s + 2; row++) {
    for (let col = -1; col < 256 / s + 1; col++) {
      const x = col * s + (row % 2) * (s / 2);
      const y = row * s - Math.sin((col * s) / 256 * Math.PI) * 6;
      const k = 0.75 + r() * 0.4;
      g.fillStyle = `rgb(${(122 * k) | 0}, ${(116 * k) | 0}, ${(108 * k) | 0})`;
      g.beginPath();
      g.roundRect ? g.roundRect(x + 1.2, y + 1.2, s - 2.4, s - 2.4, 3) : g.rect(x + 1.2, y + 1.2, s - 2.4, s - 2.4);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(x + 3, y + 3, s - 8, 2);
    }
  }
  return finish(c, { repeat, aniso: 8 });
}

/** Travertine with tiers of arches, for the Colosseum. `levels` rows of `arches` openings. */
export function arcade({ arches = 8, levels = 3, attic = true, seed = 21, stone = '#d9c8a6', dark = '#3b2e24', lit = null } = {}) {
  const [c, g] = canvas(512, 512);
  const r = rng(seed);
  g.fillStyle = stone;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,250,235,0.1)' : 'rgba(80,60,40,0.1)';
    g.fillRect(r() * 512, r() * 512, 2, 2);
  }
  const atticH = attic ? 512 * 0.2 : 0;
  const levelH = (512 - atticH) / levels;
  const w = 512 / arches;
  for (let L = 0; L < levels; L++) {
    const top = atticH + L * levelH;
    g.fillStyle = 'rgba(120, 95, 65, 0.35)';
    g.fillRect(0, top, 512, 6);
    for (let k = 0; k < arches; k++) {
      const x = k * w;
      const ax = x + w * 0.2;
      const aw = w * 0.6;
      const ay = top + levelH * 0.22;
      const ah = levelH * 0.72;
      g.fillStyle = lit && r() < 0.25 ? lit : dark;
      g.beginPath();
      g.moveTo(ax, ay + ah);
      g.lineTo(ax, ay + aw / 2);
      g.arc(ax + aw / 2, ay + aw / 2, aw / 2, Math.PI, 0);
      g.lineTo(ax + aw, ay + ah);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255, 245, 220, 0.25)';
      g.fillRect(x + w * 0.04, top + 8, w * 0.1, levelH - 8);
      g.fillRect(x + w * 0.86, top + 8, w * 0.1, levelH - 8);
    }
  }
  if (attic) {
    for (let k = 0; k < arches; k++) {
      g.fillStyle = dark;
      g.fillRect(k * w + w * 0.4, atticH * 0.4, w * 0.2, atticH * 0.3);
    }
    g.fillStyle = 'rgba(120, 95, 65, 0.4)';
    g.fillRect(0, 0, 512, 5);
  }
  return finish(c);
}

/** Stone steps, for the Colosseum's seating. */
export function steps({ seed = 4 } = {}) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = '#cdb994';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,250,235,0.12)' : 'rgba(80,60,40,0.12)';
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  for (let y = 0; y < 256; y += 32) {
    g.fillStyle = 'rgba(90, 70, 45, 0.4)';
    g.fillRect(0, y, 256, 4);
    for (let x = (y / 32) % 2 ? 0 : 40; x < 256; x += 80) g.fillRect(x, y, 3, 32);
  }
  return finish(c, { repeat: [24, 1] });
}

/** Tatami mats: woven green-gold straw with dark cloth borders. */
export function tatami({ seed = 5, repeat = [6, 6] } = {}) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = '#c9bb7a';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 3) {
    g.fillStyle = `rgba(${r() < 0.5 ? '120, 110, 50' : '235, 225, 160'}, 0.25)`;
    g.fillRect(0, y, 256, 1.5);
  }
  g.fillStyle = '#2d3a2a';
  // Two mats: one long side horizontal, one vertical, borders along the long sides.
  g.fillRect(0, 0, 256, 7);
  g.fillRect(0, 121, 256, 7);
  g.fillRect(0, 128, 7, 128);
  g.fillRect(121, 128, 7, 128);
  g.fillRect(249, 128, 7, 128);
  return finish(c, { repeat, aniso: 8 });
}

/** Shoji: paper panes in a wooden lattice, glowing with daylight. */
export function shoji({ cols = 4, rows = 6 } = {}) {
  const [c, g] = canvas(256, 512);
  g.fillStyle = '#f7f1e3';
  g.fillRect(0, 0, 256, 512);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(230,215,185,0.3)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 512);
  g.fillStyle = '#5a3f28';
  for (let x = 0; x <= cols; x++) g.fillRect((x * 256) / cols - 3, 0, 6, 512);
  for (let y = 0; y <= rows; y++) g.fillRect(0, (y * 512) / rows - 3, 256, 6);
  g.fillRect(0, 512 - 60, 256, 60);
  return finish(c);
}

/** A gold-leaf folding screen painted with pines, a crane and waves. */
export function goldScreen({ seed = 9, panels = 6 } = {}) {
  const [c, g] = canvas(512, 256);
  const r = rng(seed);
  for (let p = 0; p < panels; p++) {
    const x = (p * 512) / panels;
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `hsl(${42 + r() * 6}, ${70 + r() * 15}%, ${52 + r() * 10}%)`;
      g.fillRect(x + (i % 3) * (512 / panels / 3), Math.floor(i / 3) * 64, 512 / panels / 3 + 1, 65);
    }
  }
  g.strokeStyle = 'rgba(120, 85, 20, 0.35)';
  for (let p = 1; p < panels; p++) {
    g.beginPath();
    g.moveTo((p * 512) / panels, 0);
    g.lineTo((p * 512) / panels, 256);
    g.stroke();
  }
  // Waves.
  g.strokeStyle = '#2e5a8a';
  g.lineWidth = 3;
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    for (let x = 0; x <= 512; x += 10) g.lineTo(x, 200 + k * 12 + Math.sin(x / 24 + k) * 6);
    g.stroke();
  }
  // Pines.
  const pine = (px, py, s) => {
    g.strokeStyle = '#4a3020';
    g.lineWidth = 6 * s;
    g.beginPath();
    g.moveTo(px, py + 90 * s);
    g.quadraticCurveTo(px + 30 * s, py + 40 * s, px - 10 * s, py);
    g.stroke();
    g.fillStyle = '#2f5a3a';
    for (const [dx, dy, w] of [[-30, 0, 46], [10, 30, 40], [-14, 56, 34]]) {
      g.beginPath();
      g.ellipse(px + dx * s, py + dy * s, w * s, 12 * s, 0, 0, Math.PI * 2);
      g.fill();
    }
  };
  pine(120, 50, 1);
  pine(390, 70, 0.8);
  // A crane in flight.
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(270, 70, 26, 8, -0.2, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(255, 70);
  g.lineTo(215, 30);
  g.lineTo(265, 62);
  g.moveTo(280, 66);
  g.lineTo(320, 28);
  g.lineTo(290, 70);
  g.fill();
  g.fillStyle = '#d63a2a';
  g.beginPath();
  g.arc(298, 62, 3.5, 0, Math.PI * 2);
  g.fill();
  return finish(c);
}

/** Raked gravel, in straight lines with rings around the rocks. */
export function gravel({ seed = 2, repeat = [3, 2], rings = [] } = {}) {
  const [c, g] = canvas(512, 256);
  const r = rng(seed);
  g.fillStyle = '#ddd8cc';
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.4)' : 'rgba(120,115,100,0.25)';
    g.fillRect(r() * 512, r() * 256, 1.5, 1.5);
  }
  g.strokeStyle = 'rgba(140, 132, 115, 0.55)';
  g.lineWidth = 2;
  const inRing = (x, y) => rings.some(([rx, ry, rr]) => Math.hypot(x - rx, y - ry) < rr + 26);
  for (let y = 6; y < 256; y += 8) {
    g.beginPath();
    let pen = false;
    for (let x = 0; x <= 512; x += 4) {
      if (inRing(x, y)) {
        pen = false;
        continue;
      }
      if (!pen) g.moveTo(x, y);
      else g.lineTo(x, y);
      pen = true;
    }
    g.stroke();
  }
  for (const [rx, ry, rr] of rings) {
    for (let k = 1; k <= 3; k++) {
      g.beginPath();
      g.arc(rx, ry, rr + k * 8, 0, Math.PI * 2);
      g.stroke();
    }
  }
  return finish(c, { repeat });
}

/** Dark grey roof tiles in rows, for Japanese roofs. */
export function roofTiles({ repeat = [8, 4] } = {}) {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#4a4f57';
  g.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 16) {
    const grad = g.createLinearGradient(x, 0, x + 16, 0);
    grad.addColorStop(0, '#30343b');
    grad.addColorStop(0.5, '#6a707a');
    grad.addColorStop(1, '#30343b');
    g.fillStyle = grad;
    g.fillRect(x, 0, 16, 128);
  }
  g.fillStyle = 'rgba(20,22,26,0.5)';
  for (let y = 0; y < 128; y += 32) g.fillRect(0, y, 128, 4);
  return finish(c, { repeat });
}

/** A Roman facade: warm plaster, windows with green shutters, a shop at street level. */
export function romanFacade({ wall = '#e3b36a', shutter = '#3f6b4a', rows = 3, cols = 4, seed = 15, shop = '#7a3b26' } = {}) {
  const [c, g] = canvas(256, 256);
  const r = rng(seed);
  g.fillStyle = wall;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,240,210,0.1)' : 'rgba(120,70,30,0.08)';
    g.fillRect(r() * 256, r() * 256, 3, 3);
  }
  const groundH = 256 / (rows + 1);
  const cw = 256 / cols;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const wx = x * cw + cw * 0.3;
      const wy = y * groundH + groundH * 0.22;
      const ww = cw * 0.4;
      const wh = groundH * 0.6;
      g.fillStyle = '#f2e6cf';
      g.fillRect(wx - 4, wy - 6, ww + 8, wh + 10);
      const open = r() < 0.4;
      g.fillStyle = open ? '#3a2a20' : shutter;
      g.fillRect(wx, wy, ww, wh);
      if (!open) {
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let k = 4; k < wh; k += 5) g.fillRect(wx + 2, wy + k, ww - 4, 1.5);
        g.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      } else {
        g.fillStyle = shutter;
        g.fillRect(wx - ww * 0.45, wy, ww * 0.42, wh);
        g.fillRect(wx + ww * 1.03, wy, ww * 0.42, wh);
      }
      if (r() < 0.3) {
        g.fillStyle = '#5f8f3a';
        g.fillRect(wx - 3, wy + wh, ww + 6, 6);
        g.fillStyle = '#e04a6a';
        for (let k = 0; k < 5; k++) g.fillRect(wx + k * (ww / 5), wy + wh - 3, 3, 3);
      }
    }
  }
  const gy = 256 - groundH;
  g.fillStyle = 'rgba(0,0,0,0.15)';
  g.fillRect(0, gy - 4, 256, 4);
  for (let x = 0; x < cols; x++) {
    g.fillStyle = shop;
    g.fillRect(x * cw + cw * 0.12, gy + groundH * 0.18, cw * 0.76, groundH * 0.82);
    g.fillStyle = 'rgba(255, 225, 160, 0.55)';
    g.fillRect(x * cw + cw * 0.18, gy + groundH * 0.28, cw * 0.64, groundH * 0.5);
  }
  return finish(c);
}

// ------------------------------------------------------------------ Spain

/** Draws a shard (a polygon around cx, cy) and its copies across the edges, so it tiles. */
function tiled(g, S, cx, cy, pts) {
  for (const ox of [-S, 0, S]) {
    for (const oy of [-S, 0, S]) {
      g.beginPath();
      pts.forEach(([x, y], k) => (k ? g.lineTo(cx + x + ox, cy + y + oy) : g.moveTo(cx + x + ox, cy + y + oy)));
      g.closePath();
      g.fill();
    }
  }
}

/** Broken-tile mosaic (trencadís): bright shards of glazed tile set in pale grout. */
export function trencadis({ palette = ['#f4f1e8', '#2f6fb8', '#e8b23a', '#3c9a5f', '#d9573c', '#7fc3e0', '#f4f1e8'], seed = 7, repeat = [4, 1], grout = '#d8d2c4' } = {}) {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(seed);
  g.fillStyle = grout;
  g.fillRect(0, 0, S, S);
  const step = 16;
  for (let y = 0; y < S; y += step) {
    for (let x = 0; x < S; x += step) {
      const n = 4 + Math.floor(r() * 3);
      const rad = step * (0.52 + r() * 0.2);
      const pts = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + r() * 0.7;
        const rr = rad * (0.72 + r() * 0.35);
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      const col = new THREE.Color(palette[Math.floor(r() * palette.length)]).multiplyScalar(0.88 + r() * 0.2);
      g.fillStyle = `#${col.getHexString()}`;
      tiled(g, S, x + step / 2 + (r() - 0.5) * 6, y + step / 2 + (r() - 0.5) * 6, pts);
    }
  }
  for (let i = 0; i < 260; i++) {
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(r() * S, r() * S, 2, 1);
  }
  return finish(c, { repeat, aniso: 8 });
}

/** A tall stained-glass window with a pointed top: shards of colour held in lead. */
export function stainedGlass({ palette = ['#2a6fd1', '#3fb0c9', '#4fbf72', '#9ad1e8', '#1d4f9a'], seed = 3 } = {}) {
  const W = 128;
  const H = 384;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  const outline = () => {
    g.beginPath();
    g.moveTo(6, H - 4);
    g.lineTo(6, H * 0.3);
    g.bezierCurveTo(6, H * 0.08, W * 0.36, 4, W / 2, 4);
    g.bezierCurveTo(W * 0.64, 4, W - 6, H * 0.08, W - 6, H * 0.3);
    g.lineTo(W - 6, H - 4);
    g.closePath();
  };
  g.save();
  outline();
  g.clip();
  const cols = 5;
  const rows = 16;
  const pts = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const jx = i > 0 && i < cols ? (r() - 0.5) * 16 : 0;
      const jy = j > 0 && j < rows ? (r() - 0.5) * 14 : 0;
      pts.push([(i / cols) * W + jx, (j / rows) * H + jy]);
    }
  }
  const at = (i, j) => pts[j * (cols + 1) + i];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const col = new THREE.Color(palette[Math.floor(r() * palette.length)]).multiplyScalar(0.8 + r() * 0.35 + (1 - j / rows) * 0.15);
      g.fillStyle = `#${col.getHexString()}`;
      g.beginPath();
      g.moveTo(...at(i, j));
      g.lineTo(...at(i + 1, j));
      g.lineTo(...at(i + 1, j + 1));
      g.lineTo(...at(i, j + 1));
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(30, 26, 24, 0.85)';
      g.lineWidth = 2.4;
      g.stroke();
    }
  }
  g.fillStyle = 'rgba(255, 250, 225, 0.6)';
  g.beginPath();
  g.arc(W / 2, H * 0.17, 15, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.strokeStyle = '#3a3330';
  g.lineWidth = 5;
  outline();
  g.stroke();
  return finish(c);
}

/** A round rose window: rings of coloured glass around a bright centre. */
export function roseWindow({ seed = 5 } = {}) {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(seed);
  const pal = ['#e0442f', '#f2a23a', '#f6d85a', '#3fa45a', '#2f7fd1', '#7a4fc9', '#f07aa8'];
  const m = S / 2;
  for (const [r0, r1, n] of [[0, 20, 1], [20, 46, 8], [46, 74, 12], [74, 100, 16], [100, 124, 24]]) {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      g.beginPath();
      g.arc(m, m, r1, a0, a1);
      g.arc(m, m, r0, a1, a0, true);
      g.closePath();
      g.fillStyle = r0 === 0 ? '#fff4c8' : pal[(k + Math.floor(r() * 2) + r0) % pal.length];
      g.fill();
      g.strokeStyle = 'rgba(30, 26, 24, 0.9)';
      g.lineWidth = 2.5;
      g.stroke();
    }
  }
  g.strokeStyle = '#3a3330';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(m, m, 124, 0, Math.PI * 2);
  g.stroke();
  return finish(c);
}

/** Barcelona's pavement: grey tiles pressed with a four-petal flower. */
export function panot({ seed = 9, repeat = [160, 160], base = '#c9c3b6' } = {}) {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(seed);
  const tile = S / 2;
  const tint = new THREE.Color(base);
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const x0 = tx * tile;
      const y0 = ty * tile;
      g.fillStyle = `#${tint.clone().multiplyScalar(0.94 + r() * 0.1).getHexString()}`;
      g.fillRect(x0, y0, tile, tile);
      g.strokeStyle = 'rgba(70, 64, 56, 0.32)';
      g.lineWidth = 4;
      const cx = x0 + tile / 2;
      const cy = y0 + tile / 2;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        g.beginPath();
        g.ellipse(cx + Math.cos(a) * tile * 0.22, cy + Math.sin(a) * tile * 0.22, tile * 0.2, tile * 0.1, a, 0, Math.PI * 2);
        g.stroke();
      }
      g.beginPath();
      g.arc(cx, cy, tile * 0.06, 0, Math.PI * 2);
      g.stroke();
      for (const [qx, qy] of [[x0, y0], [x0 + tile, y0], [x0, y0 + tile], [x0 + tile, y0 + tile]]) {
        g.beginPath();
        g.arc(qx, qy, tile * 0.17, 0, Math.PI * 2);
        g.stroke();
      }
      g.strokeStyle = 'rgba(60, 56, 50, 0.4)';
      g.lineWidth = 2;
      g.strokeRect(x0 + 1, y0 + 1, tile - 2, tile - 2);
    }
  }
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '40,36,30'}, ${r() * 0.08})`;
    g.fillRect(r() * S, r() * S, 2, 2);
  }
  return finish(c, { repeat, aniso: 8 });
}

/** The wavy stripes paved down the middle of the Rambla. */
export function ramblaWaves({ repeat = [2, 8] } = {}) {
  const S = 256;
  const [c, g] = canvas(S, S);
  const band = 32;
  for (let k = 0; k < S / band; k++) {
    g.fillStyle = k % 2 ? '#e9e3d6' : '#c8bda8';
    g.beginPath();
    for (let x = 0; x <= S; x += 4) {
      const y = k * band + Math.sin((x / S) * Math.PI * 4) * 9;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    for (let x = S; x >= 0; x -= 4) g.lineTo(x, (k + 1) * band + Math.sin((x / S) * Math.PI * 4) * 9);
    g.closePath();
    g.fill();
  }
  // The last band wraps round to the top.
  g.fillStyle = '#e9e3d6';
  g.beginPath();
  for (let x = 0; x <= S; x += 4) g.lineTo(x, Math.sin((x / S) * Math.PI * 4) * 9);
  g.lineTo(S, 0);
  g.lineTo(0, 0);
  g.closePath();
  g.fill();
  return finish(c, { repeat, aniso: 8 });
}

/** An Eixample façade: tall balcony doors with iron railings and shutters, shops below. */
export function eixampleFacade({ wall = '#e6d3b3', shutter = '#4f7a52', rows = 5, cols = 3, seed = 31, shop = '#5a3a2a', awning = null } = {}) {
  const W = 256;
  const H = 512;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  g.fillStyle = wall;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,245,225,0.12)' : 'rgba(110,80,50,0.07)';
    g.fillRect(r() * W, r() * H, 3, 3);
  }
  const floorH = H / (rows + 1.2);
  const cw = W / cols;
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(0, 0, W, 10);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 10, W, 4);
  for (let y = 0; y < rows; y++) {
    const top = 18 + y * floorH;
    g.fillStyle = 'rgba(90, 60, 30, 0.12)';
    g.fillRect(0, top + floorH - 6, W, 3);
    for (let x = 0; x < cols; x++) {
      const wx = x * cw + cw * 0.28;
      const ww = cw * 0.44;
      const wy = top + floorH * 0.12;
      const wh = floorH * 0.74;
      g.fillStyle = 'rgba(255, 250, 240, 0.7)';
      g.fillRect(wx - 5, wy - 7, ww + 10, 7);
      g.fillStyle = '#2b2622';
      g.fillRect(wx, wy, ww, wh);
      const shut = r();
      g.fillStyle = shutter;
      g.fillRect(wx, wy, ww, wh * (shut < 0.4 ? 0.95 : shut < 0.75 ? 0.5 : 0.15));
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let k = 3; k < wh * 0.95; k += 4) g.fillRect(wx + 1, wy + k, ww - 2, 1);
      // The balcony: a slab and an iron railing across the lower part of the door.
      g.fillStyle = 'rgba(250, 245, 235, 0.9)';
      g.fillRect(wx - 8, wy + wh, ww + 16, 5);
      g.fillStyle = '#1e1c1c';
      g.fillRect(wx - 8, wy + wh * 0.58, ww + 16, 3);
      for (let k = 0; k <= 8; k++) g.fillRect(wx - 8 + (k * (ww + 16)) / 8 - 1, wy + wh * 0.58, 2, wh * 0.42);
      if (r() < 0.35) {
        g.fillStyle = r() < 0.5 ? '#d9483b' : '#e8a83a';
        for (let k = 0; k < 5; k++) g.fillRect(wx - 6 + k * (ww / 4), wy + wh - 6, 4, 4);
      }
    }
  }
  const gy = 18 + rows * floorH;
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(0, gy, W, 5);
  for (let x = 0; x < cols; x++) {
    g.fillStyle = shop;
    g.fillRect(x * cw + cw * 0.1, gy + 14, cw * 0.8, H - gy - 14);
    g.fillStyle = 'rgba(255, 220, 160, 0.55)';
    g.fillRect(x * cw + cw * 0.16, gy + 24, cw * 0.68, (H - gy) * 0.55);
    if (awning) {
      g.fillStyle = awning;
      g.fillRect(x * cw + cw * 0.06, gy + 8, cw * 0.88, 12);
    }
  }
  return finish(c);
}

/** A house of blue-green mosaic with white mask-shaped balconies and bone-like columns. */
export function mosaicFacade({ seed = 13 } = {}) {
  const W = 256;
  const H = 512;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  g.fillStyle = '#9cc6cf';
  g.fillRect(0, 0, W, H);
  const pal = ['#3f8fb0', '#6fb7c4', '#2f6f8f', '#b48fc7', '#7fbf9a', '#e9e4f0', '#5a9fd0'];
  for (let i = 0; i < 1300; i++) {
    const n = 4 + Math.floor(r() * 2);
    const rad = 3 + r() * 4;
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r();
      pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
    }
    g.fillStyle = pal[Math.floor(r() * pal.length)];
    tiled(g, W, r() * W, r() * H, pts);
  }
  // Mask balconies over dark windows, three floors of them.
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 3; x++) {
      const cx = 44 + x * 84;
      const cy = 70 + y * 86;
      g.fillStyle = '#2a2a33';
      g.fillRect(cx - 22, cy - 26, 44, 58);
      g.fillStyle = '#f4efe6';
      g.beginPath();
      g.ellipse(cx, cy + 10, 26, 16, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2a2a33';
      for (const s of [-9, 9]) {
        g.beginPath();
        g.ellipse(cx + s, cy + 8, 5, 6, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // The ground floor's bone-like stone frames round big wavy windows.
  const gy = 420;
  g.fillStyle = '#efe7d6';
  g.fillRect(0, gy - 10, W, H - gy + 10);
  g.fillStyle = '#3a3a44';
  for (let x = 0; x < 3; x++) {
    g.beginPath();
    g.ellipse(44 + x * 84, gy + 46, 30, 40, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#efe7d6';
  for (let x = 0; x <= 3; x++) {
    g.beginPath();
    g.ellipse(2 + x * 84, gy + 46, 10, 48, 0, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c);
}

/** A house of wavy cream stone with seaweed-like iron balconies. */
export function wavyFacade({ seed = 17 } = {}) {
  const W = 256;
  const H = 512;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  g.fillStyle = '#e9dfcb';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2400; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,250,240,0.16)' : 'rgba(120,100,70,0.06)';
    g.fillRect(r() * W, r() * H, 3, 3);
  }
  const rows = 6;
  const fh = H / rows;
  for (let y = 0; y < rows; y++) {
    const base = y * fh;
    g.fillStyle = 'rgba(140, 115, 80, 0.22)';
    g.beginPath();
    for (let x = 0; x <= W; x += 4) g.lineTo(x, base + fh - 8 + Math.sin((x / W) * Math.PI * 4 + y) * 7);
    for (let x = W; x >= 0; x -= 4) g.lineTo(x, base + fh + Math.sin((x / W) * Math.PI * 4 + y) * 7);
    g.closePath();
    g.fill();
    for (let x = 0; x < 3; x++) {
      const cx = 44 + x * 84 + Math.sin(y + x) * 6;
      const wy = base + fh * 0.2;
      g.fillStyle = '#2c2824';
      g.beginPath();
      g.ellipse(cx, wy + fh * 0.3, 26, fh * 0.32, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#141212';
      g.lineWidth = 2.2;
      for (let k = 0; k < 7; k++) {
        g.beginPath();
        const sx = cx - 30 + k * 10;
        g.moveTo(sx, wy + fh * 0.62);
        g.bezierCurveTo(sx + 8, wy + fh * 0.48, sx - 8, wy + fh * 0.42, sx + 3, wy + fh * 0.32);
        g.stroke();
      }
    }
  }
  return finish(c);
}

/**
 * The basilica's sculpted front: three deep portals under organic gables dripping with
 * stone, and a green cypress at the top.
 */
export function gaudiFacade({ seed = 21 } = {}) {
  const W = 512;
  const H = 320;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  g.fillStyle = '#c9b089';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(90, 70, 45, ${0.05 + r() * 0.08})`;
    g.fillRect(r() * W, r() * H, 2 + r() * 3, 20 + r() * 60);
  }
  // Ribs running up the front, and small sculpted lumps between them, lit from above.
  for (let x = 6; x < W; x += 14 + r() * 10) {
    g.fillStyle = 'rgba(230, 214, 184, 0.35)';
    g.fillRect(x, 0, 3, H);
    g.fillStyle = 'rgba(110, 88, 60, 0.25)';
    g.fillRect(x + 3, 0, 2, H);
  }
  for (let i = 0; i < 2600; i++) {
    const x = r() * W;
    const y = r() * H * 0.8;
    const rad = 0.8 + r() * 2.2;
    g.fillStyle = r() < 0.5 ? 'rgba(236, 222, 194, 0.4)' : 'rgba(115, 92, 62, 0.28)';
    g.beginPath();
    g.ellipse(x, y, rad, rad * (0.8 + r() * 0.9), 0, 0, Math.PI * 2);
    g.fill();
  }
  // Stone dripping from the gables like wax.
  for (let i = 0; i < 260; i++) {
    const x = r() * W;
    const y = 4 + r() * 90;
    g.fillStyle = 'rgba(110, 88, 60, 0.32)';
    g.fillRect(x, y, 1.5 + r() * 1.5, 8 + r() * 26);
  }
  const portal = (cx, w, h) => {
    const y0 = H - h;
    g.fillStyle = '#d9c4a0';
    g.beginPath();
    g.moveTo(cx - w * 0.62, H);
    g.lineTo(cx - w * 0.62, y0 + h * 0.3);
    g.quadraticCurveTo(cx, y0 - h * 0.32, cx + w * 0.62, y0 + h * 0.3);
    g.lineTo(cx + w * 0.62, H);
    g.fill();
    g.fillStyle = '#3a2e24';
    g.beginPath();
    g.moveTo(cx - w / 2, H);
    g.lineTo(cx - w / 2, y0 + h * 0.34);
    g.quadraticCurveTo(cx, y0 - h * 0.18, cx + w / 2, y0 + h * 0.34);
    g.lineTo(cx + w / 2, H);
    g.fill();
  };
  portal(W / 2, W * 0.17, H * 0.62);
  portal(W * 0.2, W * 0.12, H * 0.48);
  portal(W * 0.8, W * 0.12, H * 0.48);
  // The cypress at the top, with white doves.
  g.fillStyle = '#3f7a46';
  g.beginPath();
  g.moveTo(W / 2, 0);
  g.quadraticCurveTo(W / 2 + 26, H * 0.18, W / 2 + 14, H * 0.3);
  g.lineTo(W / 2 - 14, H * 0.3);
  g.quadraticCurveTo(W / 2 - 26, H * 0.18, W / 2, 0);
  g.fill();
  g.fillStyle = '#f4f1e8';
  for (let i = 0; i < 14; i++) g.fillRect(W / 2 - 14 + r() * 28, 10 + r() * H * 0.26, 4, 3);
  return finish(c);
}

/** A bell tower's stone, with rows of slit windows climbing it. */
export function towerStone({ seed = 23 } = {}) {
  const W = 128;
  const H = 512;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  g.fillStyle = '#c9b089';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(90, 70, 45, ${0.05 + r() * 0.08})`;
    g.fillRect(r() * W, r() * H, 2 + r() * 2, 30 + r() * 60);
  }
  g.fillStyle = '#4a3a2c';
  for (let y = 12; y < H - 30; y += 22) {
    for (let x = 0; x < 4; x++) {
      const sx = 10 + x * 32 + (Math.floor(y / 22) % 2) * 16;
      g.fillRect(sx % W, y, 7, 14);
    }
  }
  return finish(c);
}

/** Round glazed scales, pink to green to blue, for a dragon-backed roof. */
export function scales({ seed = 25 } = {}) {
  const W = 256;
  const H = 128;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  const pal = ['#e58fa8', '#d9a26a', '#9fc26a', '#5fb08a', '#3a8fc0', '#2f5fa8'];
  g.fillStyle = '#2a3a4a';
  g.fillRect(0, 0, W, H);
  const s = 16;
  for (let row = 0; row < H / (s * 0.6) + 1; row++) {
    for (let x = -s; x < W + s; x += s) {
      const cx = x + (row % 2 ? s / 2 : 0);
      const cy = row * s * 0.6;
      const t = Math.min(pal.length - 1, Math.floor((cx / W) * pal.length + (r() - 0.5) * 0.8));
      g.fillStyle = pal[Math.max(0, t)];
      g.beginPath();
      g.arc(cx, cy, s * 0.55, 0, Math.PI);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(cx - 3, cy + 2, 4, 2);
    }
  }
  return finish(c);
}

/** A round mosaic set in the pavement: bold shapes in red, yellow, blue and black. */
export function miro() {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.save();
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = '#f3efe4';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 1;
  for (let k = 0; k < S; k += 8) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k, S);
    g.moveTo(0, k);
    g.lineTo(S, k);
    g.stroke();
  }
  g.fillStyle = '#d8352a';
  g.beginPath();
  g.arc(92, 104, 44, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2d5fb4';
  g.beginPath();
  g.ellipse(176, 150, 38, 26, 0.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f2c230';
  g.beginPath();
  g.arc(150, 70, 26, 0.4, Math.PI * 1.6);
  g.fill();
  g.fillStyle = '#3c9a5f';
  g.beginPath();
  g.arc(84, 190, 14, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#151515';
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(40, 160);
  g.bezierCurveTo(100, 120, 140, 230, 210, 196);
  g.moveTo(128, 20);
  g.lineTo(128, 236);
  g.stroke();
  g.restore();
  g.strokeStyle = '#8a8070';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2);
  g.stroke();
  return finish(c);
}

/** A skyscraper's skin of glass panels, red at the foot rising to blue. */
export function glassTower() {
  const W = 128;
  const H = 256;
  const [c, g] = canvas(W, H);
  const grad = g.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, '#c2402f');
  grad.addColorStop(0.35, '#e08a3a');
  grad.addColorStop(0.6, '#5f8fd8');
  grad.addColorStop(1, '#2a4fa0');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 1;
  for (let y = 0; y < H; y += 8) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  for (let x = 0; x < W; x += 8) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  return finish(c);
}
