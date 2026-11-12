// Japan. Inside a temple hall: tatami, low desks with paper lanterns and floor cushions,
// glowing shoji screens, vermilion pillars, hanging lanterns, gold folding screens and a
// golden seated figure on the altar with candles and incense. Outside in the temple
// garden: the hall's great curved roof, a five-storey pagoda, a bell tower, torii gates
// (and a tunnel of them), stone lanterns, a koi pond with a plank bridge, a raked rock
// garden, cherry and maple trees, a bamboo grove and Mt. Fuji far away.

import * as THREE from '../../vendor/three.module.min.js';
import * as tex from '../textures.js';
import { Decor, decorMaterials, parts, merge, floorPlane, wallPlane } from '../geo.js';
import { HALF, door, signMesh, shadowDecal, wallSides, tree, box, cyl, sphere, xform } from './common.js';
import { outdoors, pickBox, fires, petals, drift, blockCamera, blockBox } from './outdoor.js';

const VERMILION = 0xc8402c;
const LACQUER = 0x2a1a14;
const GOLD = 0xd9a93a;
const ROOF = 0x3f444c;

/**
 * A hipped roof with upturned corners: eaves w×d at eaveY (corners lifted by `lift`),
 * rising to a ridge `ridge` long at ridgeY. Planar UVs for the tile texture.
 */
