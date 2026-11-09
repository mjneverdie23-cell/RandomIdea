// Pieces several places share: plants, rugs, sunbeams, drifting dust, door markers and
// hit boxes, wall clocks and the room board.

import * as THREE from '../../vendor/three.module.min.js';
import * as tex from '../textures.js';
import { Decor, box, cyl, sphere, xform, floorPlane } from '../geo.js';
import { clockDrawer } from '../place.js';

export const HALF = Math.PI / 2;

/** A potted plant (pot + leafy blobs) added to a Decor. */
export function plant(decor, x, z, r = 0.42, { pot = 0x9a5a3a, leaf = 0x3f7a45, tall = 1 } = {}) {
  decor.add('matte', pot, cyl(r * 0.8, r * 0.62, 0.5, 14), [x, 0.25, z]);
  decor.add('matte', 0x4a3424, cyl(r * 0.74, r * 0.74, 0.02, 14), [x, 0.5, z]);
  decor.add('leaf', leaf, new THREE.IcosahedronGeometry(r * 1.2, 1), [x, 0.5 + 0.5 * tall, z]);
  decor.add('leaf', new THREE.Color(leaf).offsetHSL(0.02, 0, 0.06), new THREE.IcosahedronGeometry(r * 0.9, 1), [x + r * 0.35, 0.5 + 0.95 * tall, z - r * 0.2]);
  decor.add('leaf', new THREE.Color(leaf).offsetHSL(-0.02, 0, -0.04), new THREE.IcosahedronGeometry(r * 0.75, 1), [x - r * 0.3, 0.5 + 0.8 * tall, z + r * 0.25]);
}

/** A rug lying on the floor. */
export function rug(root, w, len, hue, x, z, { alongX = false, y = 0.005 } = {}) {
  const t = tex.rug(hue);
  t.repeat.set(1, Math.max(1, Math.round(len / 5)));
  const g = new THREE.PlaneGeometry(w, len).rotateX(-HALF);
  if (alongX) g.rotateY(HALF);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
  m.position.set(x, y, z);
  root.add(m);
  return m;
}

/**
 * A beam of light from a window at `from` ([x, y, z]) down to the floor at `to`
 * ([x, z]), `width` wide across the beam.
 */
