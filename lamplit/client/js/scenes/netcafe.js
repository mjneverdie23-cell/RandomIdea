// The net café: rows of glowing screens in a neon hideout. Cyan and magenta tubes along
// the walls, a big LED board over the snack counter, gaming chairs, vending machines, a
// claw machine and beanbags. Your screen lights up when your session starts.

import * as THREE from '../../vendor/three.module.min.js';
import { DESK_TOP } from '../../shared/layout.js';
import * as tex from '../textures.js';
import { Decor, decorMaterials, parts, merge, floorPlane, wallPlane } from '../geo.js';
import { HALF, plant, door, roomBoard, signMesh, sunPatch, wallSides, box, cyl, sphere, xform } from './common.js';

const CYAN = 0x3fe6ff;
const PINK = 0xff4fd8;
const PURPLE = 0x9a6bff;
const BODY = 0x1d1b26;

/** Your lamp colour becomes the colour of your keyboard and desk lights here. */
const RGB = [0x3cf0c8, 0xffb347, 0x4fa8ff, 0xff5f8f, 0xffd84a];

export function netcafe(view) {
  const P = view.place;
  const W = P.width;
  const D = P.depth;
  const H = P.wallHeight;
  const root = view.root;
  const mats = decorMaterials();
  const decor = new Decor();
  const walls = wallSides(view, W, D);

  view.background = new THREE.Color(0x0d0820);
  view.fog = new THREE.FogExp2(0x150b2c, 0.016);
  view.exposure = 1.22;
  view.haloSize = 0.75;
  // You arrive by the door on the left, so the camera starts looking across the rows.
  Object.assign(view.cam, { pitch: 0.6, dist: 12.5, maxDist: 24, yawLimit: 1.1, spawnYaw: -0.78, splash: { x: 0, z: 1, dist: 19, pitch: 0.55, swing: 0.4 } });

  // ---------------------------------------------------------------- light: a neon wash
  root.add(new THREE.HemisphereLight(0xb3a6ff, 0x2a1840, 1.5));
  root.add(new THREE.AmbientLight(0x7a6ac0, 0.75));
  const cyanLight = new THREE.DirectionalLight(0x6fe0ff, 1.0);
  cyanLight.position.set(-12, 9, 4);
  const pinkLight = new THREE.DirectionalLight(0xff6ad5, 0.8);
  pinkLight.position.set(12, 9, -6);
  const top = new THREE.DirectionalLight(0xe6e0ff, 0.45);
  top.position.set(0, 12, 8);
  root.add(cyanLight, pinkLight, top);

  // ---------------------------------------------------------------- floor & walls
  const floorTex = tex.carpet({ base: '#241b44', accent: '#34296a', repeat: [9, 8] });
  floorTex.anisotropy = view.aniso;
  const floor = new THREE.Mesh(floorPlane(W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }));
  root.add(floor);
  view.floors.push(floor);
  const wall = (repeat) =>
    new THREE.MeshStandardMaterial({ map: tex.plaster({ top: '#2a2156', bottom: '#1d173d', panel: '#141029', rail: '#3a2f73', wainscot: 1.0 / H, speckle: 0.05, repeat: [repeat, 1] }), roughness: 0.9 });
  root.add(
    new THREE.Mesh(wallPlane(W, H, 0, H / 2, -D / 2), wall(6)),
    new THREE.Mesh(wallPlane(W, H, 0, H / 2, D / 2, Math.PI), wall(6)),
    new THREE.Mesh(wallPlane(D, H, -W / 2, H / 2, 0, HALF), wall(6)),
    new THREE.Mesh(wallPlane(D, H, W / 2, H / 2, 0, -HALF), wall(6)),
  );

  // Neon tubes along the walls, with their glow on the floor.
  const tube = (side, color, a, b, y) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ry = Math.atan2(b[0] - a[0], b[1] - a[1]);
    walls[side].decor.add('glow', color, box(0.05, 0.05, len), [(a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2], ry);
  };
  const strips = [
    ['left', CYAN, [-W / 2 + 0.05, -D / 2 + 0.3], [-W / 2 + 0.05, D / 2 - 0.3]],
    ['right', PINK, [W / 2 - 0.05, -D / 2 + 0.3], [W / 2 - 0.05, D / 2 - 0.3]],
    ['front', PURPLE, [-W / 2 + 0.3, -D / 2 + 0.05], [W / 2 - 0.3, -D / 2 + 0.05]],
    ['back', PURPLE, [-W / 2 + 0.3, D / 2 - 0.05], [W / 2 - 0.3, D / 2 - 0.05]],
  ];
  const floorGlow = [];
  for (const [side, color, a, b] of strips) {
    tube(side, color, a, b, H - 0.35);
    tube(side, color, a, b, 1.02);
    const cx = (a[0] + b[0]) / 2;
    const cz = (a[1] + b[1]) / 2;
    const alongX = Math.abs(b[0] - a[0]) > 1;
    const inset = (v, lim) => (Math.abs(v) > lim - 0.5 ? v - Math.sign(v) * 0.7 : v);
    floorGlow.push(sunPatch(root, inset(cx, W / 2), inset(cz, D / 2), alongX ? W - 1 : 1.8, alongX ? 1.8 : D - 1, { color, opacity: 0.22 }));
  }
  view.extras.push(...floorGlow);

  // Hanging light bars over each row of screens.
  for (const [tx, tz] of P.rows) {
    decor.add('glow', 0xc9b8ff, box(5.2, 0.06, 0.12), [tx, 3.3, tz]);
    decor.add('matte', BODY, box(5.3, 0.08, 0.2), [tx, 3.37, tz]);
    for (const s of [-2.3, 2.3]) decor.add('matte', 0x111111, cyl(0.008, 0.008, H - 3.4, 4), [tx + s, 3.4 + (H - 3.4) / 2, tz]);
  }

  // ---------------------------------------------------------------- signs and the big screen
  const pc = tex.sign({ text: 'NET CAFÉ', sub: 'PC방 · 24H', w: 1024, h: 320, bg: null, fg: '#fff0fb', glow: '#ff4fd8', font: 'system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif', weight: 800, size: 0.42 });
  signMesh(view, pc, 5.2, 1.62, 0, 3.75, -D / 2 + 0.06, 0, { glow: true, parent: walls.front.group });
  roomBoard(view, 0, 2.3, -D / 2 + 0.06, { w: 4.4, h: 1.5, style: 'led', parent: walls.front.group });
  walls.front.decor.add('matte', 0x0b0a12, box(4.6, 1.7, 0.08), [0, 2.3, -D / 2 + 0.02]);
  const gg = tex.sign({ text: 'GG', sub: 'good game', w: 256, h: 192, bg: null, fg: '#e8fdff', glow: '#3fe6ff', font: 'system-ui, sans-serif', weight: 900, size: 0.5 });
  signMesh(view, gg, 1.6, 1.2, -W / 2 + 0.06, 3.0, -4, HALF, { glow: true, parent: walls.left.group });
  const level = tex.sign({ text: 'LEVEL UP', sub: '공부도 레벨업', w: 512, h: 192, bg: null, fg: '#fff3fc', glow: '#ff4fd8', font: 'system-ui, sans-serif', weight: 900, size: 0.42 });
  signMesh(view, level, 2.6, 0.98, W / 2 - 0.06, 3.0, -3.5, -HALF, { glow: true, parent: walls.right.group });
  // Posters in glowing frames.
  [[-W / 2 + 0.05, 2.4, 1.6, HALF, 3], [-W / 2 + 0.05, 2.4, -8.4, HALF, 7], [W / 2 - 0.05, 2.4, 1.8, -HALF, 11], [W / 2 - 0.05, 2.4, -8.6, -HALF, 17]].forEach(([x, y, z, ry, seed], k) => {
    const side = walls[x < 0 ? 'left' : 'right'];
    signMesh(view, tex.poster({ seed }), 0.9, 1.35, x + Math.sin(ry) * 0.02, y, z + Math.cos(ry) * 0.02, ry, { parent: side.group });
    side.decor.add('glow', k % 2 ? PINK : CYAN, box(1.0, 1.45, 0.02), [x, y, z], ry);
  });

  // ---------------------------------------------------------------- the snack counter
  const cz = -10.15;
  decor.add('matte', 0x17151f, box(8.4, 1.0, 1.0), [0, 0.5, cz + 0.35]);
  decor.add('gloss', 0x0d0c12, box(8.5, 0.05, 1.1), [0, 1.02, cz + 0.35]);
  decor.add('glow', CYAN, box(8.4, 0.04, 0.02), [0, 0.95, cz + 0.86]);
  decor.add('glow', PINK, box(8.4, 0.04, 0.02), [0, 0.08, cz + 0.86]);
  decor.add('matte', 0x2b2b30, box(0.42, 0.06, 0.32), [-2.6, 1.07, cz + 0.3]);
  decor.add('glow', 0xbfe9ff, box(0.36, 0.24, 0.02), [-2.6, 1.22, cz + 0.2]);
  for (let k = 0; k < 6; k++) {
    decor.add('matte', [0xff6b6b, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xf72585, 0xffffff][k], cyl(0.07, 0.06, 0.14, 12), [-1.4 + k * 0.22, 1.12, cz + 0.4]);
    decor.add('matte', 0xffffff, cyl(0.072, 0.072, 0.01, 12), [-1.4 + k * 0.22, 1.195, cz + 0.4]);
  }
  for (let k = 0; k < 4; k++) decor.add('matte', [0xf4a261, 0xe76f51, 0x2a9d8f, 0xe9c46a][k], box(0.3, 0.42, 0.12), [1.2 + k * 0.38, 1.25, cz + 0.2], (k - 1.5) * 0.15);
  // Glowing drinks fridges against the wall.
  const fridgeTex = tex.fridge();
  for (const fx of [-4.9, 4.9]) {
    decor.add('gloss', 0xdedde6, box(1.2, 2.2, 0.7), [fx, 1.1, -D / 2 + 0.36]);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.9), new THREE.MeshBasicMaterial({ map: fridgeTex, toneMapped: false }));
    front.position.set(fx, 1.15, -D / 2 + 0.72);
    root.add(front);
  }

  // ---------------------------------------------------------------- rows of screens
  for (const [tx, tz] of P.rows) {
    // A divider between the back-to-back screens, its top edge lit.
    decor.add('matte', 0x15131c, box(5.5, 0.6, 0.05), [tx, DESK_TOP + 0.3, tz]);
    decor.add('glow', CYAN, box(5.5, 0.025, 0.06), [tx, DESK_TOP + 0.61, tz]);
    for (const s of [-2.78, 0, 2.78]) decor.add('matte', 0x15131c, box(0.06, DESK_TOP - 0.05, 1.2), [tx + s, (DESK_TOP - 0.05) / 2, tz]);
  }

  // ---------------------------------------------------------------- the back: vending, claw machine, beanbags
  const fridgeFront = (x, z, color) => {
    decor.add('gloss', color, box(0.85, 1.95, 1.05), [x, 0.975, z]);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.5), new THREE.MeshBasicMaterial({ map: fridgeTex, toneMapped: false }));
    f.rotation.y = -HALF;
    f.position.set(x - 0.43, 1.1, z - 0.05);
    root.add(f);
  };
  fridgeFront(W / 2 - 0.45, 5.2, 0xd64545);
  fridgeFront(W / 2 - 0.45, 6.4, 0x2f6fd6);
  // Claw machine.
  decor.add('gloss', 0xff6fb5, box(1.4, 0.9, 1.5), [11.25, 0.45, 9.5]);
  decor.add('glass', 0xe8f8ff, box(1.3, 1.0, 1.4), [11.25, 1.4, 9.5]);
  decor.add('gloss', 0xff6fb5, box(1.4, 0.3, 1.5), [11.25, 2.05, 9.5]);
  decor.add('glow', 0xffe6f5, box(1.2, 0.18, 0.02), [11.25, 2.05, 8.74]);
  for (let k = 0; k < 9; k++) decor.add('matte', [0xffd166, 0x06d6a0, 0x4cc9f0, 0xf72585, 0xffffff][k % 5], sphere(0.12, 10, 8), [10.85 + (k % 3) * 0.3, 1.0 + Math.floor(k / 3) * 0.05, 9.1 + Math.floor(k / 3) * 0.35]);
  decor.add('gloss', 0xc0c0c8, cyl(0.01, 0.01, 0.4, 4), [11.3, 1.7, 9.5]);
  // Beanbags around a low table and a big screen.
  for (const [x, z, r, c] of [[-1.6, 9.0, 0.55, 0x7b5cff], [0.4, 9.5, 0.55, 0x00c2a8], [2.4, 9.0, 0.55, 0xff8a3d]]) {
    decor.add('matte', c, xform(new THREE.SphereGeometry(r, 16, 12), [x, r * 0.5, z], [0, 0, 0], [1, 0.62, 1]));
    decor.add('matte', new THREE.Color(c).offsetHSL(0, 0, -0.08), xform(new THREE.SphereGeometry(r * 0.7, 14, 10), [x, r * 0.95, z + 0.18], [0, 0, 0], [1, 0.8, 0.7]));
  }
  decor.add('matte', 0x17151f, cyl(0.38, 0.38, 0.36, 18), [0.4, 0.18, 7.7]);
  decor.add('matte', 0x2b2b30, box(0.22, 0.04, 0.12), [0.3, 0.38, 7.7]);
  decor.add('matte', 0xffd166, cyl(0.05, 0.05, 0.1, 10), [0.6, 0.41, 7.75]);
  walls.back.decor.add('matte', 0x0b0a12, box(3.2, 1.9, 0.08), [0.4, 2.4, D / 2 - 0.05]);
  const tv = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.7), new THREE.MeshBasicMaterial({ map: tex.poster({ seed: 29 }), toneMapped: false }));
  tv.rotation.y = Math.PI;
  tv.position.set(0.4, 2.4, D / 2 - 0.1);
  walls.back.group.add(tv);
  // Plants in glowing pots.
  for (const [x, z, r] of [[-11.4, -10.4, 0.4], [11.4, -10.4, 0.4]]) {
    plant(decor, x, z, r, { pot: 0x1d1b26, leaf: 0x2f9a6a, tall: 1.2 });
    decor.add('glow', x < 0 ? CYAN : PINK, xform(new THREE.TorusGeometry(r * 0.8, 0.02, 6, 24), [x, 0.5, z], [HALF, 0, 0]));
  }

  // ---------------------------------------------------------------- the door out to the square
  const dz = P.doors[0].z;
  // The door stays visible even when the camera looks in through this wall.
  const left = walls.left;
  decor.add('matte', 0x0b0a12, box(0.12, 2.8, 1.9), [-W / 2 + 0.06, 1.4, dz]);
  decor.add('glow', CYAN, box(0.04, 2.9, 0.05), [-W / 2 + 0.1, 1.45, dz - 1.0]);
  decor.add('glow', CYAN, box(0.04, 2.9, 0.05), [-W / 2 + 0.1, 1.45, dz + 1.0]);
  decor.add('glow', CYAN, box(0.04, 0.05, 2.05), [-W / 2 + 0.1, 2.9, dz]);
  decor.add('glow', 0xfdf2d8, box(0.03, 2.4, 1.5), [-W / 2 + 0.08, 1.3, dz]);
  const out = tex.sign({ text: 'EXIT → Town square', sub: '광장으로 나가기', w: 512, h: 160, bg: '#0b0a12', fg: '#e8fdff', glow: '#3fe6ff', font: 'system-ui, sans-serif', size: 0.34 });
  signMesh(view, out, 1.6, 0.5, -W / 2 + 0.1, 3.4, dz, HALF, { glow: true, parent: left.group });
  door(view, 'square', { x: -W / 2 + 0.3, z: dz, arrowY: 4.0, arrowRot: HALF, color: CYAN });
  view.tags = [{ kind: 'square', at: [-W / 2 + 0.4, 4.5, dz] }];

  // ---------------------------------------------------------------- seats
  const vertex = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
  const gamingChair = parts([
    [box(0.5, 0.1, 0.5, 0, 0.47, 0), 0x1b1b22],
    [box(0.5, 0.75, 0.1, 0, 0.92, 0.24), 0x1b1b22],
    [box(0.3, 0.2, 0.08, 0, 1.36, 0.25), 0x1b1b22],
    [box(0.08, 0.7, 0.11, -0.16, 0.95, 0.245), 0xd63c4a],
    [box(0.08, 0.7, 0.11, 0.16, 0.95, 0.245), 0xd63c4a],
    [box(0.06, 0.05, 0.36, -0.27, 0.66, 0), 0x2b2b33],
    [box(0.06, 0.05, 0.36, 0.27, 0.66, 0), 0x2b2b33],
    [box(0.04, 0.18, 0.04, -0.27, 0.56, 0), 0x2b2b33],
    [box(0.04, 0.18, 0.04, 0.27, 0.56, 0), 0x2b2b33],
    [cyl(0.03, 0.03, 0.32, 8, 0, 0.27, 0), 0x55555e],
    ...[0, 1, 2, 3, 4].map((k) => [xform(box(0.04, 0.03, 0.3), [Math.sin((k / 5) * Math.PI * 2) * 0.14, 0.08, Math.cos((k / 5) * Math.PI * 2) * 0.14], [0, (k / 5) * Math.PI * 2, 0]), 0x2b2b33]),
    ...[0, 1, 2, 3, 4].map((k) => [sphere(0.03, 8, 6, Math.sin((k / 5) * Math.PI * 2) * 0.28, 0.03, Math.cos((k / 5) * Math.PI * 2) * 0.28), 0x111111]),
  ]);
  view.styles.pc = {
    desk: { geo: merge([box(1.0, 0.05, 0.65, 0, DESK_TOP - 0.025, 0)]), mat: new THREE.MeshStandardMaterial({ color: 0x2a2733, roughness: 0.4, metalness: 0.2 }) },
    chair: { geo: gamingChair, mat: vertex },
    lamp: monitor(),
    notebook: null,
    books: null,
    tea: [0.4, -0.12],
    pick: [1.3, 1.45, 2.1, 0.42],
  };

  decor.build(root, mats);
  walls.build(mats);
}

