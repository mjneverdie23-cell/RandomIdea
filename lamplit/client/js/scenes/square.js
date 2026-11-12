// The town square outside: a sunny plaza with a fountain, cherry trees and benches,
// ringed by the library, the coffee shop and the net café. Tap a building to walk in.
// Beyond it: a park with a pond and ducks, a bus stop and the rest of the town.

import * as THREE from '../../vendor/three.module.min.js';
import * as tex from '../textures.js';
import { Decor, decorMaterials, parts, merge, floorPlane, xform } from '../geo.js';
import { HALF, door, wallClock, signMesh, tree, shadowDecal, box, cyl, sphere } from './common.js';
import { pickBox, blockBox } from './outdoor.js';

const IRON = 0x26262b;
const STONE = 0xcdbfa6;

export function square(view) {
  const P = view.place;
  const W = P.width;
  const D = P.depth;
  const root = view.root;
  const mats = decorMaterials();
  const decor = new Decor();
  const B = P.buildings;
  // The camera slides in front of the buildings rather than through them.
  blockBox(view, ...B.library, 10.5);
  blockBox(view, ...B.cafe, 9.6);
  blockBox(view, ...B.netcafe, 10.4);

  view.background = new THREE.Color(0xbfdcf4);
  view.fog = new THREE.Fog(0xd5e7f5, 60, 175);
  view.exposure = 1.0;
  Object.assign(view.cam, {
    pitch: 0.74,
    dist: 18,
    ahead: 0,
    minDist: 5,
    maxDist: 34,
    yawLimit: null,
    far: 340,
    arrive: { library: 0.45, cafe: 0.85, netcafe: -0.85, ...Object.fromEntries(['pyramid', 'giza', 'colosseum', 'rome', 'temple', 'garden'].map((k) => [k, 0.5])) },
    splash: { x: 0, z: 2, dist: 31, pitch: 0.5, swing: 0.45 },
  });

  // ---------------------------------------------------------------- sky and sunlight
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(160, 32, 16),
    new THREE.MeshBasicMaterial({ map: tex.skyDome(), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  dome.renderOrder = -1;
  root.add(dome);
  root.add(new THREE.HemisphereLight(0xdcecff, 0x8aa86a, 1.55));
  root.add(new THREE.AmbientLight(0xffffff, 0.22));
  const sun = new THREE.DirectionalLight(0xfff0d2, 2.5);
  sun.position.set(26, 40, 22);
  root.add(sun);
  // Clouds drifting by.
  const cloudTex = [tex.cloud({ seed: 5 }), tex.cloud({ seed: 9 }), tex.cloud({ seed: 13 })];
  const clouds = [];
  for (let k = 0; k < 9; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex[k % 3], fog: false, depthWrite: false, transparent: true, opacity: 0.92 }));
    const a = (k / 9) * Math.PI * 2;
    s.position.set(Math.cos(a) * (70 + (k % 3) * 18), 42 + (k % 4) * 7, Math.sin(a) * (70 + (k % 2) * 25) - 20);
    s.scale.set(34 + (k % 3) * 10, 15 + (k % 2) * 5, 1);
    root.add(s);
    clouds.push(s);
  }
  view.updaters.push((dt) => {
    for (const s of clouds) {
      s.position.x += dt * 0.6;
      if (s.position.x > 110) s.position.x = -110;
    }
  });
  // The rest of the town on the horizon.
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(96, 96, 26, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: tex.skyline(), transparent: true, side: THREE.BackSide, depthWrite: false }),
  );
  ring.material.map.wrapS = THREE.RepeatWrapping;
  ring.material.map.repeat.set(3, 1);
  ring.position.y = 12;
  root.add(ring);

  // ---------------------------------------------------------------- the ground
  const grass = tex.grass({ repeat: [60, 60] });
  grass.anisotropy = view.aniso;
  const ground = new THREE.Mesh(floorPlane(240, 240), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
  root.add(ground);
  view.floors.push(ground);

  const slabs = tex.paving({ base: '#ddd3c2', repeat: [1, 1] });
  const bricks = tex.paving({ base: '#cbb9a4', kind: 'bricks', seed: 3, repeat: [1, 1] });
  const pave = (tx, w, d, x, z, y = 0.006, scale = 2) => {
    const t = tx.clone();
    t.needsUpdate = true;
    t.repeat.set(w / scale, d / scale);
    t.anisotropy = view.aniso;
    const m = new THREE.Mesh(floorPlane(w, d), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }));
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  // The plaza: a round paved square with a ring pattern.
  const plazaTex = slabs.clone();
  plazaTex.needsUpdate = true;
  plazaTex.repeat.set(10, 10);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(10, 64).rotateX(-HALF), new THREE.MeshStandardMaterial({ map: plazaTex, roughness: 0.9 }));
  plaza.position.set(P.fountain.x, 0.008, P.fountain.z);
  root.add(plaza);
  for (const [r0, r1, c] of [[9.7, 10.1, 0xb9a88f], [4.4, 4.7, 0xc7b79f]]) {
    const ringMesh = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 64).rotateX(-HALF), new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
    ringMesh.position.set(P.fountain.x, 0.011, P.fountain.z);
    root.add(ringMesh);
  }
  // Forecourt before the library, the paths and the sidewalks along the shops.
  pave(slabs, 22, 4, 0, -13, 0.007);
  pave(bricks, 6, 4, 0, -10, 0.006);
  pave(bricks, 11, 4.2, -14.2, -2, 0.006);
  pave(bricks, 11, 4.2, 14.2, -2, 0.006);
  pave(slabs, 4.4, 20, -16.8, -4, 0.007);
  pave(slabs, 4.4, 20, 16.8, -4, 0.007);
  pave(bricks, 3.4, 18, 0, 17.2, 0.006);
  pave(bricks, 14, 2.6, 0, 12.5, 0.007);

  // ---------------------------------------------------------------- the library
  {
    const [x0, z0, x1, z1] = B.library;
    const w = x1 - x0;
    const d = z1 - z0;
    const h = 9.5;
    const stone = tex.stoneBlocks({ repeat: [w / 3, h / 3] });
    const stoneMat = new THREE.MeshStandardMaterial({ map: stone, roughness: 0.92 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stoneMat);
    body.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    root.add(body);
    const fz = z1;
    // Cornice, base and a copper dome.
    decor.add('matte', 0xd9ccb2, box(w + 0.6, 0.5, 0.8), [0, h + 0.05, fz - 0.2]);
    decor.add('matte', 0xd9ccb2, box(w + 0.3, 0.6, 0.5), [0, 0.3, fz + 0.05]);
    decor.add('matte', 0xd9ccb2, cyl(4.2, 4.2, 1.6, 32), [0, h + 0.8, (z0 + z1) / 2]);
    decor.add('gloss', 0x6fa892, new THREE.SphereGeometry(4.0, 32, 12, 0, Math.PI * 2, 0, HALF), [0, h + 1.6, (z0 + z1) / 2]);
    decor.add('gloss', 0xc9a45c, sphere(0.35, 12, 8), [0, h + 5.7, (z0 + z1) / 2]);
    // Columns across the front and a pediment with a clock.
    for (const cx of [-4.2, -2.5, 2.5, 4.2, -9.6, 9.6]) {
      decor.add('matte', 0xf1e8d6, cyl(0.32, 0.36, 6.6, 16), [cx, 3.3 + 0.36, fz + 0.15]);
      decor.add('matte', 0xe2d6bf, box(0.9, 0.3, 0.9), [cx, 7.1, fz + 0.15]);
      decor.add('matte', 0xe2d6bf, box(0.9, 0.36, 0.9), [cx, 0.18 + 0.36, fz + 0.15]);
    }
    decor.add('matte', 0xe2d6bf, box(10.2, 0.6, 1.1), [0, 7.5, fz + 0.15]);
    const ped = new THREE.Shape();
    ped.moveTo(-5.2, 0);
    ped.lineTo(5.2, 0);
    ped.lineTo(0, 2.2);
    ped.closePath();
    decor.add('matte', 0xefe5d1, new THREE.ExtrudeGeometry(ped, { depth: 1.0, bevelEnabled: false }).translate(0, 7.8, fz - 0.6));
    wallClock(view, 0, 8.55, fz + 0.42, { radius: 0.62, rim: 0xc9a45c });
    // Arched windows glowing warmly from inside.
    const lit = tex.shopWindow({ warm: true, seed: 4 });
    const panes = [];
    for (const wx of [-7.8, 7.8]) {
      panes.push(new THREE.PlaneGeometry(2.4, 3.6).translate(wx, 3.8, fz + 0.02));
      panes.push(new THREE.CircleGeometry(1.2, 20, 0, Math.PI).translate(wx, 5.6, fz + 0.02));
      decor.add('matte', 0xd9ccb2, box(2.9, 0.18, 0.4), [wx, 1.9, fz + 0.15]);
      decor.add('matte', 0xd9ccb2, box(0.08, 3.6, 0.1), [wx, 3.8, fz + 0.06]);
      decor.add('matte', 0xd9ccb2, box(2.4, 0.08, 0.1), [wx, 4.6, fz + 0.06]);
    }
    root.add(new THREE.Mesh(merge(panes), new THREE.MeshBasicMaterial({ map: lit, color: 0xd9c2a0 })));
    // Bronze doors at the top of the steps, with the name carved above.
    decor.add('matte', 0x5a3a24, box(3.0, 3.8, 0.2), [0, 2.26, fz + 0.06]);
    for (const s of [-0.66, 0.66]) {
      decor.add('gloss', 0x8a5a2b, box(1.2, 3.2, 0.12), [s, 1.96, fz + 0.14]);
      decor.add('glow', 0xffe1a8, box(0.8, 1.2, 0.02), [s, 2.6, fz + 0.21]);
      decor.add('gloss', 0xc9a45c, sphere(0.06, 10, 8), [s * 0.2, 1.7, fz + 0.24]);
    }
    const name = tex.sign({ text: 'LIBRARY', sub: '도서관', w: 1024, h: 256, bg: '#e9dfca', fg: '#5a4630', size: 0.5, subSize: 0.22 });
    signMesh(view, name, 6.4, 1.6, 0, 6.2, fz + 0.24);
    // Three wide steps.
    const [sx0, sz0, sx1, sz1] = P.steps;
    for (let k = 0; k < 3; k++) {
      const depth = (sz1 - sz0) * (1 - k / 3);
      decor.add('matte', [0xe8decb, 0xe2d7c3, 0xdcd0bb][k], box(sx1 - sx0 - k * 0.3, 0.12, depth), [0, 0.06 + k * 0.12, sz0 + depth / 2]);
    }
    shadowDecal(root, 0, fz + 1.2, w + 3, 3.2, 0.3);
    door(view, 'library', { x: 0, y: h / 2, z: fz + 0.3, w, h, d: 0.8, arrowAt: [0, 4.75, fz + 0.9] });
  }

  // ---------------------------------------------------------------- the coffee shop
  {
    const [x0, z0, x1, z1] = B.cafe;
    const fx = x1;
    const w = x1 - x0;
    const d = z1 - z0;
    const cz = (z0 + z1) / 2;
    const brickMat = new THREE.MeshStandardMaterial({ map: tex.brick({ base: '#b0603f', repeat: [d / 2, 1.6] }), roughness: 0.9 });
    const lower = new THREE.Mesh(new THREE.BoxGeometry(w, 3.6, d), brickMat);
    lower.position.set((x0 + x1) / 2, 1.8, cz);
    const upperMat = new THREE.MeshStandardMaterial({ map: tex.facade({ wall: '#f2e6cf', frame: '#4a6b55', rows: 1, cols: 5, lit: 0.3, seed: 12 }), roughness: 0.95 });
    upperMat.map.wrapS = THREE.RepeatWrapping;
    upperMat.map.repeat.set(d / 9, 1);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(w, 3.4, d), upperMat);
    upper.position.set((x0 + x1) / 2, 3.6 + 1.7, cz);
    root.add(lower, upper);
    // A pitched terracotta roof.
    const roof = new THREE.Shape();
    roof.moveTo(-w / 2 - 0.4, 0);
    roof.lineTo(w / 2 + 0.4, 0);
    roof.lineTo(0, 2.6);
    roof.closePath();
    decor.add('matte', 0xb5563a, xform(new THREE.ExtrudeGeometry(roof, { depth: d + 0.6, bevelEnabled: false }), [(x0 + x1) / 2, 7.0, z0 - 0.3], [0, 0, 0]));
    decor.add('matte', 0xe8dcc4, box(0.4, 0.3, d + 0.2), [fx + 0.1, 3.65, cz]);
    // Big warm windows either side of the door.
    const lit = tex.shopWindow({ warm: true, seed: 8 });
    const panes = [];
    for (const [za, zb] of [[z0 + 1, -3.3], [-0.7, z1 - 1]]) {
      const pw = zb - za;
      panes.push(new THREE.PlaneGeometry(pw, 2.3).rotateY(HALF).translate(fx + 0.02, 1.75, (za + zb) / 2));
      decor.add('matte', 0x2f4f3e, box(0.16, 0.14, pw + 0.2), [fx + 0.06, 2.95, (za + zb) / 2]);
      decor.add('matte', 0x2f4f3e, box(0.2, 0.5, pw + 0.2), [fx + 0.08, 0.35, (za + zb) / 2]);
      for (let z = za + 1.6; z < zb - 0.4; z += 1.6) decor.add('matte', 0x2f4f3e, box(0.1, 2.3, 0.08), [fx + 0.05, 1.75, z]);
      // Flower boxes on the sills.
      decor.add('matte', 0x6b4529, box(0.35, 0.22, pw * 0.8), [fx + 0.2, 0.7, (za + zb) / 2]);
      for (let z = za + 0.4; z < zb - 0.3; z += 0.45) decor.add('leaf', [0xf28482, 0xffd166, 0xcdb4db, 0x7fb069][Math.round(z * 7) & 3], new THREE.IcosahedronGeometry(0.14, 0), [fx + 0.22, 0.88, z]);
    }
    root.add(new THREE.Mesh(merge(panes), new THREE.MeshBasicMaterial({ map: lit })));
    // The door.
    decor.add('matte', 0x2f4f3e, box(0.2, 2.8, 2.2), [fx + 0.05, 1.4, -2]);
    decor.add('glow', 0xffe8bf, box(0.04, 2.2, 1.5), [fx + 0.16, 1.3, -2]);
    decor.add('gloss', 0xc9a45c, box(0.06, 0.4, 0.06), [fx + 0.2, 1.2, -1.45]);
    // A striped awning over the windows.
    const stripeTex = tex.stripes({ a: '#2f6b55', b: '#f3ead9', n: 10 });
    stripeTex.wrapS = THREE.RepeatWrapping;
    stripeTex.repeat.set(d / 2.5, 1);
    const awn = new THREE.Mesh(new THREE.PlaneGeometry(d, 1.6), new THREE.MeshStandardMaterial({ map: stripeTex, side: THREE.DoubleSide, roughness: 0.85 }));
    awn.rotation.set(-HALF + 0.55, HALF, 0, 'YXZ');
    awn.position.set(fx + 0.65, 3.05, cz);
    root.add(awn);
    // Its name over the awning, and a hanging blade sign.
    const name = tex.sign({ text: 'COFFEE', sub: '카페', w: 1024, h: 256, bg: '#2f4f3e', fg: '#f6ecd6', border: '#c9a45c', size: 0.5, subSize: 0.22 });
    signMesh(view, name, 4.4, 1.1, fx + 0.03, 4.3, -2, HALF);
    decor.add('gloss', IRON, box(0.9, 0.05, 0.05), [fx + 0.45, 3.7, -5.6]);
    const blade = tex.sign({ text: 'CAFÉ', sub: '커피', w: 256, h: 256, bg: '#f6ecd6', fg: '#2f4f3e', border: '#2f4f3e', size: 0.3, subSize: 0.16 });
    signMesh(view, blade, 0.8, 0.8, fx + 0.75, 3.2, -5.6, 0, { double: true });
    // Terrace tables with umbrellas.
    for (const [tx, tz] of P.terrace) {
      decor.add('gloss', IRON, cyl(0.03, 0.03, 0.72, 8), [tx, 0.36, tz]);
      decor.add('matte', 0xf3ead9, cyl(0.38, 0.38, 0.04, 18), [tx, 0.74, tz]);
      decor.add('gloss', IRON, cyl(0.2, 0.24, 0.03, 14), [tx, 0.015, tz]);
      for (const s of [-1, 1]) {
        decor.group(
          [
            ['gloss', IRON, box(0.38, 0.04, 0.38, 0, 0.45, 0)],
            ['gloss', IRON, box(0.38, 0.4, 0.03, 0, 0.66, 0.18)],
            ['gloss', IRON, box(0.03, 0.45, 0.03, -0.17, 0.225, -0.17)],
            ['gloss', IRON, box(0.03, 0.45, 0.03, 0.17, 0.225, -0.17)],
            ['gloss', IRON, box(0.03, 0.45, 0.03, -0.17, 0.225, 0.17)],
            ['gloss', IRON, box(0.03, 0.45, 0.03, 0.17, 0.225, 0.17)],
          ],
          [tx, 0, tz + s * 0.62],
          s > 0 ? 0 : Math.PI,
        );
      }
      decor.add('matte', 0xd9cbb4, cyl(0.025, 0.025, 2.2, 6), [tx, 1.1, tz]);
      decor.add('matte', tz > 0 ? 0xc0624a : 0x2f6b55, new THREE.ConeGeometry(1.25, 0.55, 10, 1, true), [tx, 2.35, tz]);
      decor.add('glow', 0xffe9b8, sphere(0.05, 8, 6), [tx, 2.05, tz]);
      shadowDecal(root, tx, tz, 2.4, 2.4, 0.3);
    }
    door(view, 'cafe', { x: fx + 0.2, y: 3.6, z: cz, w: 0.6, h: 7.2, d, arrowAt: [fx + 1.2, 4.0, -2], arrowRot: HALF, color: 0xffd38a });
  }

  // ---------------------------------------------------------------- the net café
  {
    const [x0, z0, x1, z1] = B.netcafe;
    const fx = x0;
    const w = x1 - x0;
    const d = z1 - z0;
    const cz = (z0 + z1) / 2;
    const h = 10;
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2a35, roughness: 0.7 });
    const lower = new THREE.Mesh(new THREE.BoxGeometry(w, 3.8, d), darkMat);
    lower.position.set((x0 + x1) / 2, 1.9, cz);
    const upperTex = tex.facade({ wall: '#3a3947', frame: '#22212b', glass: '#5f6f9a', rows: 3, cols: 4, lit: 0.35, seed: 31, sill: false });
    upperTex.wrapS = THREE.RepeatWrapping;
    upperTex.repeat.set(d / 7, 1);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(w, h - 3.8, d), new THREE.MeshStandardMaterial({ map: upperTex, roughness: 0.8 }));
    upper.position.set((x0 + x1) / 2, 3.8 + (h - 3.8) / 2, cz);
    root.add(lower, upper);
    decor.add('matte', 0x1d1c25, box(w + 0.3, 0.4, d + 0.3), [(x0 + x1) / 2, h + 0.2, cz]);
    // Glass shopfront glowing purple and blue.
    const glowTex = tex.shopWindow({ warm: false, seed: 5 });
    const panes = [];
    for (const [za, zb] of [[z0 + 0.8, -3.3], [-0.7, z1 - 0.8]]) {
      panes.push(new THREE.PlaneGeometry(zb - za, 2.6).rotateY(-HALF).translate(fx - 0.02, 1.7, (za + zb) / 2));
      for (let z = za; z <= zb + 0.01; z += (zb - za) / 3) decor.add('gloss', 0x15151b, box(0.1, 2.7, 0.08), [fx - 0.05, 1.7, z]);
    }
    root.add(new THREE.Mesh(merge(panes), new THREE.MeshBasicMaterial({ map: glowTex, toneMapped: false })));
    decor.add('glow', 0xff4fd8, box(0.06, 0.06, d), [fx - 0.06, 3.15, cz]);
    decor.add('glow', 0x3fe6ff, box(0.06, 0.06, d), [fx - 0.06, 0.18, cz]);
    // The door.
    decor.add('gloss', 0x15151b, box(0.16, 2.8, 2.1), [fx - 0.05, 1.4, -2]);
    decor.add('glow', 0xbfe9ff, box(0.04, 2.4, 1.6), [fx - 0.14, 1.3, -2]);
    // Neon signs: across the front, and a tall blade at the corner.
    const sign = tex.sign({ text: 'NET CAFÉ', sub: 'PC방 · 24H', w: 1024, h: 256, bg: null, fg: '#fff0fb', glow: '#ff4fd8', font: 'system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif', weight: 800, size: 0.5, subSize: 0.2 });
    decor.add('matte', 0x15141c, box(0.15, 1.5, 6.4), [fx - 0.05, 4.7, -2]);
    signMesh(view, sign, 6.0, 1.5, fx - 0.14, 4.7, -2, -HALF, { glow: true });
    const blade = tex.sign({ text: 'PC', w: 256, h: 512, bg: '#15141c', fg: '#e8fdff', glow: '#3fe6ff', font: 'system-ui, sans-serif', weight: 900, size: 0.4 });
    decor.add('gloss', IRON, box(1.0, 0.06, 0.06), [fx - 0.5, 7.4, z1 - 1.2]);
    signMesh(view, blade, 0.9, 1.8, fx - 0.95, 6.4, z1 - 1.2, 0, { glow: true, double: true });
    // A vending machine and a rack of bicycles.
    decor.add('gloss', 0x2f6fd6, box(0.7, 1.9, 1.8), [18.65, 0.95, 2.1]);
    const vend = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: tex.fridge({ seed: 23 }), toneMapped: false }));
    vend.rotation.y = -HALF;
    vend.position.set(18.29, 1.1, 2.1);
    root.add(vend);
    for (const bz of [-11, -10.1, -9.2]) {
      for (const s of [-0.5, 0.5]) decor.add('gloss', IRON, xform(new THREE.TorusGeometry(0.32, 0.03, 6, 20), [18.1 + s, 0.34, bz], [0, HALF, 0]));
      decor.add('gloss', [0xe63946, 0x2a9d8f, 0xf4a261][Math.round(bz) & 1 ? 1 : 0], box(1.0, 0.05, 0.05), [18.1, 0.55, bz]);
      decor.add('gloss', IRON, box(0.05, 0.4, 0.05), [18.4, 0.7, bz]);
    }
    door(view, 'netcafe', { x: fx - 0.2, y: h / 2, z: cz, w: 0.6, h, d, arrowAt: [fx - 1.2, 3.9, -2], arrowRot: HALF, color: 0x3fe6ff });
  }

  // Name tags over each building, with how many people are inside.
  view.tags = [
    ...(view.tags ?? []),
    { kind: 'library', at: [0, 11.0, B.library[3] + 0.6] },
    { kind: 'cafe', at: [B.cafe[2] + 0.6, 6.0, -2] },
    { kind: 'netcafe', at: [B.netcafe[0] - 0.6, 6.6, -2] },
  ];

  // ---------------------------------------------------------------- gardens in the corners
  for (const [gx0, gz0, gx1, gz1] of P.gardens) {
    const cx = (gx0 + gx1) / 2;
    const w = gx1 - gx0;
    decor.add('matte', 0xcdbfa6, box(w, 0.5, 0.4), [cx, 0.25, gz1 - 0.2]);
    decor.add('leaf', 0x4f8a42, box(w - 0.6, 0.9, 0.9), [cx, 0.9, gz1 - 0.75]);
    for (let k = 0; k < 4; k++) tree(decor, cx + (k - 1.5) * 4.2, gz0 + 4 + (k % 2) * 3.5, { blossom: k % 2 === 0, scale: 1.1 });
    for (let k = 0; k < 8; k++) decor.add('leaf', [0xf28482, 0xffd166, 0xcdb4db, 0xffffff][k % 4], new THREE.IcosahedronGeometry(0.35, 0), [cx + (k - 3.5) * 2.2, 0.35, gz1 - 1.8]);
  }

  // ---------------------------------------------------------------- the fountain
  const F = P.fountain;
  decor.add('matte', STONE, cyl(F.r, F.r + 0.1, 0.55, 40), [F.x, 0.275, F.z]);
  decor.add('matte', 0xd2c5ac, xform(new THREE.TorusGeometry(F.r - 0.08, 0.12, 8, 40), [F.x, 0.56, F.z], [HALF, 0, 0]));
  decor.add('matte', STONE, cyl(0.35, 0.5, 1.6, 16), [F.x, 0.8, F.z]);
  decor.add('matte', STONE, cyl(1.3, 0.45, 0.35, 24), [F.x, 1.55, F.z]);
  decor.add('matte', STONE, cyl(0.18, 0.25, 0.9, 12), [F.x, 2.1, F.z]);
  decor.add('matte', STONE, cyl(0.6, 0.2, 0.22, 20), [F.x, 2.6, F.z]);
  decor.add('matte', STONE, sphere(0.16, 12, 8), [F.x, 2.85, F.z]);
  const waterTex = tex.water();
  const waterMat = new THREE.MeshStandardMaterial({ map: waterTex, color: 0xb9e3f2, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.9 });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(F.r - 0.15, 40).rotateX(-HALF), waterMat);
  pool.position.set(F.x, 0.48, F.z);
  const upperPool = new THREE.Mesh(new THREE.CircleGeometry(1.2, 24).rotateX(-HALF), waterMat);
  upperPool.position.set(F.x, 1.71, F.z);
  root.add(pool, upperPool);
  // Water spilling from the upper bowl.
  const fallTex = tex.water({ seed: 3 });
  fallTex.repeat.set(4, 1);
  const fall = new THREE.Mesh(
    new THREE.CylinderGeometry(1.28, 1.42, 1.2, 32, 1, true),
    new THREE.MeshBasicMaterial({ map: fallTex, color: 0xdff4ff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
  );
  fall.position.set(F.x, 1.08, F.z);
  root.add(fall);
  // Spray from the top.
  const spray = 70;
  const sprayPos = new Float32Array(spray * 3);
  const sprayVel = new Float32Array(spray * 3);
  const resetDrop = (i) => {
    const a = Math.random() * Math.PI * 2;
    const v = 0.5 + Math.random() * 0.5;
    sprayPos.set([F.x, 2.95, F.z], i * 3);
    sprayVel.set([Math.cos(a) * v, 1.6 + Math.random() * 0.8, Math.sin(a) * v], i * 3);
  };
  for (let i = 0; i < spray; i++) {
    resetDrop(i);
    sprayPos[i * 3 + 1] -= Math.random() * 1.2;
  }
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
  const drops = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ size: 0.09, color: 0xe8f7ff, transparent: true, opacity: 0.85, depthWrite: false }));
  drops.frustumCulled = false;
  root.add(drops);
  view.extras.push(drops);
  view.updaters.push((dt) => {
    waterTex.offset.x = (waterTex.offset.x + dt * 0.03) % 1;
    waterTex.offset.y = (waterTex.offset.y + dt * 0.02) % 1;
    fallTex.offset.y = (fallTex.offset.y + dt * 0.6) % 1;
    if (!drops.visible) return;
    for (let i = 0; i < spray; i++) {
      sprayVel[i * 3 + 1] -= 9.8 * dt;
      sprayPos[i * 3] += sprayVel[i * 3] * dt;
      sprayPos[i * 3 + 1] += sprayVel[i * 3 + 1] * dt;
      sprayPos[i * 3 + 2] += sprayVel[i * 3 + 2] * dt;
      if (sprayPos[i * 3 + 1] < 1.72) resetDrop(i);
    }
    sprayGeo.attributes.position.needsUpdate = true;
  });

  // ---------------------------------------------------------------- trees, petals, lamps, flowers
  for (const [x, z, blossom] of P.trees) {
    tree(decor, x, z, { blossom: Boolean(blossom), scale: blossom ? 1 : 1.15 });
    shadowDecal(root, x + 0.6, z + 0.5, 4.2, 4.2, 0.22);
  }
  // Cherry petals drifting down around the plaza.
  const petals = 160;
  const petalPos = new Float32Array(petals * 3);
  const blossoms = P.trees.filter((t) => t[2]);
  const resetPetal = (i, top = true) => {
    const [tx, tz] = blossoms[i % blossoms.length];
    petalPos.set([tx + (Math.random() - 0.5) * 3, top ? 3 + Math.random() * 1.5 : Math.random() * 4.5, tz + (Math.random() - 0.5) * 3], i * 3);
  };
  for (let i = 0; i < petals; i++) resetPetal(i, false);
  const petalGeo = new THREE.BufferGeometry();
  petalGeo.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));
  const petalPts = new THREE.Points(petalGeo, new THREE.PointsMaterial({ size: 0.08, color: 0xf9c1d0, transparent: true, opacity: 0.95 }));
  petalPts.frustumCulled = false;
  root.add(petalPts);
  view.extras.push(petalPts);
  view.updaters.push((dt, time) => {
    if (!petalPts.visible) return;
    for (let i = 0; i < petals; i++) {
      petalPos[i * 3 + 1] -= dt * (0.35 + (i % 5) * 0.05);
      petalPos[i * 3] += Math.sin(time * 0.8 + i) * dt * 0.35 + dt * 0.15;
      petalPos[i * 3 + 2] += Math.cos(time * 0.6 + i * 1.3) * dt * 0.2;
      if (petalPos[i * 3 + 1] < 0.02) resetPetal(i);
    }
    petalGeo.attributes.position.needsUpdate = true;
  });
  for (const [x, z] of P.lampPosts) {
    decor.add('gloss', IRON, cyl(0.06, 0.09, 3.2, 10), [x, 1.6, z]);
    decor.add('gloss', IRON, cyl(0.15, 0.19, 0.25, 10), [x, 0.12, z]);
    decor.add('gloss', IRON, cyl(0.04, 0.2, 0.18, 4), [x, 3.74, z], Math.PI / 4);
    decor.add('glass', 0xfff1cf, cyl(0.12, 0.09, 0.34, 4), [x, 3.46, z], Math.PI / 4);
    decor.add('glow', 0xffe2a0, sphere(0.06, 8, 6), [x, 3.44, z]);
    decor.add('gloss', IRON, cyl(0.13, 0.13, 0.04, 4), [x, 3.28, z], Math.PI / 4);
  }
  for (const [x, z, r] of P.flowerBeds) {
    decor.add('matte', 0xcdbfa6, cyl(r, r + 0.05, 0.35, 24), [x, 0.175, z]);
    decor.add('matte', 0x5a4030, cyl(r - 0.08, r - 0.08, 0.02, 24), [x, 0.36, z]);
    for (let k = 0; k < 18; k++) {
      const a = k * 2.4;
      const rr = (k % 3) * 0.3 + 0.15;
      decor.add('leaf', [0xf28482, 0xffd166, 0xffffff, 0xcdb4db, 0xe76f51][k % 5], new THREE.IcosahedronGeometry(0.13, 0), [x + Math.cos(a) * rr, 0.48, z + Math.sin(a) * rr]);
    }
    decor.add('leaf', 0x5f9a4c, new THREE.IcosahedronGeometry(0.45, 1), [x, 0.5, z]);
  }

  // ---------------------------------------------------------------- the pond, with ducks
  const Pd = P.pond;
  const pondMesh = new THREE.Mesh(new THREE.CircleGeometry(Pd.r, 40).rotateX(-HALF), new THREE.MeshStandardMaterial({ map: waterTex, color: 0x9fd0e6, roughness: 0.1, metalness: 0.1 }));
  pondMesh.position.set(Pd.x, 0.03, Pd.z);
  root.add(pondMesh);
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2;
    decor.add('matte', [0xbab0a2, 0xa89e90, 0xc8bfb2][k % 3], new THREE.IcosahedronGeometry(0.32 + (k % 3) * 0.06, 0), [Pd.x + Math.cos(a) * (Pd.r + 0.1), 0.12, Pd.z + Math.sin(a) * (Pd.r + 0.1)]);
  }
  for (const [lx, lz] of [[-1.2, 0.8], [0.9, -1.3], [1.6, 0.9], [-0.5, -1.8]]) decor.add('leaf', 0x5f9a4c, cyl(0.3, 0.3, 0.02, 10), [Pd.x + lx, 0.05, Pd.z + lz]);
  for (let k = 0; k < 9; k++) decor.add('leaf', 0x6f8f3a, cyl(0.02, 0.03, 0.9, 4), [Pd.x - Pd.r + 0.3 + (k % 3) * 0.15, 0.45, Pd.z - 1 + k * 0.2]);
  const duckGeo = parts([
    [xform(new THREE.SphereGeometry(0.2, 12, 8), [0, 0.12, 0], [0, 0, 0], [1, 0.7, 1.4]), 0xf2f0ea],
    [sphere(0.11, 10, 8, 0, 0.3, 0.2), 0x2f7a4a],
    [xform(new THREE.ConeGeometry(0.04, 0.12, 6), [0, 0.28, 0.33], [HALF, 0, 0]), 0xf2a33a],
  ]);
  const ducks = new THREE.InstancedMesh(duckGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), 3);
  ducks.frustumCulled = false;
  root.add(ducks);
  const dm = new THREE.Matrix4();
  const dq = new THREE.Quaternion();
  const dv = new THREE.Vector3();
  const ds = new THREE.Vector3(1, 1, 1);
  view.updaters.push((dt, time) => {
    for (let k = 0; k < 3; k++) {
      const a = time * (0.12 + k * 0.03) + k * 2.1;
      const r = 1.3 + k * 0.45;
      dv.set(Pd.x + Math.cos(a) * r, 0.02 + Math.sin(time * 2 + k) * 0.01, Pd.z + Math.sin(a) * r);
      dq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      ducks.setMatrixAt(k, dm.compose(dv, dq, ds));
    }
    ducks.instanceMatrix.needsUpdate = true;
  });

  // ---------------------------------------------------------------- pigeons pecking by the fountain
  const pigeonGeo = parts([
    [xform(new THREE.SphereGeometry(0.11, 10, 8), [0, 0.12, 0], [0, 0, 0], [0.9, 0.8, 1.4]), 0x8e939e],
    [sphere(0.06, 8, 6, 0, 0.2, 0.12), 0x6f7480],
    [xform(new THREE.ConeGeometry(0.02, 0.05, 5), [0, 0.2, 0.19], [HALF, 0, 0]), 0x2b2b2b],
    [xform(new THREE.ConeGeometry(0.06, 0.12, 5), [0, 0.13, -0.17], [-HALF, 0, 0]), 0x5f646f],
  ]);
  const pigeonSpots = [[2.6, 3.2], [3.4, 2.6], [-3.1, 3.4], [-2.4, -5.6], [3.6, -4.6], [-3.9, -3.9], [0.4, 4.1]];
  const pigeons = new THREE.InstancedMesh(pigeonGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), pigeonSpots.length);
  pigeons.frustumCulled = false;
  root.add(pigeons);
  view.updaters.push((dt, time) => {
    pigeonSpots.forEach(([px, pz], k) => {
      const peck = Math.max(0, Math.sin(time * 3 + k * 1.7)) ** 6;
      const yaw = Math.sin(time * 0.3 + k) * 1.5 + k;
      const hop = Math.max(0, Math.sin(time * 0.7 + k * 2.3)) ** 30 * 0.08;
      dv.set(F.x + px + Math.sin(time * 0.15 + k) * 0.3, hop, F.z + pz + Math.cos(time * 0.12 + k) * 0.3);
      dq.setFromEuler(new THREE.Euler(peck * 0.5, yaw, 0, 'YXZ'));
      pigeons.setMatrixAt(k, dm.compose(dv, dq, ds));
    });
    pigeons.instanceMatrix.needsUpdate = true;
  });

  // ---------------------------------------------------------------- bus stop and hedges
  {
    const [bx0, bz0, bx1, bz1] = P.busStop;
    const cx = (bx0 + bx1) / 2;
    decor.add('gloss', IRON, box(bx1 - bx0, 0.08, bz1 - bz0 + 0.3), [cx, 2.4, (bz0 + bz1) / 2]);
    decor.add('glass', 0xdff0ff, box(bx1 - bx0, 1.9, 0.05), [cx, 1.3, bz1 - 0.05]);
    for (const x of [bx0 + 0.05, bx1 - 0.05]) decor.add('gloss', IRON, box(0.06, 2.4, 0.06), [x, 1.2, bz1 - 0.05]);
    decor.add('matte', 0x8a5a3a, box(bx1 - bx0 - 0.6, 0.06, 0.4), [cx, 0.45, bz1 - 0.35]);
    decor.add('gloss', IRON, cyl(0.04, 0.04, 2.6, 8), [bx0 - 0.6, 1.3, bz0]);
    const busSign = tex.sign({ text: 'BUS', sub: '버스 정류장', w: 256, h: 256, bg: '#2a6fb5', fg: '#ffffff', size: 0.36, subSize: 0.14, radius: 128 });
    signMesh(view, busSign, 0.7, 0.7, bx0 - 0.6, 2.75, bz0, 0);
    // The airport shuttle stops here: tapping the bus stop opens the world map.
    const airport = tex.sign({ text: '✈ AIRPORT', sub: '공항 셔틀 · World map', w: 512, h: 160, bg: '#1d3a5f', fg: '#ffffff', border: '#ffc46b', size: 0.36, subSize: 0.18 });
    signMesh(view, airport, 2.2, 0.69, cx, 2.0, bz1 - 0.12, Math.PI);
    signMesh(view, airport, 2.2, 0.69, cx, 2.0, bz1 - 0.02, 0);
    pickBox(view, 'world', cx - 0.4, 1.4, (bz0 + bz1) / 2, bx1 - bx0 + 1.6, 2.8, bz1 - bz0 + 0.6);
    view.tags = [...(view.tags ?? []), { kind: 'world', at: [cx, 3.3, bz0] }];
  }
  decor.add('leaf', 0x4f8a42, box(W - 2, 1.0, 0.8), [0, 0.5, D / 2 - 0.3]);
  for (const s of [-1, 1]) decor.add('leaf', 0x4f8a42, box(0.8, 1.0, D / 2 - 5.6), [s * (W / 2 - 0.3), 0.5, (D / 2 + 5) / 2]);

  // ---------------------------------------------------------------- the town beyond
  const houses = [
    [-22, -34, 9, 8, 7, 0],
    [-10, -36, 8, 10, 6, 1],
    [12, -35, 10, 8, 8, 2],
    [24, -33, 8, 9, 6, 3],
    [-40, -6, 8, 12, 8, 4],
    [-38, 12, 9, 10, 6, 5],
    [40, -4, 8, 12, 7, 6],
    [38, 14, 9, 9, 6, 7],
    [-20, 36, 10, 8, 6, 8],
    [16, 36, 9, 8, 7, 9],
  ];
  const wallColors = ['#efe0c7', '#e8d2c4', '#dfe6d9', '#f2e6d0', '#e2d7ea'];
  for (const [hx, hz, hw, hd, hh, seed] of houses) {
    const t = tex.facade({ wall: wallColors[seed % wallColors.length], rows: Math.max(2, Math.round(hh / 3)), cols: 3, lit: 0.15, seed: 50 + seed });
    const m = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, hd), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
    m.position.set(hx, hh / 2, hz);
    root.add(m);
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-hw / 2 - 0.3, 0);
    roofShape.lineTo(hw / 2 + 0.3, 0);
    roofShape.lineTo(0, 2.2);
    roofShape.closePath();
    decor.add('matte', [0xb5563a, 0x6b7f99, 0x8a5a44][seed % 3], new THREE.ExtrudeGeometry(roofShape, { depth: hd + 0.4, bevelEnabled: false }).translate(hx, hh, hz - hd / 2 - 0.2));
  }
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2;
    const r = 46 + (k % 4) * 5;
    tree(decor, Math.cos(a) * r, Math.sin(a) * r * 0.85, { blossom: k % 5 === 0, scale: 1.4 });
  }

  // ---------------------------------------------------------------- benches (the seats here)
  const vertex = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 });
  const slats = [];
  for (let k = 0; k < 4; k++) slats.push([box(0.9, 0.035, 0.09, 0, 0.44, -0.16 + k * 0.105), 0xb0703f]);
  for (let k = 0; k < 3; k++) slats.push([xform(box(0.9, 0.08, 0.03), [0, 0.6 + k * 0.13, 0.25 + k * 0.025], [-0.18, 0, 0]), 0xb0703f]);
  for (const s of [-0.42, 0.42]) {
    slats.push([box(0.05, 0.44, 0.05, s, 0.22, -0.17), IRON]);
    slats.push([box(0.05, 0.85, 0.05, s, 0.42, 0.24), IRON]);
    slats.push([box(0.05, 0.05, 0.44, s, 0.4, 0.03), IRON]);
    slats.push([box(0.05, 0.04, 0.4, s, 0.66, 0.02), IRON]);
  }
  view.styles.bench = {
    desk: { geo: parts(slats), mat: vertex },
    chair: null,
    lamp: null,
    notebook: null,
    books: null,
    tea: null,
    pick: [1.0, 1.3, 1.0, -0.12],
  };
  for (const [bx, bz] of P.benches) shadowDecal(root, bx, bz, 2.2, 2.2, 0.2);

  decor.build(root, mats);
}
