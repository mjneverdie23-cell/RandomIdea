// A small 3D stage for your avatar (Profile and Shop): drag to turn it around; it turns
// slowly on its own when left alone. Also renders the shop's item thumbnails.

import * as THREE from '../vendor/three.module.min.js';
import { Avatars } from './avatars.js';
import { itemGeometry, outfitBase } from './look.js';
import { ITEM, ITEMS, sanitizeLook } from '../shared/catalog.js';
import { SWEATERS } from '../shared/words.js';

function stageLights(scene) {
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2f45, 1.6));
  const key = new THREE.DirectionalLight(0xffe2b8, 2.2);
  key.position.set(1.5, 3, 2.5);
  const rim = new THREE.DirectionalLight(0x9fb4ff, 1.4);
  rim.position.set(-2, 2, -2);
  scene.add(key, rim);
}

export class Preview {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'preview-canvas';
    this.canvas.setAttribute('aria-label', 'Your avatar in 3D. Drag to turn it around.');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    stageLights(this.scene);
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.06, 48), new THREE.MeshStandardMaterial({ color: 0x2b2036, roughness: 0.6 }));
    stage.position.y = -0.03;
    this.scene.add(stage);
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.74, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.35, toneMapped: false }),
    );
    glow.position.y = 0.002;
    this.scene.add(glow);
    this.avatars = new Avatars(this.scene, 1);
    this.member = { id: 7, preview: true, pos: [0, 0], desk: -1, st: 0, yaw: 0, look: sanitizeLook({}) };
    this.avatars.add(this.member);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.yaw = 0.35;
    this.spin = 0;
    this.dragging = false;
    this.lastInput = 0;
    this.running = false;
    this.last = 0;

    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.dragX = e.clientX;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.dragX) * 0.012;
      this.dragX = e.clientX;
      this.lastInput = performance.now();
    });
    const end = () => {
      this.dragging = false;
      this.lastInput = performance.now();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  setLook(look) {
    this.member.look = sanitizeLook(look);
    this.member.lk = this.member.look;
  }

  /** Puts the canvas into `container` and starts drawing. */
  mount(container) {
    if (!container) return;
    container.append(this.canvas);
    this.resize();
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  unmount() {
    this.running = false;
    this.canvas.remove();
  }

  resize() {
    const r = this.canvas.parentElement?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }

  frame(t) {
    if (!this.running) return;
    if (!this.canvas.isConnected) {
      this.running = false;
      return;
    }
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    if (!this.dragging && t - this.lastInput > 2500) this.yaw += dt * 0.5;
    this.member.yaw = 0;
    this.avatars.update(0, t / 1000, dt);
    this.scene.rotation.y = this.yaw;
    const r = this.canvas.getBoundingClientRect();
    if (Math.abs(r.width / r.height - this.camera.aspect) > 0.01) this.resize();
    this.camera.position.set(0, 1.0, 3.3);
    this.camera.lookAt(0, 0.6, 0);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((tt) => this.frame(tt));
  }
}

// ------------------------------------------------------------------ thumbnails

const thumbCache = new Map();
const MANNEQUIN = {};
/** Thumbnails that depend on your sweater colour; the rest are drawn once. */
const TINTED = new Set(ITEMS.filter((it) => it.tint).map((it) => it.id));
const thumbKey = (id, color) => (TINTED.has(id) ? `${id}:${color}` : id);

/**
 * PNG data URLs for shop items. They are drawn with the preview's own renderer (briefly
 * resized, all within one task so nothing flickers) rather than a new WebGL context:
 * browsers cap live contexts and drop the oldest one, which would be the room itself.
 */
Preview.prototype.thumbnails = function thumbnails(ids, color = 0) {
  const missing = ids.filter((id) => !thumbCache.has(thumbKey(id, color)));
  if (missing.length) {
    const size = 160;
    const renderer = this.renderer;
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevRatio = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
    const tint = new THREE.MeshStandardMaterial({ color: SWEATERS[color] ?? SWEATERS[0], roughness: 0.8 });
    const vertex = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf3d3b8, roughness: 0.6 });
    // Mannequins are shared, and every material made here is freed afterwards, so opening
    // the shop many times doesn't pile up GPU memory.
    MANNEQUIN.body ??= new THREE.CapsuleGeometry(0.2, 0.26, 4, 16);
    MANNEQUIN.head ??= new THREE.SphereGeometry(0.2, 24, 16);
    const extra = [];
    const solid = (color) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
      extra.push(m);
      return m;
    };
    for (const id of missing) {
      const item = ITEM[id];
      const scene = new THREE.Scene();
      stageLights(scene);
      const group = new THREE.Group();
      const variant = item.cat === 'clothes' ? 'body' : item.cat === 'accessories' ? 'acc' : item.cat === 'pets' ? 'pet' : 'hand';
      if (item.cat === 'clothes') {
        const base = outfitBase(id);
        group.add(new THREE.Mesh(MANNEQUIN.body, base === null ? tint : solid(base)));
      } else if (item.cat === 'accessories' && ['hat', 'face', 'ears'].includes(item.slot)) {
        group.add(new THREE.Mesh(MANNEQUIN.head, skin));
      } else if (item.cat === 'accessories') {
        group.add(new THREE.Mesh(MANNEQUIN.body, solid(0x8fa3c7)));
      }
      const geo = itemGeometry(id, variant) ?? {};
      for (const [g, geom] of Object.entries(geo)) group.add(new THREE.Mesh(geom, g === 'fixed' ? vertex : g === 'tint' ? tint : g === 'hair' ? hair : skin));
      scene.add(group);
      const bounds = new THREE.Box3().setFromObject(group);
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const dir = new THREE.Vector3(0.55, 0.45, 1).normalize();
      const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05;
      camera.position.copy(sphere.center).addScaledVector(dir, dist);
      camera.lookAt(sphere.center);
      renderer.render(scene, camera);
      thumbCache.set(thumbKey(id, color), this.canvas.toDataURL('image/png'));
    }
    for (const m of [tint, vertex, hair, skin, ...extra]) m.dispose();
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
  }
  return ids.map((id) => thumbCache.get(thumbKey(id, color)) ?? '');
};
