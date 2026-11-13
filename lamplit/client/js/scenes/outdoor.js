// Pieces for the outdoor places and for fire: a sky with clouds and sunshine, a ground,
// flames that flicker, palms, fountain spray, pigeons and falling petals.

import * as THREE from '../../vendor/three.module.min.js';
import * as tex from '../textures.js';
import { parts, xform, floorPlane, box, cyl, sphere } from '../geo.js';
import { HALF } from './common.js';

/**
 * Sky dome, drifting clouds, sunlight and a big ground plane. Returns the ground mesh (for
 * tapping). `sky` = [top, horizon, below] colours.
 */
export function outdoors(view, { sky = ['#4f8fd8', '#cfe6f7', '#b8d3a0'], fog = 0xd5e7f5, fogNear = 60, fogFar = 175, sun = 0xfff0d2, sunPos = [26, 40, 22], sunPower = 2.5, hemi = [0xdcecff, 0x8aa86a, 1.55], ambient = 0.22, ground, clouds = 9, cloudOpacity = 0.92 }) {
  const root = view.root;
  view.background = new THREE.Color(sky[1]);
  view.fog = new THREE.Fog(fog, fogNear, fogFar);
  // Under an open sky you can tilt the camera up to take in the tall things.
  view.cam.minPitch = -0.12;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(160, 32, 16),
    new THREE.MeshBasicMaterial({ map: tex.skyDome({ top: sky[0], horizon: sky[1], ground: sky[2] }), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  dome.renderOrder = -1;
  root.add(dome);
  root.add(new THREE.HemisphereLight(hemi[0], hemi[1], hemi[2]));
  root.add(new THREE.AmbientLight(0xffffff, ambient));
  const light = new THREE.DirectionalLight(sun, sunPower);
  light.position.set(...sunPos);
  root.add(light);
  if (clouds) {
    const cloudTex = [tex.cloud({ seed: 5 }), tex.cloud({ seed: 9 }), tex.cloud({ seed: 13 })];
    const list = [];
    for (let k = 0; k < clouds; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex[k % 3], fog: false, depthWrite: false, transparent: true, opacity: cloudOpacity }));
      const a = (k / clouds) * Math.PI * 2;
      s.position.set(Math.cos(a) * (70 + (k % 3) * 18), 42 + (k % 4) * 7, Math.sin(a) * (70 + (k % 2) * 25) - 20);
      s.scale.set(34 + (k % 3) * 10, 15 + (k % 2) * 5, 1);
      root.add(s);
      list.push(s);
    }
    view.updaters.push((dt) => {
      for (const s of list) {
        s.position.x += dt * 0.6;
        if (s.position.x > 110) s.position.x = -110;
      }
    });
  }
  ground.anisotropy = view.aniso;
  const mesh = new THREE.Mesh(floorPlane(240, 240), new THREE.MeshStandardMaterial({ map: ground, roughness: 1 }));
  root.add(mesh);
  view.floors.push(mesh);
  return mesh;
}

/** An extra tap target that leads through a door (a whole building's front). */
export function pickBox(view, to, x, y, z, w, h, d, ry = 0) {
  const pick = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(x, y, z);
  pick.rotation.y = ry;
  pick.userData.door = to;
  view.root.add(pick);
  view.doorPicks.push(pick);
  return pick;
}

// ------------------------------------------------------------------ camera blockers

const BLOCKER = new THREE.MeshBasicMaterial({ visible: false });

/**
 * Big buildings the camera mustn't pass through: when one gets between you and the camera,
 * the camera slides in front of it instead of ending up inside it or staring at its roof.
 */
export function blockCamera(view, ...meshes) {
  view.camBlockers.push(...meshes);
}

/** An invisible shape the camera can't pass through. It's never drawn, only raycast. */
export function blockShape(view, geometry, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, BLOCKER);
  m.position.set(x, y, z);
  m.updateMatrixWorld(true);
  view.camBlockers.push(m);
  return m;
}

/** An invisible box over [x0, z0, x1, z1], `h` tall, that the camera can't pass through. */
export const blockBox = (view, x0, z0, x1, z1, h) => blockShape(view, new THREE.BoxGeometry(x1 - x0, h, z1 - z0), (x0 + x1) / 2, h / 2, (z0 + z1) / 2);

