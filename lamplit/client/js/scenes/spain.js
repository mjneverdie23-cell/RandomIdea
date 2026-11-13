// Spain. Inside the basilica in Barcelona: a forest of stone columns that branch like
// trees towards the vaults, stained glass pouring blue and green light down one side and
// red and gold down the other, an altar under a hanging canopy, an organ, and two giant
// seashells for holy water by the door. Outside in Barcelona: the basilica's sculpted front
// and its spires (with a crane, still building it), a square with a pond, a Rambla of plane
// trees and flower stalls with a mosaic in the pavement, a winding mosaic bench and a
// mosaic dragon, a house of mosaic and a house of wavy stone among Eixample blocks with
// cut corners, palms, black-and-yellow taxis, a café terrace and green parakeets.

import * as THREE from '../../vendor/three.module.min.js';
import { DESK_TOP } from '../../shared/layout.js';
import * as tex from '../textures.js';
import { Decor, decorMaterials, parts, merge, floorPlane, wallPlane } from '../geo.js';
import { HALF, door, signMesh, shadowDecal, wallSides, sunbeam, sunPatch, motes, chairParts, box, cyl, sphere, xform } from './common.js';
import { outdoors, pickBox, fires, palm, spray, pigeons, blockCamera, blockShape, blockBox } from './outdoor.js';

const STONE = 0xdcd5c6;
const SANDSTONE = 0xc9b089;
const GOLD = 0xd9a93a;
const IRON = 0x2b2b30;
const WARM = ['#e0442f', '#f2763a', '#f6b83a', '#f6d85a', '#c9342f'];
const COOL = ['#2a6fd1', '#3fb0c9', '#4fbf72', '#9ad1e8', '#1d4f9a', '#2f9a7a'];
const AMBER = ['#f6d85a', '#f2b23a', '#fff1a8', '#e8a03a', '#f6c85a'];
const TILES = [0x2f6fb8, 0x3c9a5f, 0xe8b23a, 0xd9573c, 0x7fc3e0, 0xf4f1e8];

/** A glass lantern on a wrought-iron stand; its faceted globe takes your lamp colour. */
function glassLantern() {
  return {
    at: [0.34, -0.17],
    body: {
      geo: merge([
        cyl(0.06, 0.075, 0.025, 12, 0, 0.0125, 0),
        cyl(0.01, 0.014, 0.12, 6, 0, 0.08, 0),
        cyl(0.035, 0.03, 0.03, 8, 0, 0.29, 0),
        xform(new THREE.TorusGeometry(0.03, 0.007, 5, 10, Math.PI), [0, 0.31, 0]),
      ]),
      mat: new THREE.MeshStandardMaterial({ color: IRON, metalness: 0.5, roughness: 0.45 }),
    },
    shade: {
      geo: new THREE.IcosahedronGeometry(0.085, 0).translate(0, 0.2, 0),
      mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, transparent: true, opacity: 0.9, flatShading: true }),
    },
    bulb: { geo: new THREE.SphereGeometry(0.04, 10, 8).translate(0, 0.2, 0) },
    glow: 0xffc06a,
    on: 0xfff0d0,
    off: 0x4a4a52,
    halo: [0, 0.2, 0],
    pool: [0.12, -0.03, 1.2, 0.95],
    floor: [0.1, 0.3, 2.6],
    strength: 0.95,
  };
}

/** A column that grows like a tree: a trunk, a knot, and four branches up to the vault. */
function treeColumn(decor, x, z, trunk, h = 5.4) {
  decor.add('matte', 0xcfc6b4, cyl(0.78, 0.9, 0.3, 12), [x, 0.15, z]);
  decor.add('matte', trunk, cyl(0.4, 0.55, h, 12), [x, 0.3 + h / 2, z]);
  for (const y of [h * 0.36, h * 0.72]) decor.add('matte', 0xcbbfa8, cyl(0.5, 0.52, 0.14, 12), [x, y, z]);
  const ky = 0.3 + h;
  decor.add('matte', 0xe6dfd0, xform(new THREE.SphereGeometry(0.64, 12, 8), [x, ky, z], [0, 0, 0], [1, 0.75, 1]));
  const len = 2.8;
  const tilt = 0.62;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const reach = Math.sin(tilt) * len;
    const rise = Math.cos(tilt) * len;
    decor.add('matte', trunk, xform(cyl(0.14, 0.22, len, 8), [x + (dx * reach) / 2, ky + rise / 2, z + (dz * reach) / 2], [dz * tilt, 0, -dx * tilt]));
    const ex = x + dx * reach;
    const ey = ky + rise;
    const ez = z + dz * reach;
    decor.add('matte', 0xe6dfd0, sphere(0.26, 10, 8, ex, ey, ez));
    // Each branch holds up a cup of the vault with a skylight in it.
    decor.add('matte', 0xf2ede2, cyl(0.9, 0.55, 0.3, 10), [ex, ey + 0.2, ez]);
    decor.add('glow', 0xfff3d6, cyl(0.55, 0.55, 0.04, 10), [ex, ey + 0.36, ez]);
  }
}

// ------------------------------------------------------------------ inside the basilica

