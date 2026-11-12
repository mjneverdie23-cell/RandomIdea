// Egypt. Inside the Great Pyramid: a torch-lit hall of painted sandstone with a golden
// sarcophagus, two colossal seated statues, treasure, and oil lamps on cedar desks. Outside
// at Giza: the pyramid itself, the Sphinx, an obelisk, an oasis with palms, a Bedouin tent,
// a market stall, dunes, distant pyramids and a caravan of camels.

import * as THREE from '../../vendor/three.module.min.js';
import { DESK_TOP } from '../../shared/layout.js';
import * as tex from '../textures.js';
import { Decor, decorMaterials, parts, merge, floorPlane, wallPlane } from '../geo.js';
import { HALF, rug, sunbeam, sunPatch, motes, door, signMesh, shadowDecal, wallSides, oilLamp, box, cyl, sphere, xform } from './common.js';
import { outdoors, pickBox, fires, palm, drift, blockShape, blockBox } from './outdoor.js';

const SAND = 0xd8b37a;
const GOLD = 0xe0b443;
const LAPIS = 0x1f4f8a;
const GRANITE = 0x6a3a32;

/** A pyramid with stone courses running round it: base `side`, apex `height`. */
function pyramidGeometry(side, height, courses = 40) {
  const s = side / 2;
  const apex = [0, height, 0];
  const corners = [[-s, 0, s], [s, 0, s], [s, 0, -s], [-s, 0, -s]];
  const pos = [];
  const uv = [];
  for (let k = 0; k < 4; k++) {
    const a = corners[k];
    const b = corners[(k + 1) % 4];
    pos.push(...a, ...b, ...apex);
    uv.push(0, 0, side / 6, 0, side / 12, courses);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

let courseTex = null;
function pyramidStone() {
  if (courseTex) return courseTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#d9b77f';
  g.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,240,210,0.15)' : 'rgba(120,85,45,0.15)';
    g.fillRect(Math.random() * 128, Math.random() * 64, 2, 2);
  }
  g.fillStyle = 'rgba(110, 75, 40, 0.55)';
  g.fillRect(0, 0, 128, 5);
  g.fillStyle = 'rgba(255, 235, 200, 0.25)';
  g.fillRect(0, 6, 128, 3);
  for (const x of [20, 70, 110]) {
    g.fillStyle = 'rgba(110, 75, 40, 0.4)';
    g.fillRect(x, 5, 2, 59);
  }
  courseTex = new THREE.CanvasTexture(c);
  courseTex.colorSpace = THREE.SRGBColorSpace;
  courseTex.wrapS = THREE.RepeatWrapping;
  courseTex.wrapT = THREE.RepeatWrapping;
  return courseTex;
}

function pyramidMesh(side, height, x, z, { courses = 40, cap = true } = {}) {
  const group = new THREE.Group();
  const m = new THREE.Mesh(pyramidGeometry(side, height, courses), new THREE.MeshStandardMaterial({ map: pyramidStone(), roughness: 0.95 }));
  group.add(m);
  if (cap) {
    const capH = height * 0.07;
    const capS = side * 0.07;
    const c = new THREE.Mesh(pyramidGeometry(capS, capH, 1), new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.6, roughness: 0.3 }));
    c.position.y = height - capH * 0.98;
    group.add(c);
  }
  group.position.set(x, 0, z);
  return group;
}

/** A colossal seated king facing +z, about 6.5 m tall, made of blocks. */
function seatedColossus(decor, x, z, scale = 1) {
  const s = scale;
  const stone = 0xd2ad74;
  const P = (geo) => xform(geo, [x, 0, z], [0, 0, 0], s);
  decor.add('matte', 0xc9a26a, P(box(3.2, 2.4, 2.8, 0, 1.2, -0.4)));
  decor.add('matte', stone, P(box(2.2, 0.8, 2.0, 0, 2.8, 0.3)));
  for (const sx of [-0.55, 0.55]) {
    decor.add('matte', stone, P(box(0.8, 2.4, 0.8, sx, 1.2, 1.15)));
    decor.add('matte', stone, P(box(0.8, 0.3, 1.1, sx, 0.15, 1.3)));
    decor.add('matte', stone, P(box(0.42, 0.3, 1.3, sx * 1.55, 3.1, 0.75)));
  }
  decor.add('matte', stone, P(box(1.9, 2.4, 1.2, 0, 4.4, -0.1)));
  decor.add('matte', LAPIS, P(box(1.95, 0.5, 1.25, 0, 3.4, -0.1)));
  decor.add('matte', GOLD, P(box(1.2, 0.5, 0.1, 0, 4.9, 0.55)));
  decor.add('matte', stone, P(box(1.0, 1.1, 1.0, 0, 6.25, 0)));
  decor.add('matte', 0x2a2a2a, P(box(0.16, 0.08, 0.05, -0.22, 6.35, 0.51)));
  decor.add('matte', 0x2a2a2a, P(box(0.16, 0.08, 0.05, 0.22, 6.35, 0.51)));
  decor.add('matte', 0x8a6a40, P(box(0.22, 0.5, 0.18, 0, 5.55, 0.42)));
  // The striped headdress, and its two lappets falling to the chest.
  for (let k = 0; k < 5; k++) decor.add('matte', k % 2 ? LAPIS : GOLD, P(box(1.4 - k * 0.04, 0.18, 1.3, 0, 6.9 - k * 0.18, -0.05)));
  for (const sx of [-0.62, 0.62]) {
    for (let k = 0; k < 6; k++) decor.add('matte', k % 2 ? LAPIS : GOLD, P(box(0.38, 0.22, 0.5, sx, 6.3 - k * 0.22, 0.18)));
  }
  decor.add('matte', GOLD, P(xform(new THREE.ConeGeometry(0.13, 0.5, 6), [0, 7.3, 0.4], [0.3, 0, 0])));
}