let flameTex = null;
function flameTexture() {
  if (flameTex) return flameTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 92, 2, 32, 80, 60);
  grad.addColorStop(0, 'rgba(255, 250, 220, 1)');
  grad.addColorStop(0.25, 'rgba(255, 200, 90, 0.95)');
  grad.addColorStop(0.55, 'rgba(255, 110, 30, 0.6)');
  grad.addColorStop(1, 'rgba(255, 60, 10, 0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(32, 4);
  g.bezierCurveTo(54, 50, 60, 90, 32, 124);
  g.bezierCurveTo(4, 90, 10, 50, 32, 4);
  g.fill();
  flameTex = new THREE.CanvasTexture(c);
  flameTex.colorSpace = THREE.SRGBColorSpace;
  return flameTex;
}

/**
 * Flickering flames (torches, braziers) at the given points: [x, y, z, size]. One draw
 * call for the flames and one for their glow.
 */
export function fires(view, points, { color = 0xffa040, glowSize = 2.2 } = {}) {
  const n = points.length;
  const flames = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 2).translate(0, 0.9, 0),
    new THREE.MeshBasicMaterial({ map: flameTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }),
    n * 2,
  );
  flames.frustumCulled = false;
  flames.renderOrder = 6;
  const glowPos = new Float32Array(n * 3);
  points.forEach(([x, y, z], i) => glowPos.set([x, y + 0.3, z], i * 3));
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
  const glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({ size: glowSize, map: tex.glow(), color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  glow.renderOrder = 5;
  view.root.add(flames, glow);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  view.updaters.push((dt, time) => {
    points.forEach(([x, y, z, size = 0.3], i) => {
      const f = 0.85 + Math.sin(time * 11 + i * 3.1) * 0.08 + Math.sin(time * 23 + i) * 0.07;
      for (let k = 0; k < 2; k++) {
        q.setFromAxisAngle(up, k * HALF + Math.sin(time * 2 + i) * 0.2);
        m.compose(p.set(x, y, z), q, s.set(size * (0.9 + 0.1 * Math.sin(time * 7 + i)), size * f, size));
        flames.setMatrixAt(i * 2 + k, m);
      }
    });
    flames.instanceMatrix.needsUpdate = true;
    glow.material.opacity = 0.5 + Math.sin(time * 9) * 0.04;
  });
  return { flames, glow };
}

/** A date palm: a gently curved trunk and drooping fronds. */
export function palm(decor, x, z, { height = 6, lean = 0.15, turn = 0 } = {}) {
  const segs = 7;
  let px = x;
  let pz = z;
  let py = 0;
  const dx = Math.sin(turn) * lean;
  const dz = Math.cos(turn) * lean;
  for (let k = 0; k < segs; k++) {
    const h = height / segs;
    const r0 = 0.24 - k * 0.018;
    decor.add('matte', k % 2 ? 0x8a6a46 : 0x7a5a3a, xform(cyl(r0 - 0.02, r0, h * 1.05, 7), [px, py + h / 2, pz], [dz * 0.8, 0, -dx * 0.8]));
    px += dx * h * (0.3 + k * 0.1);
    pz += dz * h * (0.3 + k * 0.1);
    py += h;
  }
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + turn;
    const frond = new THREE.ConeGeometry(0.5, 3.2, 4, 1).scale(1, 1, 0.12).translate(0, 1.6, 0);
    xform(frond, [px, py, pz], [Math.cos(a) * 1.15, 0, -Math.sin(a) * 1.15]);
    frond.rotateY(0);
    decor.add('leaf', k % 2 ? 0x4f8a3a : 0x5f9a45, frond);
  }
  for (let k = 0; k < 5; k++) decor.add('matte', 0x8a4a1a, sphere(0.1, 6, 5), [px + Math.cos(k * 1.3) * 0.25, py - 0.25, pz + Math.sin(k * 1.3) * 0.25]);
}

/** Water drops thrown up from a spout and falling back into a basin. */
export function spray(view, x, z, { top = 2.95, floor = 1.72, count = 70, spread = 0.5, lift = 1.6 } = {}) {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const reset = (i) => {
    const a = Math.random() * Math.PI * 2;
    const v = spread * (0.6 + Math.random() * 0.6);
    pos.set([x, top, z], i * 3);
    vel.set([Math.cos(a) * v, lift + Math.random() * 0.8, Math.sin(a) * v], i * 3);
  };
  for (let i = 0; i < count; i++) {
    reset(i);
    pos[i * 3 + 1] -= Math.random() * 1.2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const drops = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.09, color: 0xe8f7ff, transparent: true, opacity: 0.85, depthWrite: false }));
  drops.frustumCulled = false;
  view.root.add(drops);
  view.extras.push(drops);
  view.updaters.push((dt) => {
    if (!drops.visible) return;
    for (let i = 0; i < count; i++) {
      vel[i * 3 + 1] -= 9.8 * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < floor) reset(i);
    }
    geo.attributes.position.needsUpdate = true;
  });
}