export function basilica(view) {
  const P = view.place;
  const W = P.width;
  const D = P.depth;
  const H = P.wallHeight;
  const root = view.root;
  const mats = decorMaterials();
  const decor = new Decor();
  const walls = wallSides(view, W, D);

  view.background = new THREE.Color(0xe6dfd2);
  view.fog = new THREE.Fog(0xe9e3d8, 42, 95);
  view.exposure = 1.05;
  view.haloSize = 0.8;
  // You come in by the main door at the back and look down the nave to the altar.
  Object.assign(view.cam, { pitch: 0.62, dist: 14, maxDist: 28, yawLimit: 1.1, spawnYaw: 0.35, splash: { x: 0, z: -1, dist: 26, pitch: 0.5, swing: 0.35 } });

  // ---------------------------------------------------------------- daylight, coloured by the glass
  root.add(new THREE.HemisphereLight(0xfff6ea, 0xb4a690, 1.5));
  root.add(new THREE.AmbientLight(0xffffff, 0.3));
  const key = new THREE.DirectionalLight(0xfff2dc, 1.15);
  key.position.set(3, 26, 4);
  key.target.position.set(0, 0, -3);
  root.add(key, key.target);
  for (const [x, z, color] of [[-8, -6, 0xff7a2a], [-8, 5, 0xffa040], [8, -6, 0x2f9cff], [8, 5, 0x30c8a0]]) {
    const l = new THREE.PointLight(color, 14, 16, 1.4);
    l.position.set(x, 4, z);
    root.add(l);
  }

  // ---------------------------------------------------------------- floor and walls
  const floorTex = tex.paving({ base: '#ddd6c8', repeat: [W / 2, D / 2], seed: 27 });
  floorTex.anisotropy = view.aniso;
  const floor = new THREE.Mesh(floorPlane(W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 }));
  root.add(floor);
  view.floors.push(floor);
  decor.add('matte', 0xbcae96, box(2.2, 0.01, D - 6), [0, 0.006, 1.5]);
  const wallMat = (rx) => new THREE.MeshStandardMaterial({ map: tex.stoneBlocks({ base: '#e6dfd0', seed: 29, repeat: [rx, H / 3.2] }), roughness: 0.92 });
  root.add(
    new THREE.Mesh(wallPlane(W, H, 0, H / 2, -D / 2), wallMat(W / 4)),
    new THREE.Mesh(wallPlane(W, H, 0, H / 2, D / 2, Math.PI), wallMat(W / 4)),
    new THREE.Mesh(wallPlane(D, H, -W / 2, H / 2, 0, HALF), wallMat(D / 4)),
    new THREE.Mesh(wallPlane(D, H, W / 2, H / 2, 0, -HALF), wallMat(D / 4)),
  );

  // ---------------------------------------------------------------- stained glass: warm to the west, cool to the east
  const glassMat = (palette, seed) => new THREE.MeshBasicMaterial({ map: tex.stainedGlass({ palette, seed }), transparent: true, alphaTest: 0.1, toneMapped: false });
  const WIN_Z = [-12.6, -7.75, -3.25, 1.25, 5.75, 10.25];
  for (const side of [-1, 1]) {
    const wall = walls[side < 0 ? 'left' : 'right'];
    const palette = side < 0 ? WARM : COOL;
    const wx = side * (W / 2 - 0.03);
    const geos = [[], []];
    WIN_Z.forEach((z, k) => {
      geos[k % 2].push(new THREE.PlaneGeometry(2.3, 6.9).rotateY(-side * HALF).translate(wx, 6.6, z));
      geos[(k + 1) % 2].push(new THREE.PlaneGeometry(1.2, 2.9).rotateY(-side * HALF).translate(wx, 11.6, z));
      for (const dz of [-1.22, 1.22]) wall.decor.add('matte', 0xcfc6b4, box(0.12, 7.2, 0.18), [side * (W / 2 - 0.06), 6.6, z + dz]);
      wall.decor.add('matte', 0xcfc6b4, box(0.14, 0.22, 2.7), [side * (W / 2 - 0.07), 3.05, z]);
    });
    geos.forEach((list, k) => wall.group.add(new THREE.Mesh(merge(list), glassMat(palette, 3 + k + (side > 0 ? 10 : 0)))));
  }
  // The coloured light those windows throw across the floor and the desks.
  WIN_Z.forEach((z, k) => {
    for (const side of [-1, 1]) {
      const hue = side < 0 ? [0xff8a3a, 0xffc24a, 0xff5a3a][k % 3] : [0x3aa0ff, 0x3fd0a0, 0x4f8aff][k % 3];
      const fx = side * (W / 2 - 5.5);
      if (k % 2 === 0) sunbeam(root, [side * (W / 2 - 0.2), 7.5, z], [fx, z + 0.6], 1.8, { color: hue, opacity: 0.1 });
      sunPatch(root, fx, z + 0.6, 3.0, 4.0, { color: hue, opacity: 0.42, y: 0.012 });
    }
  });
  motes(view, { x: 0, z: -2, w: 22, d: 26, y0: 0.5, y1: 12, count: 220, color: 0xfff2dc, opacity: 0.4 });

  // ---------------------------------------------------------------- the forest of columns
  // The side aisles (their hanging lanterns) hide when the camera is out beyond them.
  const rows = { left: new Decor(), right: new Decor() };
  const rowGroups = {};
  for (const k of ['left', 'right']) {
    rowGroups[k] = new THREE.Group();
    root.add(rowGroups[k]);
    view.cullers.push({ object: rowGroups[k], test: (c) => (k === 'left' ? c.x > -9.0 : c.x < 9.0) });
  }
  // Red porphyry by the altar, then dark basalt, grey granite and pale sandstone. Each column
  // is its own group: it steps aside while the camera is right over it (its canopy of
  // branches is about the camera's height) or out beyond its row.
  const trunkAt = (z) => (z < -8 ? 0x8a4f3f : z < -3 ? 0x5f5d60 : z < 2 ? 0xa9a49c : 0xd6c6a6);
  const columns = [];
  for (const [x, z] of P.columns) {
    const group = new THREE.Group();
    root.add(group);
    const d = new Decor();
    treeColumn(d, x, z, trunkAt(z));
    columns.push([d, group]);
    view.cullers.push({ object: group, test: (c) => (c.x - x) ** 2 + (c.z - z) ** 2 > 12 && (x < 0 ? c.x > -9.0 : c.x < 9.0) });
    shadowDecal(root, x, z, 2.4, 2.4, 0.22);
  }
  // Lanterns hanging in the side aisles.
  for (const z of [-7.75, -3.25, 1.25, 5.75]) {
    for (const side of [-1, 1]) {
      const d = rows[side < 0 ? 'left' : 'right'];
      const x = side * 11.2;
      d.add('matte', 0x333333, cyl(0.012, 0.012, 7, 4), [x, 9.2, z]);
      d.add('gloss', IRON, cyl(0.12, 0.2, 0.12, 8), [x, 5.75, z]);
      d.add('glow', 0xffe2a8, sphere(0.2, 10, 8, x, 5.5, z));
    }
  }

  // ---------------------------------------------------------------- the apse: altar, canopy, golden windows, organ
  decor.add('matte', 0xd9d0bf, box(9, 0.2, 4.4), [0, 0.1, -13.8]);
  decor.add('matte', 0xe3dbcb, box(7.6, 0.2, 3.6), [0, 0.3, -14.2]);
  decor.add('matte', 0xece6d8, box(6.2, 0.2, 2.8), [0, 0.5, -14.6]);
  decor.add('gloss', 0xf1ece2, box(2.6, 0.95, 1.1), [0, 1.08, -14.6]);
  decor.add('gloss', GOLD, box(2.64, 0.08, 1.14), [0, 1.52, -14.6]);
  for (const s of [-0.9, 0.9]) decor.add('matte', 0xf4efe4, cyl(0.05, 0.05, 0.3, 8), [s, 1.71, -14.6]);
  fires(view, [[-0.9, 1.92, -14.6, 0.16], [0.9, 1.92, -14.6, 0.16]], { glowSize: 1.2 });
  {
    const cy = 6.6;
    const cz = -14;
    decor.add('matte', 0xf4efe4, cyl(0.6, 2.5, 1.0, 7), [0, cy + 0.5, cz]);
    decor.add('gloss', GOLD, cyl(2.56, 2.56, 0.14, 7), [0, cy, cz]);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      decor.add('glow', 0xffe9b0, sphere(0.1, 8, 6, Math.sin(a) * 2.4, cy - 0.2, cz + Math.cos(a) * 2.4));
    }
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.2;
      for (let j = 0; j < 3; j++) decor.add('gloss', 0x6a2f5a, sphere(0.09, 6, 5, Math.sin(a) * 2.15 + (j - 1) * 0.08, cy - 0.35 - j * 0.11, cz + Math.cos(a) * 2.15));
    }
    for (const a of [0, 2.1, 4.2]) decor.add('matte', 0x333333, cyl(0.015, 0.015, H - cy - 1, 4), [Math.sin(a) * 0.4, (H + cy + 1) / 2, cz + Math.cos(a) * 0.4]);
  }
  {
    const front = walls.front;
    const list = [
      [-4.2, 2.0, 7.0, 7.2],
      [0, 2.6, 9.0, 8.4],
      [4.2, 2.0, 7.0, 7.2],
    ];
    const geos = list.map(([x, w, h, y]) => new THREE.PlaneGeometry(w, h).translate(x, y, -D / 2 + 0.03));
    front.group.add(new THREE.Mesh(merge(geos), glassMat(AMBER, 7)));
    for (const [x, w, h, y] of list) {
      for (const s of [-1, 1]) front.decor.add('matte', 0xcfc6b4, box(0.18, h + 0.2, 0.12), [x + (s * (w + 0.18)) / 2, y, -D / 2 + 0.06]);
    }
    sunbeam(root, [0, 10, -D / 2 + 0.2], [0, -13], 2.4, { color: 0xffd27a, opacity: 0.1 });
    sunPatch(root, 0, -12.6, 4, 3, { color: 0xffe0a0, opacity: 0.3, y: 0.62 });
  }
  {
    const [x0, z0, x1, z1] = P.organ;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    decor.add('matte', 0x6b4329, box(x1 - x0 - 0.2, 1.6, z1 - z0 - 0.2), [cx, 0.8, cz]);
    decor.add('gloss', GOLD, box(x1 - x0 - 0.1, 0.12, z1 - z0 - 0.1), [cx, 1.62, cz]);
    const n = 13;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const h = 2.6 + Math.sin(Math.PI * t) * 3.6;
      const px = x0 + 0.5 + t * (x1 - x0 - 1);
      decor.add('gloss', 0xd8dde2, cyl(0.13, 0.13, h, 10), [px, 1.68 + h / 2, cz + 0.3]);
      decor.add('matte', 0x2a2a2a, box(0.12, 0.08, 0.02, px, 2.1, cz + 0.44));
    }
  }

  // ---------------------------------------------------------------- seashells for holy water, and the door out
  for (const [x, z] of P.fonts) {
    decor.add('matte', 0xcfc6b4, cyl(0.22, 0.32, 0.75, 12), [x, 0.375, z]);
    decor.add('gloss', 0xf2ead8, xform(new THREE.SphereGeometry(0.62, 18, 8, 0, Math.PI * 2, HALF, HALF), [x, 1.0, z], [0, 0, 0], [1.1, 0.45, 0.85]));
    for (let k = 0; k < 7; k++) decor.add('gloss', 0xe2d6bc, xform(box(0.03, 0.03, 1.0), [x + (k - 3) * 0.16, 0.92, z + 0.02], [0, (k - 3) * 0.12, 0]));
    decor.add('glass', 0x9fd8ef, cyl(0.6, 0.6, 0.02, 18), [x, 0.97, z]);
  }
  {
    const z = D / 2;
    // The door's frame hangs on the back wall, so it hides with the wall when the camera is out there.
    const back = walls.back.decor;
    for (const s of [-1, 1]) back.add('matte', 0xcfc6b4, box(0.5, 4.6, 0.5), [s * 1.95, 2.3, z - 0.25]);
    back.add('matte', 0xcfc6b4, xform(new THREE.TorusGeometry(1.95, 0.26, 8, 20, Math.PI), [0, 4.6, z - 0.25]));
    back.add('glow', 0xfff3dc, box(3.4, 4.5, 0.06), [0, 2.25, z - 0.05]);
    const rose = new THREE.Mesh(new THREE.PlaneGeometry(5, 5).rotateY(Math.PI).translate(0, 10, z - 0.03), new THREE.MeshBasicMaterial({ map: tex.roseWindow(), transparent: true, alphaTest: 0.1, toneMapped: false }));
    walls.back.group.add(rose);
    const out = tex.sign({ text: 'Barcelona →', sub: '바르셀로나 시내로', w: 512, h: 160, bg: '#7a2a2a', fg: '#f6e7c4', border: '#e8b23a' });
    signMesh(view, out, 1.7, 0.53, 0, 5.6, z - 0.12, Math.PI, { parent: walls.back.group });
    door(view, 'barcelona', { x: 0, y: 2.2, z: z - 0.4, w: 3.4, h: 4.4, d: 0.8, arrowAt: [0, 6.5, z - 1.0], color: 0xf2c46a });
    view.tags = [{ kind: 'barcelona', at: [0, 7.4, z - 0.8] }];
  }

  // ---------------------------------------------------------------- seats: oak tables inlaid with tile, lanterns
  const oak = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  for (const [x, z] of P.tables) {
    for (const lx of [-2.3, 0, 2.3]) for (const lz of [-0.6, 0.6]) decor.add('matte', 0x6b4a2a, box(0.12, DESK_TOP - 0.05, 0.12), [x + lx, (DESK_TOP - 0.05) / 2, z + lz]);
    shadowDecal(root, x, z, 6, 3.4, 0.18);
  }
  view.styles.desk = {
    desk: {
      geo: parts([
        [box(1.2, 0.06, 0.7, 0, DESK_TOP - 0.03, 0), 0xc8a06a],
        [box(1.2, 0.012, 0.06, 0, DESK_TOP + 0.002, -0.3), 0x2f6fb8],
        [box(1.2, 0.012, 0.03, 0, DESK_TOP + 0.002, -0.255), 0xe8b23a],
      ]),
      mat: oak,
    },
    chair: { geo: parts(chairParts(0x8a5a32, 0xc9a26a)), mat: oak },
    lamp: glassLantern(),
    notebook: [-0.06, 0.07],
    books: [-0.38, -0.13, 1],
    tea: [-0.42, 0.17],
    pick: [1.5, 1.4, 2.05, 0.36],
  };

  decor.build(root, mats);
  rows.left.build(rowGroups.left, mats);
  rows.right.build(rowGroups.right, mats);
  for (const [d, group] of columns) d.build(group, mats);
  walls.build(mats);
}