// ------------------------------------------------------------------ inside the pyramid

export function pyramid(view) {
  const P = view.place;
  const W = P.width;
  const D = P.depth;
  const H = P.wallHeight;
  const root = view.root;
  const mats = decorMaterials();
  const decor = new Decor();
  const walls = wallSides(view, W, D);

  view.background = new THREE.Color(0x2b1b10);
  view.fog = new THREE.Fog(0x2b1b10, 34, 80);
  view.exposure = 1.1;
  view.haloSize = 0.75;
  Object.assign(view.cam, { pitch: 0.6, dist: 13, yawLimit: 1.1, spawnYaw: -0.6, splash: { x: 0, z: 0, dist: 22, pitch: 0.52, swing: 0.35 } });

  // ---------------------------------------------------------------- warm torchlight
  root.add(new THREE.HemisphereLight(0xffe2b4, 0x5a3820, 1.45));
  root.add(new THREE.AmbientLight(0xffd8a4, 0.4));
  const key = new THREE.DirectionalLight(0xfff0d6, 1.3);
  key.position.set(0, 20, -6);
  key.target.position.set(0, 0, -8);
  root.add(key, key.target);
  const torchLights = [];
  for (const [x, z] of [[-6, 8], [6, -6]]) {
    const l = new THREE.PointLight(0xff9a40, 9, 16, 1.6);
    l.position.set(x, 3, z);
    root.add(l);
    torchLights.push(l);
  }
  view.updaters.push((dt, time) => {
    torchLights.forEach((l, i) => {
      l.intensity = 9 + Math.sin(time * 9 + i * 2) * 0.8 + Math.sin(time * 23 + i) * 0.5;
    });
  });

  // ---------------------------------------------------------------- floor and painted walls
  const floorTex = tex.paving({ base: '#cdb38e', repeat: [W / 2.4, D / 2.4], seed: 9 });
  floorTex.anisotropy = view.aniso;
  const floor = new THREE.Mesh(floorPlane(W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 }));
  root.add(floor);
  view.floors.push(floor);
  const wallMat = (repeat) => new THREE.MeshStandardMaterial({ map: tex.egyptWall({ repeat: [repeat, 1], wallHeight: H }), roughness: 0.9 });
  root.add(
    new THREE.Mesh(wallPlane(W, H, 0, H / 2, -D / 2), wallMat(5)),
    new THREE.Mesh(wallPlane(W, H, 0, H / 2, D / 2, Math.PI), wallMat(5)),
    new THREE.Mesh(wallPlane(D, H, -W / 2, H / 2, 0, HALF), wallMat(6)),
    new THREE.Mesh(wallPlane(D, H, W / 2, H / 2, 0, -HALF), wallMat(6)),
  );
  // Corbelled stones stepping inward at the top of the side walls, as in the Grand Gallery.
  for (const side of [-1, 1]) {
    const wd = walls[side < 0 ? 'left' : 'right'].decor;
    for (let k = 0; k < 3; k++) wd.add('matte', k % 2 ? 0xc9a46c : 0xd4b07a, box(0.3 + k * 0.3, 0.45, D), [side * (W / 2 - 0.15 - k * 0.15), H - 0.22 - k * 0.45, 0]);
  }
  rug(root, 2.4, 19, 18, 0, -1.8, { y: 0.005 });

  // ---------------------------------------------------------------- the burial chamber end
  decor.add('matte', 0xc9a46c, box(5.6, 0.4, 2.8), [0, 0.2, -11.4]);
  decor.add('matte', 0xbf9a62, box(4.4, 0.2, 2.2), [0, 0.5, -11.4]);
  decor.add('gloss', GRANITE, box(2.6, 1.0, 1.2), [0, 1.1, -11.4]);
  // The golden coffin lid with its striped headdress and folded arms.
  decor.add('gloss', GOLD, box(2.3, 0.3, 0.95), [0.05, 1.75, -11.4]);
  decor.add('gloss', GOLD, sphere(0.38, 14, 10), [1.05, 1.98, -11.4]);
  for (let k = 0; k < 5; k++) decor.add('gloss', k % 2 ? LAPIS : GOLD, box(0.12, 0.34, 1.0), [0.85 - k * 0.14, 1.8, -11.4]);
  decor.add('gloss', LAPIS, box(0.5, 0.06, 0.8), [0.3, 1.92, -11.4]);
  decor.add('gloss', 0xb8452f, box(0.08, 0.06, 0.6), [0.05, 1.93, -11.4]);
  seatedColossus(decor, -7, -12.4, 1);
  seatedColossus(decor, 7, -12.4, 1);
  // A winged sun above the sarcophagus, and a shaft of daylight falling on it.
  const front = walls.front.decor;
  front.add('glow', 0xffd36a, xform(cyl(0.7, 0.7, 0.06, 28), [0, 6.6, -D / 2 + 0.08], [HALF, 0, 0]));
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) front.add('gloss', k % 2 ? LAPIS : GOLD, box(2.6 - k * 0.45, 0.16, 0.06), [s * (1.9 - k * 0.2), 6.75 - k * 0.2, -D / 2 + 0.06]);
  }
  sunbeam(root, [0, H, -11.4], [0, -11.4], 1.6, { color: 0xfff1cc, opacity: 0.13 });
  sunPatch(root, 0, -11.4, 3.2, 2.4, { color: 0xffe6b0, opacity: 0.25, y: 0.52 });
  motes(view, { x: 0, z: -9, w: 8, d: 8, y0: 0.4, y1: H, count: 160, color: 0xffe6b8 });

  // ---------------------------------------------------------------- painted pillars with lotus tops
  for (const [x, z] of P.pillars) {
    decor.add('matte', 0xd8b37a, box(1.0, 6.4, 1.0), [x, 3.2, z]);
    for (const [y, c] of [[5.2, LAPIS], [5.5, 0xb8452f], [5.8, GOLD]]) decor.add('matte', c, box(1.04, 0.22, 1.04), [x, y, z]);
    decor.add('matte', 0x3f7a5a, cyl(0.85, 0.5, 0.9, 8), [x, 6.85, z]);
    decor.add('matte', GOLD, box(1.5, 0.2, 1.5), [x, 7.4, z]);
    shadowDecal(root, x, z, 2.2, 2.2, 0.25);
  }
  const pillarGlyphs = new THREE.MeshStandardMaterial({ map: tex.glyphColumn({ seed: 4 }), roughness: 0.9 });
  const glyphPlanes = [];
  for (const [x, z] of P.pillars) {
    for (const s of [-1, 1]) glyphPlanes.push(new THREE.PlaneGeometry(0.6, 4.4).rotateY(s < 0 ? Math.PI : 0).translate(x, 2.6, z + s * 0.505));
    glyphPlanes.push(new THREE.PlaneGeometry(0.6, 4.4).rotateY(-Math.sign(x) * HALF).translate(x - Math.sign(x) * 0.505, 2.6, z));
  }
  root.add(new THREE.Mesh(merge(glyphPlanes), pillarGlyphs));

  // ---------------------------------------------------------------- torches and braziers
  const flames = [];
  for (const z of [-11, -6.75, -2.25, 2.25, 6.75]) {
    for (const side of [-1, 1]) {
      if (side < 0 && z > 6) continue;
      const x = side * (W / 2 - 0.25);
      walls[side < 0 ? 'left' : 'right'].decor.add('gloss', 0x5a3a20, box(0.16, 0.6, 0.16), [x, 3.1, z]);
      walls[side < 0 ? 'left' : 'right'].decor.add('gloss', 0x3a2a1a, cyl(0.16, 0.08, 0.22, 8), [x - side * 0.05, 3.45, z]);
      flames.push([x - side * 0.05, 3.5, z, 0.32]);
    }
  }
  for (const [x, z] of P.circles) {
    decor.add('gloss', 0x7a5a2a, cyl(0.05, 0.05, 1.1, 6), [x, 0.55, z]);
    for (let k = 0; k < 3; k++) decor.add('gloss', 0x7a5a2a, xform(cyl(0.03, 0.03, 1.2, 5), [x + Math.cos(k * 2.1) * 0.25, 0.55, z + Math.sin(k * 2.1) * 0.25], [Math.sin(k * 2.1) * 0.35, 0, -Math.cos(k * 2.1) * 0.35]));
    decor.add('gloss', 0xb8862f, cyl(0.42, 0.22, 0.28, 16), [x, 1.2, z]);
    decor.add('glow', 0xff8a30, cyl(0.36, 0.36, 0.04, 16), [x, 1.33, z]);
    flames.push([x, 1.32, z, 0.55]);
  }
  fires(view, flames, { glowSize: 2.6 });

  // ---------------------------------------------------------------- treasure in the corner
  const [tx0, tz0, tx1, tz1] = P.blocks[3];
  const tcx = (tx0 + tx1) / 2;
  const tcz = (tz0 + tz1) / 2;
  decor.add('gloss', GOLD, box(1.6, 0.9, 1.0), [tcx - 1, 0.45, tcz + 0.6]);
  decor.add('gloss', 0xc79a2f, xform(cyl(0.48, 0.48, 1.6, 12), [tcx - 1, 0.95, tcz + 0.6], [0, 0, HALF], [1, 1, 0.55]));
  decor.add('gloss', LAPIS, box(1.64, 0.12, 1.04), [tcx - 1, 0.62, tcz + 0.6]);
  decor.add('gloss', 0x8a5a2a, box(1.2, 0.8, 0.9), [tcx + 1.1, 0.4, tcz - 0.6]);
  decor.add('gloss', GOLD, box(1.25, 0.12, 0.95), [tcx + 1.1, 0.82, tcz - 0.6]);
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9;
    decor.add('gloss', [GOLD, 0x2f6b8a, 0xb8452f][k % 3], cyl(0.18, 0.12, 0.55, 10), [tcx + Math.cos(a) * 1.4, 0.28, tcz + Math.sin(a) * 1.1]);
    decor.add('gloss', GOLD, sphere(0.2, 10, 8), [tcx + Math.cos(a) * 1.4, 0.62, tcz + Math.sin(a) * 1.1]);
  }
  for (let k = 0; k < 24; k++) decor.add('gloss', GOLD, cyl(0.07, 0.07, 0.02, 8), [tcx + Math.sin(k * 7.3) * 1.6, 0.01 + (k % 3) * 0.02, tcz + Math.cos(k * 3.1) * 1.3]);
  // A golden cat statue, sitting tall.
  decor.add('gloss', 0x222222, box(0.5, 0.3, 0.5), [tcx + 0.4, 0.15, tcz + 1.2]);
  decor.add('gloss', GOLD, xform(new THREE.SphereGeometry(0.22, 12, 10), [tcx + 0.4, 0.62, tcz + 1.2], [0, 0, 0], [0.9, 1.6, 1]));
  decor.add('gloss', GOLD, sphere(0.15, 10, 8), [tcx + 0.4, 1.05, tcz + 1.28]);
  for (const s of [-0.07, 0.07]) decor.add('gloss', GOLD, xform(new THREE.ConeGeometry(0.05, 0.14, 4), [tcx + 0.4 + s, 1.2, tcz + 1.26]));

  // ---------------------------------------------------------------- the way out to Giza
  const dz = P.doors[0].z;
  const left = walls.left;
  decor.add('matte', 0xbf9a62, box(0.3, 3.4, 0.45), [-W / 2 + 0.15, 1.7, dz - 1.3]);
  decor.add('matte', 0xbf9a62, box(0.3, 3.4, 0.45), [-W / 2 + 0.15, 1.7, dz + 1.3]);
  decor.add('matte', 0xc9a46c, box(0.34, 0.45, 3.1), [-W / 2 + 0.17, 3.6, dz]);
  decor.add('gloss', GOLD, box(0.04, 0.22, 1.4), [-W / 2 + 0.35, 3.6, dz]);
  decor.add('glow', 0xfff0d0, box(0.04, 3.2, 2.1), [-W / 2 + 0.05, 1.6, dz]);
  const out = tex.sign({ text: 'Giza desert →', sub: '기자 사막으로 나가기', w: 512, h: 160, bg: '#123f5a', fg: '#f6e7c4', border: '#e0b443' });
  signMesh(view, out, 1.6, 0.5, -W / 2 + 0.1, 5.3, dz, HALF, { parent: left.group });
  rug(root, 1.8, 2.8, 30, -W / 2 + 1.4, dz, { y: 0.006 });
  door(view, 'giza', { x: -W / 2 + 0.3, z: dz, h: 3.6, d: 2.4, arrowY: 5.0, arrowRot: HALF, color: 0xffd38a });
  view.tags = [{ kind: 'giza', at: [-W / 2 + 0.4, 6.0, dz] }];

  // ---------------------------------------------------------------- seats: cedar desks, folding stools, oil lamps
  const cedar = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  for (const [x, z] of P.tables) {
    for (const lx of [-2.3, 0, 2.3]) for (const lz of [-0.6, 0.6]) decor.add('matte', 0x4a2c18, box(0.12, DESK_TOP - 0.05, 0.12), [x + lx, (DESK_TOP - 0.05) / 2, z + lz]);
    decor.add('gloss', GOLD, box(4.8, 0.04, 0.06), [x, DESK_TOP - 0.08, z - 0.68]);
    decor.add('gloss', GOLD, box(4.8, 0.04, 0.06), [x, DESK_TOP - 0.08, z + 0.68]);
    shadowDecal(root, x, z, 6, 3.4, 0.2);
  }
  view.styles.desk = {
    desk: { geo: parts([[box(1.2, 0.06, 0.7, 0, DESK_TOP - 0.03, 0), 0x6b3f22], [box(1.2, 0.02, 0.05, 0, DESK_TOP + 0.005, -0.33), GOLD]]), mat: cedar },
    chair: {
      geo: parts([
        [box(0.46, 0.06, 0.4, 0, 0.45, 0), 0x8a5a32],
        [xform(box(0.04, 0.62, 0.04), [0, 0.22, -0.13], [0.55, 0, 0]), 0x4a2c18],
        [xform(box(0.04, 0.62, 0.04), [0, 0.22, 0.13], [-0.55, 0, 0]), 0x4a2c18],
        [box(0.5, 0.04, 0.04, 0, 0.42, -0.19), 0x4a2c18],
        [box(0.5, 0.04, 0.04, 0, 0.42, 0.19), 0x4a2c18],
        [box(0.5, 0.03, 0.04, 0, 0.02, -0.26), 0x4a2c18],
        [box(0.5, 0.03, 0.04, 0, 0.02, 0.26), 0x4a2c18],
      ]),
      mat: cedar,
    },
    lamp: oilLamp(),
    notebook: [-0.06, 0.07],
    books: [-0.38, -0.13, 1],
    tea: [-0.42, 0.17],
    pick: [1.5, 1.4, 2.05, 0.36],
  };

  decor.build(root, mats);
  walls.build(mats);
}

