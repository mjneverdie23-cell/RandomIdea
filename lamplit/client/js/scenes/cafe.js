// The coffee shop: golden afternoon light through tall windows, a brick wall behind the
// counter, an espresso machine, pastries, pendant lights and string lights, a long
// communal table, little tables for two and a lounge with a sofa and a piano.

import * as THREE from '../../vendor/three.module.min.js';
import { DESK_TOP } from '../../shared/layout.js';
import * as tex from '../textures.js';
import { Decor, decorMaterials, parts, merge, floorPlane, wallPlane } from '../geo.js';
import { HALF, plant, rug, sunbeam, sunPatch, motes, door, wallClock, roomBoard, signMesh, chairParts, stoolParts, shadowDecal, wallSides, box, cyl, sphere, xform } from './common.js';

const WALNUT = 0x7a4b2c;
const IRON = 0x2b2a2c;
const CREAM = 0xf3ead9;

export function cafe(view) {
  const P = view.place;
  const W = P.width;
  const D = P.depth;
  const H = P.wallHeight;
  const root = view.root;
  const mats = decorMaterials();
  const decor = new Decor();
  const walls = wallSides(view, W, D);

  view.background = new THREE.Color(0x5a3d2b);
  view.fog = new THREE.Fog(0x5a3d2b, 34, 70);
  view.exposure = 1.05;
  view.haloSize = 0.8;
  // You arrive by the door on the right, so the camera starts looking across toward the windows.
  Object.assign(view.cam, { pitch: 0.62, dist: 11.5, maxDist: 22, yawLimit: 1.1, spawnYaw: 0.78, splash: { x: -1, z: 1, dist: 17, pitch: 0.55, swing: 0.4 } });

  // ---------------------------------------------------------------- light
  root.add(new THREE.HemisphereLight(0xfff0d8, 0x7a5236, 1.45));
  root.add(new THREE.AmbientLight(0xffe7cc, 0.32));
  const sun = new THREE.DirectionalLight(0xffd193, 2.4);
  sun.position.set(-20, 11, 5);
  sun.target.position.set(2, 0, -1);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.35);
  fill.position.set(12, 8, 10);
  root.add(sun, sun.target, fill);

  // ---------------------------------------------------------------- floor & walls
  const floorTex = tex.herringbone({ hue: 31, sat: 46, light: 50, repeat: [5, 4.5] });
  floorTex.anisotropy = view.aniso;
  const floor = new THREE.Mesh(floorPlane(W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55 }));
  root.add(floor);
  view.floors.push(floor);

  const brickMat = new THREE.MeshStandardMaterial({ map: tex.brick({ base: '#b0603f', repeat: [8, 2.4] }), roughness: 0.9 });
  const sage = (repeat) =>
    new THREE.MeshStandardMaterial({ map: tex.plaster({ top: '#c4cfb0', bottom: '#b4c19f', panel: '#6e4a30', rail: '#57391f', wainscot: 1.05 / H, repeat: [repeat, 1] }), roughness: 0.95 });
  const cream = (repeat) =>
    new THREE.MeshStandardMaterial({ map: tex.plaster({ top: '#f6ecda', bottom: '#efe2c9', panel: '#6e4a30', rail: '#57391f', wainscot: 0.95 / H, repeat: [repeat, 1] }), roughness: 0.95 });
  root.add(
    new THREE.Mesh(wallPlane(W, H, 0, H / 2, -D / 2), brickMat),
    new THREE.Mesh(wallPlane(W, H, 0, H / 2, D / 2, Math.PI), sage(6)),
    new THREE.Mesh(wallPlane(D, H, -W / 2, H / 2, 0, HALF), cream(6)),
    new THREE.Mesh(wallPlane(D, H, W / 2, H / 2, 0, -HALF), sage(6)),
  );
  for (const [side, w, x, z, ry] of [['front', W, 0, -D / 2 + 0.08, 0], ['back', W, 0, D / 2 - 0.08, 0], ['left', D, -W / 2 + 0.08, 0, HALF], ['right', D, W / 2 - 0.08, 0, HALF]]) {
    walls[side].decor.add('matte', 0x57391f, box(w, 0.16, 0.16), [x, H - 0.08, z], ry);
  }

  // ---------------------------------------------------------------- windows onto the street
  const view1 = tex.streetView({ seed: 6 });
  const paneGeos = [];
  const winZ = [-5.4, -1.8, 1.8, 5.4];
  for (const z of winZ) {
    paneGeos.push(new THREE.PlaneGeometry(3.4, 3.1).rotateY(HALF).translate(-W / 2 + 0.02, 2.55, z));
    // Black steel frames with a grid of muntins.
    const f = (g) => walls.left.decor.add('gloss', IRON, g);
    f(box(0.1, 3.3, 0.1, -W / 2 + 0.06, 2.55, z - 1.75));
    f(box(0.1, 3.3, 0.1, -W / 2 + 0.06, 2.55, z + 1.75));
    f(box(0.1, 0.1, 3.6, -W / 2 + 0.06, 4.15, z));
    f(box(0.1, 0.1, 3.6, -W / 2 + 0.06, 0.95, z));
    f(box(0.06, 3.1, 0.04, -W / 2 + 0.05, 2.55, z));
    f(box(0.06, 0.04, 3.4, -W / 2 + 0.05, 3.3, z));
  }
  root.add(new THREE.Mesh(merge(paneGeos), new THREE.MeshBasicMaterial({ map: view1, color: 0xfff6e6 })));
  // Plants hanging above the windows.
  for (const z of [-3.6, 0, 3.6]) {
    const l = walls.left.decor;
    l.add('matte', IRON, cyl(0.006, 0.006, 0.7, 4), [-W / 2 + 0.5, 4.5, z]);
    l.add('matte', 0xd9c7a8, cyl(0.16, 0.12, 0.2, 12), [-W / 2 + 0.5, 4.08, z]);
    l.add('leaf', 0x4f8a42, new THREE.IcosahedronGeometry(0.24, 1), [-W / 2 + 0.5, 4.08, z]);
    for (let k = 0; k < 4; k++) l.add('leaf', 0x5f9a4c, new THREE.IcosahedronGeometry(0.09, 0), [-W / 2 + 0.5 + Math.cos(k) * 0.2, 3.85 - k * 0.14, z + Math.sin(k * 2) * 0.2]);
  }

  // Golden light pouring in.
  const sunlit = [];
  for (const z of winZ) {
    sunlit.push(sunbeam(root, [-W / 2 + 0.2, 3.9, z], [-5.2, z + 0.9], 2.9, { color: 0xffe0a6, opacity: 0.075 }));
    sunlit.push(sunPatch(root, -7.4, z + 0.7, 3.4, 2.8, { color: 0xffd38a, opacity: 0.2 }));
  }
  view.extras.push(...sunlit);
  motes(view, { x: -7, z: 0, w: 7, d: 15, y0: 0.5, y1: 4.2, count: 220, color: 0xffe0b0 });

  // ---------------------------------------------------------------- the window counter
  decor.add('matte', WALNUT, box(0.62, 0.05, 11.4), [-W / 2 + 0.31, DESK_TOP - 0.025, 0]);
  for (let z = -5.4; z <= 5.4; z += 1.8) decor.add('gloss', IRON, box(0.4, 0.04, 0.04), [-W / 2 + 0.2, DESK_TOP - 0.1, z]);

  // ---------------------------------------------------------------- the counter
  const cz = -8.45;
  decor.add('matte', WALNUT, box(10.6, 0.98, 0.7), [0.5, 0.49, cz]);
  for (let x = -4.6; x <= 5.6; x += 0.25) decor.add('matte', 0x6a3f24, box(0.04, 0.84, 0.02), [x, 0.5, cz + 0.36]);
  decor.add('gloss', 0xe9e6e0, box(10.8, 0.06, 0.82), [0.5, 1.01, cz]);
  // Back counter and shelves on the brick.
  decor.add('matte', 0x6a3f24, box(10.4, 0.92, 0.6), [0.5, 0.46, -D / 2 + 0.3]);
  decor.add('gloss', 0xe9e6e0, box(10.5, 0.05, 0.64), [0.5, 0.945, -D / 2 + 0.32]);
  for (const y of [2.05, 2.6]) {
    decor.add('matte', 0x7a4b2c, box(3.2, 0.05, 0.3), [-3.4, y, -D / 2 + 0.16]);
    decor.add('matte', 0x7a4b2c, box(3.2, 0.05, 0.3), [4.6, y, -D / 2 + 0.16]);
    for (let k = 0; k < 8; k++) {
      const mx = -4.8 + k * 0.4;
      decor.add('gloss', [0xf3efe6, 0xd96c4a, 0x5a8f9a, 0xf3efe6][k % 4], cyl(0.06, 0.055, 0.12, 12), [mx, y + 0.085, -D / 2 + 0.16]);
      const jx = 3.2 + k * 0.4;
      decor.add('glass', 0xf2e7d0, cyl(0.07, 0.07, 0.2, 12), [jx, y + 0.125, -D / 2 + 0.16]);
      decor.add('matte', [0x5b3a1f, 0x3f2a18, 0xc9a26a][k % 3], cyl(0.065, 0.065, 0.12, 12), [jx, y + 0.085, -D / 2 + 0.16]);
    }
  }
  // Espresso machine with cups on top.
  const ex = -2.4;
  decor.add('gloss', 0xd8d8dc, box(0.95, 0.5, 0.55), [ex, 1.29, cz - 0.05]);
  decor.add('gloss', 0x9a2f2a, box(0.97, 0.12, 0.57), [ex, 1.6, cz - 0.05]);
  for (const s of [-0.25, 0.25]) {
    decor.add('gloss', 0x6c6c72, cyl(0.06, 0.06, 0.1, 12), [ex + s, 1.12, cz + 0.17]);
    decor.add('matte', 0x1d1d1f, box(0.05, 0.03, 0.22), [ex + s, 1.09, cz + 0.3]);
  }
  for (let k = 0; k < 6; k++) decor.add('gloss', CREAM, cyl(0.045, 0.035, 0.07, 12), [ex - 0.35 + k * 0.14, 1.7, cz - 0.05]);
  // Grinders, the till and a jar of biscotti.
  for (const gx of [-1.35, -0.95]) {
    decor.add('gloss', 0x2b2a2c, box(0.22, 0.34, 0.26), [gx, 1.21, cz - 0.1]);
    decor.add('glass', 0xc89a6a, cyl(0.1, 0.06, 0.26, 12), [gx, 1.51, cz - 0.1]);
  }
  decor.add('matte', 0x2b2a2c, box(0.36, 0.05, 0.28), [1.4, 1.07, cz]);
  decor.add('glow', 0xcfe9ff, box(0.3, 0.2, 0.02), [1.4, 1.2, cz - 0.06]);
  decor.add('glass', 0xffffff, cyl(0.11, 0.11, 0.26, 14), [0.6, 1.17, cz + 0.15]);
  // The pastry case.
  decor.add('matte', 0x6a3f24, box(1.9, 0.12, 0.7), [4.4, 1.1, cz]);
  decor.add('glass', 0xe8f4ff, box(1.9, 0.62, 0.7), [4.4, 1.47, cz]);
  decor.add('gloss', 0xf1f1f1, box(1.85, 0.02, 0.65), [4.4, 1.43, cz]);
  for (let k = 0; k < 5; k++) {
    decor.add('matte', 0xe2a64a, xform(new THREE.TorusGeometry(0.07, 0.035, 6, 10, Math.PI), [3.7 + k * 0.33, 1.2, cz - 0.05], [HALF, 0, 0]));
    decor.add('matte', [0xf2c4ce, 0x6b3a2a, 0xf7f0e0, 0x9b4a6a, 0xe9c46a][k], cyl(0.09, 0.09, 0.09, 14), [3.7 + k * 0.33, 1.49, cz + 0.08]);
  }
  // Menu boards above the back counter; the middle one shows the room.
  roomBoard(view, 0.5, 3.35, -D / 2 + 0.06, { w: 3.6, h: 1.55, style: 'cafe', parent: walls.front.group });
  const menuL = tex.sign({ text: 'Coffee', sub: 'Latte · Americano · Flat white', w: 512, h: 256, bg: '#232220', fg: '#f6eedc', border: '#b98d5a' });
  const menuR = tex.sign({ text: '커피 · 차', sub: 'Tea · Cocoa · Pastries', w: 512, h: 256, bg: '#232220', fg: '#f6eedc', border: '#b98d5a' });
  signMesh(view, menuL, 2.2, 1.1, -3.4, 3.35, -D / 2 + 0.06, 0, { parent: walls.front.group });
  signMesh(view, menuR, 2.2, 1.1, 4.4, 3.35, -D / 2 + 0.06, 0, { parent: walls.front.group });
  for (const x of [-3.4, 0.5, 4.4]) walls.front.decor.add('matte', 0x57391f, box(x === 0.5 ? 3.8 : 2.4, 0.08, 0.08), [x, x === 0.5 ? 4.17 : 3.95, -D / 2 + 0.08]);

  // ---------------------------------------------------------------- pendants and string lights
  const glowPts = [];
  const pendant = (x, z, y = 2.75, big = false) => {
    const r = big ? 0.26 : 0.17;
    decor.add('matte', IRON, cyl(0.008, 0.008, H - y, 4), [x, y + (H - y) / 2, z]);
    decor.add('gloss', big ? 0x2b2a2c : 0xb88a4a, new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, HALF), [x, y, z]);
    decor.add('glow', 0xfff0c8, sphere(r * 0.42, 10, 8), [x, y - r * 0.18, z]);
    glowPts.push(x, y - r * 0.4, z);
  };
  for (const x of [-2.4, 0.5, 3.4]) pendant(x, cz + 0.2, 2.6, true);
  for (const z of [-3.0, 0, 3.0]) pendant(P.longTable.x, z, 2.5);
  for (const [tx, tz] of P.twoTops) pendant(tx, tz, 2.45);
  // String lights swagging along the top of the sage walls.
  const swag = (side, x0, z0, x1, z1, n) => {
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const y = H - 0.45 - Math.sin(t * Math.PI * 4) ** 2 * 0.35;
      const p = [x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t];
      walls[side].decor.add('glow', 0xffd892, sphere(0.035, 6, 5), p);
      pts.push(...p);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const halo = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.45, map: tex.glow(), color: 0xffc77a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    walls[side].group.add(halo);
    view.extras.push(halo);
  };
  swag('left', -W / 2 + 0.25, -D / 2 + 0.3, -W / 2 + 0.25, D / 2 - 0.3, 40);
  swag('right', W / 2 - 0.25, D / 2 - 0.3, W / 2 - 0.25, -D / 2 + 0.3, 40);

  // ---------------------------------------------------------------- tables
  for (const [tx, tz] of P.twoTops) {
    decor.add('gloss', IRON, cyl(0.035, 0.035, DESK_TOP - 0.06, 8), [tx, (DESK_TOP - 0.06) / 2, tz]);
    decor.add('gloss', IRON, cyl(0.22, 0.26, 0.04, 16), [tx, 0.02, tz]);
    shadowDecal(root, tx, tz, 1.4, 2.3, 0.2);
  }
  const lt = P.longTable;
  for (const z of [lt.z0 + 0.25, 0, lt.z1 - 0.25]) {
    for (const s of [-0.55, 0.55]) decor.add('matte', 0x5a3520, box(0.1, DESK_TOP - 0.06, 0.1), [lt.x + s, (DESK_TOP - 0.06) / 2, z]);
  }
  decor.add('matte', 0x5a3520, box(0.08, 0.1, lt.z1 - lt.z0 - 0.4), [lt.x, 0.18, 0]);
  shadowDecal(root, lt.x, 0, 3.2, 9.6, 0.18);
  // A jar of flowers down the middle of the long table.
  for (const z of [-2.4, 0.6, 3.0]) {
    decor.add('glass', 0xdff0ff, cyl(0.06, 0.05, 0.16, 12), [lt.x, DESK_TOP + 0.08, z]);
    for (let k = 0; k < 5; k++) decor.add('matte', [0xf28482, 0xffd166, 0xffffff, 0xcdb4db, 0xf4a261][k], sphere(0.04, 8, 6), [lt.x + Math.cos(k * 1.3) * 0.05, DESK_TOP + 0.26 + (k % 2) * 0.04, z + Math.sin(k * 1.3) * 0.05]);
  }

  // ---------------------------------------------------------------- the lounge
  // Green velvet sofa against the right wall.
  decor.group(
    [
      ['matte', 0x2f6b55, box(3.0, 0.42, 0.95, 0, 0.21, 0)],
      ['matte', 0x2f6b55, box(3.0, 0.62, 0.22, 0, 0.72, 0.38)],
      ['matte', 0x2a5e4b, box(0.22, 0.62, 0.95, -1.45, 0.42, 0)],
      ['matte', 0x2a5e4b, box(0.22, 0.62, 0.95, 1.45, 0.42, 0)],
      ['matte', 0x3a7d64, box(1.3, 0.12, 0.7, -0.66, 0.48, -0.05)],
      ['matte', 0x3a7d64, box(1.3, 0.12, 0.7, 0.66, 0.48, -0.05)],
      ['matte', 0xe9c46a, box(0.4, 0.36, 0.12, -1.0, 0.72, 0.18)],
    ],
    [10.5, 0, -4.1],
    -HALF,
  );
  decor.add('matte', 0x6a3f24, box(0.9, 0.08, 1.2), [8.85, 0.42, -4.1]);
  for (const [x, z] of [[8.5, -4.6], [9.2, -4.6], [8.5, -3.6], [9.2, -3.6]]) decor.add('matte', 0x6a3f24, box(0.06, 0.4, 0.06), [x, 0.2, z]);
  decor.add('gloss', CREAM, cyl(0.045, 0.035, 0.08, 12), [8.7, 0.5, -3.9]);
  decor.add('matte', 0x9b3b36, box(0.2, 0.04, 0.28), [9.0, 0.48, -4.4]);
  const armchair = (x, z, ry, color) =>
    decor.group(
      [
        ['matte', color, box(0.82, 0.4, 0.78, 0, 0.3, 0)],
        ['matte', color, box(0.82, 0.62, 0.18, 0, 0.75, 0.32)],
        ['matte', new THREE.Color(color).offsetHSL(0, 0, -0.06), box(0.14, 0.3, 0.78, -0.41, 0.55, 0)],
        ['matte', new THREE.Color(color).offsetHSL(0, 0, -0.06), box(0.14, 0.3, 0.78, 0.41, 0.55, 0)],
        ['matte', 0x4a2e1c, box(0.7, 0.1, 0.66, 0, 0.05, 0)],
      ],
      [x, 0, z],
      ry,
    );
  armchair(7.3, -4.8, -HALF, 0xd9a441);
  armchair(7.3, -3.3, -HALF, 0xd9a441);
  rug(root, 3.2, 4.2, 28, 8.6, -4.1, { y: 0.006 });
  // A floor lamp by the sofa.
  decor.add('gloss', 0xb88a4a, cyl(0.02, 0.02, 1.6, 8), [10.55, 0.8, -6.0]);
  decor.add('gloss', 0xb88a4a, cyl(0.16, 0.2, 0.03, 14), [10.55, 0.015, -6.0]);
  decor.add('glow', 0xffe2b0, cyl(0.18, 0.26, 0.3, 16), [10.55, 1.7, -6.0]);
  glowPts.push(10.55, 1.7, -6.0);
  // Reading corner: a little round table and two armchairs.
  decor.add('matte', 0x6a3f24, cyl(0.4, 0.4, 0.04, 20), [5.2, 0.62, 1.6]);
  decor.add('matte', 0x6a3f24, cyl(0.04, 0.06, 0.6, 8), [5.2, 0.3, 1.6]);
  decor.add('gloss', CREAM, cyl(0.045, 0.035, 0.08, 12), [5.1, 0.68, 1.5]);
  armchair(6.4, 3.0, Math.PI * 0.8, 0xc0624a);
  armchair(4.0, 3.0, -Math.PI * 0.8, 0xc0624a);
  // A bookshelf and a clock on the right wall.
  const shelfTex = tex.shelfOfBooks({ wood: '#6e4a30', back: '#3f2a1a', rows: 4, repeat: [2, 1], seed: 41 });
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.2, 3.6), [new THREE.MeshStandardMaterial({ color: 0x6e4a30 }), new THREE.MeshStandardMaterial({ map: shelfTex, roughness: 0.85 }), ...Array(4).fill(new THREE.MeshStandardMaterial({ color: 0x6e4a30 }))]);
  shelf.position.set(W / 2 - 0.2, 1.1, 0.4);
  root.add(shelf);
  view.cullers.push({ object: shelf, test: (c) => c.x < W / 2 - 0.4 });
  plant(walls.right.decor, W / 2 - 0.25, 1.4, 0.2, { tall: 0.6 });
  wallClock(view, W / 2 - 0.05, 3.5, 0.4, { radius: 0.5, ry: -HALF, rim: 0x2b2a2c, parent: walls.right.group });
  // An upright piano by the back wall.
  const px = -7.65;
  decor.add('matte', 0x5a3523, box(2.1, 1.25, 0.6), [px, 0.625, 9.4]);
  decor.add('gloss', 0x4a2a1a, box(2.15, 0.06, 0.64), [px, 1.28, 9.4]);
  decor.add('matte', 0xf4f1ea, box(1.9, 0.04, 0.2), [px, 0.8, 9.05]);
  for (let k = 0; k < 14; k++) decor.add('matte', 0x111111, box(0.04, 0.03, 0.12), [px - 0.85 + k * 0.13, 0.83, 9.02]);
  decor.add('matte', 0x5a3523, box(0.9, 0.48, 0.38), [px, 0.24, 8.5]);
  decor.add('gloss', 0xc9a45c, cyl(0.05, 0.06, 0.2, 10), [px - 0.55, 1.41, 9.4]);
  decor.add('glow', 0xfff0c8, sphere(0.05, 8, 6), [px - 0.55, 1.55, 9.4]);
  for (let k = 0; k < 3; k++) decor.add('matte', [0x9b3b36, 0x2f5687, 0xe9c46a][k], box(0.3, 0.04, 0.22), [px + 0.5, 1.33 + k * 0.04, 9.4], k * 0.3);
  // Framed prints.
  [['back', 3.6, 2.8, D / 2 - 0.04, Math.PI, 5], ['back', -3.0, 2.6, D / 2 - 0.04, Math.PI, 8], ['back', -6.2, 2.9, D / 2 - 0.04, Math.PI, 13], ['right', W / 2 - 0.04, 2.7, -6.8, -HALF, 21]].forEach(([side, x, y, z, ry, seed]) => {
    signMesh(view, tex.poster({ seed }), 0.8, 1.2, x, y, z, ry, { parent: walls[side].group });
    walls[side].decor.add('matte', 0x2b2a2c, box(0.94, 1.34, 0.03), [x - Math.sin(ry) * 0.012, y, z - Math.cos(ry) * 0.012], ry);
  });

  // ---------------------------------------------------------------- plants
  plant(decor, -10.35, -9.35, 0.42, { tall: 1.3 });
  plant(decor, -10.35, 9.35, 0.42, { tall: 1.1 });
  plant(decor, 10.35, -9.35, 0.48, { tall: 1.5, pot: 0xe9e1d2 });
  plant(decor, 10.35, 9.35, 0.42, { tall: 1.2, pot: 0xe9e1d2 });

  // ---------------------------------------------------------------- the door out to the square
  const dz = P.doors[0].z;
  // The door stays visible even when the camera looks in through this wall.
  const right = walls.right;
  decor.add('matte', 0x57391f, box(0.2, 2.9, 0.18), [W / 2 - 0.1, 1.45, dz - 1.0]);
  decor.add('matte', 0x57391f, box(0.2, 2.9, 0.18), [W / 2 - 0.1, 1.45, dz + 1.0]);
  decor.add('matte', 0x57391f, box(0.2, 0.18, 2.2), [W / 2 - 0.1, 2.9, dz]);
  decor.add('glow', 0xfdf2d8, box(0.03, 2.5, 1.7), [W / 2 - 0.06, 1.3, dz]);
  decor.add('gloss', 0xb88a4a, box(0.06, 0.06, 0.5), [W / 2 - 0.12, 1.1, dz - 0.5]);
  decor.add('gloss', 0xc9a45c, xform(new THREE.ConeGeometry(0.07, 0.1, 12, 1, true), [W / 2 - 0.2, 2.72, dz - 0.9], [Math.PI, 0, 0]));
  const open = tex.sign({ text: 'OPEN', sub: '영업 중', w: 256, h: 128, bg: '#1d1410', fg: '#ffcf7a', glow: '#ff9a3a' });
  signMesh(view, open, 0.55, 0.28, W / 2 - 0.08, 1.9, dz + 0.35, -HALF, { glow: true, parent: right.group });
  const out = tex.sign({ text: 'Town square →', sub: '광장으로 나가기', w: 512, h: 160, bg: '#2b2a2c', fg: '#f6eedc', border: '#b98d5a' });
  signMesh(view, out, 1.4, 0.44, W / 2 - 0.06, 3.35, dz, -HALF, { parent: right.group });
  rug(root, 1.4, 2.2, 20, W / 2 - 1.0, dz, { y: 0.006 });
  door(view, 'square', { x: W / 2 - 0.3, z: dz, arrowY: 3.95, arrowRot: HALF, color: 0xffd38a });
  view.tags = [{ kind: 'square', at: [W / 2 - 0.4, 4.45, dz] }];

  // Soft halos around every bulb.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(glowPts, 3));
  const halos = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.55, map: tex.glow(), color: 0xffc77a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  root.add(halos);
  view.extras.push(halos);

  // ---------------------------------------------------------------- seats
  const walnut = new THREE.MeshStandardMaterial({ color: 0x8a5733, roughness: 0.45 });
  const marble = new THREE.MeshStandardMaterial({ color: 0xf1eee8, roughness: 0.25, metalness: 0.05 });
  const vertex = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const bistro = { geo: parts(chairParts(0x3b2a20, 0x5a3a26)), mat: vertex };
  view.styles.bar = {
    desk: { geo: merge([box(0.8, 0.05, 0.45, 0, DESK_TOP - 0.025, 0)]), mat: walnut },
    chair: { geo: parts(stoolParts(0x5a3a26, IRON)), mat: vertex },
    lamp: mushroomLamp([0.26, -0.08]),
    notebook: [-0.05, 0.06],
    books: null,
    tea: [-0.28, 0.05],
    pick: [0.9, 1.4, 1.5, 0.3],
  };
  view.styles.cafe = {
    desk: { geo: merge([box(0.76, 0.04, 0.4, 0, DESK_TOP - 0.02, 0)]), mat: marble },
    chair: bistro,
    lamp: mushroomLamp([0.24, -0.1]),
    notebook: [-0.07, 0.04],
    books: null,
    tea: [-0.25, 0.07],
    pick: [0.95, 1.4, 1.6, 0.4],
  };
  view.styles.desk = {
    desk: { geo: merge([box(1.2, 0.06, 0.7, 0, DESK_TOP - 0.03, 0)]), mat: walnut },
    chair: bistro,
    lamp: mushroomLamp([0.33, -0.22]),
    notebook: [-0.06, 0.07],
    books: [-0.38, -0.13, 0.9],
    tea: [-0.42, 0.17],
    pick: [1.5, 1.4, 2.05, 0.36],
  };

  decor.build(root, mats);
  walls.build(mats);
}