// ------------------------------------------------------------------ outside: Barcelona

/** A London plane: a mottled trunk and a broad, round crown. */
function planeTree(decor, x, z, h = 5.5) {
  decor.add('matte', 0xb9ad8c, cyl(0.2, 0.26, h, 8), [x, h / 2, z]);
  for (let k = 0; k < 4; k++) decor.add('matte', k % 2 ? 0xd8d0b4 : 0x8c8a6a, cyl(0.215, 0.215, 0.5, 8), [x, 0.8 + k * 1.1, z]);
  for (const [dx, dy, dz, r] of [[0, 0, 0, 2.3], [1.3, -0.4, 0.4, 1.6], [-1.2, -0.3, 0.6, 1.7], [0.3, 0.5, -1.2, 1.6]]) {
    decor.add('leaf', [0x5f8f3a, 0x6f9f45, 0x4f7f32][(dx > 0) + (dz > 0)], xform(new THREE.IcosahedronGeometry(r, 1), [x + dx, h + 0.8 + dy, z + dz], [0, 0, 0], [1, 0.75, 1]));
  }
}

/** A green iron flower stall with buckets of flowers round it. */
function kiosk(decor, x, z) {
  const G = 0x2f5a3a;
  decor.add('gloss', G, box(2.0, 2.4, 2.0), [x, 1.2, z]);
  decor.add('glow', 0xfff0c8, box(1.5, 0.8, 2.02), [x, 1.6, z]);
  decor.add('glow', 0xfff0c8, box(2.02, 0.8, 1.5), [x, 1.6, z]);
  decor.add('gloss', G, xform(new THREE.ConeGeometry(1.75, 0.9, 4), [x, 2.85, z], [0, Math.PI / 4, 0]));
  decor.add('gloss', GOLD, sphere(0.12, 8, 6, x, 3.35, z));
  const flowers = [0xe84a6a, 0xf2c230, 0xf07aa8, 0xffffff, 0xd9483b, 0xb48fc7];
  let k = 0;
  for (const o of [-0.6, 0, 0.6]) {
    for (const [px, pz] of [[x + 1.1, z + o], [x - 1.1, z + o], [x + o, z + 1.1], [x + o, z - 1.1]]) {
      decor.add('matte', 0x6b6b70, cyl(0.16, 0.13, 0.3, 8), [px, 0.15, pz]);
      decor.add('leaf', flowers[k++ % flowers.length], sphere(0.2, 7, 5, px, 0.42, pz));
    }
  }
}