// ------------------------------------------------------------------ outside: the Giza desert

/** A dromedary facing +z: the body without legs (legs are animated separately). */
function camelBody({ resting = false, blanket = 0xb8342a } = {}) {
  const tan = 0xc79a62;
  const dark = 0xa87c48;
  const y = resting ? -0.75 : 0;
  const list = [
    [xform(new THREE.SphereGeometry(0.5, 14, 10), [0, 1.65 + y, 0], [0, 0, 0], [0.75, 0.85, 1.9]), tan],
    [xform(new THREE.SphereGeometry(0.45, 12, 10), [0, 2.1 + y, -0.1], [0, 0, 0], [1, 0.9, 1.2]), dark],
    [xform(cyl(0.16, 0.22, 1.1, 8), [0, 2.0 + y, 1.15], [0.75, 0, 0]), tan],
    [xform(box(0.26, 0.3, 0.6), [0, 2.45 + y, 1.65], [0.25, 0, 0]), tan],
    [box(0.06, 0.12, 0.06, -0.1, 2.65 + y, 1.45), dark],
    [box(0.06, 0.12, 0.06, 0.1, 2.65 + y, 1.45), dark],
    [box(0.05, 0.05, 0.05, -0.13, 2.52 + y, 1.75), 0x1a1a1a],
    [box(0.05, 0.05, 0.05, 0.13, 2.52 + y, 1.75), 0x1a1a1a],
    [xform(cyl(0.03, 0.05, 0.6, 6), [0, 1.45 + y, -1.0], [-0.3, 0, 0]), dark],
    // A colourful blanket over the hump, with tassels.
    [xform(box(0.95, 0.05, 1.1), [0, 2.32 + y, -0.1]), blanket],
    [box(0.98, 0.5, 0.05, 0, 2.1 + y, -0.62), blanket],
    [box(0.98, 0.5, 0.05, 0, 2.1 + y, 0.42), blanket],
    [box(0.99, 0.08, 1.12, 0, 2.0 + y, -0.1), 0xf2c94c],
  ];
  for (const s of [-0.5, 0.5]) for (const z of [-0.5, -0.1, 0.3]) list.push([sphere(0.05, 6, 5, s, 1.82 + y, z), 0xf2c94c]);
  if (resting) {
    for (const s of [-0.32, 0.32]) {
      list.push([box(0.2, 0.25, 0.9, s, 0.2, 0.7), tan]);
      list.push([box(0.2, 0.25, 0.9, s, 0.2, -0.7), tan]);
    }
  }
  return parts(list);
}

