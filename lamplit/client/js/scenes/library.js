// The library: a tall, sunlit reading room with long oak tables, green banker's lamps,
// bookshelves up the walls and arched windows full of sky.

import * as THREE from '../../vendor/three.module.min.js';
import { DESK_TOP } from '../../shared/layout.js';
import * as tex from '../textures.js';
import { Decor, decorMaterials, parts, merge, floorPlane, wallPlane } from '../geo.js';
import { HALF, plant, rug, sunbeam, sunPatch, motes, door, wallClock, roomBoard, signMesh, chairParts, shadowDecal, wallSides, box, cyl, sphere, xform } from './common.js';

const OAK = 0x9a6a42;
const DARK = 0x5a3a24;

export function library(view) {
  const P = view.place;
  const W = P.width;
  const D = P.depth;
  const H = P.wallHeight;
  const root = view.root;
  const mats = decorMaterials();
  const decor = new Decor();
  const walls = wallSides(view, W, D);

  view.background = new THREE.Color(0xeadfcb);
  view.fog = new THREE.Fog(0xeadfcb, 42, 90);
  view.exposure = 1.0;
  view.haloSize = 0.9;
  // You arrive by the door in the back-left corner, so the camera starts looking across the room.
  Object.assign(view.cam, { pitch: 0.58, dist: 13.5, yawLimit: 1.1, spawnYaw: -0.62, splash: { x: 0, z: 2, dist: 23, pitch: 0.52, swing: 0.35 } });

  // ---------------------------------------------------------------- light
  root.add(new THREE.HemisphereLight(0xfff6e6, 0x8a6a48, 1.6));
  root.add(new THREE.AmbientLight(0xfff1dc, 0.35));
  const sun = new THREE.DirectionalLight(0xffe6bd, 2.2);
  sun.position.set(-16, 20, -4);
  sun.target.position.set(3, 0, 2);
  const fill = new THREE.DirectionalLight(0xd9e6ff, 0.55);
  fill.position.set(14, 10, 14);
  root.add(sun, sun.target, fill);

  // ---------------------------------------------------------------- floor & walls
  const floorTex = tex.planks({ hue: 33, sat: 40, light: 63, repeat: [6, 7] });
  floorTex.anisotropy = view.aniso;
  const floor = new THREE.Mesh(floorPlane(W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6 }));
  root.add(floor);
  view.floors.push(floor);

  const wallMat = (repeat) =>
    new THREE.MeshStandardMaterial({ map: tex.plaster({ top: '#f4ead8', bottom: '#ece0c8', panel: '#8a5d3b', rail: '#6b4529', wainscot: 1.3 / H, repeat: [repeat, 1] }), roughness: 0.95 });
  root.add(
    new THREE.Mesh(wallPlane(W, H, 0, H / 2, -D / 2), wallMat(7)),
    new THREE.Mesh(wallPlane(W, H, 0, H / 2, D / 2, Math.PI), wallMat(7)),
    new THREE.Mesh(wallPlane(D, H, -W / 2, H / 2, 0, HALF), wallMat(8.5)),
    new THREE.Mesh(wallPlane(D, H, W / 2, H / 2, 0, -HALF), wallMat(8.5)),
  );
  // Crown moulding along the top of every wall.
  for (const [side, w, x, z, ry] of [['front', W, 0, -D / 2 + 0.1, 0], ['back', W, 0, D / 2 - 0.1, 0], ['left', D, -W / 2 + 0.1, 0, HALF], ['right', D, W / 2 - 0.1, 0, HALF]]) {
    walls[side].decor.add('matte', 0xe9dcc2, box(w, 0.3, 0.2), [x, H - 0.15, z], ry);
    walls[side].decor.add('matte', 0xd8c7a8, box(w, 0.12, 0.3), [x, H - 0.36, z], ry);
  }

  // ---------------------------------------------------------------- windows full of sky
  const skyTex = tex.sky({ seed: 2, horizon: 'trees' });
  const paneMat = new THREE.MeshBasicMaterial({ map: skyTex, color: 0xf2f6ff });
  const panes = [];
  const arched = (cx, cy, z, w, h, side) => {
    // side: 0 = front wall (faces +z), -1 = left wall (faces +x), 1 = right wall (faces -x)
    const ry = side === 0 ? 0 : side < 0 ? HALF : -HALF;
    const place = (g, lx, ly, lz) => {
      g.rotateY(ry);
      const [ox, oz] = side === 0 ? [lx, lz] : side < 0 ? [lz, -lx] : [-lz, lx];
      g.translate(cx + ox, ly, z + oz);
      return g;
    };
    panes.push(place(new THREE.PlaneGeometry(w, h), 0, cy, 0.02));
    panes.push(place(new THREE.CircleGeometry(w / 2, 24, 0, Math.PI), 0, cy + h / 2, 0.02));
    const t = 0.14;
    const frame = [
      place(box(w + t * 2, t, 0.16), 0, cy - h / 2 - t / 2, 0.06),
      place(box(t, h, 0.14), -w / 2 - t / 2, cy, 0.06),
      place(box(t, h, 0.14), w / 2 + t / 2, cy, 0.06),
      place(box(0.05, h, 0.08), 0, cy, 0.05),
      place(box(w, 0.05, 0.08), 0, cy + h / 6, 0.05),
      place(box(w, 0.05, 0.08), 0, cy - h / 6, 0.05),
      place(xform(new THREE.TorusGeometry(w / 2 + t / 2, t / 2, 6, 24, Math.PI), [0, 0, 0]), 0, cy + h / 2, 0.06),
      place(box(w + 0.5, 0.1, 0.36), 0, cy - h / 2 - t - 0.05, 0.16),
    ];
    const wallDecor = walls[side === 0 ? 'front' : side < 0 ? 'left' : 'right'].decor;
    for (const g of frame) wallDecor.add('matte', 0xf2e9d8, g);
  };
  for (const z of [-12, -6, 0, 6]) arched(-W / 2, 5.6, z, 2.1, 2.6, -1);
  for (const z of [-12, -6, 0, 6, 12]) arched(W / 2, 5.6, z, 2.1, 2.6, 1);
  for (const x of [-7.6, 7.6]) arched(x, 3.6, -D / 2, 3.2, 4.6, 0);
  root.add(new THREE.Mesh(merge(panes), paneMat));

  // Sunbeams from the left windows, and where they land.
  const beams = [];
  for (const z of [-12, -6, 0, 6]) {
    beams.push(sunbeam(root, [-W / 2 + 0.2, 6.4, z], [-2.2, z + 1.6], 2.0, { opacity: 0.085 }));
    beams.push(sunPatch(root, -3.4, z + 1.4, 3.2, 2.6, { opacity: 0.16 }));
  }
  for (const x of [-7.6, 7.6]) beams.push(sunbeam(root, [x, 4.6, -D / 2 + 0.2], [x * 0.8, -9.5], 2.8, { opacity: 0.06 }));
  view.extras.push(...beams);
  motes(view, { x: -6, z: -2, w: 12, d: 26, y0: 0.4, y1: 6, count: 320 });

  // ---------------------------------------------------------------- clock & board
  const front = walls.front;
  wallClock(view, 0, 6.8, -D / 2 + 0.05, { radius: 0.9, parent: front.group });
  roomBoard(view, 0, 3.4, -D / 2 + 0.05, { style: 'chalk', parent: front.group });
  front.decor.add('matte', 0x6b4529, box(4.95, 0.15, 0.1), [0, 4.47, -D / 2 + 0.05]);
  front.decor.add('matte', 0x6b4529, box(4.95, 0.15, 0.22), [0, 2.33, -D / 2 + 0.1]);
  front.decor.add('matte', 0x6b4529, box(0.15, 2.0, 0.1), [-2.4, 3.4, -D / 2 + 0.05]);
  front.decor.add('matte', 0x6b4529, box(0.15, 2.0, 0.1), [2.4, 3.4, -D / 2 + 0.05]);

  // ---------------------------------------------------------------- bookshelves
  const shelfWood = new THREE.MeshStandardMaterial({ color: 0x7a5032, roughness: 0.75 });
  for (const [minX, minZ, maxX, maxZ] of P.shelves) {
    const side = minX < 0 ? -1 : 1;
    const len = maxZ - minZ;
    const books = tex.shelfOfBooks({ wood: '#7a5032', back: '#4a2f1c', rows: 6, repeat: [Math.round(len / 2.2), 1] });
    books.anisotropy = view.aniso;
    const booksMat = new THREE.MeshStandardMaterial({ map: books, roughness: 0.85 });
    const faces = side < 0 ? [booksMat, shelfWood, shelfWood, shelfWood, shelfWood, shelfWood] : [shelfWood, booksMat, shelfWood, shelfWood, shelfWood, shelfWood];
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, 3.4, len), faces);
    shelf.position.set((minX + maxX) / 2, 1.7, (minZ + maxZ) / 2);
    root.add(shelf);
    const cap = new THREE.Mesh(box(0.8, 0.14, len + 0.1), shelfWood);
    cap.position.set((minX + maxX) / 2 - side * 0.06, 3.47, (minZ + maxZ) / 2);
    root.add(cap);
    view.cullers.push({ object: shelf, test: (c) => c.x * side < W / 2 - 0.4 }, { object: cap, test: (c) => c.x * side < W / 2 - 0.4 });
    // A rolling ladder on each run of shelves, on a brass rail.
    const near = walls[side < 0 ? 'left' : 'right'].decor;
    const lx = side * (W / 2 - 0.72);
    for (const lz of [-8.4, 3.8]) {
      for (const s of [-0.22, 0.22]) near.add('matte', DARK, box(0.05, 3.6, 0.05), [lx, 1.8, lz + s], 0);
      for (let k = 0; k < 9; k++) near.add('matte', DARK, box(0.05, 0.035, 0.44), [lx, 0.35 + k * 0.38, lz]);
    }
    near.add('gloss', 0xb08d57, xform(cyl(0.02, 0.02, len, 8), [side * (W / 2 - 0.66), 3.3, (minZ + maxZ) / 2], [HALF, 0, 0]));
  }

  // ---------------------------------------------------------------- reading tables
  for (const [tx, tz] of P.tables) {
    for (const lx of [-2.88, 0, 2.88]) for (const lz of [-0.6, 0.6]) decor.add('matte', DARK, box(0.09, DESK_TOP - 0.05, 0.09), [tx + lx, (DESK_TOP - 0.05) / 2, tz + lz]);
    decor.add('matte', DARK, box(5.9, 0.12, 0.05), [tx, DESK_TOP - 0.11, tz - 0.66]);
    decor.add('matte', DARK, box(5.9, 0.12, 0.05), [tx, DESK_TOP - 0.11, tz + 0.66]);
    decor.add('gloss', 0xc9a45c, box(6.0, 0.012, 0.03), [tx, DESK_TOP + 0.006, tz]);
    shadowDecal(root, tx, tz, 7.2, 3.4, 0.16);
  }

  // ---------------------------------------------------------------- the lobby
  // Librarian's desk with a computer, books and a lamp.
  decor.add('matte', 0x7a5032, box(5.0, 1.05, 1.1), [6.1, 0.525, 10.95]);
  decor.add('matte', 0x5a3a24, box(5.2, 0.06, 1.25), [6.1, 1.08, 10.95]);
  decor.add('matte', 0x8a6040, box(4.6, 0.7, 0.04), [6.1, 0.5, 11.52]);
  decor.add('matte', 0x2b2b30, box(0.5, 0.34, 0.04), [7.2, 1.33, 10.7]);
  decor.add('glow', 0xbfe3ff, box(0.44, 0.27, 0.01), [7.2, 1.33, 10.725]);
  decor.add('matte', 0x2b2b30, box(0.06, 0.16, 0.06), [7.2, 1.16, 10.66]);
  for (let k = 0; k < 4; k++) decor.add('matte', [0x9b3b36, 0x2f5687, 0x33775a, 0xb5893c][k], box(0.22, 0.05, 0.3), [4.3, 1.135 + k * 0.05, 10.9], k * 0.2);
  decor.add('gloss', 0xc9a45c, sphere(0.06, 12, 8), [5.2, 1.14, 10.6]);
  const info = tex.sign({ text: 'Information', sub: '안내', w: 512, h: 160, bg: '#1f5b44', fg: '#f4ead2', border: '#c9a45c' });
  signMesh(view, info, 1.5, 0.47, 6.1, 1.62, 10.33);
  // Reading nook: two armchairs, a table and a floor lamp.
  for (const [ax, ry] of [[9.75, HALF], [11.65, -HALF]]) {
    decor.group(
      [
        ['matte', 0x2f6b4f, box(0.8, 0.4, 0.75, 0, 0.3, 0)],
        ['matte', 0x2f6b4f, box(0.8, 0.6, 0.18, 0, 0.75, 0.3)],
        ['matte', 0x2a5d45, box(0.14, 0.32, 0.75, -0.4, 0.56, 0)],
        ['matte', 0x2a5d45, box(0.14, 0.32, 0.75, 0.4, 0.56, 0)],
        ['matte', DARK, box(0.7, 0.1, 0.65, 0, 0.05, 0)],
      ],
      [ax, 0, 14.4],
      ry,
    );
  }
  decor.add('matte', DARK, cyl(0.32, 0.32, 0.04, 20), [10.7, 0.56, 14.4]);
  decor.add('matte', DARK, cyl(0.04, 0.05, 0.54, 8), [10.7, 0.27, 14.4]);
  decor.add('gloss', 0xc9a45c, cyl(0.02, 0.02, 1.5, 8), [12.0, 0.75, 13.4]);
  decor.add('glow', 0xffe6b0, cyl(0.16, 0.24, 0.26, 16), [12.0, 1.6, 13.4]);
  // A globe on a stand.
  decor.add('matte', DARK, cyl(0.05, 0.22, 0.75, 10), [-10.4, 0.375, 8.8]);
  decor.add('gloss', 0x4a87b8, sphere(0.34, 20, 14), [-10.4, 1.12, 8.8]);
  decor.add('matte', 0x7fb069, sphere(0.2, 10, 8), [-10.25, 1.2, 9.05]);
  decor.add('gloss', 0xc9a45c, xform(new THREE.TorusGeometry(0.39, 0.015, 6, 28), [-10.4, 1.12, 8.8], [0, 0.6, 0.35]));

  // ---------------------------------------------------------------- the door out to the square
  const dz = 13;
  // The door stays visible even when the camera looks in through this wall.
  const left = walls.left;
  decor.add('matte', 0x5a3a24, box(0.22, 3.2, 0.2), [-W / 2 + 0.11, 1.6, dz - 1.1]);
  decor.add('matte', 0x5a3a24, box(0.22, 3.2, 0.2), [-W / 2 + 0.11, 1.6, dz + 1.1]);
  decor.add('matte', 0x5a3a24, box(0.22, 0.22, 2.4), [-W / 2 + 0.11, 3.2, dz]);
  for (const s of [-1, 1]) {
    decor.add('matte', 0x7a4a2c, box(0.08, 2.85, 0.96), [-W / 2 + 0.06, 1.43, dz + s * 0.5]);
    decor.add('glow', 0xeaf4ff, box(0.02, 1.2, 0.62), [-W / 2 + 0.11, 1.95, dz + s * 0.5]);
    decor.add('gloss', 0xc9a45c, box(0.05, 0.3, 0.04), [-W / 2 + 0.13, 1.25, dz + s * 0.1]);
  }
  decor.add('glow', 0xeaf4ff, box(0.02, 0.5, 2.0), [-W / 2 + 0.1, 3.0, dz]);
  const out = tex.sign({ text: 'Town square →', sub: '광장으로 나가기', w: 512, h: 160, bg: '#1f5b44', fg: '#f4ead2', border: '#c9a45c' });
  signMesh(view, out, 1.5, 0.47, -W / 2 + 0.14, 3.75, dz, HALF, { parent: left.group });
  rug(root, 1.6, 2.4, 160, -W / 2 + 1.2, dz, { y: 0.006 });
  door(view, 'square', { x: -W / 2 + 0.3, z: dz, arrowY: 4.4, arrowRot: HALF });
  view.tags = [{ kind: 'square', at: [-W / 2 + 0.4, 4.9, dz] }];

  // ---------------------------------------------------------------- chandeliers
  const bulbs = [];
  for (const z of [-9, -1.5, 6]) {
    for (const x of [0]) {
      decor.add('gloss', 0x2b2b2b, cyl(0.015, 0.015, H - 5.4, 6), [x, 5.4 + (H - 5.4) / 2, z]);
      decor.add('gloss', 0xc9a45c, xform(new THREE.TorusGeometry(0.75, 0.04, 8, 32), [x, 5.2, z], [HALF, 0, 0]));
      decor.add('gloss', 0xc9a45c, cyl(0.08, 0.14, 0.4, 12), [x, 5.3, z]);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const bx = x + Math.cos(a) * 0.75;
        const bz = z + Math.sin(a) * 0.75;
        decor.add('gloss', 0xf2ead8, cyl(0.03, 0.03, 0.16, 8), [bx, 5.3, bz]);
        decor.add('glow', 0xfff0c8, sphere(0.05, 8, 6), [bx, 5.43, bz]);
        bulbs.push(bx, 5.45, bz);
      }
    }
  }
  const bulbGeo = new THREE.BufferGeometry();
  bulbGeo.setAttribute('position', new THREE.Float32BufferAttribute(bulbs, 3));
  const sparkle = new THREE.Points(bulbGeo, new THREE.PointsMaterial({ size: 0.7, map: tex.glow(), color: 0xffd79a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  root.add(sparkle);
  view.extras.push(sparkle);

  // ---------------------------------------------------------------- rugs & plants
  rug(root, 2.0, 21, 352, 0, -3.2, { y: 0.004 });
  rug(root, 6.0, 4.0, 24, 0, 11.6, { y: 0.005, alongX: true });
  for (const [x, z, r] of P.circles.slice(1)) plant(decor, x, z, r, { tall: 1.25 });

  // ---------------------------------------------------------------- seats
  const wood = new THREE.MeshStandardMaterial({ color: OAK, roughness: 0.5 });
  const chairWood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  view.styles.desk = {
    desk: { geo: merge([box(1.2, 0.05, 0.7, 0, DESK_TOP - 0.025, 0)]), mat: wood },
    chair: { geo: parts(chairParts(0x6b4329, 0x7a5032)), mat: chairWood },
    lamp: bankersLamp(),
    notebook: [-0.06, 0.07],
    books: [-0.38, -0.13, 1],
    tea: [-0.42, 0.17],
    pick: [1.5, 1.4, 2.05, 0.36],
  };

  decor.build(root, mats);
  walls.build(mats);
}

/** The classic green-shaded banker's lamp. */
export function bankersLamp() {
  return {
    at: [0.33, -0.2],
    body: { geo: merge([cyl(0.065, 0.075, 0.025, 16, 0, 0.0125, 0), cyl(0.011, 0.011, 0.27, 8, 0, 0.15, 0)]), mat: new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 0.65, roughness: 0.35 }) },
    shade: {
      geo: new THREE.CylinderGeometry(0.08, 0.08, 0.36, 16, 1, true, 0, Math.PI).rotateZ(HALF).translate(0, 0.3, 0),
      mat: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.25, roughness: 0.35, side: THREE.DoubleSide }),
    },
    bulb: { geo: new THREE.CylinderGeometry(0.024, 0.024, 0.26, 8).rotateZ(HALF).translate(0, 0.285, 0) },
    glow: 0xffa94d,
    on: 0xfff2cf,
    off: 0x3a3a40,
    pool: [0.12, -0.04, 1.7, 1.25],
    floor: [0.1, 0.2, 3.4],
    strength: 0.85,
  };
}