/** A lamp post with a crown of six lanterns and a red-and-gold top. */
function lampPost(decor, x, z) {
  decor.add('matte', 0xbfb5a2, cyl(0.32, 0.4, 0.5, 10), [x, 0.25, z]);
  decor.add('gloss', IRON, cyl(0.07, 0.11, 4.4, 8), [x, 2.7, z]);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const ax = x + Math.sin(a) * 0.55;
    const az = z + Math.cos(a) * 0.55;
    decor.add('gloss', IRON, xform(cyl(0.025, 0.025, 0.6, 5), [x + Math.sin(a) * 0.28, 4.25, z + Math.cos(a) * 0.28], [Math.cos(a) * HALF, 0, -Math.sin(a) * HALF]));
    decor.add('glow', 0xfff0c0, sphere(0.13, 8, 6, ax, 4.12, az));
    decor.add('gloss', IRON, cyl(0.1, 0.06, 0.08, 6, ax, 4.3, az));
  }
  decor.add('gloss', 0xb8342a, sphere(0.2, 10, 8, x, 5.05, z));
  decor.add('gloss', GOLD, xform(new THREE.ConeGeometry(0.12, 0.45, 8), [x, 5.45, z]));
}

/** A Barcelona taxi: black, with yellow doors and its green "free" light on. */
function taxi(decor, x, z, ry = 0) {
  const at = (g) => xform(g, [x, 0, z], [0, ry, 0]);
  decor.add('gloss', 0x141414, at(box(1.75, 0.62, 4.3, 0, 0.55, 0)));
  decor.add('gloss', 0xf2c230, at(box(1.79, 0.5, 2.0, 0, 0.6, 0.1)));
  decor.add('gloss', 0x141414, at(box(1.6, 0.55, 2.2, 0, 1.12, -0.1)));
  decor.add('glass', 0x9fc7e0, at(box(1.64, 0.4, 2.0, 0, 1.15, -0.1)));
  decor.add('glow', 0x3aff6a, at(box(0.3, 0.12, 0.16, 0, 1.46, 0.3)));
  for (const [wx, wz] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) decor.add('gloss', 0x1a1a1a, at(xform(new THREE.TorusGeometry(0.3, 0.12, 6, 12), [wx, 0.32, wz], [0, HALF, 0])));
  decor.add('glow', 0xfff3d0, at(box(1.4, 0.12, 0.04, 0, 0.62, 2.16)));
  decor.add('glow', 0xd9483b, at(box(1.4, 0.1, 0.04, 0, 0.66, -2.16)));
}

/** The mosaic dragon on its fountain, water running from its mouth. */
function dragon(view, decor, { x, z }) {
  decor.add('matte', 0xd9cbb4, cyl(1.0, 1.08, 0.5, 20), [x, 0.25, z]);
  decor.add('glass', 0x7fc8e8, cyl(0.88, 0.88, 0.02, 20), [x, 0.49, z]);
  const body = [[0, -0.85, 0.2], [0.18, -0.5, 0.26], [0.1, -0.1, 0.32], [0, 0.3, 0.34], [-0.05, 0.62, 0.28]];
  body.forEach(([dx, dz, r], k) => decor.add('gloss', TILES[k % TILES.length], xform(new THREE.SphereGeometry(r, 12, 8), [x + dx, 0.72 + r * 0.6, z + dz], [0, 0, 0], [1, 0.75, 1.3])));
  decor.add('gloss', TILES[2], xform(new THREE.ConeGeometry(0.12, 0.7, 8), [x - 0.1, 0.8, z - 1.2], [-HALF * 0.7, 0, 0]));
  decor.add('gloss', TILES[4], xform(new THREE.SphereGeometry(0.24, 12, 8), [x - 0.05, 1.05, z + 0.95], [0, 0, 0], [1, 0.85, 1.25]));
  decor.add('gloss', TILES[3], box(0.28, 0.14, 0.3, x - 0.05, 0.95, z + 1.18));
  for (const s of [-0.1, 0.1]) decor.add('gloss', 0x151515, sphere(0.04, 6, 5, x - 0.05 + s, 1.17, z + 1.08));
  for (const [lx, lz] of [[-0.3, 0.45], [0.3, 0.45], [-0.3, -0.25], [0.3, -0.25]]) decor.add('gloss', TILES[1], xform(cyl(0.06, 0.08, 0.35, 6), [x + lx, 0.62, z + lz], [0, 0, lx > 0 ? -0.5 : 0.5]));
  for (let k = 0; k < 6; k++) decor.add('gloss', TILES[(k + 2) % TILES.length], xform(new THREE.ConeGeometry(0.05, 0.16, 5), [x + 0.05, 1.1 - Math.abs(k - 2.5) * 0.05, z - 0.6 + k * 0.25]));
  spray(view, x - 0.05, z + 1.32, { top: 0.95, floor: 0.5, count: 36, spread: 0.18, lift: 0.5 });
}

