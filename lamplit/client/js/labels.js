// HTML labels that follow avatars: your own name, and short-lived bubbles for waves,
// cheers and finished sessions.

import * as THREE from '../vendor/three.module.min.js';

export class Labels {
  constructor(root) {
    this.root = root;
    this.v = new THREE.Vector3();
    this.bubbles = [];
    this.self = document.createElement('div');
    this.self.className = 'label self';
    this.self.hidden = true;
    root.append(this.self);
  }

  setSelf(text) {
    this.self.textContent = text;
  }

  bubble(id, html, ms = 2200, cls = '') {
    const el = document.createElement('div');
    el.className = `bubble ${cls}`;
    el.innerHTML = html;
    el.style.opacity = '0';
    this.root.append(el);
    const now = performance.now();
    this.bubbles.push({ id, el, born: now, until: now + ms });
    if (this.bubbles.length > 40) this.drop(0);
  }

  forget(id) {
    for (let i = this.bubbles.length - 1; i >= 0; i--) if (this.bubbles[i].id === id) this.drop(i);
  }

  clear() {
    while (this.bubbles.length) this.drop(0);
  }

  drop(i) {
    this.bubbles[i].el.remove();
    this.bubbles.splice(i, 1);
  }

  project(camera, w, h) {
    const v = this.v.project(camera);
    if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) return null;
    return [(v.x + 1) * 0.5 * w, (1 - v.y) * 0.5 * h];
  }

  update(camera, avatars, selfId, w, h, showSelf) {
    let at = showSelf && avatars.anchor(selfId, this.v) ? this.project(camera, w, h) : null;
    this.self.hidden = !at;
    if (at) this.self.style.transform = `translate3d(${at[0].toFixed(1)}px, ${(at[1] - 4).toFixed(1)}px, 0) translate(-50%, -100%)`;

    const now = performance.now();
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      if (now >= b.until) {
        this.drop(i);
        continue;
      }
      at = avatars.anchor(b.id, this.v) ? this.project(camera, w, h) : null;
      if (!at) {
        b.el.style.opacity = '0';
        continue;
      }
      const age = now - b.born;
      const life = b.until - b.born;
      const rise = Math.min(1, age / life) * 26;
      const fade = Math.min(1, age / 180, (life - age) / 400);
      b.el.style.opacity = fade.toFixed(2);
      b.el.style.transform = `translate3d(${at[0].toFixed(1)}px, ${(at[1] - 30 - rise).toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  }
}