export function giza(view) {
  const P = view.place;
  const root = view.root;
  const mats = decorMaterials();
  const decor = new Decor();

  outdoors(view, {
    sky: ['#3f86d6', '#f6e2b8', '#e2c08a'],
    fog: 0xf2dcb4,
    fogNear: 60,
    fogFar: 200,
    sun: 0xfff0d0,
    sunPos: [35, 45, 18],
    sunPower: 2.7,
    hemi: [0xe6f0ff, 0xd9b27a, 1.4],
    ground: tex.sand({ repeat: [60, 60] }),
    clouds: 5,
    cloudOpacity: 0.7,
  });
  view.exposure = 1.0;
  Object.assign(view.cam, {
    pitch: 0.5,
    dist: 23,
    ahead: 0,
    minDist: 5,
    maxDist: 40,
    yawLimit: null,
    far: 340,
    // Out of the pyramid you turn to face the desert: the obelisk, the market and the camels.
    arrive: { pyramid: Math.PI },
    splash: { x: 0, z: 0, dist: 36, pitch: 0.42, swing: 0.45 },
  });

  // ---------------------------------------------------------------- the pyramids
  const G = P.pyramid;
  root.add(pyramidMesh(G.side, G.height, G.x, G.z, { courses: 46 }));
  // Turn the camera round and it rides up the face instead of going through it.
  blockShape(view, new THREE.ConeGeometry(G.side / Math.SQRT2, G.height, 4, 1, false, Math.PI / 4), G.x, G.height / 2, G.z);
  root.add(pyramidMesh(30, 19, -46, -64, { courses: 38 }));
  root.add(pyramidMesh(16, 10, -72, -70, { courses: 20 }));
  shadowDecal(root, 10, -10.6, 30, 3.2, 0.25);
  // The entrance: a stone portal with a lit passage behind it and torches either side.
  const fz = G.z + G.side / 2;
  decor.add('matte', 0xcba46e, box(1.1, 4.6, 1.2), [-2.0, 2.3, fz + 0.3]);
  decor.add('matte', 0xcba46e, box(1.1, 4.6, 1.2), [2.0, 2.3, fz + 0.3]);
  decor.add('matte', 0xd8b37a, box(5.4, 1.1, 1.4), [0, 5.05, fz + 0.3]);
  decor.add('gloss', GOLD, box(1.8, 0.4, 0.06), [0, 5.05, fz + 1.02]);
  decor.add('glow', 0xffcf8a, box(2.9, 4.0, 0.06), [0, 2.0, fz - 0.05]);
  decor.add('matte', 0xc9a46c, box(6.8, 0.25, 2.2), [0, 0.12, fz + 0.4]);
  blockBox(view, -2.8, fz - 0.6, 2.8, fz + 1.0, 5.7);
  fires(view, [[-2.9, 3.4, fz + 1.0, 0.36], [2.9, 3.4, fz + 1.0, 0.36]], { glowSize: 2.4 });
  for (const s of [-2.9, 2.9]) {
    decor.add('gloss', 0x4a3020, cyl(0.06, 0.06, 0.8, 6), [s, 3.0, fz + 1.0]);
    decor.add('gloss', 0x3a2a1a, cyl(0.17, 0.09, 0.24, 8), [s, 3.36, fz + 1.0]);
  }
  door(view, 'pyramid', { x: 0, y: 2.3, z: fz + 0.6, w: 4.6, h: 4.6, d: 1.4, arrowAt: [0, 6.5, fz + 1.4], color: 0xffd38a });
  pickBox(view, 'pyramid', 0, 7, fz - 1.5, 30, 14, 1);
  view.tags = [{ kind: 'pyramid', at: [0, 8.2, fz + 1.4] }];

  // ---------------------------------------------------------------- the Sphinx, facing south
  {
    const [x0, z0, x1, z1] = P.sphinx;
    const cx = (x0 + x1) / 2;
    blockBox(view, x0 + 0.6, z0, x1 - 0.6, z1, 4.5);
    const L = 0xd6b07a;
    const S = 0xc39a62;
    decor.add('matte', 0xc9a46c, box(x1 - x0, 0.5, z1 - z0), [cx, 0.25, (z0 + z1) / 2]);
    decor.add('matte', L, xform(new THREE.SphereGeometry(1, 16, 12), [cx, 2.0, z0 + 4.2], [0, 0, 0], [2.0, 1.6, 4.0]));
    decor.add('matte', S, xform(new THREE.SphereGeometry(1, 14, 10), [cx, 1.6, z0 + 1.6], [0, 0, 0], [2.2, 1.3, 1.6]));
    decor.add('matte', L, box(3.2, 3.2, 2.0, cx, 2.6, z1 - 4.4));
    for (const s of [-1.25, 1.25]) {
      decor.add('matte', L, box(0.95, 0.8, 4.2, cx + s, 0.9, z1 - 2.4));
      decor.add('matte', S, box(1.0, 0.85, 0.5, cx + s, 0.92, z1 - 0.35));
      decor.add('matte', S, box(0.7, 1.2, 2.4, cx + s * 1.35, 1.1, z0 + 2.2));
    }
    // The head in its striped headdress.
    const hz = z1 - 4.0;
    decor.add('matte', L, box(1.7, 1.9, 1.7, cx, 5.0, hz));
    for (let k = 0; k < 6; k++) decor.add('matte', k % 2 ? 0xb08a58 : L, box(2.3 - k * 0.05, 0.2, 1.9), [cx, 6.25 - k * 0.2, hz - 0.1]);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 6; k++) decor.add('matte', k % 2 ? 0xb08a58 : L, box(0.5, 0.32, 1.0), [cx + s * 1.05, 5.6 - k * 0.32, hz + 0.05]);
    }
    decor.add('matte', 0x5a4030, box(0.3, 0.12, 0.06), [cx - 0.38, 5.25, hz + 0.86]);
    decor.add('matte', 0x5a4030, box(0.3, 0.12, 0.06), [cx + 0.38, 5.25, hz + 0.86]);
    decor.add('matte', S, box(0.3, 0.45, 0.25, cx, 4.85, hz + 0.9));
    decor.add('matte', 0x8a6a48, box(0.6, 0.08, 0.06, cx, 4.4, hz + 0.86));
    decor.add('matte', S, xform(cyl(0.12, 0.12, 4, 8), [cx + 1.9, 0.7, z0 + 3.5], [HALF, 0, 0]));
    shadowDecal(root, cx + 1.5, (z0 + z1) / 2, 9, 15, 0.3);
  }

  // ---------------------------------------------------------------- an obelisk
  {
    const [ox, oz] = P.obelisk;
    decor.add('matte', 0xc9a46c, box(1.6, 0.8, 1.6), [ox, 0.4, oz]);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 8.5, 4, 1, true).rotateY(Math.PI / 4).translate(ox, 5.05, oz), new THREE.MeshStandardMaterial({ map: tex.glyphColumn({ seed: 12, bg: '#d6b07a' }), roughness: 0.9 }));
    root.add(shaft);
    decor.add('gloss', GOLD, xform(new THREE.ConeGeometry(0.6, 1.1, 4), [ox, 9.85, oz], [0, Math.PI / 4, 0]));
    shadowDecal(root, ox + 1.4, oz + 0.8, 3, 6, 0.25);
  }

  // ---------------------------------------------------------------- the oasis and palms
  {
    const O = P.oasis;
    const waterTex = tex.water();
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-HALF).scale(O.a, 1, O.b), new THREE.MeshStandardMaterial({ map: waterTex, color: 0x8fd0d8, roughness: 0.1, metalness: 0.1 }));
    pool.position.set(O.x, 0.03, O.z);
    root.add(pool);
    const rim = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-HALF).scale(O.a + 1.4, 1, O.b + 1.2), new THREE.MeshStandardMaterial({ color: 0x9aa860, roughness: 1 }));
    rim.position.set(O.x, 0.015, O.z);
    root.add(rim);
    view.updaters.push((dt) => {
      waterTex.offset.x = (waterTex.offset.x + dt * 0.02) % 1;
    });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      decor.add('leaf', 0x6f8f3a, cyl(0.02, 0.03, 0.9 + (k % 3) * 0.2, 4), [O.x + Math.cos(a) * (O.a + 0.2), 0.45, O.z + Math.sin(a) * (O.b + 0.2)]);
    }
  }
  P.palms.forEach(([x, z], k) => {
    palm(decor, x, z, { height: 5.5 + (k % 3) * 1.1, lean: 0.12 + (k % 2) * 0.08, turn: k * 1.7 });
    shadowDecal(root, x + 0.8, z + 0.6, 3.2, 3.2, 0.22);
  });

  // ---------------------------------------------------------------- a Bedouin tent with cushions and tea
  {
    const T = P.tent;
    const stripeTex = tex.stripes({ a: '#7a1f1f', b: '#e8d5b0', n: 12 });
    stripeTex.wrapS = THREE.RepeatWrapping;
    stripeTex.repeat.set(2, 1);
    const canopy = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 6.2).rotateX(-HALF), new THREE.MeshStandardMaterial({ map: stripeTex, side: THREE.DoubleSide, roughness: 0.9 }));
    canopy.position.set(T.x, 2.5, T.z);
    canopy.rotation.z = 0.08;
    root.add(canopy);
    for (const [sx, sz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) decor.add('matte', 0x5a3a20, cyl(0.07, 0.08, 2.6, 6), [T.x + sx, 1.3, T.z + sz]);
    decor.add('matte', 0x5a3a20, cyl(0.08, 0.08, 3.0, 6), [T.x, 1.5, T.z]);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.4), new THREE.MeshStandardMaterial({ map: stripeTex, side: THREE.DoubleSide }));
    back.position.set(T.x, 1.25, T.z - 3.05);
    root.add(back);
    rug(root, 5.2, 5.2, 8, T.x, T.z, { y: 0.008 });
    decor.add('gloss', 0xc9a45c, cyl(0.42, 0.42, 0.04, 20), [T.x, 0.36, T.z]);
    decor.add('gloss', 0x7a5a2a, cyl(0.06, 0.2, 0.34, 8), [T.x, 0.17, T.z]);
    decor.add('gloss', 0xc9a45c, sphere(0.12, 12, 8), [T.x - 0.1, 0.48, T.z]);
    decor.add('gloss', 0xc9a45c, xform(new THREE.ConeGeometry(0.03, 0.16, 6), [T.x + 0.04, 0.5, T.z], [0, 0, -1.1]));
    for (let k = 0; k < 4; k++) decor.add('glass', 0xffd27a, cyl(0.03, 0.025, 0.07, 8), [T.x + Math.cos(k * 1.6) * 0.26, 0.42, T.z + Math.sin(k * 1.6) * 0.26]);
    decor.add('gloss', 0xc9a45c, cyl(0.12, 0.08, 0.3, 8), [T.x + 0.9, 2.1, T.z + 0.9]);
    decor.add('glow', 0xffcf8a, sphere(0.08, 8, 6), [T.x + 0.9, 2.05, T.z + 0.9]);
  }

  // ---------------------------------------------------------------- ruins, a market stall, dunes
  P.ruins.forEach(([x, z], k) => {
    const h = [3.6, 1.6, 2.6, 0.9][k];
    for (let d = 0; d < h; d += 0.9) decor.add('matte', d % 1.8 < 0.9 ? 0xd6b47e : 0xcaa56d, cyl(0.46, 0.48, 0.88, 14), [x, d + 0.44, z]);
    if (k === 0) decor.add('matte', 0xd6b47e, box(1.3, 0.4, 1.3), [x, h + 0.2, z]);
  });
  decor.add('matte', 0xd6b47e, xform(cyl(0.46, 0.46, 0.88, 14), [-6.2, 0.46, 21.8], [0, 0.4, HALF]));
  decor.add('matte', 0xcaa56d, xform(cyl(0.46, 0.46, 0.88, 14), [-7.2, 0.46, 22.4], [0, 0.9, HALF]));
  {
    const [x0, z0, x1, z1] = P.stall;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    for (const [sx, sz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) decor.add('matte', 0x5a3a20, cyl(0.05, 0.05, 2.3, 6), [sx, 1.15, sz]);
    const awning = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 0.6, z1 - z0 + 0.8).rotateX(-HALF), new THREE.MeshStandardMaterial({ map: tex.stripes({ a: '#2a6f8a', b: '#f3e6c8', n: 10 }), side: THREE.DoubleSide }));
    awning.position.set(cx, 2.35, cz);
    awning.rotation.x = 0.12;
    root.add(awning);
    decor.add('matte', 0x8a5a32, box(x1 - x0 - 0.2, 0.08, 1.0), [cx, 0.8, z0 + 0.6]);
    for (let k = 0; k < 6; k++) {
      decor.add('matte', [0xc0392b, 0xe6a817, 0xd35400, 0x6a8f3a, 0x8e44ad, 0xb5651d][k], new THREE.ConeGeometry(0.17, 0.3, 10), [x0 + 0.5 + k * 0.58, 0.99, z0 + 0.5]);
      decor.add('matte', 0xb5651d, cyl(0.12, 0.16, 0.3, 10), [x0 + 0.6 + k * 0.58, 1.0, z0 + 0.85]);
    }
    for (let k = 0; k < 3; k++) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.6), new THREE.MeshStandardMaterial({ map: tex.rug([0, 30, 200][k]), side: THREE.DoubleSide }));
      r.position.set(x0 + 0.8 + k * 1.2, 1.3, z1 - 0.05);
      root.add(r);
    }
  }
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2;
    const r = 52 + (k % 4) * 9;
    decor.add('matte', [0xe3c48f, 0xd9b67e, 0xe8cc9a][k % 3], xform(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, HALF), [Math.cos(a) * r, -0.2, Math.sin(a) * r * 0.85], [0, a, 0], [14 + (k % 3) * 5, 3 + (k % 4), 9 + (k % 2) * 4]));
  }
  for (const [x, z, sx, sz] of [[-34, 26, 9, 5], [33, 27, 10, 5], [-36, -2, 5, 9], [36, 4, 5, 10]]) {
    decor.add('matte', 0xdcbd88, xform(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, HALF), [x, -0.1, z], [0, 0, 0], [sx, 1.8, sz]));
  }

  // ---------------------------------------------------------------- camels: a caravan and two resting
  const restGeo = camelBody({ resting: true, blanket: 0x2a5f8a });
  for (const [x, z, yaw] of P.restingCamels) {
    const m = new THREE.Mesh(restGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    m.position.set(x, 0, z);
    m.rotation.y = yaw;
    root.add(m);
    shadowDecal(root, x, z, 2.4, 3.4, 0.3);
  }
  const caravan = 3;
  const bodies = new THREE.InstancedMesh(camelBody(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), caravan);
  const legs = new THREE.InstancedMesh(
    merge([cyl(0.09, 0.07, 0.7, 6, 0, -0.35, 0), cyl(0.07, 0.05, 0.65, 6, 0, -1.0, 0), cyl(0.09, 0.09, 0.08, 6, 0, -1.33, 0)]),
    new THREE.MeshStandardMaterial({ color: 0xb98c55, roughness: 0.85 }),
    caravan * 4,
  );
  const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-HALF), new THREE.MeshBasicMaterial({ map: tex.blob(), color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }), caravan);
  for (const m of [bodies, legs, blobs]) {
    m.frustumCulled = false;
    root.add(m);
  }
  const hips = [[-0.28, 1.4, 0.8], [0.28, 1.4, 0.8], [-0.28, 1.4, -0.8], [0.28, 1.4, -0.8]];
  const mBody = new THREE.Matrix4();
  const mLeg = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const pathAt = (t) => [16 + Math.cos(t) * 11, 17.5 + Math.sin(t) * 5.5];
  view.updaters.push((dt, time) => {
    for (let i = 0; i < caravan; i++) {
      const t = time * 0.06 - i * 0.3;
      const [x, z] = pathAt(t);
      const [nx, nz] = pathAt(t + 0.01);
      const yaw = Math.atan2(nx - x, nz - z);
      const step = time * 3.2 + i;
      mBody.compose(v.set(x, Math.abs(Math.sin(step)) * 0.05, z), q.setFromEuler(e.set(0, yaw, Math.sin(step) * 0.03)), one);
      bodies.setMatrixAt(i, mBody);
      hips.forEach(([hx, hy, hz], k) => {
        const phase = k === 0 || k === 3 ? 0 : Math.PI;
        tmp.compose(v.set(hx, hy, hz), q.setFromEuler(e.set(Math.sin(step + phase) * 0.35, 0, 0)), one);
        legs.setMatrixAt(i * 4 + k, mLeg.multiplyMatrices(mBody, tmp));
      });
      blobs.setMatrixAt(i, tmp.makeScale(1.6, 1, 2.6).setPosition(x, 0.012, z));
    }
    bodies.instanceMatrix.needsUpdate = true;
    legs.instanceMatrix.needsUpdate = true;
    blobs.instanceMatrix.needsUpdate = true;
  });

  // ---------------------------------------------------------------- blowing sand
  drift(view, { x: 0, z: 4, w: 60, d: 46, y0: 0.05, y1: 1.2, count: 320, color: 0xf6e2b8, size: 0.06, wind: [1.6, 0, 0.4], opacity: 0.55 });

  // ---------------------------------------------------------------- seats: cushions in the tent, stone blocks
  const vertex = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  view.styles.mat = {
    desk: {
      geo: parts([
        [box(0.7, 0.16, 0.7, 0, 0.08, 0), 0xb8342a],
        [box(0.72, 0.03, 0.72, 0, 0.16, 0), 0xf2c94c],
        ...[[-0.33, -0.33], [0.33, -0.33], [-0.33, 0.33], [0.33, 0.33]].map(([x, z]) => [sphere(0.04, 6, 5, x, 0.1, z), 0xf2c94c]),
        [box(0.62, 0.32, 0.14, 0, 0.3, 0.3), 0x7a1f1f],
      ]),
      mat: vertex,
    },
    chair: null,
    lamp: null,
    notebook: null,
    books: null,
    tea: null,
    pick: [0.9, 1.0, 0.9, -0.05],
  };
  view.styles.stone = {
    desk: { geo: parts([[box(0.8, 0.42, 0.56, 0, 0.21, 0), 0xd2ad74], [box(0.7, 0.04, 0.5, 0, 0.43, 0), 0xdcbb84]]), mat: vertex },
    chair: null,
    lamp: null,
    notebook: null,
    books: null,
    tea: null,
    pick: [0.9, 1.2, 0.9, -0.1],
  };
  for (const d of P.desks) if (d.kit === 'stone') shadowDecal(root, d.x, d.z, 1.3, 1.1, 0.25);

  decor.build(root, mats);
}