/** The winding bench in one piece: a seat and a curled backrest, clad in broken tile. */
function waveBench(view, w) {
  const zAt = (x) => w.z + Math.sin((x - w.mid) * w.freq) * w.amp;
  // Cross-section: [distance towards the front, height].
  const profile = [[0.32, 0], [0.32, 0.4], [0.28, 0.45], [-0.24, 0.45], [-0.3, 0.98], [-0.44, 1.02], [-0.47, 0]];
  const steps = Math.ceil((w.to - w.from) / 0.2);
  const pos = [];
  const uv = [];
  const idx = [];
  let s = 0;
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const x = w.from + ((w.to - w.from) * i) / steps;
    const z = zAt(x);
    const slope = (zAt(x + 0.01) - zAt(x - 0.01)) / 0.02;
    const n = Math.hypot(slope, 1);
    const nx = -slope / n;
    const nz = 1 / n;
    if (prev) s += Math.hypot(x - prev[0], z - prev[1]);
    prev = [x, z];
    profile.forEach(([f, y], k) => {
      pos.push(x + nx * f, y, z + nz * f);
      uv.push(s / 1.2, k / (profile.length - 1));
    });
  }
  const np = profile.length;
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < np - 1; k++) {
      const a = i * np + k;
      idx.push(a, a + 1, a + np, a + 1, a + np + 1, a + np);
    }
  }
  // Close both ends.
  for (const i of [0, steps]) {
    const o = i * np;
    for (let k = 1; k < np - 1; k++) idx.push(o, o + k, o + k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex.trencadis({ repeat: [1, 1] }), roughness: 0.35, side: THREE.DoubleSide }));
  view.root.add(mesh);
  shadowDecal(view.root, (w.from + w.to) / 2, w.z, w.to - w.from + 1.5, 2.6, 0.22);
}