export function sunbeam(root, from, to, width, { color = 0xfff1d0, opacity = 0.09 } = {}) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[2];
  const horiz = Math.hypot(dx, dz);
  const len = Math.hypot(horiz, from[1]);
  const g = new THREE.PlaneGeometry(width, len);
  // Lay the plane's length along the beam: tilt it down, then turn toward the floor point.
  g.rotateY(HALF);
  g.rotateZ(Math.atan2(horiz, from[1]));
  g.rotateY(Math.atan2(dx, dz) - HALF);
  const m = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({ map: tex.shaft(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
  );
  m.position.set((from[0] + to[0]) / 2, from[1] / 2, (from[2] + to[1]) / 2);
  m.renderOrder = 5;
  root.add(m);
  return m;
}

/** A soft patch of sunlight on the floor. */
export function sunPatch(root, x, z, w, d, { color = 0xffe2a8, opacity = 0.22, y = 0.008 } = {}) {
  const m = new THREE.Mesh(
    floorPlane(w, d),
    new THREE.MeshBasicMaterial({ map: tex.glow(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  m.position.set(x, y, z);
  m.renderOrder = 1;
  root.add(m);
  return m;
}

/** Dust or pollen drifting slowly upward inside a box. Hidden on the battery-saver setting. */
export function motes(view, { x = 0, z = 0, w = 20, d = 20, y0 = 0.4, y1 = 5, count = 300, color = 0xffe3b5, size = 0.045, opacity = 0.45 } = {}) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = x + (Math.random() - 0.5) * w;
    pos[i * 3 + 1] = y0 + Math.random() * (y1 - y0);
    pos[i * 3 + 2] = z + (Math.random() - 0.5) * d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(g, new THREE.PointsMaterial({ size, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  points.frustumCulled = false;
  view.root.add(points);
  view.extras.push(points);
  view.updaters.push((dt, time) => {
    if (!points.visible) return;
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) {
      let y = a.array[i * 3 + 1] + dt * 0.03 * (0.4 + ((i * 13) % 7) / 7);
      if (y > y1) y = y0;
      a.array[i * 3 + 1] = y;
      a.array[i * 3] += Math.sin(time * 0.2 + i) * dt * 0.02;
    }
    a.needsUpdate = true;
  });
  return points;
}

/**
 * Makes a door you can tap: an invisible hit box, and a softly bobbing arrow above it
 * so people notice it. `to` is the kind of place it leads to.
 */
export function door(view, to, { x, y = 1.45, z, w = 0.6, h = 2.9, d = 2, arrowY = 3.25, arrowAt = null, color = 0x8fe3d2, arrowRot = 0 } = {}) {
  const pick = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(x, y, z);
  pick.userData.door = to;
  view.root.add(pick);
  view.doorPicks.push(pick);
  const shape = new THREE.Shape();
  shape.moveTo(-0.22, 0.12);
  shape.lineTo(0, -0.12);
  shape.lineTo(0.22, 0.12);
  shape.lineTo(0.22, 0.24);
  shape.lineTo(0, 0);
  shape.lineTo(-0.22, 0.24);
  shape.closePath();
  const arrow = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false }).translate(0, 0, -0.025), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  const at = arrowAt ?? [x, arrowY, z];
  arrow.position.set(at[0], at[1], at[2]);
  arrow.rotation.y = arrowRot;
  view.root.add(arrow);
  view.updaters.push((dt, time) => {
    arrow.position.y = at[1] + Math.sin(time * 2.2) * 0.08;
    arrow.rotation.y = arrowRot + Math.sin(time * 0.9) * 0.5;
  });
  return { pick, arrow };
}

/**
 * Decoration fixed to each wall of a room, kept in its own group per wall so the group
 * hides whenever the camera is on the far side of that wall (the walls themselves are
 * one-sided and vanish then, and whatever hangs on them should too).
 */
export function wallSides(view, W, D) {
  const tests = {
    front: (c) => c.z > -D / 2 + 0.3,
    back: (c) => c.z < D / 2 - 0.3,
    left: (c) => c.x > -W / 2 + 0.3,
    right: (c) => c.x < W / 2 - 0.3,
  };
  const sides = {};
  for (const k of Object.keys(tests)) {
    const group = new THREE.Group();
    group.name = `wall-${k}`;
    view.root.add(group);
    view.cullers.push({ object: group, test: tests[k] });
    sides[k] = { decor: new Decor(), group };
  }
  sides.build = (mats) => {
    for (const k of Object.keys(tests)) sides[k].decor.build(sides[k].group, mats);
  };
  return sides;
}

/** A wall clock facing +z (turned by ry) at (x, y, z). */
export function wallClock(view, x, y, z, { radius = 0.85, ry = 0, rim = 0xb08d57, face, ink, parent = view.root } = {}) {
  const dyn = tex.dynamic(256, 256);
  const faceMesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.MeshBasicMaterial({ map: dyn.texture }));
  const rimMesh = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.035, radius * 0.07, 10, 48), new THREE.MeshStandardMaterial({ color: rim, metalness: 0.6, roughness: 0.35 }));
  for (const m of [faceMesh, rimMesh]) {
    m.position.set(x, y, z);
    m.rotation.y = ry;
    parent.add(m);
  }
  const draw = clockDrawer(dyn, { face, ink });
  draw(new Date());
  view.clocks.push(draw);
}

/** A board on the wall showing the room's title and live figures. */
export function roomBoard(view, x, y, z, { w = 4.65, h = 2.0, ry = 0, style = 'chalk', parent = view.root } = {}) {
  const dyn = tex.dynamic(1024, Math.round((1024 * h) / w));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: dyn.texture, toneMapped: style !== 'led' }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  parent.add(mesh);
  view.board = (data) => drawBoard(dyn, data, style);
  view.board({ title: 'Lamplit', items: [] });
  return mesh;
}

const SANS = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const SERIF = 'Georgia, "Nanum Myeongjo", serif';

function drawBoard(dyn, { title, items }, style) {
  const { ctx: g, texture, canvas } = dyn;
  const w = canvas.width;
  const h = canvas.height;
  const looks = {
    chalk: { bg: ['#24382f', '#1b2c24'], title: 'rgba(240, 236, 220, 0.82)', value: '#ffd38a', label: 'rgba(240, 236, 220, 0.82)', font: SERIF },
    cafe: { bg: ['#2b2a28', '#1f1e1c'], title: 'rgba(250, 244, 230, 0.9)', value: '#ffcf8a', label: 'rgba(250, 244, 230, 0.85)', font: SERIF },
    led: { bg: ['#07061a', '#120a2e'], title: '#9ff3ff', value: '#ff7ad9', label: '#c9d4ff', font: SANS },
  };
  const L = looks[style] ?? looks.chalk;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, L.bg[0]);
  grad.addColorStop(1, L.bg[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  if (style === 'led') {
    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 2);
  } else {
    g.fillStyle = 'rgba(255,255,255,0.035)';
    for (let i = 0; i < 40; i++) g.fillRect((i * 97) % w, (i * 53) % h, 60, 2);
  }
  g.textAlign = 'center';
  g.fillStyle = L.title;
  g.font = `600 ${Math.round(h * 0.09)}px ${L.font}`;
  if (style === 'led') {
    g.shadowColor = L.title;
    g.shadowBlur = 18;
  }
  g.fillText(title, w / 2, h * 0.16);
  g.shadowBlur = 0;
  g.fillStyle = L.label;
  g.globalAlpha = 0.3;
  g.fillRect(w / 2 - 140, h * 0.21, 280, 2);
  g.globalAlpha = 1;
  items.forEach((item, k) => {
    const x = items.length === 1 ? w / 2 : k === 0 ? w * 0.28 : w * 0.72;
    g.fillStyle = L.value;
    g.font = `700 ${Math.round(h * 0.3)}px ${L.font}`;
    if (style === 'led') {
      g.shadowColor = L.value;
      g.shadowBlur = 24;
    }
    g.fillText(item.value, x, h * 0.61);
    g.shadowBlur = 0;
    g.fillStyle = L.label;
    g.font = `500 ${Math.round(h * 0.082)}px ${SANS}`;
    g.fillText(item.label, x, h * 0.78);
  });
  texture.needsUpdate = true;
}

