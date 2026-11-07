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
