// Italy. Inside the Colosseum: desks on the sandy arena floor under the open sky, ringed
// by the podium wall and rising tiers of stone seats (taller on the far side, ruined on
// the near one), banners, braziers, statues and the excavated maze of the hypogeum.
// Outside in Rome: the Colosseum's arcades, a triumphal arch, a fountain, umbrella pines
// and cypresses, ochre buildings with green shutters, a café terrace, scooters and a
// little car, a gelato cart, ruins of the Forum and a dome on the skyline.

import * as THREE from '../../vendor/three.module.min.js';
import { DESK_TOP } from '../../shared/layout.js';
import * as tex from '../textures.js';
import { Decor, decorMaterials, parts, merge } from '../geo.js';
import { HALF, door, signMesh, shadowDecal, oilLamp, chairParts, box, cyl, sphere, xform } from './common.js';
import { outdoors, pickBox, fires, spray, pigeons, blockCamera } from './outdoor.js';

const TRAVERTINE = 0xd9c8a6;
const MARBLE = 0xf1ece2;
const PINE = 0x3f6b3a;

/** An elliptical band of wall (open cylinder) facing inward or outward, between angles. */
function ellipseWall(a, b, y0, h, { inward = true, start = 0, length = Math.PI * 2, segments = 64, map = null, color = 0xffffff, repeat = 8 } = {}) {
  const g = new THREE.CylinderGeometry(1, 1, h, segments, 1, true, start, length);
  g.scale(a, 1, b).translate(0, y0 + h / 2, 0);
  if (map) {
    map.wrapS = THREE.RepeatWrapping;
    map.repeat.set(repeat, 1);
  }
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map, color, roughness: 0.9, side: inward ? THREE.BackSide : THREE.FrontSide }));
}

