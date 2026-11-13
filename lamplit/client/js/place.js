// One place on screen: its architecture and decoration (built by a recipe in scenes/),
// and every seat with its desk, chair and light. Lit lights glow with additive sprites
// rather than real lights, so a phone can draw a full room of them.
//
// Each seat kind ("kit") gets its own instanced desk, chair and lamp parts from the
// recipe's `styles`; notebooks, books, tea, glow pools, markers and hit boxes are shared
// by every seat in the place.

import * as THREE from '../vendor/three.module.min.js';
import { KITS, deskTop } from '../shared/layout.js';
import { LAMPS } from '../shared/words.js';
import * as tex from './textures.js';
import { HIDDEN, merge, box, cyl, instanced } from './geo.js';

const WHITE = new THREE.Color(1, 1, 1);
const HOVER = new THREE.Color(1.5, 1.38, 1.2);

const notebookGeo = () => merge([box(0.36, 0.01, 0.25, 0, 0.005, 0), box(0.005, 0.012, 0.25, 0, 0.006, 0), box(0.14, 0.012, 0.012, 0.12, 0.014, 0.05)]);
const booksGeo = () => merge([box(0.24, 0.05, 0.32, 0, 0.025, 0), box(0.22, 0.045, 0.3, 0.01, 0.073, 0.005), box(0.2, 0.05, 0.27, -0.005, 0.12, -0.01)]);
const teaGeo = () => merge([cyl(0.045, 0.036, 0.075, 14, 0, 0.0455, 0), cyl(0.075, 0.07, 0.008, 18, 0, 0.004, 0), new THREE.TorusGeometry(0.022, 0.007, 6, 12).translate(0.05, 0.05, 0)]);

export class PlaceView {
  /**
   * @param renderer the WebGL renderer (for texture settings)
   * @param place a place from shared/places.js
   * @param recipe function(view) that builds the architecture and sets `view.styles`
   */
  constructor(renderer, place, recipe) {
    this.place = place;
    this.kind = place.kind;
    this.desks = place.desks;
    this.N = place.desks.length;
    this.root = new THREE.Group();
    this.root.name = `place-${place.kind}`;
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.background = new THREE.Color(0x101010);
    this.fog = null;
    this.exposure = 1.1;
    /** Camera presets: default pitch and distance, how far it may turn, and the splash orbit. */
    this.cam = { pitch: 0.56, minPitch: 0.3, dist: 13, minDist: 4, maxDist: 26, yawLimit: 1.1, far: 140, arrive: {}, splash: { x: 0, z: 2, dist: 21, pitch: 0.48, swing: 0.35 } };
    this.updaters = [];
    this.cullers = [];
    this.doorPicks = [];
    /** Big things outdoors the camera slides in front of rather than passing through. */
    this.camBlockers = [];
    this.floors = [];
    this.clocks = [];
    this.board = null;
    this.extras = [];
    this.styles = {};

    const N = this.N;
    this.level = new Float32Array(N);
    this.target = new Float32Array(N);
    this.flicker = new Float32Array(N);
    this.occupied = new Uint8Array(N);
    this.teaOn = new Uint8Array(N);
    this.animating = new Set();
    this.hovered = -1;
    this.markersOn = false;
    this.ownDesk = -1;
    this.tmpColor = new THREE.Color();
    this.tmpMatrix = new THREE.Matrix4();
    this.tmpLocal = new THREE.Matrix4();
    this.tmpVec = new THREE.Vector3();
    this.clockSecond = -1;

    /** Each seat's frame: translate to the seat, turn by its rotation. */
    this.frames = this.desks.map((d) => new THREE.Matrix4().makeRotationY(d.rot).setPosition(d.x, 0, d.z));

    recipe(this);
    this.buildSeats();
    for (let i = 0; i < N; i++) this.paintLamp(i);
  }

  /** A point in seat i's frame, as a matrix (written into `out`). */
  local(i, x, y, z, out = this.tmpMatrix) {
    return out.multiplyMatrices(this.frames[i], this.tmpLocal.makeTranslation(x, y, z));
  }

  /** World position of a point in seat i's frame. */
  localPoint(i, x, y, z, out = this.tmpVec) {
    return out.set(x, y, z).applyMatrix4(this.frames[i]);
  }

  // ------------------------------------------------------------------ seats