/** A monitor whose screen lights up, with a keyboard and desk strip in your colour. */
function monitor() {
  const z = -0.2;
  return {
    at: [0, z],
    body: {
      geo: merge([box(0.24, 0.015, 0.16, 0, 0.0075, -0.02), box(0.045, 0.22, 0.04, 0, 0.12, -0.04), box(0.64, 0.4, 0.035, 0, 0.4, 0)]),
      mat: new THREE.MeshStandardMaterial({ color: 0x15151b, roughness: 0.4, metalness: 0.3 }),
    },
    shade: {
      geo: merge([box(0.44, 0.012, 0.14, 0, 0.006, 0.2), box(0.06, 0.02, 0.1, 0.3, 0.01, 0.22), box(1.0, 0.014, 0.014, 0, -0.035, 0.53)]),
      mat: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    },
    shadeColor: (style) => RGB[style] ?? RGB[0],
    bulb: { geo: new THREE.PlaneGeometry(0.6, 0.36).translate(0, 0.4, 0.019), mat: new THREE.MeshBasicMaterial({ map: tex.screen(), toneMapped: false }) },
    glow: 0x58c8ff,
    on: 0xffffff,
    off: 0x10131c,
    halo: [0, 0.4, 0.06],
    pool: [0, -0.02, 1.1, 0.9],
    floor: [0, 0.45, 2.6],
    flicker: 0.2,
    strength: 0.75,
  };
}