/** A flat elliptical ring (a row of seats seen from above). */
function ellipseRing(a0, b0, a1, b1, y, { start = 0, length = Math.PI * 2, segments = 64 } = {}) {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= segments; i++) {
    const t = start + (i / segments) * length;
    const s = Math.sin(t);
    const c = Math.cos(t);
    pos.push(a0 * s, y, b0 * c, a1 * s, y, b1 * c);
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A Roman in a toga on a pedestal, in white marble. */
function statue(decor, x, z, ry = 0, scale = 1) {
  const s = scale;
  const at = (geo) => xform(geo, [x, 0, z], [0, ry, 0], s);
  decor.add('matte', 0xd8d0c0, at(box(1.0, 1.2, 1.0, 0, 0.6, 0)));
  decor.add('matte', 0xe6dfd2, at(box(1.15, 0.12, 1.15, 0, 1.26, 0)));
  decor.add('matte', MARBLE, at(cyl(0.28, 0.42, 1.6, 12, 0, 2.1, 0)));
  decor.add('matte', MARBLE, at(cyl(0.22, 0.28, 0.6, 12, 0, 3.15, 0)));
  decor.add('matte', MARBLE, at(sphere(0.2, 14, 10, 0, 3.66, 0.02)));
  decor.add('matte', MARBLE, at(xform(box(0.12, 0.7, 0.12), [0.32, 3.0, 0.15], [0.6, 0, -0.3])));
  decor.add('matte', MARBLE, at(xform(box(0.6, 1.3, 0.2), [-0.1, 2.5, 0.16], [0, 0, 0.35])));
}

// ------------------------------------------------------------------ inside the Colosseum

export function colosseum(view) {
  const P = view.place;
  const { a, b } = P.arena;
  const root = view.root;
  const mats = decorMaterials();
  const decor = new Decor();

  outdoors(view, {
    sky: ['#4a8fe0', '#d8ebfa', '#c9b28a'],
    fog: 0xdfe9f2,
    fogNear: 70,
    fogFar: 200,
    sun: 0xfff0d6,
    sunPos: [20, 42, 26],
    sunPower: 2.4,
    hemi: [0xe2efff, 0xb8a27a, 1.45],
    ground: tex.cobbles({ repeat: [40, 40] }),
    clouds: 7,
  });
  view.exposure = 1.0;
  // You arrive by the east gate; the camera starts on the low (ruined) south side, looking in.
  Object.assign(view.cam, { pitch: 0.58, dist: 16, ahead: 0, minDist: 5, maxDist: 32, yawLimit: null, far: 340, spawnYaw: 0.5, splash: { x: 0, z: 0, dist: 30, pitch: 0.55, swing: 0.5 } });

  // ---------------------------------------------------------------- the arena floor
  const sand = tex.sand({ repeat: [8, 6], base: '#d6bd8c' });
  sand.anisotropy = view.aniso;
  const arena = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-HALF).scale(a + 0.2, 1, b + 0.2), new THREE.MeshStandardMaterial({ map: sand, roughness: 1 }));
  arena.position.y = 0.01;
  root.add(arena);
  // The excavated maze of walls where animals and scenery once waited below the floor.
  {
    const [x0, z0, x1, z1] = P.hypogeum;
    decor.add('matte', 0x6b5a45, box(x1 - x0, 0.02, z1 - z0), [(x0 + x1) / 2, 0.012, (z0 + z1) / 2]);
    for (let x = x0 + 0.6; x < x1; x += 1.3) decor.add('matte', 0xbfa98a, box(0.3, 0.7, z1 - z0 - 0.4), [x, 0.35, (z0 + z1) / 2]);
    for (let z = z0 + 1.1; z < z1; z += 2.2) decor.add('matte', 0xb59f80, box(x1 - x0 - 0.4, 0.5, 0.25), [(x0 + x1) / 2, 0.25, z]);
    for (const z of [z0, z1]) decor.add('matte', 0x6b4a2c, box(x1 - x0, 0.06, 0.06), [(x0 + x1) / 2, 0.95, z]);
    for (const x of [x0, x1]) decor.add('matte', 0x6b4a2c, box(0.06, 0.06, z1 - z0), [x, 0.95, (z0 + z1) / 2]);
    for (let k = 0; k <= 8; k++) {
      decor.add('matte', 0x6b4a2c, box(0.06, 1.0, 0.06), [x0 + ((x1 - x0) * k) / 8, 0.5, z0]);
      decor.add('matte', 0x6b4a2c, box(0.06, 1.0, 0.06), [x0 + ((x1 - x0) * k) / 8, 0.5, z1]);
    }
  }

  // ---------------------------------------------------------------- the podium wall and the tiers
  const podium = tex.arcade({ arches: 6, levels: 1, attic: false, stone: '#e2d4b6', dark: '#8a7458' });
  root.add(ellipseWall(a + 0.3, b + 0.3, 0, 3.2, { map: podium, repeat: 18 }));
  const seatMat = new THREE.MeshStandardMaterial({ map: tex.steps(), roughness: 0.95, side: THREE.DoubleSide });
  const riserMat = new THREE.MeshStandardMaterial({ color: 0xbfae8c, roughness: 0.95, side: THREE.BackSide });
  // Tall on the far (north) side, broken down to a few rows on the near side.
  const seats = [];
  const risers = [];
  const rows = 14;
  for (let k = 0; k < rows; k++) {
    const s0 = 1.02 + k * 0.07;
    const s1 = s0 + 0.07;
    const y = 3.2 + k * 0.9;
    const near = k < 5;
    const start = near ? 0 : HALF + 0.25 - (k - 5) * 0.03;
    const length = near ? Math.PI * 2 : Math.PI - 0.5 + (k - 5) * 0.06;
    seats.push(ellipseRing(a * s0, b * s0, a * s1, b * s1, y + 0.9, { start, length }));
    const g = new THREE.CylinderGeometry(1, 1, 0.9, 64, 1, true, start, length);
    g.scale(a * s0, 1, b * s0).translate(0, y + 0.45, 0);
    risers.push(g);
  }
  root.add(new THREE.Mesh(merge(seats.map((g) => {
    const uv = new Float32Array(g.attributes.position.count * 2);
    for (let i = 0; i < uv.length / 2; i++) uv.set([(i >> 1) / 4, i % 2], i * 2);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  })), seatMat));
  root.add(new THREE.Mesh(merge(risers), riserMat));
  // The surviving outer ring on the north side, arches open to the sky.
  const outer = tex.arcade({ arches: 6, levels: 2, attic: true, stone: '#d9c8a6', dark: '#a9cdea' });
  root.add(ellipseWall(a * 2.05, b * 2.05, 3.2 + rows * 0.9 - 0.2, 9, { map: outer, repeat: 14, start: HALF + 0.35, length: Math.PI - 0.7 }));
  // Canvas awnings (the velarium) along the top of the north side.
  for (let k = 0; k < 9; k++) {
    const t = HALF + 0.55 + (k / 8) * (Math.PI - 1.1);
    const x = Math.sin(t) * a * 2.0;
    const z = Math.cos(t) * b * 2.0;
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.2), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xf3e6c8 : 0xe8c9a0, side: THREE.DoubleSide, roughness: 0.9 }));
    sail.position.set(x * 0.94, 3.2 + rows * 0.9 + 8.6, z * 0.94);
    sail.lookAt(0, 10, 0);
    sail.rotateX(-0.7);
    root.add(sail);
  }

  // ---------------------------------------------------------------- banners, braziers, statues
  const banner = tex.sign({ text: 'SPQR', sub: '❦', w: 128, h: 256, bg: '#8a1f1f', fg: '#f0c75a', border: '#f0c75a', size: 0.2, subSize: 0.28, radius: 4 });
  for (let k = 0; k < 10; k++) {
    const t = (k / 10) * Math.PI * 2 + 0.31;
    const x = Math.sin(t) * (a + 0.25);
    const z = Math.cos(t) * (b + 0.25);
    const m = signMesh(view, banner, 0.9, 1.8, x * 0.995, 2.1, z * 0.995, Math.atan2(-x, -z));
    m.renderOrder = 2;
  }
  const flames = [];
  for (const [x, z] of P.braziers) {
    decor.add('gloss', 0x7a5a2a, cyl(0.06, 0.12, 1.2, 8), [x, 0.6, z]);
    decor.add('gloss', 0x9a7a3a, cyl(0.2, 0.3, 0.06, 12), [x, 0.03, z]);
    decor.add('gloss', 0xb08a3a, cyl(0.46, 0.24, 0.3, 16), [x, 1.3, z]);
    decor.add('glow', 0xff8a30, cyl(0.4, 0.4, 0.04, 16), [x, 1.44, z]);
    flames.push([x, 1.42, z, 0.55]);
  }
  fires(view, flames, { glowSize: 2.6 });
  statue(decor, 0, -11.4, 0, 1.05);
  statue(decor, -14.5, -7.6, 0.8, 0.95);
  statue(decor, 14.5, -7.6, -0.8, 0.95);

  // ---------------------------------------------------------------- the gate out to Rome
  {
    const gx = a + 0.1;
    decor.add('matte', TRAVERTINE, box(0.6, 2.6, 0.6), [gx, 1.3, -1.5]);
    decor.add('matte', TRAVERTINE, box(0.6, 2.6, 0.6), [gx, 1.3, 1.5]);
    decor.add('matte', TRAVERTINE, xform(new THREE.TorusGeometry(1.5, 0.3, 8, 20, Math.PI), [gx, 2.6, 0], [0, HALF, 0]));
    decor.add('matte', 0xcbb894, box(0.7, 0.5, 3.9), [gx, 4.35, 0]);
    decor.add('glow', 0xfff3dc, box(0.06, 3.6, 2.4), [gx + 0.3, 1.8, 0]);
    const out = tex.sign({ text: 'Roma →', sub: '로마 시내로', w: 512, h: 160, bg: '#8a1f1f', fg: '#f6e7c4', border: '#f0c75a' });
    signMesh(view, out, 1.5, 0.47, gx - 0.37, 4.35, 0, -HALF);
    door(view, 'rome', { x: gx - 0.3, y: 1.8, z: 0, w: 0.8, h: 3.6, d: 3.2, arrowAt: [gx - 0.8, 5.2, 0], arrowRot: HALF, color: 0xf0c75a });
    view.tags = [{ kind: 'rome', at: [gx - 0.5, 6.2, 0] }];
  }

  // ---------------------------------------------------------------- seats: oak tables, stools, bronze oil lamps
  const wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  for (const [x, z] of P.tables) {
    for (const lx of [-2.3, 0, 2.3]) for (const lz of [-0.6, 0.6]) decor.add('matte', 0x5a3a24, box(0.12, DESK_TOP - 0.05, 0.12), [x + lx, (DESK_TOP - 0.05) / 2, z + lz]);
    shadowDecal(root, x, z, 6, 3.4, 0.22);
  }
  view.styles.desk = {
    desk: { geo: parts([[box(1.2, 0.06, 0.7, 0, DESK_TOP - 0.03, 0), 0x8a5a36], [box(1.2, 0.02, 0.04, 0, DESK_TOP + 0.002, -0.33), 0xc9a45c]]), mat: wood },
    chair: {
      geo: parts([
        [box(0.48, 0.06, 0.42, 0, 0.45, 0), 0x6b4329],
        [box(0.5, 0.05, 0.08, 0, 0.47, 0.2), 0x8a1f1f],
        ...[[-0.2, -0.17], [0.2, -0.17], [-0.2, 0.17], [0.2, 0.17]].map(([x, z]) => [cyl(0.03, 0.025, 0.44, 6, x, 0.22, z), 0x4a2c18]),
      ]),
      mat: wood,
    },
    lamp: oilLamp({ color: 0x9a6a2a }),
    notebook: [-0.06, 0.07],
    books: [-0.38, -0.13, 1],
    tea: [-0.42, 0.17],
    pick: [1.5, 1.4, 2.05, 0.36],
  };

  decor.build(root, mats);
}