/** Pigeons pecking about at the given spots. */
export function pigeons(view, spots) {
  const geo = parts([
    [xform(new THREE.SphereGeometry(0.11, 10, 8), [0, 0.12, 0], [0, 0, 0], [0.9, 0.8, 1.4]), 0x8e939e],
    [sphere(0.06, 8, 6, 0, 0.2, 0.12), 0x6f7480],
    [xform(new THREE.ConeGeometry(0.02, 0.05, 5), [0, 0.2, 0.19], [HALF, 0, 0]), 0x2b2b2b],
    [xform(new THREE.ConeGeometry(0.06, 0.12, 5), [0, 0.13, -0.17], [-HALF, 0, 0]), 0x5f646f],
  ]);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), spots.length);
  mesh.frustumCulled = false;
  view.root.add(mesh);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  view.updaters.push((dt, time) => {
    spots.forEach(([px, pz], k) => {
      const peck = Math.max(0, Math.sin(time * 3 + k * 1.7)) ** 6;
      const hop = Math.max(0, Math.sin(time * 0.7 + k * 2.3)) ** 30 * 0.08;
      v.set(px + Math.sin(time * 0.15 + k) * 0.3, hop, pz + Math.cos(time * 0.12 + k) * 0.3);
      q.setFromEuler(e.set(peck * 0.5, Math.sin(time * 0.3 + k) * 1.5 + k, 0));
      mesh.setMatrixAt(k, m.compose(v, q, s));
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
}

/** Petals (or leaves) drifting down around trees at [x, z]. */
export function petals(view, trees, { count = 150, color = 0xf9c1d0, height = 4.5 } = {}) {
  const pos = new Float32Array(count * 3);
  const reset = (i, top = true) => {
    const [tx, tz] = trees[i % trees.length];
    pos.set([tx + (Math.random() - 0.5) * 3, top ? height - 1.5 + Math.random() * 1.5 : Math.random() * height, tz + (Math.random() - 0.5) * 3], i * 3);
  };
  for (let i = 0; i < count; i++) reset(i, false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.08, color, transparent: true, opacity: 0.95 }));
  pts.frustumCulled = false;
  view.root.add(pts);
  view.extras.push(pts);
  view.updaters.push((dt, time) => {
    if (!pts.visible) return;
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] -= dt * (0.35 + (i % 5) * 0.05);
      pos[i * 3] += Math.sin(time * 0.8 + i) * dt * 0.35 + dt * 0.15;
      pos[i * 3 + 2] += Math.cos(time * 0.6 + i * 1.3) * dt * 0.2;
      if (pos[i * 3 + 1] < 0.02) reset(i);
    }
    geo.attributes.position.needsUpdate = true;
  });
}

/** Drifting specks (sand, dust, incense) inside a box, moving with a wind. */
export function drift(view, { x = 0, z = 0, w = 40, d = 40, y0 = 0.1, y1 = 1.5, count = 260, color = 0xf3dcae, size = 0.05, wind = [1.2, 0, 0.3], opacity = 0.6, rise = 0 } = {}) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) pos.set([x + (Math.random() - 0.5) * w, y0 + Math.random() * (y1 - y0), z + (Math.random() - 0.5) * d], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, color, transparent: true, opacity, depthWrite: false }));
  pts.frustumCulled = false;
  view.root.add(pts);
  view.extras.push(pts);
  view.updaters.push((dt, time) => {
    if (!pts.visible) return;
    for (let i = 0; i < count; i++) {
      let px = pos[i * 3] + (wind[0] + Math.sin(time + i) * 0.3) * dt;
      let py = pos[i * 3 + 1] + (rise + Math.sin(time * 1.3 + i * 0.7) * 0.1) * dt;
      let pz = pos[i * 3 + 2] + (wind[2] + Math.cos(time * 0.8 + i) * 0.2) * dt;
      if (px > x + w / 2) px -= w;
      if (px < x - w / 2) px += w;
      if (pz > z + d / 2) pz -= d;
      if (pz < z - d / 2) pz += d;
      if (py > y1) py = y0;
      if (py < y0) py = y1;
      pos[i * 3] = px;
      pos[i * 3 + 1] = py;
      pos[i * 3 + 2] = pz;
    }
    geo.attributes.position.needsUpdate = true;
  });
  return pts;
}

export { box, cyl, sphere, xform };
