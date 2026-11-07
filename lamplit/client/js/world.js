// The reading room: architecture, 100 instanced desks with lamps, and the effects that
// make lit lamps glow. Real lights are kept to a handful; lamp glow is faked with
// additive sprites so a phone can draw a full room of lit desks.

import * as THREE from '../vendor/three.module.min.js';
import { HALL, DESKS, DESK_COUNT, SHELF, PLANTS } from '../shared/layout.js';
import { LAMPS } from '../shared/words.js';
import * as tex from './textures.js';

const DESK_TOP = 0.76;
const LAMP = { x: 0.33, z: -0.16 };
const WARM = new THREE.Color(0xffa94d);
const BULB_ON = new THREE.Color(0xfff2cf);
const BULB_OFF = new THREE.Color(0x2a2a30);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

// ------------------------------------------------------------------ geometry helpers

/** Merges geometries with position/normal/uv into one indexed geometry. */
function merge(list) {
  let vertices = 0;
  let indices = 0;
  for (const g of list) {
    vertices += g.attributes.position.count;
    indices += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vertices * 3);
  const nor = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  const idx = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    const count = g.attributes.position.count;
    if (g.index) {
      const src = g.index.array;
      for (let k = 0; k < src.length; k++) idx[io + k] = src[k] + vo;
      io += src.length;
    } else {
      for (let k = 0; k < count; k++) idx[io + k] = k + vo;
      io += count;
    }
    vo += count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (rt, rb, h, seg, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z);

function instanced(geometry, material, count, { dynamic = false } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  if (dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

// ------------------------------------------------------------------ the room

export class World {
  constructor(renderer) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060914);
    this.scene.fog = new THREE.FogExp2(0x080c1c, 0.016);
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    this.level = new Float32Array(DESK_COUNT);
    this.target = new Float32Array(DESK_COUNT);
    this.flicker = new Float32Array(DESK_COUNT);
    this.occupied = new Uint8Array(DESK_COUNT);
    this.teaOn = new Uint8Array(DESK_COUNT);
    this.animating = new Set();
    this.hovered = -1;
    this.markersOn = false;
    this.ownDesk = -1;
    this.tmpColor = new THREE.Color();
    this.tmpMatrix = new THREE.Matrix4();
    this.clockSecond = -1;

    this.buildLights();
    this.buildRoom();
    this.buildDesks();
    this.buildAtmosphere();
    for (let i = 0; i < DESK_COUNT; i++) this.paintLamp(i);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x8494c8, 0x3a2818, 1.55));
    this.scene.add(new THREE.AmbientLight(0x343f63, 1.1));
    const moon = new THREE.DirectionalLight(0xa9b9ff, 1.25);
    moon.position.set(-8, 16, -18);
    moon.target.position.set(2, 0, 4);
    this.scene.add(moon, moon.target);
    // The visitor's own lamp is a real light so their desk looks properly lit.
    this.ownLight = new THREE.PointLight(0xffb15c, 0, 4.5, 1.6);
    this.scene.add(this.ownLight);
  }

  buildRoom() {
    const { width: W, depth: D, wallHeight: H } = HALL;
    const scene = this.scene;

    const floorTex = tex.woodFloor();
    floorTex.anisotropy = this.aniso;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: floorTex, color: 0xd2b49c, roughness: 0.7 }),
    );
    floor.name = 'floor';
    this.floor = floor;
    scene.add(floor);

    // Walls face inward, so a camera outside the room looks straight through the near one.
    const wallMat = (repeat) => {
      const t = tex.wall();
      t.repeat.set(repeat, 1);
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
    };
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat(7));
    front.position.set(0, H / 2, -D / 2);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateY(Math.PI), wallMat(7));
    back.position.set(0, H / 2, D / 2);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(D, H).rotateY(Math.PI / 2), wallMat(8.5));
    left.position.set(-W / 2, H / 2, 0);
    const right = new THREE.Mesh(new THREE.PlaneGeometry(D, H).rotateY(-Math.PI / 2), wallMat(8.5));
    right.position.set(W / 2, H / 2, 0);
    scene.add(front, back, left, right);

    // Tall windows on the front wall, with rain sliding down the glass.
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a1b12, roughness: 0.6 });
    this.rainTextures = [];
    for (const [x, moon] of [[-8, true], [8, false]]) {
      const w = 6.2;
      const h = 4.4;
      const cy = 3.4;
      const z = -D / 2 + 0.02;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex.nightSky({ moon, seed: moon ? 3 : 9 }) }));
      pane.position.set(x, cy, z);
      const rainTex = tex.rain();
      this.rainTextures.push(rainTex);
      const rainPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: rainTex, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      rainPlane.position.set(x, cy, z + 0.02);
      const t = 0.16;
      const frame = merge([
        box(w + t * 2, t, 0.14, x, cy + h / 2 + t / 2, z + 0.05),
        box(w + t * 2, t, 0.3, x, cy - h / 2 - t / 2, z + 0.12),
        box(t, h, 0.14, x - w / 2 - t / 2, cy, z + 0.05),
        box(t, h, 0.14, x + w / 2 + t / 2, cy, z + 0.05),
        box(0.06, h, 0.08, x - w / 6, cy, z + 0.04),
        box(0.06, h, 0.08, x + w / 6, cy, z + 0.04),
        box(w, 0.06, 0.08, x, cy + h / 6, z + 0.04),
        box(w, 0.06, 0.08, x, cy - h / 6, z + 0.04),
      ]);
      scene.add(pane, rainPlane, new THREE.Mesh(frame, frameMat));
    }

    // Small high windows along the side walls.
    const skyTex = tex.nightSky({ seed: 15 });
    const highGeos = [];
    for (const z of [-10.5, -3.5, 3.5, 10.5]) {
      for (const side of [-1, 1]) {
        const g = new THREE.PlaneGeometry(1.5, 2.1).rotateY(side < 0 ? Math.PI / 2 : -Math.PI / 2);
        g.translate(side * (W / 2 - 0.02), 4.9, z);
        highGeos.push(g);
      }
    }
    scene.add(new THREE.Mesh(merge(highGeos), new THREE.MeshBasicMaterial({ map: skyTex, color: 0xb8c4ff })));

    // Clock and room board between the windows.
    this.clock = tex.dynamic(256, 256);
    const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.85, 48), new THREE.MeshBasicMaterial({ map: this.clock.texture }));
    clockFace.position.set(0, 5.55, -D / 2 + 0.04);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.06, 10, 48), new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 0.6, roughness: 0.35 }));
    rim.position.copy(clockFace.position);
    this.board = tex.dynamic(1024, 440);
    const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.65, 2.0), new THREE.MeshBasicMaterial({ map: this.board.texture }));
    boardMesh.position.set(0, 3.0, -D / 2 + 0.04);
    const boardFrame = merge([
      box(4.95, 0.15, 0.1, 0, 4.07, -D / 2 + 0.05),
      box(4.95, 0.15, 0.22, 0, 1.93, -D / 2 + 0.1),
      box(0.15, 2.0, 0.1, -2.4, 3.0, -D / 2 + 0.05),
      box(0.15, 2.0, 0.1, 2.4, 3.0, -D / 2 + 0.05),
    ]);
    scene.add(clockFace, rim, boardMesh, new THREE.Mesh(boardFrame, frameMat));
    this.drawClock(new Date());
    this.drawBoard({ title: 'Lamplit', items: [] });

    // Bookshelves along both side walls; only the inward face shows books.
    const shelfLen = SHELF.zMax - SHELF.zMin;
    const shelfWood = new THREE.MeshStandardMaterial({ color: 0x2b1d14, roughness: 0.8 });
    this.shelves = [];
    for (const side of [-1, 1]) {
      const books = tex.bookshelf();
      books.anisotropy = this.aniso;
      const booksMat = new THREE.MeshStandardMaterial({ map: books, roughness: 0.85 });
      const mats = side < 0 ? [booksMat, shelfWood, shelfWood, shelfWood, shelfWood, shelfWood] : [shelfWood, booksMat, shelfWood, shelfWood, shelfWood, shelfWood];
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(SHELF.depth, SHELF.height, shelfLen), mats);
      shelf.position.set(side * (W / 2 - SHELF.depth / 2), SHELF.height / 2, (SHELF.zMin + SHELF.zMax) / 2);
      shelf.userData.side = side;
      this.shelves.push(shelf);
      scene.add(shelf);
    }

    // Rugs down the aisles and at the entrance.
    const rugMesh = (w, len, hue, x, z, alongX, y) => {
      const t = tex.rug(hue);
      t.repeat.set(1, Math.max(1, Math.round(len / 5)));
      const g = new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2);
      if (alongX) g.rotateY(Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
      m.position.set(x, y, z);
      return m;
    };
    scene.add(
      rugMesh(1.9, 24.5, 352, 0, 0.3, false, 0.004),
      rugMesh(1.7, 8.6, 352, -5.9, 0.3, true, 0.005),
      rugMesh(1.7, 8.6, 352, 5.9, 0.3, true, 0.005),
      rugMesh(3.6, 1.8, 24, 0, 15.4, false, 0.006),
    );

    // Potted plants.
    const pots = [];
    const leaves = [];
    for (const [x, z, r] of PLANTS) {
      pots.push(cyl(r * 0.8, r * 0.62, 0.5, 14, x, 0.25, z));
      leaves.push(new THREE.IcosahedronGeometry(r * 1.25, 1).translate(x, 0.95, z));
      leaves.push(new THREE.IcosahedronGeometry(r * 0.9, 1).translate(x + r * 0.35, 1.45, z - r * 0.2));
    }
    scene.add(new THREE.Mesh(merge(pots), new THREE.MeshStandardMaterial({ color: 0x8a4b2e, roughness: 0.9 })));
    scene.add(new THREE.Mesh(merge(leaves), new THREE.MeshStandardMaterial({ color: 0x2f5d3a, roughness: 0.8, flatShading: true })));
  }

  buildDesks() {
    const N = DESK_COUNT;
    const scene = this.scene;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();

    const deskGeo = merge([
      box(1.2, 0.05, 0.7, 0, DESK_TOP - 0.025, 0),
      box(0.05, 0.71, 0.05, -0.56, 0.355, -0.3),
      box(0.05, 0.71, 0.05, 0.56, 0.355, -0.3),
      box(0.05, 0.71, 0.05, -0.56, 0.355, 0.3),
      box(0.05, 0.71, 0.05, 0.56, 0.355, 0.3),
      box(1.1, 0.34, 0.02, 0, 0.52, -0.32),
      box(1.2, 0.2, 0.035, 0, DESK_TOP + 0.1, -0.335),
    ]);
    const chairGeo = merge([
      box(0.44, 0.05, 0.42, 0, 0.45, 0),
      box(0.42, 0.42, 0.04, 0, 0.69, 0.2),
      box(0.035, 0.45, 0.035, -0.19, 0.225, -0.18),
      box(0.035, 0.45, 0.035, 0.19, 0.225, -0.18),
      box(0.035, 0.9, 0.035, -0.19, 0.45, 0.19),
      box(0.035, 0.9, 0.035, 0.19, 0.45, 0.19),
    ]);
    const lampBodyGeo = merge([cyl(0.065, 0.075, 0.025, 16, 0, 0.0125, 0), cyl(0.011, 0.011, 0.27, 8, 0, 0.15, 0)]);
    // Half a cylinder lying along x with the curved side up: a banker's-lamp shade.
    const shadeGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.36, 16, 1, true, 0, Math.PI)
      .rotateZ(Math.PI / 2)
      .translate(0, 0.3, 0);
    const bulbGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.26, 8).rotateZ(Math.PI / 2).translate(0, 0.285, 0);
    const notebookGeo = merge([box(0.36, 0.01, 0.25, 0, 0.005, 0), box(0.005, 0.012, 0.25, 0, 0.006, 0), box(0.14, 0.012, 0.012, 0.12, 0.014, 0.05)]);
    const booksGeo = merge([box(0.24, 0.05, 0.32, 0, 0.025, 0), box(0.22, 0.045, 0.3, 0.01, 0.073, 0.005), box(0.2, 0.05, 0.27, -0.005, 0.12, -0.01)]);
    const teaGeo = merge([cyl(0.045, 0.036, 0.075, 14, 0, 0.0455, 0), cyl(0.075, 0.07, 0.008, 18, 0, 0.004, 0), new THREE.TorusGeometry(0.022, 0.007, 6, 12).translate(0.05, 0.05, 0)]);

    const mat = (o) => new THREE.MeshStandardMaterial(o);
    this.deskMesh = instanced(deskGeo, mat({ color: 0x6e4b34, roughness: 0.6 }), N);
    this.chairMesh = instanced(chairGeo, mat({ color: 0x4b3223, roughness: 0.7 }), N);
    this.lampBody = instanced(lampBodyGeo, mat({ color: 0xb08d57, metalness: 0.65, roughness: 0.35 }), N);
    this.shadeMesh = instanced(shadeGeo, mat({ color: 0xffffff, metalness: 0.25, roughness: 0.35, side: THREE.DoubleSide }), N);
    this.bulbMesh = instanced(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), N);
    this.notebooks = instanced(notebookGeo, mat({ color: 0xe9e3d3, roughness: 0.9 }), N, { dynamic: true });
    this.books = instanced(booksGeo, mat({ color: 0xffffff, roughness: 0.85 }), N);
    this.teaMesh = instanced(teaGeo, mat({ color: 0xf4f1ea, roughness: 0.3 }), N, { dynamic: true });

    const glowTex = tex.glow();
    const additive = (opts) =>
      new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, ...opts });
    this.deskPool = instanced(new THREE.PlaneGeometry(1.7, 1.25).rotateX(-Math.PI / 2), additive({}), N);
    this.floorPool = instanced(new THREE.PlaneGeometry(3.8, 3.8).rotateX(-Math.PI / 2), additive({}), N);
    this.deskPool.renderOrder = 2;
    this.floorPool.renderOrder = 1;

    this.markers = instanced(
      new THREE.OctahedronGeometry(0.075),
      new THREE.MeshBasicMaterial({ color: 0x8fe3d2, transparent: true, opacity: 0.85, toneMapped: false }),
      N,
      { dynamic: true },
    );
    this.pick = instanced(new THREE.BoxGeometry(1.5, 1.4, 2.05).translate(0, 0.7, 0.36), new THREE.MeshBasicMaterial({ visible: false }), N);

    const haloPos = new Float32Array(N * 3);
    this.haloColor = new Float32Array(N * 3);
    const bookColor = new THREE.Color();
    const palette = [0x8b3a3a, 0x3a5a8b, 0x3a7a5a, 0x9a7a3a, 0x6a4a7a, 0x7a6a5a];
    const white = new THREE.Color(1, 1, 1);
    for (const d of DESKS) {
      const i = d.i;
      m.makeTranslation(d.x, 0, d.z);
      this.deskMesh.setMatrixAt(i, m);
      this.pick.setMatrixAt(i, m);
      this.deskMesh.setColorAt(i, white);
      m.makeTranslation(d.x, 0, d.seat.z);
      this.chairMesh.setMatrixAt(i, m);
      m.makeTranslation(d.x + LAMP.x, DESK_TOP, d.z + LAMP.z);
      this.lampBody.setMatrixAt(i, m);
      this.shadeMesh.setMatrixAt(i, m);
      this.bulbMesh.setMatrixAt(i, m);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (((i * 37) % 11) - 5) * 0.04);
      m.compose(p.set(d.x - 0.38, DESK_TOP, d.z - 0.13), q, s);
      this.books.setMatrixAt(i, m);
      this.books.setColorAt(i, bookColor.setHex(palette[i % palette.length]));
      this.notebooks.setMatrixAt(i, HIDDEN);
      this.teaMesh.setMatrixAt(i, HIDDEN);
      this.markers.setMatrixAt(i, HIDDEN);
      m.makeTranslation(d.x + 0.12, DESK_TOP + 0.004, d.z - 0.04);
      this.deskPool.setMatrixAt(i, m);
      m.makeTranslation(d.x + 0.1, 0.012, d.z + 0.2);
      this.floorPool.setMatrixAt(i, m);
      haloPos.set([d.x + LAMP.x, DESK_TOP + 0.27, d.z + LAMP.z], i * 3);
      this.setShade(i, 0);
    }
    this.pick.computeBoundingSphere();

    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPos, 3));
    this.haloAttr = new THREE.BufferAttribute(this.haloColor, 3);
    haloGeo.setAttribute('color', this.haloAttr);
    this.halos = new THREE.Points(
      haloGeo,
      new THREE.PointsMaterial({ size: 1.1, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false }),
    );
    this.halos.renderOrder = 3;

    for (const mesh of [this.notebooks, this.teaMesh, this.markers]) mesh.frustumCulled = false;
    scene.add(this.deskMesh, this.chairMesh, this.lampBody, this.shadeMesh, this.bulbMesh, this.notebooks, this.books, this.teaMesh, this.floorPool, this.deskPool, this.markers, this.pick, this.halos);
  }

  buildAtmosphere() {
    // Moonlight falling from the windows.
    const shaftTex = tex.shaft();
    for (const x of [-8, 8]) {
      const shaft = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 13),
        new THREE.MeshBasicMaterial({ map: shaftTex, color: 0x7f95ff, transparent: true, opacity: 0.075, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      shaft.position.set(x, 3.0, -12.2);
      shaft.rotation.x = -1.02;
      this.scene.add(shaft);
    }
    // Dust drifting through the lamplight.
    const n = 380;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 24;
      pos[i * 3 + 1] = 0.4 + Math.random() * 4.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.045, color: 0xffe3b5, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.scene.add(this.dust);
  }

  // ------------------------------------------------------------------ desk state

  setShade(i, lampStyle) {
    this.shadeMesh.setColorAt(i, this.tmpColor.setHex((LAMPS[lampStyle] ?? LAMPS[0]).shade));
    this.shadeMesh.instanceColor.needsUpdate = true;
  }

  /** Someone sits at desk i: show their notebook and lamp style. */
  setOccupied(i, lampStyle) {
    this.occupied[i] = 1;
    this.notebooks.setMatrixAt(i, this.tmpMatrix.makeTranslation(DESKS[i].x - 0.06, DESK_TOP, DESKS[i].z + 0.07));
    this.notebooks.instanceMatrix.needsUpdate = true;
    this.setShade(i, lampStyle);
  }

  setFree(i) {
    this.occupied[i] = 0;
    this.notebooks.setMatrixAt(i, HIDDEN);
    this.notebooks.instanceMatrix.needsUpdate = true;
    this.setShade(i, 0);
    this.setLamp(i, false);
    this.setTea(i, false);
  }

  setLamp(i, on, { instant = false } = {}) {
    const t = on ? 1 : 0;
    if (this.target[i] === t && !instant) return;
    this.target[i] = t;
    if (instant) {
      this.level[i] = t;
      this.paintLamp(i);
      return;
    }
    if (on) this.flicker[i] = 0.35;
    this.animating.add(i);
  }

  setTea(i, on) {
    if (this.teaOn[i] === (on ? 1 : 0)) return;
    this.teaOn[i] = on ? 1 : 0;
    const d = DESKS[i];
    this.teaMesh.setMatrixAt(i, on ? this.tmpMatrix.makeTranslation(d.x - 0.42, DESK_TOP, d.z + 0.17) : HIDDEN);
    this.teaMesh.instanceMatrix.needsUpdate = true;
  }

  setHover(i) {
    if (i === this.hovered) return;
    const white = this.tmpColor.setRGB(1, 1, 1);
    if (this.hovered >= 0) this.deskMesh.setColorAt(this.hovered, white);
    this.hovered = i;
    if (i >= 0) this.deskMesh.setColorAt(i, this.tmpColor.setRGB(1.55, 1.4, 1.2));
    this.deskMesh.instanceColor.needsUpdate = true;
  }

  /** Floating markers over free desks, shown while the visitor is looking for a seat. */
  setMarkers(on) {
    this.markersOn = on;
    if (!on) {
      for (let i = 0; i < DESK_COUNT; i++) this.markers.setMatrixAt(i, HIDDEN);
      this.markers.instanceMatrix.needsUpdate = true;
    }
  }

  setOwnDesk(i) {
    this.ownDesk = i;
    if (i >= 0) {
      const d = DESKS[i];
      this.ownLight.position.set(d.x + LAMP.x, DESK_TOP + 0.24, d.z + LAMP.z + 0.05);
    }
  }

  paintLamp(i) {
    const v = Math.max(0, Math.min(1, this.level[i]));
    const c = this.tmpColor;
    this.bulbMesh.setColorAt(i, c.copy(BULB_OFF).lerp(BULB_ON, v));
    this.deskPool.setColorAt(i, c.copy(WARM).multiplyScalar(v * 0.95));
    this.floorPool.setColorAt(i, c.copy(WARM).multiplyScalar(v * 0.3));
    c.copy(WARM).multiplyScalar(v * 0.8);
    this.haloColor[i * 3] = c.r;
    this.haloColor[i * 3 + 1] = c.g;
    this.haloColor[i * 3 + 2] = c.b;
    this.bulbMesh.instanceColor.needsUpdate = true;
    this.deskPool.instanceColor.needsUpdate = true;
    this.floorPool.instanceColor.needsUpdate = true;
    this.haloAttr.needsUpdate = true;
  }

  // ------------------------------------------------------------------ picking

  /**
   * The desk under the pointer. Desk hit boxes overlap on screen (each is tall enough to
   * include a seated person's head), so among every desk the ray passes through, choose
   * the one whose centre is closest to the pointer on screen.
   */
  pickDesk(raycaster, camera, pointerNdc) {
    const hits = raycaster.intersectObject(this.pick, false);
    if (hits.length === 0) return -1;
    if (!camera) return hits[0].instanceId;
    let best = -1;
    let bestD = Infinity;
    const v = this.tmpVec ?? (this.tmpVec = new THREE.Vector3());
    for (const h of hits) {
      const d = DESKS[h.instanceId];
      v.set(d.x, 0.9, d.z + 0.25).project(camera);
      const dist = Math.hypot((v.x - pointerNdc.x) * camera.aspect, v.y - pointerNdc.y);
      if (dist < bestD) {
        bestD = dist;
        best = h.instanceId;
      }
    }
    return best;
  }

  pickFloor(raycaster) {
    const hit = raycaster.intersectObject(this.floor, false)[0];
    return hit ? hit.point : null;
  }

  /** Hide the side shelves when the camera swings outside that wall. */
  cullFor(camera) {
    for (const shelf of this.shelves) shelf.visible = camera.position.x * shelf.userData.side < HALL.width / 2 - 0.4;
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
    const own = this.ownDesk >= 0 ? this.level[this.ownDesk] : 0;
    this.ownLight.intensity = own * 2.4;

    for (const t of this.rainTextures) t.offset.y = (t.offset.y + dt * 0.16) % 1;

    const dust = this.dust.geometry.attributes.position;
    for (let i = 0; i < dust.count; i++) {
      let y = dust.array[i * 3 + 1] + dt * 0.03 * (0.4 + ((i * 13) % 7) / 7);
      if (y > 5) y = 0.4;
      dust.array[i * 3 + 1] = y;
      dust.array[i * 3] += Math.sin(time * 0.2 + i) * dt * 0.02;
    }
    dust.needsUpdate = true;

    if (this.markersOn) {
      const m = this.tmpMatrix;
      for (const d of DESKS) {
        if (this.occupied[d.i]) {
          this.markers.setMatrixAt(d.i, HIDDEN);
        } else {
          m.makeRotationY(time * 1.2 + d.i);
          m.setPosition(d.x, 1.25 + Math.sin(time * 2 + d.i * 0.7) * 0.06, d.seat.z);
          this.markers.setMatrixAt(d.i, m);
        }
      }
      this.markers.instanceMatrix.needsUpdate = true;
    }

    const now = new Date();
    if (now.getSeconds() !== this.clockSecond) {
      this.clockSecond = now.getSeconds();
      this.drawClock(now);
    }
  }

  drawClock(date) {
    const { ctx: g, texture } = this.clock;
    const c = 128;
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#efe7d2';
    g.beginPath();
    g.arc(c, c, 126, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#3b2a1d';
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      const r0 = k % 5 === 0 ? 100 : 110;
      g.lineWidth = k % 5 === 0 ? 5 : 2;
      g.beginPath();
      g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0);
      g.lineTo(c + Math.sin(a) * 118, c - Math.cos(a) * 118);
      g.stroke();
    }
    const hand = (angle, len, width, color) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(c - Math.sin(angle) * 14, c + Math.cos(angle) * 14);
      g.lineTo(c + Math.sin(angle) * len, c - Math.cos(angle) * len);
      g.stroke();
    };
    const s = date.getSeconds();
    const mnt = date.getMinutes() + s / 60;
    const h = (date.getHours() % 12) + mnt / 60;
    hand((h / 12) * Math.PI * 2, 58, 9, '#2a1d14');
    hand((mnt / 60) * Math.PI * 2, 88, 6, '#2a1d14');
    hand((s / 60) * Math.PI * 2, 96, 2, '#a8443a');
    g.fillStyle = '#2a1d14';
    g.beginPath();
    g.arc(c, c, 8, 0, Math.PI * 2);
    g.fill();
    texture.needsUpdate = true;
  }

  /** Redraws the room board: a title and up to two big figures with labels. */
  drawBoard({ title, items }) {
    const { ctx: g, texture, canvas } = this.board;
    const w = canvas.width;
    const h = canvas.height;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1d2b25');
    grad.addColorStop(1, '#16221d');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < 40; i++) g.fillRect((i * 97) % w, (i * 53) % h, 60, 2);
    g.fillStyle = 'rgba(240, 236, 220, 0.75)';
    g.font = '600 40px Georgia, "Nanum Myeongjo", serif';
    g.textAlign = 'center';
    g.fillText(title, w / 2, 70);
    g.fillStyle = 'rgba(240, 236, 220, 0.25)';
    g.fillRect(w / 2 - 140, 92, 280, 2);
    items.forEach((item, k) => {
      const x = items.length === 1 ? w / 2 : k === 0 ? w * 0.28 : w * 0.72;
      g.fillStyle = '#ffd38a';
      g.font = '700 132px Georgia, "Nanum Myeongjo", serif';
      g.fillText(item.value, x, 270);
      g.fillStyle = 'rgba(240, 236, 220, 0.8)';
      g.font = '500 36px system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
      g.fillText(item.label, x, 340);
    });
    texture.needsUpdate = true;
  }
}

export { DESK_TOP };