// ------------------------------------------------------------------ outside: Rome

/** An umbrella pine: a tall bare trunk and a broad flat crown. */
function umbrellaPine(decor, x, z, h = 8) {
  decor.add('matte', 0x6b4a32, xform(cyl(0.2, 0.32, h, 8), [x, h / 2, z], [0.05, 0, 0.04]));
  decor.add('matte', 0x6b4a32, xform(cyl(0.1, 0.16, 2.4, 6), [x + 0.8, h - 0.6, z], [0, 0, -0.9]));
  decor.add('matte', 0x6b4a32, xform(cyl(0.1, 0.16, 2.4, 6), [x - 0.7, h - 0.5, z + 0.3], [0.2, 0, 0.9]));
  for (const [dx, dz, r, dy] of [[0, 0, 3.4, 0.4], [1.8, 0.4, 2.2, 0.1], [-1.9, 0.6, 2.3, 0], [0.4, -1.8, 2.2, 0.2], [-0.2, 1.9, 2.1, 0.1]]) {
    decor.add('leaf', [PINE, 0x4a7a42, 0x355f33][(dx + dz > 0) | 0], xform(new THREE.SphereGeometry(r, 12, 6), [x + dx, h + 0.4 + dy, z + dz], [0, 0, 0], [1, 0.32, 1]));
  }
}