function hipRoof(w, d, ridge, eaveY, ridgeY, lift = 0.6) {
  const x = w / 2;
  const z = d / 2;
  const r = ridge / 2;
  const up = eaveY + lift;
  const R0 = [-r, ridgeY, 0];
  const R1 = [r, ridgeY, 0];
  const tris = [];
  for (const s of [1, -1]) {
    const A = [-x, up, s * z];
    const B = [-x / 3, eaveY, s * z];
    const C = [x / 3, eaveY, s * z];
    const Dd = [x, up, s * z];
    const faces = [[R0, A, B], [R0, B, C], [R0, C, R1], [R1, C, Dd]];
    for (const f of faces) tris.push(s > 0 ? f : [f[0], f[2], f[1]]);
    const L = [-s * x, eaveY, 0];
    const front = [-s * x, up, z];
    const back = [-s * x, up, -z];
    const end = s > 0 ? R0 : R1;
    tris.push(s > 0 ? [end, L, front] : [end, front, L]);
    tris.push(s > 0 ? [end, back, L] : [end, L, back]);
  }
  const pos = [];
  const uv = [];
  for (const t of tris) {
    for (const p of t) {
      pos.push(...p);
      uv.push((p[0] + p[2]) * 0.5, p[1] * 1.3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

let tileTex = null;
function roofMaterial() {
  if (!tileTex) {
    tileTex = tex.roofTiles({ repeat: [1, 1] });
    tileTex.wrapS = THREE.RepeatWrapping;
    tileTex.wrapT = THREE.RepeatWrapping;
  }
  return new THREE.MeshStandardMaterial({ map: tileTex, color: 0xd0d4dc, roughness: 0.8, side: THREE.DoubleSide });
}

/** A paper lantern hanging at (x, y, z). */
function chochin(decor, x, y, z, color = 0xf2ece0, cord = 1.2) {
  decor.add('matte', 0x222222, cyl(0.008, 0.008, cord, 4), [x, y + 0.35 + cord / 2, z]);
  decor.add('matte', 0x2a2a2a, cyl(0.12, 0.12, 0.06, 12), [x, y + 0.33, z]);
  decor.add('glow', color, xform(new THREE.SphereGeometry(0.26, 14, 10), [x, y, z], [0, 0, 0], [1, 1.25, 1]));
  decor.add('matte', 0x2a2a2a, cyl(0.12, 0.12, 0.06, 12), [x, y - 0.33, z]);
}

/** A stone lantern. */
function toro(decor, x, z, s = 1) {
  const at = (geo) => xform(geo, [x, 0, z], [0, 0, 0], s);
  const stone = 0x9a968c;
  decor.add('matte', stone, at(cyl(0.34, 0.4, 0.25, 6, 0, 0.125, 0)));
  decor.add('matte', stone, at(cyl(0.12, 0.14, 0.8, 8, 0, 0.65, 0)));
  decor.add('matte', stone, at(cyl(0.3, 0.26, 0.14, 6, 0, 1.1, 0)));
  decor.add('matte', 0x8c887e, at(box(0.36, 0.34, 0.36, 0, 1.34, 0)));
  decor.add('glow', 0xffd9a0, at(box(0.22, 0.2, 0.37, 0, 1.34, 0)));
  decor.add('glow', 0xffd9a0, at(box(0.37, 0.2, 0.22, 0, 1.34, 0)));
  decor.add('matte', stone, at(xform(new THREE.ConeGeometry(0.46, 0.34, 6), [0, 1.68, 0])));
  decor.add('matte', stone, at(sphere(0.08, 8, 6, 0, 1.9, 0)));
}

/** A torii gate across x, centred at (x, z), `span` between its pillars. */
function torii(decor, x, z, span, h, { thick = 0.3, color = VERMILION, ry = 0 } = {}) {
  const at = (geo) => xform(geo, [x, 0, z], [0, ry, 0]);
  for (const s of [-1, 1]) {
    decor.add('matte', color, at(cyl(thick, thick * 1.1, h, 12, (s * span) / 2, h / 2, 0)));
    decor.add('matte', 0x1a1a1a, at(cyl(thick * 1.2, thick * 1.25, h * 0.08, 12, (s * span) / 2, h * 0.04, 0)));
    decor.add('matte', 0x1a1a1a, at(xform(box(span * 0.22, thick * 0.9, thick * 2.4), [(s * span) / 2 + s * span * 0.45, h + thick * 1.2, 0], [0, 0, s * 0.12])));
  }
  decor.add('matte', color, at(box(span + thick * 2.6, thick * 0.9, thick * 1.2, 0, h * 0.8, 0)));
  decor.add('matte', 0x1a1a1a, at(box(span * 1.02, thick * 0.9, thick * 2.4, 0, h + thick * 0.9, 0)));
  decor.add('matte', color, at(box(span * 1.0, thick * 0.6, thick * 1.8, 0, h + thick * 0.2, 0)));
}

// ------------------------------------------------------------------ inside the temple hall

export function temple(view) {
  const P = view.place;
  const W = P.width;
  const D = P.depth;
  const H = P.wallHeight;
  const root = view.root;
  const mats = decorMaterials();
  const decor = new Decor();
  const walls = wallSides(view, W, D);

  view.background = new THREE.Color(0x2b1d16);
  view.fog = new THREE.Fog(0x2b1d16, 30, 70);
  view.exposure = 1.08;
  view.haloSize = 0.8;
  Object.assign(view.cam, { pitch: 0.62, dist: 12, yawLimit: 1.1, spawnYaw: 0.78, splash: { x: 0, z: 0, dist: 19, pitch: 0.55, swing: 0.4 } });

  // ---------------------------------------------------------------- soft light through paper screens
  root.add(new THREE.HemisphereLight(0xfff4e4, 0x6b4a32, 1.55));
  root.add(new THREE.AmbientLight(0xffe9d0, 0.38));
  const key = new THREE.DirectionalLight(0xfff2dc, 1.2);
  key.position.set(-12, 10, 4);
  root.add(key);

  // ---------------------------------------------------------------- tatami, wooden borders, walls
  const tat = tex.tatami({ repeat: [(W - 2.4) / 2, (D - 2.4) / 2] });
  tat.anisotropy = view.aniso;
  const floor = new THREE.Mesh(floorPlane(W - 2.4, D - 2.4), new THREE.MeshStandardMaterial({ map: tat, roughness: 0.9 }));
  root.add(floor);
  const plank = tex.planks({ hue: 26, sat: 38, light: 34, plankH: 40, repeat: [6, 6] });
  const edge = new THREE.Mesh(floorPlane(W, D, 0, -0.005, 0), new THREE.MeshStandardMaterial({ map: plank, roughness: 0.5 }));
  root.add(edge);
  view.floors.push(edge, floor);
  const shojiTex = tex.shoji({ cols: 4, rows: 7 });
  shojiTex.wrapS = THREE.RepeatWrapping;
  shojiTex.repeat.set(D / 2.2, 1);
  const shojiMat = new THREE.MeshBasicMaterial({ map: shojiTex, color: 0xfff6e8 });
  const woodWall = (repeat) => new THREE.MeshStandardMaterial({ map: tex.plaster({ top: '#4a2e1f', bottom: '#3a2418', panel: '#2a1a12', rail: '#5a3a24', wainscot: 0.9 / H, repeat: [repeat, 1] }), roughness: 0.6 });
  root.add(
    new THREE.Mesh(wallPlane(W, H, 0, H / 2, -D / 2), woodWall(4)),
    new THREE.Mesh(wallPlane(W, H, 0, H / 2, D / 2, Math.PI), woodWall(4)),
    new THREE.Mesh(wallPlane(D, H - 1.2, -W / 2, (H - 1.2) / 2, 0, HALF), shojiMat),
    new THREE.Mesh(wallPlane(D, H - 1.2, W / 2, (H - 1.2) / 2, 0, -HALF), shojiMat),
    new THREE.Mesh(wallPlane(D, 1.2, -W / 2, H - 0.6, 0, HALF), woodWall(6)),
    new THREE.Mesh(wallPlane(D, 1.2, W / 2, H - 0.6, 0, -HALF), woodWall(6)),
  );
  for (const [side, w, x, z, ry] of [['front', W, 0, -D / 2 + 0.1, 0], ['back', W, 0, D / 2 - 0.1, 0], ['left', D, -W / 2 + 0.1, 0, HALF], ['right', D, W / 2 - 0.1, 0, HALF]]) {
    walls[side].decor.add('matte', LACQUER, box(w, 0.3, 0.2), [x, H - 0.15, z], ry);
    walls[side].decor.add('matte', 0x3a2418, box(w, 0.22, 0.24), [x, H - 1.25, z], ry);
  }

  // ---------------------------------------------------------------- pillars, beams and lanterns
  // The rows of pillars along each side hide, like the walls, when the camera looks in past them.
  const rowDecor = { left: new Decor(), right: new Decor() };
  const rowGroups = {};
  for (const k of ['left', 'right']) {
    rowGroups[k] = new THREE.Group();
    root.add(rowGroups[k]);
    view.cullers.push({ object: rowGroups[k], test: (c) => (k === 'left' ? c.x > -9.3 : c.x < 9.3) });
  }
  for (const [x, z] of P.pillars) {
    const d = rowDecor[x < 0 ? 'left' : 'right'];
    d.add('matte', VERMILION, cyl(0.22, 0.24, H, 14), [x, H / 2, z]);
    d.add('matte', 0x1a1a1a, cyl(0.3, 0.3, 0.12, 14), [x, 0.06, z]);
    d.add('gloss', GOLD, cyl(0.25, 0.25, 0.08, 14), [x, 3.6, z]);
  }
  for (const s of [-1, 1]) {
    const d = rowDecor[s < 0 ? 'left' : 'right'];
    d.add('matte', VERMILION, box(0.3, 0.35, D - 2), [s * 9, 4.6, 0]);
    d.add('matte', LACQUER, box(0.34, 0.12, D - 2), [s * 9, 4.84, 0]);
  }
  const lanterns = [];
  for (const z of [-6, -2, 2, 6]) {
    for (const s of [-1, 1]) lanterns.push([s * 9, 3.6, z + 2]);
  }
  for (const x of [-4, 0, 4]) lanterns.push([x, 4.2, -7.2]);
  lanterns.forEach(([x, y, z], k) => chochin(Math.abs(x) > 8 ? rowDecor[x < 0 ? 'left' : 'right'] : decor, x, y, z, k % 3 === 2 ? 0xffd2b0 : 0xfff1dc, 0.7));
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lanterns.flat(), 3));
  const lglow = new THREE.Points(lg, new THREE.PointsMaterial({ size: 1.4, map: tex.glow(), color: 0xffc888, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  root.add(lglow);
  view.extras.push(lglow);

  // ---------------------------------------------------------------- the altar
  {
    const [x0, z0, x1, z1] = P.dais;
    const cz = (z0 + z1) / 2;
    decor.add('matte', LACQUER, box(x1 - x0, 0.5, z1 - z0), [0, 0.25, cz]);
    decor.add('gloss', GOLD, box(x1 - x0 + 0.04, 0.05, 0.06), [0, 0.48, z1]);
    decor.add('matte', 0x3a241a, box(x1 - x0 - 1, 0.3, z1 - z0 - 0.6), [0, 0.65, cz - 0.2]);
    // A golden seated figure on a lotus, with a radiant halo.
    const fz = z0 + 1.0;
    for (let k = 0; k < 3; k++) decor.add('gloss', GOLD, cyl(1.0 - k * 0.12, 1.1 - k * 0.12, 0.25, 16), [0, 0.95 + k * 0.25, fz]);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      decor.add('gloss', 0xe8bf5a, xform(new THREE.SphereGeometry(0.28, 10, 6), [Math.sin(a) * 0.95, 1.55, fz + Math.cos(a) * 0.95], [0, a, 0], [0.7, 0.5, 1.2]));
    }
    decor.add('gloss', GOLD, xform(new THREE.SphereGeometry(0.75, 18, 10), [0, 1.95, fz + 0.1], [0, 0, 0], [1.25, 0.45, 0.85]));
    decor.add('gloss', GOLD, xform(new THREE.SphereGeometry(0.5, 16, 12), [0, 2.65, fz], [0, 0, 0], [1, 1.2, 0.8]));
    decor.add('gloss', GOLD, sphere(0.34, 16, 12, 0, 3.45, fz + 0.02));
    decor.add('gloss', 0xc4932c, sphere(0.15, 10, 8, 0, 3.78, fz));
    decor.add('gloss', GOLD, xform(new THREE.SphereGeometry(0.2, 10, 8), [0, 2.15, fz + 0.45], [0, 0, 0], [1.4, 0.5, 0.8]));
    decor.add('gloss', 0xe8bf5a, xform(new THREE.TorusGeometry(1.25, 0.08, 8, 40), [0, 3.3, fz - 0.35]));
    decor.add('gloss', 0xc4932c, xform(cyl(1.2, 1.2, 0.05, 40), [0, 3.3, fz - 0.4], [HALF, 0, 0]));
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      decor.add('gloss', GOLD, xform(new THREE.ConeGeometry(0.1, 0.5, 4), [Math.sin(a) * 1.45, 3.3 + Math.cos(a) * 1.45, fz - 0.38], [0, 0, -a]));
    }
    // Candles, incense, flowers and a bowl bell.
    const flames = [];
    for (const s of [-1, 1]) {
      decor.add('gloss', GOLD, cyl(0.06, 0.18, 1.3, 10), [s * 2.6, 1.15, cz + 0.6]);
      decor.add('matte', 0xfaf6ea, cyl(0.06, 0.06, 0.35, 10), [s * 2.6, 1.98, cz + 0.6]);
      flames.push([s * 2.6, 2.16, cz + 0.6, 0.12]);
      decor.add('gloss', 0x7a5a2a, cyl(0.12, 0.08, 0.4, 10), [s * 1.6, 1.0, cz + 0.6]);
      for (let k = 0; k < 4; k++) decor.add('matte', [0xf2a3bb, 0xffffff, GOLD, 0xf2a3bb][k], xform(new THREE.SphereGeometry(0.12, 8, 6), [s * 1.6 + Math.cos(k * 1.6) * 0.1, 1.3 + k * 0.05, cz + 0.6 + Math.sin(k * 1.6) * 0.1], [0, 0, 0], [1, 0.6, 1]));
    }
    fires(view, flames, { glowSize: 1.0, color: 0xffb050 });
    decor.add('gloss', 0x6b4a2a, cyl(0.32, 0.24, 0.3, 16), [0, 0.95, z1 - 0.4]);
    for (const a of [0, 2.1, 4.2]) decor.add('gloss', 0x6b4a2a, cyl(0.03, 0.03, 0.3, 5), [Math.cos(a) * 0.22, 0.65, z1 - 0.4 + Math.sin(a) * 0.22]);
    drift(view, { x: 0, z: z1 - 0.4, w: 0.6, d: 0.6, y0: 1.1, y1: 4.2, count: 70, color: 0xe8e4dc, size: 0.06, wind: [0.04, 0, 0], opacity: 0.4, rise: 0.35 });
    decor.add('gloss', 0x9a7a3a, xform(new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, HALF * 0.6, HALF * 1.4), [3.6, 0.95, cz + 0.4]));
    decor.add('matte', 0x8a1f1f, cyl(0.38, 0.38, 0.1, 14), [3.6, 0.55, cz + 0.4]);
    // A canopy of gold hanging over it all.
    decor.add('gloss', GOLD, box(3.6, 0.2, 3.0), [0, 5.1, fz]);
    for (let k = 0; k < 10; k++) {
      const t = (k / 10) * Math.PI * 2;
      decor.add('gloss', GOLD, cyl(0.01, 0.01, 0.9, 4), [Math.sin(t) * 1.6, 4.55, fz + Math.cos(t) * 1.3]);
      decor.add('gloss', GOLD, sphere(0.06, 6, 5, Math.sin(t) * 1.6, 4.08, fz + Math.cos(t) * 1.3));
    }
  }
  // A great drum, and a gong stand.
  decor.add('matte', 0x5a3a24, box(1.3, 0.8, 0.9), [-9.6, 0.4, -9.6]);
  decor.add('matte', 0x8a2a1f, xform(cyl(0.6, 0.6, 0.9, 18), [-9.6, 1.4, -9.6], [0, 0, HALF]));
  decor.add('matte', 0xe8dcc0, xform(cyl(0.55, 0.55, 0.92, 18), [-9.6, 1.4, -9.6], [0, 0, HALF]));
  decor.add('matte', 0x8a2a1f, xform(cyl(0.6, 0.6, 0.86, 18), [-9.6, 1.4, -9.6], [0, 0, HALF]));
  decor.add('matte', 0x3a5a3a, xform(new THREE.SphereGeometry(0.3, 10, 8), [9.6, 0.5, -9.6], [0, 0, 0], [1, 0.8, 1]));
  decor.add('matte', 0x6b4a2a, cyl(0.25, 0.3, 0.4, 10), [9.6, 0.2, -9.6]);
  // A bonsai on a stand by the door.
  decor.add('matte', 0x3a2418, box(0.8, 0.5, 0.5), [-9.8, 0.25, 9.8]);
  decor.add('matte', 0x6b6b6b, box(0.6, 0.15, 0.36), [-9.8, 0.58, 9.8]);
  decor.add('matte', 0x5a3a24, xform(cyl(0.05, 0.08, 0.6, 6), [-9.8, 0.9, 9.8], [0, 0, 0.5]));
  decor.add('leaf', 0x3f6b3a, xform(new THREE.SphereGeometry(0.3, 8, 6), [-9.6, 1.2, 9.8], [0, 0, 0], [1.4, 0.5, 1]));
  decor.add('leaf', 0x4a7a42, xform(new THREE.SphereGeometry(0.22, 8, 6), [-10.1, 1.0, 9.8], [0, 0, 0], [1.3, 0.5, 1]));

  // ---------------------------------------------------------------- gold folding screens along the back
  {
    const panels = 8;
    const gold = tex.goldScreen({ panels: 1 });
    const mat = new THREE.MeshStandardMaterial({ map: gold, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide });
    const geos = [];
    const pw = 14 / panels;
    for (let k = 0; k < panels; k++) {
      const g = new THREE.PlaneGeometry(pw * 1.02, 2.0);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (k + uv.getX(i)) / panels);
      g.rotateY((k % 2 ? 1 : -1) * 0.35 + Math.PI);
      g.translate(-7 + pw * (k + 0.5), 1.0, 10.72);
      geos.push(g);
    }
    const screen = new THREE.Mesh(merge(geos), mat);
    // Gold screens use their own texture coordinates across all panels.
    screen.material.map.repeat.set(1, 1);
    walls.back.group.add(screen);
  }

  // ---------------------------------------------------------------- the door out to the garden
  const dz = P.doors[0].z;
  decor.add('matte', LACQUER, box(0.2, 3.0, 0.2), [W / 2 - 0.1, 1.5, dz - 1.05]);
  decor.add('matte', LACQUER, box(0.2, 3.0, 0.2), [W / 2 - 0.1, 1.5, dz + 1.05]);
  decor.add('matte', LACQUER, box(0.2, 0.2, 2.3), [W / 2 - 0.1, 3.0, dz]);
  decor.add('glow', 0xf3f8ee, box(0.03, 2.8, 1.9), [W / 2 - 0.04, 1.4, dz]);
  const out = tex.sign({ text: 'Temple garden →', sub: '절 마당으로 나가기', w: 512, h: 160, bg: '#2a1a14', fg: '#f6ecd6', border: '#d9a93a' });
  signMesh(view, out, 1.5, 0.47, W / 2 - 0.06, 3.5, dz, -HALF, { parent: walls.right.group });
  door(view, 'garden', { x: W / 2 - 0.3, z: dz, arrowY: 4.2, arrowRot: HALF, color: 0xffd38a });
  view.tags = [{ kind: 'garden', at: [W / 2 - 0.4, 4.8, dz] }];

  // ---------------------------------------------------------------- seats: low desks, cushions, paper lanterns
  const vertex = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  const top = 0.38;
  view.styles.low = {
    desk: {
      geo: parts([
        [box(1.0, 0.05, 0.6, 0, top - 0.025, 0), 0x3a2418],
        [box(1.0, 0.012, 0.6, 0, top + 0.001, 0), 0x4a2e1f],
        ...[[-0.44, -0.24], [0.44, -0.24], [-0.44, 0.24], [0.44, 0.24]].map(([x, z]) => [box(0.06, top - 0.05, 0.06, x, (top - 0.05) / 2, z), 0x2a1a12]),
      ]),
      mat: vertex,
    },
    chair: { geo: parts([[box(0.52, 0.07, 0.52, 0, 0.035, 0), 0x8a2a2a], [box(0.54, 0.01, 0.54, 0, 0.07, 0), 0xa83a3a]]), mat: vertex },
    lamp: andon(),
    notebook: [-0.08, 0.06],
    books: [-0.34, -0.14, 0.8],
    tea: [0.3, 0.16],
    pick: [1.1, 1.0, 1.8, 0.35],
  };

  decor.build(root, mats);
  walls.build(mats);
  rowDecor.left.build(rowGroups.left, mats);
  rowDecor.right.build(rowGroups.right, mats);
}

/** A paper lantern on a wooden frame; the paper takes your lamp colour. */
const PAPER = [0xfbf3e2, 0xf7d9a8, 0xd8e6f4, 0xf6d4dc, 0xf6e3a2];
function andon() {
  return {
    at: [0.36, -0.15],
    body: {
      geo: merge([
        box(0.2, 0.02, 0.2, 0, 0.01, 0),
        ...[[-0.08, -0.08], [0.08, -0.08], [-0.08, 0.08], [0.08, 0.08]].map(([x, z]) => box(0.02, 0.32, 0.02, x, 0.17, z)),
        box(0.2, 0.02, 0.2, 0, 0.33, 0),
      ]),
      mat: new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.6 }),
    },
    shade: { geo: box(0.15, 0.24, 0.15, 0, 0.18, 0), mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, transparent: true, opacity: 0.85 }) },
    shadeColor: (style) => PAPER[style] ?? PAPER[0],
    bulb: { geo: new THREE.SphereGeometry(0.05, 10, 8).translate(0, 0.17, 0) },
    glow: 0xffb45a,
    on: 0xffe6b0,
    off: 0x3a2a20,
    halo: [0, 0.18, 0],
    pool: [0.1, -0.02, 1.2, 0.9],
    floor: [0.1, 0.3, 2.6],
    strength: 0.95,
  };
}