  buildSeats() {
    const N = this.N;
    const root = this.root;
    this.seatStyle = new Array(N);
    this.seatIndex = new Int32Array(N);
    const byKit = new Map();
    for (const d of this.desks) {
      if (!byKit.has(d.kit)) byKit.set(d.kit, []);
      byKit.get(d.kit).push(d.i);
    }
    const m = this.tmpMatrix;
    for (const [kit, list] of byKit) {
      const st = this.styles[kit];
      if (!st) throw new Error(`no style for ${kit} seats in ${this.kind}`);
      const n = list.length;
      if (st.desk) st.deskMesh = instanced(st.desk.geo, st.desk.mat, n);
      if (st.chair) st.chairMesh = instanced(st.chair.geo, st.chair.mat, n);
      if (st.lamp) {
        st.bodyMesh = st.lamp.body ? instanced(st.lamp.body.geo, st.lamp.body.mat, n) : null;
        st.shadeMesh = st.lamp.shade ? instanced(st.lamp.shade.geo, st.lamp.shade.mat, n) : null;
        st.bulbMesh = instanced(st.lamp.bulb.geo, st.lamp.bulb.mat ?? new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n);
        st.bulbOn = new THREE.Color(st.lamp.on ?? 0xfff2cf);
        st.bulbOff = new THREE.Color(st.lamp.off ?? 0x2a2a30);
        st.glow = new THREE.Color(st.lamp.glow ?? 0xffa94d);
      }
      list.forEach((i, li) => {
        this.seatStyle[i] = st;
        this.seatIndex[i] = li;
        if (st.deskMesh) {
          st.deskMesh.setMatrixAt(li, this.frames[i]);
          st.deskMesh.setColorAt(li, WHITE);
        }
        if (st.chairMesh) st.chairMesh.setMatrixAt(li, this.local(i, 0, 0, KITS[kit].chairZ, m));
        if (st.lamp) {
          const [lx, lz] = st.lamp.at;
          this.local(i, lx, deskTop(kit), lz, m);
          st.bodyMesh?.setMatrixAt(li, m);
          st.shadeMesh?.setMatrixAt(li, m);
          st.bulbMesh.setMatrixAt(li, m);
        }
      });
      for (const mesh of [st.deskMesh, st.chairMesh, st.bodyMesh, st.shadeMesh, st.bulbMesh]) {
        if (!mesh) continue;
        mesh.computeBoundingSphere();
        root.add(mesh);
      }
      if (st.shadeMesh) for (const i of list) this.setShade(i, 0);
      if (st.lamp?.flame) this.hasFlames = true;
    }

    const mat = (o) => new THREE.MeshStandardMaterial(o);
    this.notebooks = instanced(notebookGeo(), mat({ color: 0xece6d6, roughness: 0.9 }), N, { dynamic: true });
    this.books = instanced(booksGeo(), mat({ color: 0xffffff, roughness: 0.85 }), N);
    this.teaMesh = instanced(teaGeo(), mat({ color: 0xf4f1ea, roughness: 0.3 }), N, { dynamic: true });
    const glowTex = tex.glow();
    const additive = (opts) =>
      new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, ...opts });
    this.deskPool = instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), additive({}), N);
    this.floorPool = instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), additive({}), N);
    this.deskPool.renderOrder = 2;
    this.floorPool.renderOrder = 1;
    this.markers = instanced(
      new THREE.OctahedronGeometry(0.075),
      new THREE.MeshBasicMaterial({ color: 0x8fe3d2, transparent: true, opacity: 0.9, toneMapped: false }),
      N,
      { dynamic: true },
    );
    this.pick = instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }), N);

    const haloPos = new Float32Array(N * 3);
    this.haloColor = new Float32Array(N * 3);
    const palette = [0x8b3a3a, 0x3a5a8b, 0x3a7a5a, 0x9a7a3a, 0x6a4a7a, 0x7a6a5a];
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (const d of this.desks) {
      const i = d.i;
      const st = this.seatStyle[i];
      const [pw, ph, pd, pz] = st.pick;
      this.pick.setMatrixAt(i, this.tmpLocal.copy(this.frames[i]).multiply(m.compose(p.set(0, ph / 2, pz), q.identity(), s.set(pw, ph, pd))));
      if (st.books) {
        const [bx, bz, bs] = st.books;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (((i * 37) % 11) - 5) * 0.04);
        this.books.setMatrixAt(i, this.tmpLocal.copy(this.frames[i]).multiply(m.compose(p.set(bx, deskTop(d.kit), bz), q, s.setScalar(bs ?? 1))));
        this.books.setColorAt(i, this.tmpColor.setHex(palette[i % palette.length]));
      } else {
        this.books.setMatrixAt(i, HIDDEN);
        this.books.setColorAt(i, WHITE);
      }
      this.notebooks.setMatrixAt(i, HIDDEN);
      this.teaMesh.setMatrixAt(i, HIDDEN);
      this.markers.setMatrixAt(i, HIDDEN);
      if (st.lamp) {
        const pool = st.lamp.pool;
        this.deskPool.setMatrixAt(i, this.tmpLocal.copy(this.frames[i]).multiply(m.compose(p.set(pool[0], deskTop(d.kit) + 0.004, pool[1]), q.identity(), s.set(pool[2], 1, pool[3]))));
        const fl = st.lamp.floor;
        this.floorPool.setMatrixAt(i, this.tmpLocal.copy(this.frames[i]).multiply(m.compose(p.set(fl[0], 0.012, fl[1]), q.identity(), s.set(fl[2], 1, fl[2]))));
        const [lx, lz] = st.lamp.at;
        const h = this.localPoint(i, lx + (st.lamp.halo?.[0] ?? 0), deskTop(d.kit) + (st.lamp.halo?.[1] ?? 0.27), lz + (st.lamp.halo?.[2] ?? 0));
        haloPos.set([h.x, h.y, h.z], i * 3);
      } else {
        this.deskPool.setMatrixAt(i, HIDDEN);
        this.floorPool.setMatrixAt(i, HIDDEN);
        haloPos.set([d.x, -10, d.z], i * 3);
      }
    }
    this.pick.computeBoundingSphere();
    this.books.computeBoundingSphere();

    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPos, 3));
    this.haloAttr = new THREE.BufferAttribute(this.haloColor, 3);
    haloGeo.setAttribute('color', this.haloAttr);
    this.halos = new THREE.Points(
      haloGeo,
      new THREE.PointsMaterial({ size: this.haloSize ?? 1.1, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false }),
    );
    this.halos.renderOrder = 3;
    for (const mesh of [this.notebooks, this.teaMesh, this.markers, this.halos, this.deskPool, this.floorPool]) mesh.frustumCulled = false;
    root.add(this.notebooks, this.books, this.teaMesh, this.floorPool, this.deskPool, this.markers, this.pick, this.halos);

    // The visitor's own lamp is a real light so their desk looks properly lit.
    this.ownLight = new THREE.PointLight(0xffb15c, 0, 4.5, 1.6);
    root.add(this.ownLight);
  }

  // ------------------------------------------------------------------ showing

  show(scene, renderer) {
    scene.add(this.root);
    this.root.updateMatrixWorld(true);
    scene.background = this.background;
    scene.fog = this.fog;
    renderer.toneMappingExposure = this.exposure;
  }

  hide(scene) {
    scene.remove(this.root);
  }

  setQuality(q) {
    for (const o of this.extras) o.visible = q !== 'low';
  }

  // ------------------------------------------------------------------ seat state

  setShade(i, lampStyle) {
    const st = this.seatStyle[i];
    if (!st?.shadeMesh) return;
    const color = st.lamp.shadeColor ? st.lamp.shadeColor(lampStyle) : (LAMPS[lampStyle] ?? LAMPS[0]).shade;
    st.shadeMesh.setColorAt(this.seatIndex[i], this.tmpColor.setHex(color));
    st.shadeMesh.instanceColor.needsUpdate = true;
  }

  /** Someone sits at seat i: show their lamp style, and their notebook unless they brought work. */
  setOccupied(i, lampStyle, notebook = true) {
    if (i < 0 || i >= this.N) return;
    this.occupied[i] = 1;
    const st = this.seatStyle[i];
    const at = st.notebook;
    this.notebooks.setMatrixAt(i, notebook && at ? this.local(i, at[0], deskTop(this.desks[i].kit), at[1]) : HIDDEN);
    this.notebooks.instanceMatrix.needsUpdate = true;
    this.setShade(i, lampStyle);
  }

  setFree(i) {
    if (i < 0 || i >= this.N) return;
    this.occupied[i] = 0;
    this.notebooks.setMatrixAt(i, HIDDEN);
    this.notebooks.instanceMatrix.needsUpdate = true;
    this.setShade(i, 0);
    this.setLamp(i, false);
    this.setTea(i, false);
  }

  setLamp(i, on, { instant = false } = {}) {
    if (i < 0 || i >= this.N || !this.seatStyle[i].lamp) return;
    const t = on ? 1 : 0;
    if (this.target[i] === t && !instant) return;
    this.target[i] = t;
    if (instant) {
      this.level[i] = t;
      this.paintLamp(i);
      return;
    }
    if (on) this.flicker[i] = this.seatStyle[i].lamp.flicker ?? 0.35;
    this.animating.add(i);
  }

  setTea(i, on) {
    if (i < 0 || i >= this.N) return;
    const at = this.seatStyle[i].tea;
    if (!at || this.teaOn[i] === (on ? 1 : 0)) return;
    this.teaOn[i] = on ? 1 : 0;
    this.teaMesh.setMatrixAt(i, on ? this.local(i, at[0], deskTop(this.desks[i].kit), at[1]) : HIDDEN);
    this.teaMesh.instanceMatrix.needsUpdate = true;
  }

  setHover(i) {
    if (i === this.hovered) return;
    const paint = (k, color) => {
      const st = this.seatStyle[k];
      if (!st?.deskMesh) return;
      st.deskMesh.setColorAt(this.seatIndex[k], color);
      st.deskMesh.instanceColor.needsUpdate = true;
    };
    if (this.hovered >= 0) paint(this.hovered, WHITE);
    this.hovered = i;
    if (i >= 0) paint(i, HOVER);
  }

  /** Floating markers over free seats, shown while the visitor is looking for one. */
  setMarkers(on) {
    this.markersOn = on;
    if (!on) {
      for (let i = 0; i < this.N; i++) this.markers.setMatrixAt(i, HIDDEN);
      this.markers.instanceMatrix.needsUpdate = true;
    }
  }

  setOwnDesk(i) {
    this.ownDesk = i;
    const st = i >= 0 ? this.seatStyle[i] : null;
    if (st?.lamp) {
      const [lx, lz] = st.lamp.at;
      const p = this.localPoint(i, lx, deskTop(this.desks[i].kit) + 0.24, lz + 0.05);
      this.ownLight.position.copy(p);
      this.ownLight.color.copy(st.glow);
    }
  }

  isRest(i) {
    return Boolean(this.desks[i]?.rest);
  }

  paintLamp(i) {
    const st = this.seatStyle[i];
    if (!st?.lamp) return;
    const li = this.seatIndex[i];
    const v = Math.max(0, Math.min(1, this.level[i]));
    const c = this.tmpColor;
    st.bulbMesh.setColorAt(li, c.copy(st.bulbOff).lerp(st.bulbOn, v));
    const k = st.lamp.strength ?? 1;
    this.deskPool.setColorAt(i, c.copy(st.glow).multiplyScalar(v * 0.95 * k));
    this.floorPool.setColorAt(i, c.copy(st.glow).multiplyScalar(v * 0.3 * k));
    c.copy(st.glow).multiplyScalar(v * 0.8 * k);
    this.haloColor[i * 3] = c.r;
    this.haloColor[i * 3 + 1] = c.g;
    this.haloColor[i * 3 + 2] = c.b;
    st.bulbMesh.instanceColor.needsUpdate = true;
    this.deskPool.instanceColor.needsUpdate = true;
    this.floorPool.instanceColor.needsUpdate = true;
    this.haloAttr.needsUpdate = true;
  }

  // ------------------------------------------------------------------ picking

  /**
   * The seat under the pointer. Hit boxes overlap on screen (each is tall enough to
   * include a seated person's head), so among every seat the ray passes through, choose
   * the one whose centre is closest to the pointer on screen.
   */
  pickDesk(raycaster, camera, pointerNdc) {
    const hits = raycaster.intersectObject(this.pick, false);
    if (hits.length === 0) return -1;
    if (!camera) return hits[0].instanceId;
    let best = -1;
    let bestD = Infinity;
    const v = new THREE.Vector3();
    for (const h of hits) {
      const d = this.desks[h.instanceId];
      v.set((d.x + d.seat.x) / 2, 0.9, (d.z + d.seat.z) / 2).project(camera);
      const dist = Math.hypot((v.x - pointerNdc.x) * camera.aspect, v.y - pointerNdc.y);
      if (dist < bestD) {
        bestD = dist;
        best = h.instanceId;
      }
    }
    return best;
  }

  pickFloor(raycaster) {
    const hit = raycaster.intersectObjects(this.floors, false)[0];
    return hit ? hit.point : null;
  }

  /** The door (a place kind to go to) under the pointer, if any. */
  pickDoor(raycaster) {
    const hit = raycaster.intersectObjects(this.doorPicks, false)[0];
    return hit ? hit.object.userData.door : null;
  }

  /** Hides things on the camera's side of the room so they never block the view. */
  cullFor(camera) {
    for (const c of this.cullers) c.object.visible = c.test(camera.position);
  }

  // ------------------------------------------------------------------ per frame

  update(dt, time) {
    for (const i of this.animating) {
      const t = this.target[i];
      let v = this.level[i] + (t - this.level[i]) * Math.min(1, dt * (t > this.level[i] ? 9 : 5));
      if (Math.abs(t - v) < 0.01) v = t;
      this.level[i] = v;
      if (this.flicker[i] > 0) {
        this.flicker[i] -= dt;
        if (this.flicker[i] > 0.12) this.level[i] = Math.random() < 0.5 ? 0.15 : 0.8;
      }
      this.paintLamp(i);
      if (v === t && this.flicker[i] <= 0) this.animating.delete(i);
    }
    // Flames (oil lamps) keep flickering while they burn.
    if (this.hasFlames) {
      const c = this.tmpColor;
      for (let i = 0; i < this.N; i++) {
        const st = this.seatStyle[i];
        const v = this.level[i];
        if (!st.lamp?.flame || v < 0.05 || this.animating.has(i)) continue;
        const f = 0.8 + 0.12 * Math.sin(time * 9 + i * 1.7) + 0.08 * Math.sin(time * 21 + i);
        c.copy(st.glow).multiplyScalar(v * 0.8 * (st.lamp.strength ?? 1) * f);
        this.haloColor[i * 3] = c.r;
        this.haloColor[i * 3 + 1] = c.g;
        this.haloColor[i * 3 + 2] = c.b;
      }
      this.haloAttr.needsUpdate = true;
    }
    const own = this.ownDesk >= 0 ? this.level[this.ownDesk] : 0;
    this.ownLight.intensity = own * 2.4 * (this.hasFlames ? 0.9 + 0.1 * Math.sin(time * 11) : 1);

    if (this.markersOn) {
      const m = this.tmpMatrix;
      for (const d of this.desks) {
        if (this.occupied[d.i]) {
          this.markers.setMatrixAt(d.i, HIDDEN);
        } else {
          m.makeRotationY(time * 1.2 + d.i);
          m.setPosition(d.seat.x, (d.rest ? 1.05 : 1.25) + Math.sin(time * 2 + d.i * 0.7) * 0.06, d.seat.z);
          this.markers.setMatrixAt(d.i, m);
        }
      }
      this.markers.instanceMatrix.needsUpdate = true;
    }

    for (const fn of this.updaters) fn(dt, time);

    if (this.clocks.length) {
      const now = new Date();
      if (now.getSeconds() !== this.clockSecond) {
        this.clockSecond = now.getSeconds();
        for (const c of this.clocks) c(now);
      }
    }
  }

  /** Redraws the room board (if the place has one): a title and up to two figures. */
  drawBoard(data) {
    this.board?.(data);
  }
}