function cypress(decor, x, z, h = 7) {
  decor.add('matte', 0x5a3a24, cyl(0.12, 0.16, 1, 6), [x, 0.5, z]);
  decor.add('leaf', 0x2f5a35, xform(new THREE.SphereGeometry(0.75, 10, 8), [x, h / 2 + 0.4, z], [0, 0, 0], [1, h / 1.6, 1]));
}

function vespa(decor, x, z, ry, color) {
  const at = (geo) => xform(geo, [x, 0, z], [0, ry, 0]);
  for (const s of [-0.55, 0.55]) decor.add('gloss', 0x222222, at(xform(new THREE.TorusGeometry(0.2, 0.07, 6, 14), [0, 0.22, s], [0, HALF, 0])));
  decor.add('gloss', color, at(xform(new THREE.SphereGeometry(0.3, 12, 8), [0, 0.48, -0.35], [0, 0, 0], [1.1, 0.9, 1.4])));
  decor.add('gloss', color, at(box(0.3, 0.1, 0.7, 0, 0.32, 0.1)));
  decor.add('gloss', color, at(xform(box(0.28, 0.8, 0.12), [0, 0.65, 0.48], [-0.25, 0, 0])));
  decor.add('gloss', 0x5a3a24, at(box(0.3, 0.1, 0.5, 0, 0.66, -0.3)));
  decor.add('gloss', 0xc0c0c8, at(box(0.62, 0.04, 0.04, 0, 1.05, 0.6)));
  decor.add('glow', 0xfff3d0, at(sphere(0.07, 8, 6, 0, 0.98, 0.66)));
}