// ------------------------------------------------------------------ outside: the temple garden

export function garden(view) {
  const P = view.place;
  const root = view.root;
  const mats = decorMaterials();
  const decor = new Decor();

  outdoors(view, {
    sky: ['#6aa6e6', '#f6e9ee', '#9fbf88'],
    fog: 0xeef0f2,
    fogNear: 60,
    fogFar: 190,
    sun: 0xfff4e4,
    sunPos: [24, 40, 26],
    sunPower: 2.4,
    hemi: [0xe6f0ff, 0x8fae6a, 1.5],
    ground: tex.grass({ repeat: [60, 60] }),
    clouds: 7,
  });
  view.exposure = 1.0;
  Object.assign(view.cam, {
    pitch: 0.55,
    dist: 21,
    ahead: 0,
    minDist: 5,
    maxDist: 36,
    yawLimit: null,
    far: 340,
    // Out of the hall you turn to face the garden and its gate.
    arrive: { temple: Math.PI },
    splash: { x: 0, z: 2, dist: 34, pitch: 0.45, swing: 0.45 },
  });

  // ---------------------------------------------------------------- gravel paths and stepping stones
  const gravelTex = tex.paving({ base: '#d9d4c8', kind: 'slabs', seed: 41, repeat: [1, 1] });
  const path = (w, d, x, z) => {
    const t = gravelTex.clone();
    t.needsUpdate = true;
    t.repeat.set(w / 1.5, d / 1.5);
    const m = new THREE.Mesh(floorPlane(w, d), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
    m.position.set(x, 0.006, z);
    root.add(m);
  };
  path(5, 30, 0, 1);
  path(30, 3.6, 0, -12);
  path(3.2, 24, -24, 4.5);
  for (let k = 0; k < 9; k++) decor.add('matte', 0xa8a498, xform(cyl(0.38, 0.4, 0.06, 7), [6.5 + k * 1.3, 0.03, -9 + Math.sin(k) * 0.4], [0, k, 0]));

  // ---------------------------------------------------------------- the temple hall from outside
  {
    const [x0, z0, x1, z1] = P.hall;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const w = x1 - x0;
    const d = z1 - z0;
    decor.add('matte', 0x9a968c, box(w + 1, 0.9, d + 1), [cx, 0.45, cz]);
    decor.add('matte', 0x5a3a24, box(w - 1.6, 4.6, d - 1.6), [cx, 3.2, cz]);
    const panelMat = new THREE.MeshStandardMaterial({ map: tex.shoji({ cols: 3, rows: 4 }), roughness: 0.9 });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w - 2, 3.8), panelMat);
    front.material.map.wrapS = THREE.RepeatWrapping;
    front.material.map.repeat.set(6, 1);
    front.position.set(cx, 2.8, z1 - 0.79);
    root.add(front);
    decor.add('glow', 0xffe7c0, box(3.2, 3.2, 0.06), [cx, 2.5, z1 - 0.76]);
    for (let k = 0; k <= 8; k++) decor.add('matte', VERMILION, cyl(0.26, 0.28, 5.2, 12), [x0 + 0.6 + (k * (w - 1.2)) / 8, 3.5, z1 - 0.2]);
    decor.add('matte', VERMILION, box(w - 0.8, 0.5, 0.4), [cx, 5.7, z1 - 0.2]);
    decor.add('matte', 0x5a3a24, box(w + 0.6, 0.12, 2.0), [cx, 0.95, z1 + 0.2]);
    for (let k = 0; k <= 16; k++) decor.add('matte', VERMILION, box(0.08, 0.6, 0.08), [x0 - 0.1 + (k * (w + 0.2)) / 16, 1.3, z1 + 1.1]);
    decor.add('matte', VERMILION, box(w + 0.3, 0.08, 0.1), [cx, 1.62, z1 + 1.1]);
    for (let k = 0; k < 5; k++) decor.add('matte', 0xa8a498, box(7.6 - k * 0.3, 0.18, 0.4), [cx, 0.09 + k * 0.18, z1 + 2.2 - k * 0.32]);
    const roof = new THREE.Mesh(hipRoof(w + 6, d + 6, w * 0.45, 6.2, 11.2, 0.9), roofMaterial());
    roof.position.set(cx, 0, cz);
    root.add(roof);
    const upper = new THREE.Mesh(hipRoof(w * 0.62, d * 0.55, w * 0.3, 10.6, 13.6, 0.5), roofMaterial());
    upper.position.set(cx, 0, cz);
    root.add(upper);
    blockBox(view, x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 1.25, 6.4);
    blockCamera(view, roof, upper);
    decor.add('matte', 0x2a2d33, box(w * 0.3 + 0.4, 0.5, 0.6), [cx, 13.75, cz]);
    for (const s of [-1, 1]) decor.add('gloss', GOLD, xform(new THREE.ConeGeometry(0.3, 0.9, 6), [cx + s * (w * 0.15 + 0.2), 14.2, cz], [0, 0, s * 0.4]));
    const plaque = tex.sign({ text: '寺', sub: 'TEMPLE', w: 256, h: 320, bg: '#2a1a14', fg: '#e8c56a', border: '#d9a93a', size: 0.45, subSize: 0.12, font: '"Noto Serif JP", "Noto Serif KR", serif' });
    signMesh(view, plaque, 1.3, 1.6, cx, 6.9, z1 + 0.95);
    chochin(decor, cx, 4.4, z1 + 1.0, 0xff8a6a, 0.9);
    door(view, 'temple', { x: cx, y: 2.4, z: z1 + 0.4, w: 6, h: 4.8, d: 1.4, arrowAt: [cx, 5.0, z1 + 2.2], color: 0xffd38a });
    pickBox(view, 'temple', cx, 6, z1 - 0.4, w, 12, 1);
    view.tags = [{ kind: 'temple', at: [cx, 8.6, z1 + 1.6] }];
  }

  // ---------------------------------------------------------------- a five-storey pagoda
  {
    const { x, z, side } = P.pagoda;
    blockBox(view, x - 3, z - 3, x + 3, z + 3, 13.5);
    decor.add('matte', 0x9a968c, box(side + 0.6, 0.8, side + 0.6), [x, 0.4, z]);
    let y = 0.8;
    for (let k = 0; k < 5; k++) {
      const s = side * (1 - k * 0.12);
      const h = k === 0 ? 2.6 : 1.9;
      decor.add('matte', VERMILION, box(s * 0.62, h, s * 0.62), [x, y + h / 2, z]);
      decor.add('matte', 0xf2ece0, box(s * 0.5, h * 0.55, s * 0.63), [x, y + h * 0.45, z]);
      decor.add('matte', 0xf2ece0, box(s * 0.63, h * 0.55, s * 0.5), [x, y + h * 0.45, z]);
      y += h;
      const r = new THREE.Mesh(hipRoof(s + 1.4, s + 1.4, 0.2, y, y + 0.9, 0.45), roofMaterial());
      r.position.set(x, 0, z);
      root.add(r);
      y += 0.5;
    }
    decor.add('matte', 0x2a2d33, box(0.6, 0.6, 0.6), [x, y + 0.3, z]);
    decor.add('gloss', GOLD, cyl(0.07, 0.09, 3.8, 8), [x, y + 2.3, z]);
    for (let k = 0; k < 9; k++) decor.add('gloss', GOLD, cyl(0.24 - k * 0.012, 0.24 - k * 0.012, 0.06, 12), [x, y + 0.9 + k * 0.3, z]);
    decor.add('gloss', GOLD, sphere(0.16, 10, 8), [x, y + 4.3, z]);
    shadowDecal(root, x + 2, z + 2, 10, 10, 0.25);
  }

  // ---------------------------------------------------------------- the bell tower
  {
    const [x0, z0, x1, z1] = P.bell;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    decor.add('matte', 0x9a968c, box(x1 - x0, 0.7, z1 - z0), [cx, 0.35, cz]);
    for (const [sx, sz] of [[x0 + 0.4, z0 + 0.4], [x1 - 0.4, z0 + 0.4], [x0 + 0.4, z1 - 0.4], [x1 - 0.4, z1 - 0.4]]) decor.add('matte', VERMILION, cyl(0.18, 0.2, 4.2, 10), [sx, 2.8, sz]);
    const r = new THREE.Mesh(hipRoof(x1 - x0 + 2, z1 - z0 + 2, 1.6, 4.9, 6.9, 0.5), roofMaterial());
    r.position.set(cx, 0, cz);
    root.add(r);
    blockCamera(view, r);
    decor.add('gloss', 0x5f6b4f, cyl(0.85, 0.95, 1.9, 20), [cx, 3.35, cz]);
    decor.add('gloss', 0x5f6b4f, sphere(0.85, 16, 8, cx, 4.3, cz));
    decor.add('matte', 0x6b4a2a, xform(cyl(0.12, 0.12, 2.0, 8), [cx + 1.9, 2.5, cz], [0, 0, HALF]));
  }

  // ---------------------------------------------------------------- torii gates
  {
    const G = P.gate;
    torii(decor, G.x, G.z, G.span, 5.4, { thick: 0.3 });
    for (const z of P.torii) torii(decor, -24, z, 2.8, 2.9, { thick: 0.14, ry: HALF });
    shadowDecal(root, G.x + 1, G.z + 1, 7, 2.6, 0.25);
  }

  // ---------------------------------------------------------------- the koi pond and its bridge
  {
    const Pd = P.pond;
    const waterTex = tex.water({ seed: 22 });
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48).rotateX(-HALF).scale(Pd.a, 1, Pd.b),
      new THREE.MeshStandardMaterial({ map: waterTex, color: 0x6fae9a, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.78 }),
    );
    water.position.set(Pd.x, 0.04, Pd.z);
    water.renderOrder = 2;
    root.add(water);
    const bed = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-HALF).scale(Pd.a, 1, Pd.b), new THREE.MeshStandardMaterial({ color: 0x2f4a3a, roughness: 1 }));
    bed.position.set(Pd.x, 0.008, Pd.z);
    root.add(bed);
    view.updaters.push((dt) => {
      waterTex.offset.x = (waterTex.offset.x + dt * 0.015) % 1;
    });
    for (let k = 0; k < 30; k++) {
      const a = (k / 30) * Math.PI * 2;
      decor.add('matte', [0x9a968c, 0x8a867c, 0xa8a498][k % 3], new THREE.IcosahedronGeometry(0.3 + (k % 4) * 0.08, 0), [Pd.x + Math.cos(a) * (Pd.a + 0.2), 0.12, Pd.z + Math.sin(a) * (Pd.b + 0.2)]);
    }
    for (const [lx, lz] of [[-3.5, 1.2], [2.8, -1.6], [-1.6, -2.4], [3.6, 1.8]]) decor.add('leaf', 0x5f9a4c, cyl(0.32, 0.32, 0.02, 10), [Pd.x + lx, 0.06, Pd.z + lz]);
    // Koi gliding under the surface.
    const koiGeo = parts([
      [xform(new THREE.SphereGeometry(0.16, 10, 8), [0, 0, 0], [0, 0, 0], [0.6, 0.35, 1.6]), 0xffffff],
      [xform(new THREE.ConeGeometry(0.12, 0.2, 4), [0, 0, -0.32], [-HALF, 0, 0], [1, 1, 0.4]), 0xffffff],
    ]);
    const koiColors = [0xf26b2a, 0xffffff, 0xf2a03a, 0xe8452a, 0x222222, 0xf26b2a];
    const koi = new THREE.InstancedMesh(koiGeo, new THREE.MeshStandardMaterial({ roughness: 0.5 }), koiColors.length);
    koiColors.forEach((c, i) => koi.setColorAt(i, new THREE.Color(c)));
    koi.frustumCulled = false;
    root.add(koi);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    view.updaters.push((dt, time) => {
      for (let i = 0; i < koiColors.length; i++) {
        const t = time * (0.18 + i * 0.03) + i * 1.3;
        const rx = Pd.a * (0.35 + (i % 3) * 0.18);
        const rz = Pd.b * (0.35 + (i % 2) * 0.25);
        v.set(Pd.x + Math.cos(t) * rx, 0.025, Pd.z + Math.sin(t) * rz);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-Math.sin(t) * rx, Math.cos(t) * rz) + Math.sin(time * 3 + i) * 0.15);
        koi.setMatrixAt(i, m.compose(v, q, one));
      }
      koi.instanceMatrix.needsUpdate = true;
    });
    const [bx0, bz0, bx1, bz1] = P.bridge;
    for (let z = bz0; z < bz1; z += 0.4) decor.add('matte', 0x7a5a3a, box(bx1 - bx0 - 0.1, 0.08, 0.36), [(bx0 + bx1) / 2, 0.12, z + 0.2]);
    for (const x of [bx0, bx1]) {
      for (let z = bz0; z <= bz1; z += 1.6) decor.add('matte', 0x5a3a24, box(0.08, 0.5, 0.08), [x, 0.25, z]);
      decor.add('matte', 0x5a3a24, box(0.06, 0.06, bz1 - bz0), [x, 0.48, (bz0 + bz1) / 2]);
    }
    toro(decor, Pd.x + Pd.a + 0.9, Pd.z - 1.6, 0.8);
  }

  // ---------------------------------------------------------------- the raked rock garden
  {
    const [x0, z0, x1, z1] = P.rockGarden;
    const w = x1 - x0;
    const d = z1 - z0;
    const rocks = [[0.25, 0.35, 0.7], [0.55, 0.6, 0.5], [0.8, 0.3, 0.4]];
    const gtex = tex.gravel({ repeat: [1, 1], rings: rocks.map(([u, v, r]) => [u * 512, v * 256, r * 40]) });
    const g = new THREE.Mesh(floorPlane(w, d), new THREE.MeshStandardMaterial({ map: gtex, roughness: 1 }));
    g.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2);
    root.add(g);
    for (const [u, v, r] of rocks) decor.add('matte', 0x7a776e, xform(new THREE.DodecahedronGeometry(r, 0), [x0 + u * w, r * 0.45, z0 + v * d], [0.3, u * 3, 0.2], [1.2, 0.8, 1]));
    for (const z of [z0, z1]) decor.add('matte', 0x5a3a24, box(w, 0.25, 0.12), [(x0 + x1) / 2, 0.12, z]);
    for (const x of [x0, x1]) decor.add('matte', 0x5a3a24, box(0.12, 0.25, d), [x, 0.12, (z0 + z1) / 2]);
  }

  // ---------------------------------------------------------------- lanterns, a water basin, trees, bamboo
  for (const [x, z] of P.lanterns) toro(decor, x, z, 1);
  {
    const [x0, z0, x1, z1] = P.basin;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    decor.add('matte', 0x8a867c, box(1.6, 0.7, 0.8), [cx, 0.35, cz]);
    decor.add('glass', 0x9fd0e0, box(1.4, 0.04, 0.6), [cx, 0.71, cz]);
    for (let k = 0; k < 4; k++) decor.add('matte', 0xc9b98a, xform(cyl(0.015, 0.015, 0.6, 4), [cx - 0.5 + k * 0.33, 0.85, cz + 0.2], [0.9, 0, 0]));
    for (const [sx, sz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) decor.add('matte', 0x5a3a24, cyl(0.07, 0.07, 2.4, 6), [sx, 1.2, sz]);
    const r = new THREE.Mesh(hipRoof(x1 - x0 + 1, z1 - z0 + 1, 0.8, 2.4, 3.2, 0.25), roofMaterial());
    r.position.set(cx, 0, cz);
    root.add(r);
  }
  const blossoms = [];
  P.trees.forEach(([x, z, kind], k) => {
    if (kind === 0) {
      tree(decor, x, z, { blossom: true, scale: 1.1 });
      blossoms.push([x, z]);
    } else if (kind === 1) {
      decor.add('matte', 0x5a3a2a, cyl(0.14, 0.22, 2.6, 8), [x, 1.3, z]);
      for (const [dx, dy, dz, r] of [[0, 3.2, 0, 1.4], [1.0, 2.8, 0.4, 1.0], [-0.9, 2.9, -0.3, 1.0], [0.2, 3.9, -0.5, 0.9]]) {
        decor.add('leaf', [0xd8452a, 0xe8642f, 0xc23a24, 0xf08a3a][(k + Math.round(dx * 2)) & 3], new THREE.IcosahedronGeometry(r, 1), [x + dx, dy, z + dz]);
      }
    } else {
      decor.add('matte', 0x5a4a3a, xform(cyl(0.16, 0.26, 3.6, 8), [x, 1.8, z], [0.15, 0, -0.2]));
      for (const [dx, dy, dz, r] of [[0.4, 3.6, 0, 1.6], [-1.2, 2.6, 0.5, 1.1], [1.6, 2.9, -0.5, 1.0]]) {
        decor.add('leaf', 0x2f5a35, xform(new THREE.SphereGeometry(r, 10, 6), [x + dx, dy, z + dz], [0, 0, 0], [1, 0.35, 0.8]));
      }
    }
    shadowDecal(root, x + 0.6, z + 0.5, 4, 4, 0.22);
  });
  petals(view, blossoms, { count: 140 });
  {
    const [x0, z0, x1, z1] = P.bamboo;
    const geos = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 110; k++) {
      const x = x0 + rnd() * (x1 - x0);
      const z = z0 + rnd() * (z1 - z0);
      const h = 7 + rnd() * 5;
      geos.push([cyl(0.07, 0.08, h, 6, x, h / 2, z), 0x6f9a3a]);
      geos.push([new THREE.IcosahedronGeometry(0.9 + rnd() * 0.5, 0).scale(1, 1.6, 1).translate(x, h, z), 0x5f8f35]);
    }
    for (const [g, c] of geos) decor.add('leaf', c, g);
  }

  // ---------------------------------------------------------------- Mt. Fuji on the horizon
  {
    const fuji = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(60, 34, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0x8aa7c8, fog: false }));
    body.position.y = 17;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(20.5, 11.6, 48, 1), new THREE.MeshBasicMaterial({ color: 0xf6f8fb, fog: false }));
    cap.position.y = 28.2;
    fuji.add(body, cap);
    fuji.position.set(-70, -6, -150);
    root.add(fuji);
  }

  // ---------------------------------------------------------------- seats: red benches under parasols
  const vertex = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  view.styles.bench = {
    desk: {
      geo: parts([
        [box(0.9, 0.1, 0.55, 0, 0.42, 0), 0xc8302a],
        [box(0.92, 0.04, 0.6, 0, 0.47, 0), 0xd83a30],
        ...[[-0.4, -0.22], [0.4, -0.22], [-0.4, 0.22], [0.4, 0.22]].map(([x, z]) => [box(0.06, 0.4, 0.06, x, 0.2, z), 0x5a3a24]),
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
  for (const [bx, bz, rot] of P.benchSpots) {
    const px = bx + Math.sin(rot) * 0.6;
    const pz = bz + Math.cos(rot) * 0.6;
    decor.add('matte', 0x5a3a24, cyl(0.03, 0.03, 2.6, 6), [px, 1.3, pz]);
    decor.add('matte', 0xc8302a, new THREE.ConeGeometry(1.4, 0.55, 16, 1, true), [px, 2.65, pz]);
    shadowDecal(root, bx, bz, 2.2, 2.2, 0.22);
  }

  decor.build(root, mats);
}