/** Green parakeets wheeling over the square. */
function parakeets(view, n = 7) {
  const geo = parts([
    [xform(new THREE.SphereGeometry(0.12, 8, 6), [0, 0, 0], [0, 0, 0], [0.9, 0.8, 1.8]), 0x5fbf3a],
    [box(0.62, 0.02, 0.16, 0, 0.03, 0.02), 0x4faa32],
    [box(0.07, 0.02, 0.32, 0, 0, -0.3), 0x3f8f2a],
    [sphere(0.06, 6, 5, 0, 0.04, 0.21), 0xb9c9b0],
  ]);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), n);
  mesh.frustumCulled = false;
  view.root.add(mesh);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  view.updaters.push((dt, time) => {
    for (let i = 0; i < n; i++) {
      const t = time * 0.32 + i * 0.85;
      const r = 9 + (i % 3) * 2.5;
      const x = -2 + Math.sin(t) * r;
      const z = 2 + Math.cos(t) * r * 0.8;
      const y = 8.5 + Math.sin(time * 1.1 + i) * 0.7 + (i % 2) * 1.2;
      const yaw = Math.atan2(Math.cos(t) * r, -Math.sin(t) * r * 0.8);
      m.compose(p.set(x, y, z), q.setFromEuler(e.set(0, yaw, Math.sin(t) * 0.3)), sc.set(1 + Math.sin(time * 16 + i * 1.7) * 0.35, 1, 1));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
}

/** A spire: a tall rounded cone, widest at the foot. */
function spireGeometry(r0, h) {
  const pts = [];
  for (let k = 0; k <= 14; k++) {
    const t = k / 14;
    pts.push(new THREE.Vector2(r0 * Math.pow(1 - t, 0.55) + 0.12, t * h));
  }
  return new THREE.LatheGeometry(pts, 16);
}

/** The mosaic pinnacle on a bell tower: a gold neck, a red mitre spotted white, white balls. */
function pinnacle(decor, x, y, z, s = 1) {
  decor.add('gloss', GOLD, cyl(0.3 * s, 0.42 * s, 1.2 * s, 10), [x, y + 0.6 * s, z]);
  decor.add('gloss', 0xc0392b, xform(new THREE.OctahedronGeometry(0.9 * s, 0), [x, y + 2.1 * s, z], [0, Math.PI / 4, 0], [0.8, 1.6, 0.8]));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    decor.add('gloss', 0xf4f1e8, sphere(0.14 * s, 6, 5, x + Math.sin(a) * 0.45 * s, y + (1.8 + (k % 2) * 0.6) * s, z + Math.cos(a) * 0.45 * s));
  }
  for (const [dx, dy, dz] of [[0, 3.85, 0], [0.38, 3.55, 0], [-0.38, 3.55, 0], [0, 3.55, 0.38], [0, 3.55, -0.38]]) decor.add('gloss', 0xf4f1e8, sphere(0.18 * s, 8, 6, x + dx * s, y + dy * s, z + dz * s));
}

/** A tower crane, its jib slowly swinging over the work. */
function crane(view, decor, x, z, h = 46) {
  const Y = 0xf2c230;
  for (const [sx, sz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) decor.add('gloss', Y, box(0.14, h, 0.14), [x + sx, h / 2, z + sz]);
  for (let y = 1; y < h; y += 2) {
    decor.add('gloss', Y, box(1.3, 0.1, 0.1), [x, y, z - 0.6]);
    decor.add('gloss', Y, box(1.3, 0.1, 0.1), [x, y, z + 0.6]);
    decor.add('gloss', Y, box(0.1, 0.1, 1.3), [x - 0.6, y + 1, z]);
    decor.add('gloss', Y, box(0.1, 0.1, 1.3), [x + 0.6, y + 1, z]);
  }
  const jib = new THREE.Group();
  jib.position.set(x, h, z);
  view.root.add(jib);
  const jd = new Decor();
  jd.add('gloss', Y, box(26, 0.7, 0.9, -11, 0.6, 0));
  jd.add('gloss', Y, box(8, 0.7, 0.9, 5, 0.6, 0));
  jd.add('matte', 0x8a8a8a, box(2, 1.6, 1.4, 7.6, -0.3, 0));
  jd.add('gloss', Y, box(1.4, 1.4, 1.4, 0, 1.6, 0));
  jd.add('gloss', Y, xform(new THREE.ConeGeometry(0.5, 4, 4), [0, 3.6, 0]));
  jd.add('matte', 0x333333, cyl(0.02, 0.02, 14, 4, -18, -6.8, 0));
  jd.add('gloss', 0xd9483b, box(0.4, 0.5, 0.4, -18, -13.9, 0));
  view.updaters.push((dt, time) => {
    jib.rotation.y = -0.5 + Math.sin(time * 0.04) * 0.7;
  });
  return { jib, decor: jd };
}

export function barcelona(view) {
  const P = view.place;
  const root = view.root;
  const mats = decorMaterials();
  const decor = new Decor();
  let craneJib = null;

  outdoors(view, {
    sky: ['#3b8be0', '#e9f1f8', '#cdbf9f'],
    fog: 0xe6edf3,
    fogNear: 70,
    fogFar: 210,
    sun: 0xfff1d6,
    sunPos: [-26, 44, 30],
    sunPower: 2.6,
    hemi: [0xe8f0ff, 0xb9a688, 1.45],
    ground: tex.panot({ repeat: [240, 240] }),
    clouds: 6,
  });
  view.exposure = 1.04;
  Object.assign(view.cam, {
    pitch: 0.52,
    dist: 22,
    ahead: 0,
    minDist: 5,
    maxDist: 38,
    yawLimit: null,
    far: 340,
    // Out of the basilica you turn to face the city.
    arrive: { basilica: Math.PI },
    splash: { x: 0, z: -2, dist: 38, pitch: 0.4, swing: 0.45 },
  });

  // ---------------------------------------------------------------- the ground: a paved square, the Rambla, two little parks
  const ground = (map, w, d, x, z, y = 0.006) => {
    map.anisotropy = view.aniso;
    const m = new THREE.Mesh(floorPlane(w, d), new THREE.MeshStandardMaterial({ map, roughness: 0.9 }));
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  ground(tex.paving({ base: '#d9cfbf', repeat: [10, 4], seed: 44 }), 30, 13.4, 0, -8.6);
  {
    const [x0, z0, x1, z1] = P.rambla;
    ground(tex.ramblaWaves({ repeat: [1, (z1 - z0) / 4] }), x1 - x0, z1 - z0, (x0 + x1) / 2, (z0 + z1) / 2, 0.008);
  }
  ground(tex.grass({ seed: 45, repeat: [6, 6] }), 16, 13, -25, -12.5, 0.007);
  ground(tex.grass({ seed: 46, repeat: [6, 6] }), 14, 12, 25, -20, 0.007);
  {
    const { x, z, r } = P.mosaic;
    const m = new THREE.Mesh(floorPlane(r * 2, r * 2), new THREE.MeshStandardMaterial({ map: tex.miro(), transparent: true, roughness: 0.6 }));
    m.position.set(x, 0.014, z);
    root.add(m);
  }

  // ---------------------------------------------------------------- the basilica: its sculpted front and its spires
  {
    const [x0, z0, x1, z1] = P.basilica;
    const W = x1 - x0;
    const Dd = z1 - z0;
    const bodyH = 18;
    const stone = tex.stoneBlocks({ base: '#c9b089', seed: 47, repeat: [8, 5] });
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, bodyH, Dd), new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95 }));
    body.position.set((x0 + x1) / 2, bodyH / 2, (z0 + z1) / 2);
    root.add(body);
    blockBox(view, x0, z0, x1, z1, bodyH);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W, bodyH), new THREE.MeshStandardMaterial({ map: tex.gaudiFacade(), roughness: 0.95 }));
    front.position.set(0, bodyH / 2, z1 + 0.03);
    root.add(front);
    // Pointed gables over the three portals, and the green cypress over the middle one.
    for (const [gx, gw, gh] of [[0, 8, 9], [-9, 5.4, 6], [9, 5.4, 6]]) {
      decor.add('matte', SANDSTONE, xform(new THREE.ConeGeometry(gw / 2, gh, 4), [gx, bodyH + gh / 2 - 0.2, z1 - 0.6], [0, Math.PI / 4, 0], [1, 1, 0.35]));
    }
    decor.add('leaf', 0x3f7a46, xform(new THREE.ConeGeometry(1.5, 7, 8), [0, bodyH + 5.5, z1 - 0.4]));
    for (let k = 0; k < 10; k++) decor.add('matte', 0xf4f1e8, sphere(0.16, 6, 5, Math.sin(k * 2.4) * (1.3 - k * 0.1), bodyH + 2.6 + k * 0.6, z1 + 0.6));
    // Deep arches round the three portals.
    for (const [px, pw, ph] of [[0, 5.6, 7.2], [-9, 4.0, 5.6], [9, 4.0, 5.6]]) {
      for (const s of [-1, 1]) decor.add('matte', 0xd3c2a0, box(0.8, ph, 1.0), [px + (s * pw) / 2, ph / 2, z1 + 0.4]);
      decor.add('matte', 0xd3c2a0, xform(new THREE.TorusGeometry(pw / 2, 0.45, 8, 22, Math.PI), [px, ph, z1 + 0.4], [0, 0, 0], [1, 1.25, 1]));
    }
    // The steps up to the portal.
    for (let k = 0; k < 3; k++) decor.add('matte', 0xd3c6ac, box(6.8 - k * 0.6, 0.16, 0.7 - k * 0.1), [0, 0.08 + k * 0.16, z1 + 0.35 - k * 0.2]);
    decor.add('glow', 0xffe2a8, box(3.6, 5.4, 0.06), [0, 2.9, z1 + 0.05]);
    // Four bell towers on the front, and the tall towers of the middle behind them.
    const spires = [];
    const towers = [
      [-9.6, z1 - 1.6, 1.9, 31],
      [-3.6, z1 - 1.6, 2.0, 34],
      [3.6, z1 - 1.6, 2.0, 34],
      [9.6, z1 - 1.6, 1.9, 31],
      [-7, -25, 2.3, 38],
      [7, -25, 2.3, 38],
      [0, -23, 3.0, 46],
    ];
    for (const [tx, tz, r0, h] of towers) {
      spires.push(spireGeometry(r0, h).translate(tx, 0, tz));
      blockShape(view, new THREE.CylinderGeometry(r0 * 0.5, r0, h, 10), tx, h / 2, tz);
    }
    const towerTex = tex.towerStone();
    towerTex.wrapS = THREE.RepeatWrapping;
    towerTex.repeat.set(3, 1);
    root.add(new THREE.Mesh(merge(spires), new THREE.MeshStandardMaterial({ map: towerTex, roughness: 0.95 })));
    towers.slice(0, 4).forEach(([tx, tz, , h]) => pinnacle(decor, tx, h - 0.2, tz, 0.9));
    for (const [tx, tz, , h] of towers.slice(4, 6)) decor.add('gloss', GOLD, sphere(0.9, 14, 10, tx, h + 0.6, tz));
    // A star of glass and gold on the tallest tower.
    {
      const [tx, tz, , h] = towers[6];
      for (const r of [[0, 0, 0], [HALF, 0, 0], [0, 0, HALF]]) decor.add('gloss', 0xf4f1e8, xform(new THREE.OctahedronGeometry(0.7, 0), [tx, h + 1.4, tz], r, [0.35, 2.0, 0.35]));
      decor.add('glow', 0xfff3c0, sphere(0.45, 12, 8, tx, h + 1.4, tz));
    }
    craneJib = crane(view, decor, 12.5, -27);
    // The way in.
    door(view, 'basilica', { x: 0, y: 2.6, z: z1 + 0.5, w: 4, h: 5.2, d: 1, arrowAt: [0, 7.2, z1 + 1.2], color: 0xf0c75a });
    pickBox(view, 'basilica', 0, 9, z1 - 0.4, W, 18, 1.2);
    view.tags = [{ kind: 'basilica', at: [0, 8.6, z1 + 1.4] }];
    blockBox(view, -3.4, z1, 3.4, z1 + 0.7, 1);
  }

  // ---------------------------------------------------------------- Eixample blocks, cut at the corners
  const facadeMats = [
    tex.eixampleFacade({ wall: '#e6d3b3', shutter: '#4f7a52', seed: 31 }),
    tex.eixampleFacade({ wall: '#ead9c4', shutter: '#7a5a3a', seed: 32 }),
    tex.eixampleFacade({ wall: '#dcc39a', shutter: '#3f6b5a', seed: 33 }),
    tex.eixampleFacade({ wall: '#efe2cf', shutter: '#5a6f4a', seed: 34, awning: '#b8342a', shop: '#4a2a22' }),
    tex.eixampleFacade({ wall: '#e3c7b0', shutter: '#4a5f7a', seed: 35 }),
  ].map((map) => {
    map.wrapS = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({ map, roughness: 0.95 });
  });
  const facadeGeos = facadeMats.map(() => []);
  const roofGeos = [];
  let nb = 0;
  /** A building: façades on its four sides (one window bay per 7 m or so) and a flat roof. */
  const building = (cx, cz, w, d, h, ry = 0, mi = nb++ % facadeMats.length) => {
    const sides = [
      [w, d / 2, 0],
      [d, w / 2, HALF],
      [w, d / 2, Math.PI],
      [d, w / 2, -HALF],
    ];
    for (const [fw, off, a] of sides) {
      const g = new THREE.PlaneGeometry(fw, h);
      const bays = Math.max(1, Math.round(fw / 7));
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * bays);
      g.translate(0, h / 2, off).rotateY(a).rotateY(ry).translate(cx, 0, cz);
      facadeGeos[mi].push(g);
    }
    roofGeos.push(new THREE.PlaneGeometry(w, d).rotateX(-HALF).translate(0, h, 0).rotateY(ry).translate(cx, 0, cz));
    decor.add('matte', 0xf0e4cc, xform(box(w + 0.4, 0.4, d + 0.4), [cx, h + 0.2, cz], [0, ry, 0]));
    if (nb % 3 === 0) decor.add('matte', 0xbfb2a0, xform(box(1.6, 1.2, 1.2), [cx + 1.5, h + 0.8, cz - 1], [0, ry, 0]));
  };
  const rect = (x0, z0, x1, z1, h, mi) => building((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, h, 0, mi);
  // Plain buildings: [x0, z0, x1, z1, height].
  for (const [x0, z0, x1, z1, h, mi] of [
    [21, -4, 33, 1, 16],
    [21, 9, 33, 16, 19, 3],
    [21, 16, 33, 22.5, 17],
    [21, 22.5, 33, 29, 20],
    [-33, 15, -21, 22, 19],
    [-33, 22, -21, 29, 16],
    [-21, 23, -14, 29, 17],
    [14, 23, 21, 29, 16],
  ]) rect(x0, z0, x1, z1, h, mi);
  // Corner buildings with the corner facing the square cut off at 45 degrees: the strip along
  // one edge, the rest of the building, and a turned block whose face is the cut.
  const cut = 3.2;
  for (const [cx, cz, sx, sz, [x0, z0, x1, z1], h, alongX] of [
    [21, -12, 1, 1, [21, -12, 33, -4], 18, false],
    [-21, -2, -1, 1, [-33, -2, -21, 6], 18, false],
    [-7, 23, -1, 1, [-14, 23, -7, 29], 19, true],
    [7, 23, 1, 1, [7, 23, 14, 29], 18, true],
  ]) {
    const mi = nb++ % facadeMats.length;
    const far = (lo, hi, s) => (s > 0 ? hi : lo);
    if (!alongX) {
      const xa = cx + sx * cut;
      const xb = far(x0, x1, sx);
      rect(Math.min(xa, xb), Math.min(cz, cz + sz * cut), Math.max(xa, xb), Math.max(cz, cz + sz * cut), h, mi);
      const za = cz + sz * cut;
      const zb = far(z0, z1, sz);
      rect(x0, Math.min(za, zb), x1, Math.max(za, zb), h, mi);
    } else {
      const za = cz + sz * cut;
      const zb = far(z0, z1, sz);
      rect(Math.min(cx, cx + sx * cut), Math.min(za, zb), Math.max(cx, cx + sx * cut), Math.max(za, zb), h, mi);
      const xa = cx + sx * cut;
      const xb = far(x0, x1, sx);
      rect(Math.min(xa, xb), z0, Math.max(xa, xb), z1, h, mi);
    }
    building(cx + sx * cut, cz + sz * cut, cut * Math.SQRT2, cut * Math.SQRT2, h, Math.PI / 4, mi);
  }
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xcdb89a, roughness: 0.95 });
  facadeGeos.forEach((list, k) => {
    const m = new THREE.Mesh(merge(list), facadeMats[k]);
    root.add(m);
    blockCamera(view, m);
  });
  root.add(new THREE.Mesh(merge(roofGeos), roofMat));

  // ---------------------------------------------------------------- the house of mosaic, with its dragon-backed roof
  {
    const [x0, z0, x1, z1] = P.mosaicHouse;
    const h = 20;
    const plain = new THREE.MeshStandardMaterial({ map: facadeMats[2].map, roughness: 0.95 });
    const face = new THREE.MeshStandardMaterial({ map: tex.mosaicFacade(), roughness: 0.5 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(33 - x0, h, z1 - z0), [plain, face, roofMat, roofMat, plain, plain]);
    m.position.set((x0 + 33) / 2, h / 2, (z0 + z1) / 2);
    root.add(m);
    blockCamera(view, m);
    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, z1 - z0, 16, 1, false, -HALF, Math.PI).rotateX(-HALF).scale(1, 0.75, 1),
      new THREE.MeshStandardMaterial({ map: tex.scales(), roughness: 0.35 }),
    );
    roof.position.set(x0 + 2.4, h, (z0 + z1) / 2);
    root.add(roof);
    decor.add('matte', 0xe9dfcb, cyl(0.7, 0.8, 3.2, 12), [x0 + 1.2, h + 1.6, z0 + 0.9]);
    decor.add('gloss', 0x7fbf9a, xform(new THREE.SphereGeometry(0.9, 12, 10), [x0 + 1.2, h + 3.6, z0 + 0.9], [0, 0, 0], [1, 1.25, 1]));
    decor.add('gloss', GOLD, sphere(0.25, 8, 6, x0 + 1.2, h + 4.9, z0 + 0.9));
    for (const y of [6.4, 10, 13.6]) {
      for (const z of [z0 + 1.3, (z0 + z1) / 2, z1 - 1.3]) decor.add('gloss', 0xf4efe6, xform(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI), [x0 - 0.02, y, z], [0, -HALF, 0], [1.0, 0.6, 0.7]));
    }
  }

  // ---------------------------------------------------------------- the house of wavy stone, with its helmeted chimneys
  {
    const [x0, z0, x1, z1] = P.wavyHouse;
    const h = 17;
    const plain = new THREE.MeshStandardMaterial({ map: facadeMats[1].map, roughness: 0.95 });
    const face = new THREE.MeshStandardMaterial({ map: tex.wavyFacade(), roughness: 0.9 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 + 33, h, z1 - z0), [face, plain, roofMat, roofMat, plain, plain]);
    m.position.set((x1 - 33) / 2, h / 2, (z0 + z1) / 2);
    root.add(m);
    blockCamera(view, m);
    for (let k = 0; k < 5; k++) {
      const z = z0 + 1.3 + k * ((z1 - z0 - 2.6) / 4);
      const x = x1 - 2 - (k % 2) * 1.5;
      decor.add('matte', 0xe9dfcb, cyl(0.35, 0.5, 1.8, 10), [x, h + 0.9, z]);
      decor.add('matte', k % 2 ? 0xe9dfcb : 0x8fbf8a, sphere(0.42, 10, 8, x, h + 2.05, z));
      decor.add('matte', 0xd9cbb4, xform(new THREE.ConeGeometry(0.2, 0.7, 8), [x, h + 2.7, z]));
    }
  }

  // ---------------------------------------------------------------- the café terrace
  {
    const stripes = tex.stripes({ a: '#b8342a', b: '#f6e7c4', n: 10 });
    // An awning sloping down from the café's front, out over the terrace.
    const aw = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 6.6).rotateX(-HALF).rotateZ(0.4), new THREE.MeshStandardMaterial({ map: stripes, side: THREE.DoubleSide, roughness: 0.8 }));
    aw.position.set(20.25, 3.3, 12.5);
    root.add(aw);
    const sign = tex.sign({ text: 'Café · Tapas', w: 512, h: 128, bg: '#2a1a14', fg: '#f6d27a', border: '#d9a93a', size: 0.46 });
    signMesh(view, sign, 2.6, 0.65, 20.93, 4.6, 12.5, -HALF);
    for (const [tx, tz] of P.cafeTables) {
      decor.add('gloss', 0xd9d9de, cyl(0.36, 0.36, 0.04, 16), [tx, 0.74, tz]);
      decor.add('gloss', 0x3a3a3e, cyl(0.03, 0.03, 0.72, 6), [tx, 0.37, tz]);
      decor.add('gloss', 0x3a3a3e, cyl(0.24, 0.26, 0.03, 12), [tx, 0.015, tz]);
      decor.add('matte', 0xf4f1e8, cyl(0.035, 0.03, 0.12, 8), [tx + 0.1, 0.82, tz - 0.05]);
      decor.add('glass', 0xc9342f, cyl(0.03, 0.025, 0.1, 8), [tx - 0.12, 0.81, tz + 0.08]);
      decor.add('matte', 0xd9cbb4, cyl(0.025, 0.025, 2.2, 6), [tx, 1.85, tz]);
      const um = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.5, 12, 1, true), new THREE.MeshStandardMaterial({ map: tex.stripes({ a: '#e8b23a', b: '#c0392b', n: 12 }), side: THREE.DoubleSide }));
      um.position.set(tx, 3.0, tz);
      root.add(um);
    }
  }

  // ---------------------------------------------------------------- the Rambla: plane trees, flower stalls, lamps
  for (const [x, z] of P.planes) planeTree(decor, x, z, 5.2 + Math.abs(Math.sin(x * 3 + z)) * 1.2);
  for (const [x, z] of P.kiosks) kiosk(decor, x, z);
  for (const [x, z] of P.lamps) lampPost(decor, x, z);
  P.palms.forEach(([x, z], k) => palm(decor, x, z, { height: 7 + (k % 3), lean: 0.12, turn: k * 1.3 }));
  for (const [x, z] of P.taxis) taxi(decor, x, z, 0);

  // ---------------------------------------------------------------- the pond in the basilica's park
  {
    const { x, z, a, b } = P.pond;
    decor.add('matte', 0xbfb3a0, xform(new THREE.CircleGeometry(1, 40).rotateX(-HALF), [x, 0.02, z], [0, 0, 0], [a + 0.35, 1, b + 0.35]));
    const water = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-HALF).scale(a, 1, b), new THREE.MeshStandardMaterial({ map: tex.water({ seed: 22 }), roughness: 0.15, metalness: 0.1 }));
    water.position.set(x, 0.04, z);
    root.add(water);
    for (let k = 0; k < 14; k++) {
      const t = Math.PI * 0.75 + (k / 14) * 1.1;
      decor.add('leaf', 0x5f8a3a, cyl(0.02, 0.03, 0.9 + (k % 3) * 0.3, 4), [x + Math.cos(t) * (a - 0.2), 0.5, z + Math.sin(t) * (b - 0.2)]);
    }
  }

  // ---------------------------------------------------------------- the winding mosaic bench and the dragon
  waveBench(view, P.wave);
  dragon(view, decor, P.dragon);

  // ---------------------------------------------------------------- the skyline: a glass tower, and hills
  {
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      pts.push(new THREE.Vector2(7 * Math.sqrt(Math.max(0, 1 - Math.pow(t, 3))), t * 44));
    }
    const tower = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), new THREE.MeshStandardMaterial({ map: tex.glassTower(), roughness: 0.3, metalness: 0.2 }));
    tower.position.set(78, 0, -30);
    root.add(tower);
    decor.add('matte', 0x7f9a6a, xform(new THREE.SphereGeometry(1, 20, 10), [-60, -8, -150], [0, 0, 0], [70, 34, 30]));
    decor.add('matte', 0xe9e2d2, box(5, 6, 5, -60, 27, -140));
    decor.add('matte', 0xe9e2d2, xform(new THREE.ConeGeometry(1.2, 8, 8), [-60, 34, -140]));
    decor.add('matte', 0x8aa676, xform(new THREE.SphereGeometry(1, 20, 10), [-110, -6, 40], [0, 0, 0], [40, 22, 50]));
  }

  // ---------------------------------------------------------------- life: parakeets overhead, pigeons below
  parakeets(view, 7);
  pigeons(view, [[1.2, -6], [-2, -9.5], [3, -11], [-1, 6.5], [0.6, 16]]);

  // ---------------------------------------------------------------- seats: iron-and-wood benches, café chairs, the mosaic bench
  const vertex = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  view.styles.bench = {
    desk: {
      geo: parts([
        ...[-0.16, 0, 0.16].map((z) => [box(0.9, 0.04, 0.12, 0, 0.42, z), 0x9a6a3a]),
        [xform(box(0.9, 0.1, 0.03), [0, 0.62, 0.24], [-0.25, 0, 0]), 0x9a6a3a],
        [xform(box(0.9, 0.1, 0.03), [0, 0.8, 0.28], [-0.25, 0, 0]), 0x9a6a3a],
        ...[-0.42, 0.42].map((x) => [box(0.05, 0.42, 0.5, x, 0.21, 0.02), 0x23302a]),
        ...[-0.42, 0.42].map((x) => [box(0.05, 0.5, 0.05, x, 0.68, 0.27), 0x23302a]),
      ]),
      mat: vertex,
    },
    chair: null,
    lamp: null,
    notebook: null,
    books: null,
    tea: null,
    pick: [1.0, 1.2, 1.0, -0.1],
  };
  view.styles.chair = {
    desk: { geo: parts(chairParts(0x2b2a2c, 0xc0392b)), mat: vertex },
    chair: null,
    lamp: null,
    notebook: null,
    books: null,
    tea: null,
    pick: [0.7, 1.3, 0.8, 0.1],
  };
  view.styles.stone = { desk: null, chair: null, lamp: null, notebook: null, books: null, tea: null, pick: [0.9, 1.2, 0.9, -0.05] };
  for (const [bx, bz] of P.benchSpots) shadowDecal(root, bx, bz, 2, 2, 0.2);

  decor.build(root, mats);
  craneJib.decor.build(craneJib.jib, mats);
}