/** Draws an analog clock face onto a dynamic texture. */
export function clockDrawer(dyn, { face = '#efe7d2', ink = '#2a1d14', second = '#a8443a' } = {}) {
  return (date) => {
    const { ctx: g, texture, canvas } = dyn;
    const size = canvas.width;
    const c = size / 2;
    const k = size / 256;
    g.clearRect(0, 0, size, size);
    g.fillStyle = face;
    g.beginPath();
    g.arc(c, c, 126 * k, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = ink;
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const r0 = (i % 5 === 0 ? 100 : 110) * k;
      g.lineWidth = (i % 5 === 0 ? 5 : 2) * k;
      g.beginPath();
      g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0);
      g.lineTo(c + Math.sin(a) * 118 * k, c - Math.cos(a) * 118 * k);
      g.stroke();
    }
    const hand = (angle, len, width, color) => {
      g.strokeStyle = color;
      g.lineWidth = width * k;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(c - Math.sin(angle) * 14 * k, c + Math.cos(angle) * 14 * k);
      g.lineTo(c + Math.sin(angle) * len * k, c - Math.cos(angle) * len * k);
      g.stroke();
    };
    const s = date.getSeconds();
    const mnt = date.getMinutes() + s / 60;
    const h = (date.getHours() % 12) + mnt / 60;
    hand((h / 12) * Math.PI * 2, 58, 9, ink);
    hand((mnt / 60) * Math.PI * 2, 88, 6, ink);
    hand((s / 60) * Math.PI * 2, 96, 2, second);
    g.fillStyle = ink;
    g.beginPath();
    g.arc(c, c, 8 * k, 0, Math.PI * 2);
    g.fill();
    texture.needsUpdate = true;
  };
}