export function rome(view) {
  const P = view.place;
  const root = view.root;
  const mats = decorMaterials();
  const decor = new Decor();

  outdoors(view, {
    sky: ['#3f87dc', '#f1e3c6', '#c9b08a'],
    fog: 0xeadfca,
    fogNear: 60,
    fogFar: 190,
    sun: 0xffe8c4,
    sunPos: [-30, 40, 24],
    sunPower: 2.6,
    hemi: [0xe6efff, 0xb89a72, 1.45],
    ground: tex.cobbles({ repeat: [70, 70] }),
    clouds: 7,
  });
  view.exposure = 1.08;
  Object.assign(view.cam, {
    pitch: 0.55,
    dist: 22,
    ahead: 0,
    minDist: 5,
    maxDist: 38,
    yawLimit: null,
    far: 340,
    // Out of the Colosseum you turn to face the city.
    arrive: { colosseum: Math.PI },
    splash: { x: 0, z: 0, dist: 36, pitch: 0.42, swing: 0.45 },
  });

  // ---------------------------------------------------------------- the Colosseum from outside
  {
    const C = P.colosseum;
    const group = new THREE.Group();
    group.position.set(C.x, 0, C.z);
    const facade = tex.arcade({ arches: 4, levels: 3, attic: true, stone: '#dccaa6', dark: '#3a2c22' });
    // Intact on the side facing the piazza, broken down to two storeys round the west.
    group.add(ellipseWall(C.a, C.b, 0, 24, { inward: false, map: facade, repeat: 3.6, start: -0.9, length: 2.4, segments: 40 }));
    const lower = tex.arcade({ arches: 4, levels: 2, attic: false, stone: '#d4c19c', dark: '#3a2c22' });
    group.add(ellipseWall(C.a, C.b, 0, 15, { inward: false, map: lower, repeat: 7, start: 1.5, length: Math.PI * 2 - 2.4, segments: 64 }));
    const inner = tex.arcade({ arches: 4, levels: 2, attic: false, stone: '#cdb995', dark: '#4a3a2c' });
    group.add(ellipseWall(C.a * 0.86, C.b * 0.86, 0, 19, { inward: false, map: inner, repeat: 8, segments: 64 }));
    // The jagged edge where the outer ring breaks off.
    for (let k = 0; k < 6; k++) {
      const t = -0.9 - k * 0.05;
      decor.add('matte', 0xd4c19c, box(2.2, 24 - k * 1.6, 2.4), [C.x + Math.sin(t) * C.a * 0.97, (24 - k * 1.6) / 2, C.z + Math.cos(t) * C.b * 0.97], t);
    }
    root.add(group);
    blockCamera(view, ...group.children);
    // The entrance arch facing the piazza, numbered like the originals.
    const gz = C.z + C.b;
    const num = tex.sign({ text: 'LII', w: 256, h: 96, bg: '#dccaa6', fg: '#4a3a2c', size: 0.6, radius: 2 });
    signMesh(view, num, 1.2, 0.45, 0, 6.2, gz + 0.12);
    decor.add('glow', 0xffe2b0, box(2.6, 3.4, 0.08), [0, 1.7, gz + 0.06]);
    decor.add('matte', 0xcfbd98, box(3.4, 0.4, 0.5), [0, 3.6, gz + 0.1]);
    door(view, 'colosseum', { x: 0, y: 2.6, z: gz + 0.4, w: 4, h: 5.2, d: 1, arrowAt: [0, 7.2, gz + 1.2], color: 0xf0c75a });
    pickBox(view, 'colosseum', 0, 10, gz - 1.6, 34, 20, 1.2);
    view.tags = [{ kind: 'colosseum', at: [0, 8.8, gz + 1.4] }];
  }

  // ---------------------------------------------------------------- a triumphal arch
  {
    const { x, z } = P.arch;
    const st = 0xe0d2b4;
    decor.add('matte', st, box(2.0, 7.0, 2.8), [x - 2.4, 3.5, z]);
    decor.add('matte', st, box(2.0, 7.0, 2.8), [x + 2.4, 3.5, z]);
    decor.add('matte', st, box(6.8, 2.2, 2.8), [x, 8.1, z]);
    decor.add('matte', 0xd2c3a2, box(7.2, 0.4, 3.0), [x, 7.0, z]);
    decor.add('matte', st, xform(new THREE.TorusGeometry(1.4, 0.35, 8, 16, Math.PI), [x, 5.6, z + 1.25]));
    decor.add('matte', st, xform(new THREE.TorusGeometry(1.4, 0.35, 8, 16, Math.PI), [x, 5.6, z - 1.25]));
    for (const s of [-1, 1]) {
      for (const f of [-1, 1]) {
        decor.add('matte', MARBLE, cyl(0.28, 0.3, 6.6, 12), [x + s * 1.65, 3.3, z + f * 1.62]);
        decor.add('matte', MARBLE, cyl(0.28, 0.3, 6.6, 12), [x + s * 3.15, 3.3, z + f * 1.62]);
      }
      decor.add('matte', MARBLE, box(0.6, 1.2, 0.6), [x + s * 2.4, 9.8, z]);
      decor.add('matte', MARBLE, sphere(0.35, 10, 8), [x + s * 2.4, 10.6, z]);
    }
    const inscription = tex.sign({ text: 'SENATVS·POPVLVSQVE', sub: 'ROMANVS', w: 512, h: 160, bg: '#d8c9a8', fg: '#5a4630', size: 0.24, subSize: 0.22, radius: 2 });
    signMesh(view, inscription, 4.4, 1.4, x, 8.2, z + 1.42);
    shadowDecal(root, x + 1, z + 1.6, 9, 5, 0.3);
  }

  // ---------------------------------------------------------------- the fountain
  {
    const F = P.fountain;
    decor.add('matte', MARBLE, cyl(F.r, F.r + 0.2, 0.75, 40), [F.x, 0.375, F.z]);
    decor.add('matte', 0xe2dbcf, xform(new THREE.TorusGeometry(F.r - 0.08, 0.14, 8, 40), [F.x, 0.76, F.z], [HALF, 0, 0]));
    decor.add('matte', 0xbdb2a2, xform(new THREE.DodecahedronGeometry(1.3, 0), [F.x, 1.0, F.z], [0, 0, 0], [1.2, 0.8, 1.1]));
    statue(decor, F.x, F.z, Math.PI * 0.1, 0.8);
    for (let k = 0; k < 4; k++) {
      const t = (k / 4) * Math.PI * 2 + Math.PI / 4;
      decor.add('matte', MARBLE, xform(new THREE.ConeGeometry(0.25, 0.7, 8), [F.x + Math.sin(t) * 1.3, 1.3, F.z + Math.cos(t) * 1.3], [Math.cos(t) * 0.9, 0, -Math.sin(t) * 0.9]));
    }
    const waterTex = tex.water({ seed: 7 });
    const water = new THREE.Mesh(new THREE.CircleGeometry(F.r - 0.15, 40).rotateX(-HALF), new THREE.MeshStandardMaterial({ map: waterTex, color: 0x9fdcef, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.92 }));
    water.position.set(F.x, 0.62, F.z);
    root.add(water);
    view.updaters.push((dt) => {
      waterTex.offset.x = (waterTex.offset.x + dt * 0.03) % 1;
      waterTex.offset.y = (waterTex.offset.y + dt * 0.02) % 1;
    });
    spray(view, F.x, F.z, { top: 4.4, floor: 0.66, count: 80, spread: 0.7, lift: 1.4 });
    pigeons(view, [[2.6, 9.5], [-3.2, 10.4], [4.4, 1.0], [-4.6, 0.4], [1.0, 11.8], [-1.6, -1.2]]);
  }

  // ---------------------------------------------------------------- streets of ochre buildings
  const walls = [
    { wall: '#e3b36a', shutter: '#3f6b4a', shop: '#7a3b26' },
    { wall: '#d9875a', shutter: '#2f5a48', shop: '#5a3a26' },
    { wall: '#efd59a', shutter: '#4a6b3a', shop: '#6a2f22' },
    { wall: '#e8b9a0', shutter: '#3a5a6a', shop: '#4a3a2a' },
    { wall: '#c96f4a', shutter: '#2f4f3a', shop: '#3a2a20' },
  ].map((c, k) => tex.romanFacade({ ...c, seed: 20 + k, rows: 3, cols: 3 }));
  let n = 0;
  for (const [x0, z0, x1, z1] of P.buildings) {
    const alongX = x1 - x0 > z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    const count = Math.max(1, Math.round(len / 8));
    for (let k = 0; k < count; k++) {
      const h = 11 + ((n * 7) % 3) * 2.5;
      const map = walls[n % walls.length];
      const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.95 });
      const plain = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xd9a86a).offsetHSL((n % 5) * 0.01, 0, 0), roughness: 0.95 });
      const w = alongX ? len / count : x1 - x0;
      const d = alongX ? z1 - z0 : len / count;
      const cx = alongX ? x0 + (k + 0.5) * w : (x0 + x1) / 2;
      const cz = alongX ? (z0 + z1) / 2 : z0 + (k + 0.5) * d;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mat, mat, plain, plain, mat, mat]);
      m.position.set(cx, h / 2, cz);
      root.add(m);
      blockCamera(view, m);
      decor.add('matte', 0xf0e2c4, box(w + 0.4, 0.45, d + 0.4), [cx, h + 0.2, cz]);
      const roof = new THREE.Shape();
      const rw = (alongX ? w : d) / 2 + 0.3;
      roof.moveTo(-rw, 0);
      roof.lineTo(rw, 0);
      roof.lineTo(0, 2.2);
      roof.closePath();
      const rg = new THREE.ExtrudeGeometry(roof, { depth: (alongX ? d : w) + 0.4, bevelEnabled: false });
      rg.translate(0, 0, -((alongX ? d : w) + 0.4) / 2);
      if (!alongX) rg.rotateY(HALF);
      rg.translate(cx, h + 0.4, cz);
      decor.add('matte', 0xb5563a, rg);
      n++;
    }
  }
  // Awnings over the café, and its terrace.
  for (const z of [7, 10.4, 13.8]) {
    const aw = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.8), new THREE.MeshStandardMaterial({ map: tex.stripes({ a: '#8a1f1f', b: '#f3e6c8', n: 8 }), side: THREE.DoubleSide }));
    aw.rotation.set(-HALF + 0.5, HALF, 0, 'YXZ');
    aw.position.set(-22.3, 3.0, z);
    root.add(aw);
  }
  const cafeSign = tex.sign({ text: 'Caffè', sub: 'Gelato · Espresso', w: 512, h: 160, bg: '#2f4f3a', fg: '#f6ecd6', border: '#c9a45c' });
  signMesh(view, cafeSign, 3.6, 1.1, -22.96, 4.6, 10.4, HALF);
  for (const [x, z] of P.cafeTables) {
    decor.add('gloss', 0x2b2a2c, cyl(0.03, 0.03, 0.72, 8), [x, 0.36, z]);
    decor.add('matte', MARBLE, cyl(0.34, 0.34, 0.04, 18), [x, 0.74, z]);
    decor.add('gloss', 0x2b2a2c, cyl(0.18, 0.22, 0.03, 12), [x, 0.015, z]);
    decor.add('gloss', 0xffffff, cyl(0.04, 0.03, 0.06, 10), [x + 0.1, 0.79, z]);
    decor.add('matte', 0xd9cbb4, cyl(0.025, 0.025, 2.0, 6), [x, 1.0, z]);
    decor.add('matte', 0xf3e6c8, new THREE.ConeGeometry(1.1, 0.5, 10, 1, true), [x, 2.15, z]);
  }

  // ---------------------------------------------------------------- pines, cypresses, lamps
  P.pines.forEach(([x, z], k) => {
    umbrellaPine(decor, x, z, 7.5 + (k % 3) * 1.2);
    shadowDecal(root, x + 1, z + 0.8, 7, 7, 0.22);
  });
  P.cypress.forEach(([x, z], k) => cypress(decor, x, z, 6.5 + (k % 2) * 1.5));
  for (const [x, z] of P.lamps) {
    decor.add('gloss', 0x2f3a2f, cyl(0.06, 0.1, 3.4, 8), [x, 1.7, z]);
    decor.add('gloss', 0x2f3a2f, cyl(0.17, 0.2, 0.25, 8), [x, 0.12, z]);
    decor.add('glass', 0xfff1cf, cyl(0.14, 0.1, 0.38, 6), [x, 3.6, z]);
    decor.add('glow', 0xffe2a0, sphere(0.06, 8, 6), [x, 3.58, z]);
    decor.add('gloss', 0x2f3a2f, xform(new THREE.ConeGeometry(0.2, 0.2, 6), [x, 3.9, z]));
  }

  // ---------------------------------------------------------------- scooters, a little car, a gelato cart
  vespa(decor, -19.6, 2.6, 0.3, 0x9fd3c7);
  vespa(decor, -19.4, 4.0, 0.2, 0xf2c94c);
  vespa(decor, 8.4, 18.8, -1.4, 0xe76f51);
  {
    const [x0, z0, x1, z1] = P.fiat;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const at = (geo) => xform(geo, [cx, 0, cz], [0, HALF, 0]);
    decor.add('gloss', 0x7fc8b0, at(xform(new THREE.SphereGeometry(1, 16, 10), [0, 0.62, 0], [0, 0, 0], [0.72, 0.42, 1.35])));
    decor.add('gloss', 0x7fc8b0, at(xform(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, HALF), [0, 0.88, -0.1], [0, 0, 0], [0.6, 0.42, 0.75])));
    decor.add('glass', 0xbfe3ff, at(xform(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, HALF), [0, 0.89, -0.1], [0, 0, 0], [0.62, 0.38, 0.77])));
    for (const [sx, sz] of [[-0.62, 0.8], [0.62, 0.8], [-0.62, -0.85], [0.62, -0.85]]) decor.add('gloss', 0x222222, at(xform(new THREE.TorusGeometry(0.22, 0.08, 6, 14), [sx, 0.26, sz], [0, HALF, 0])));
    decor.add('glow', 0xfff3d0, at(sphere(0.1, 8, 6, -0.4, 0.62, 1.33)));
    decor.add('glow', 0xfff3d0, at(sphere(0.1, 8, 6, 0.4, 0.62, 1.33)));
    shadowDecal(root, cx, cz, 3.4, 2.2, 0.35);
  }
  {
    const [x0, z0, x1, z1] = P.cart;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    decor.add('matte', 0xf3e6c8, box(x1 - x0, 0.9, z1 - z0, cx, 0.65, cz));
    decor.add('matte', 0xe76f51, box(x1 - x0 + 0.02, 0.18, z1 - z0 + 0.02, cx, 0.4, cz));
    decor.add('glass', 0xdff0ff, box(x1 - x0 - 0.2, 0.3, z1 - z0 - 0.2, cx, 1.25, cz));
    for (let k = 0; k < 6; k++) decor.add('matte', [0xf7c6d0, 0xfff1c1, 0xa8d5a2, 0x6b3a2a, 0xf4a261, 0xcdb4db][k], sphere(0.12, 8, 6, x0 + 0.35 + k * 0.33, 1.18, cz), 0);
    for (const s of [-1, 1]) decor.add('gloss', 0x2b2a2c, xform(new THREE.TorusGeometry(0.3, 0.05, 6, 14), [cx + s * 0.8, 0.3, z1 + 0.05]));
    decor.add('matte', 0xd9cbb4, cyl(0.025, 0.025, 1.8, 6), [cx, 1.9, cz]);
    const um = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.5, 12, 1, true), new THREE.MeshStandardMaterial({ map: tex.stripes({ a: '#e76f51', b: '#fff6e6', n: 12 }), side: THREE.DoubleSide }));
    um.position.set(cx, 2.85, cz);
    root.add(um);
  }

  // ---------------------------------------------------------------- the Forum, and a dome on the skyline
  P.ruins.forEach(([x, z], k) => {
    const h = [6.5, 6.5, 3.2][k];
    decor.add('matte', 0xe6dccb, cyl(0.38, 0.42, h, 14), [x, h / 2, z]);
    decor.add('matte', 0xd8ccb6, box(1.1, 0.5, 1.1), [x, h + 0.25, z]);
    decor.add('matte', 0xd8ccb6, box(1.2, 0.3, 1.2), [x, 0.15, z]);
  });
  decor.add('matte', 0xd8ccb6, box(4.4, 0.8, 1.0), [-19.5, 7.4, -18.8], -0.38);
  decor.add('matte', 0xe6dccb, xform(cyl(0.38, 0.38, 2.4, 14), [-12.6, 0.38, -19.6], [0, 0.6, HALF]));
  {
    const dx = 34;
    const dz = -78;
    decor.add('matte', 0xe6dccb, cyl(9, 9, 8, 32), [dx, 14, dz]);
    decor.add('matte', 0xd9cdb6, box(30, 10, 14), [dx, 5, dz + 8]);
    decor.add('gloss', 0x9aa6a0, new THREE.SphereGeometry(9, 32, 16, 0, Math.PI * 2, 0, HALF), [dx, 18, dz]);
    decor.add('matte', 0xe6dccb, cyl(1.4, 1.4, 3, 12), [dx, 28.5, dz]);
    decor.add('gloss', 0xc9a45c, sphere(0.6, 10, 8), [dx, 30.6, dz]);
  }
  for (let k = 0; k < 14; k++) {
    const t = (k / 14) * Math.PI * 2;
    const r = 58 + (k % 3) * 8;
    umbrellaPine(decor, Math.cos(t) * r, Math.sin(t) * r * 0.85, 9);
  }

  // ---------------------------------------------------------------- seats: travertine benches, café chairs
  const vertex = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  view.styles.bench = {
    desk: { geo: parts([[box(0.9, 0.1, 0.5, 0, 0.42, 0), 0xe6dccb], [box(0.25, 0.37, 0.4, -0.3, 0.185, 0), 0xd8ccb6], [box(0.25, 0.37, 0.4, 0.3, 0.185, 0), 0xd8ccb6]]), mat: vertex },
    chair: null,
    lamp: null,
    notebook: null,
    books: null,
    tea: null,
    pick: [1.0, 1.2, 1.0, -0.1],
  };
  view.styles.chair = {
    desk: { geo: parts(chairParts(0x2b2a2c, 0x8a1f1f)), mat: vertex },
    chair: null,
    lamp: null,
    notebook: null,
    books: null,
    tea: null,
    pick: [0.7, 1.3, 0.8, 0.1],
  };
  for (const [bx, bz] of P.benchSpots) shadowDecal(root, bx, bz, 2, 2, 0.2);

  decor.build(root, mats);
}