/** Café shades: your lamp style as opal glass, amber, blue, rose or gold. */
const CAFE_SHADES = [0xf3e6cc, 0xd99a4a, 0x6f93c8, 0xd9879a, 0xf0cf6a];

/** A little mushroom-shaped table lamp: brass stem, a dome shade in your lamp colour. */
export function mushroomLamp(at) {
  return {
    at,
    shadeColor: (style) => CAFE_SHADES[style] ?? CAFE_SHADES[0],
    body: { geo: merge([cyl(0.06, 0.07, 0.02, 16, 0, 0.01, 0), cyl(0.012, 0.016, 0.16, 8, 0, 0.09, 0)]), mat: new THREE.MeshStandardMaterial({ color: 0xc9a45c, metalness: 0.6, roughness: 0.35 }) },
    shade: {
      geo: new THREE.SphereGeometry(0.12, 18, 8, 0, Math.PI * 2, 0, HALF).translate(0, 0.17, 0),
      mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, side: THREE.DoubleSide }),
    },
    bulb: { geo: new THREE.SphereGeometry(0.05, 12, 8).translate(0, 0.175, 0) },
    glow: 0xffb35c,
    on: 0xfff0d0,
    off: 0x5a4a3c,
    halo: [0, 0.16, 0],
    pool: [0.1, -0.02, 1.0, 0.85],
    floor: [0.1, 0.3, 2.4],
    strength: 0.9,
  };
}