/** A sign plane (from tex.sign) at (x, y, z), facing +z turned by ry. */
export function signMesh(view, texture, w, h, x, y, z, ry = 0, { glow = false, parent = view.root, double = false } = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: !glow, side: double ? THREE.DoubleSide : THREE.FrontSide }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  parent.add(m);
  return m;
}

/** Simple wooden chair geometry facing -z (the sitter's back toward +z). */
export function chairParts(wood = 0x6b4329, seat = null) {
  return [
    [box(0.44, 0.05, 0.42, 0, 0.45, 0), seat ?? wood],
    [box(0.42, 0.06, 0.03, 0, 0.88, 0.2), wood],
    [box(0.42, 0.05, 0.03, 0, 0.68, 0.2), wood],
    [box(0.035, 0.45, 0.035, -0.19, 0.225, -0.18), wood],
    [box(0.035, 0.45, 0.035, 0.19, 0.225, -0.18), wood],
    [box(0.035, 0.9, 0.035, -0.19, 0.45, 0.19), wood],
    [box(0.035, 0.9, 0.035, 0.19, 0.45, 0.19), wood],
  ];
}

/** A round café stool. */
export function stoolParts(top = 0x3b2a20, frame = 0x2a2a2e) {
  return [
    [cyl(0.19, 0.18, 0.06, 18, 0, 0.47, 0), top],
    [cyl(0.025, 0.025, 0.44, 8, 0, 0.22, 0), frame],
    [xform(new THREE.TorusGeometry(0.15, 0.012, 6, 18), [0, 0.18, 0], [HALF, 0, 0]), frame],
    [cyl(0.17, 0.19, 0.02, 18, 0, 0.01, 0), frame],
  ];
}

/** A leafy tree: trunk and a cluster of low-poly blobs. `blossom` makes it a cherry tree. */
export function tree(decor, x, z, { blossom = false, scale = 1 } = {}) {
  const s = scale;
  decor.add('matte', 0x6a4a32, cyl(0.16 * s, 0.24 * s, 2.4 * s, 8), [x, 1.2 * s, z]);
  decor.add('matte', 0x6a4a32, xform(cyl(0.07 * s, 0.1 * s, 1.1 * s, 6), [x + 0.35 * s, 2.5 * s, z], [0, 0, -0.6]));
  const colors = blossom ? [0xf7b6c8, 0xf9c9d6, 0xf2a3bb, 0xfbd8e2] : [0x5f9a4c, 0x6fab55, 0x4f8a42, 0x7cb35d];
  const blobs = [
    [0, 3.4, 0, 1.35],
    [0.9, 3.1, 0.3, 1.0],
    [-0.8, 3.0, -0.2, 1.05],
    [0.2, 4.1, -0.4, 0.95],
    [-0.3, 3.3, 0.85, 0.9],
  ];
  blobs.forEach(([bx, by, bz, r], k) => decor.add('leaf', colors[k % colors.length], new THREE.IcosahedronGeometry(r * s, 1), [x + bx * s, by * s, z + bz * s]));
}

/** Contact shadow under something on the floor. */
export function shadowDecal(root, x, z, w, d, opacity = 0.25, y = 0.01) {
  const m = new THREE.Mesh(floorPlane(w, d), new THREE.MeshBasicMaterial({ map: tex.blob(), transparent: true, opacity, depthWrite: false, color: 0x000000 }));
  m.position.set(x, y, z);
  m.renderOrder = 1;
  root.add(m);
  return m;
}

export { box, cyl, sphere, xform };
