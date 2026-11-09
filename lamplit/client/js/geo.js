// Geometry helpers for building places out of simple shapes. Static decoration is
// collected per material "channel" and merged into one mesh per channel, so a whole room
// of furniture costs a handful of draw calls.

import * as THREE from '../vendor/three.module.min.js';

export const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
export const cyl = (rt, rb, h, seg = 16, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z);
export const sphere = (r, ws = 16, hs = 12, x = 0, y = 0, z = 0) => new THREE.SphereGeometry(r, ws, hs).translate(x, y, z);

/** Moves, rotates (radians, XYZ order) and scales a geometry in place. */
export function xform(geo, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const sc = Array.isArray(s) ? s : [s, s, s];
  return geo.applyMatrix4(_m.compose(_v.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(sc[0], sc[1], sc[2])));
}

/** Gives every vertex of a geometry one colour. */
export function paint(geo, color) {
  _c.set(color);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * Merges geometries into one indexed geometry. Keeps uv and colour when every part has
 * them. The parts are disposed.
 */
export function merge(list) {
  let vertices = 0;
  let indices = 0;
  for (const g of list) {
    vertices += g.attributes.position.count;
    indices += g.index ? g.index.count : g.attributes.position.count;
  }
  const hasUv = list.every((g) => g.attributes.uv);
  const hasColor = list.every((g) => g.attributes.color);
  const pos = new Float32Array(vertices * 3);
  const nor = new Float32Array(vertices * 3);
  const uv = hasUv ? new Float32Array(vertices * 2) : null;
  const col = hasColor ? new Float32Array(vertices * 3) : null;
  const idx = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const count = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (uv) uv.set(g.attributes.uv.array, vo * 2);
    if (col) col.set(g.attributes.color.array, vo * 3);
    if (g.index) {
      const src = g.index.array;
      for (let k = 0; k < src.length; k++) idx[io + k] = src[k] + vo;
      io += src.length;
    } else {
      for (let k = 0; k < count; k++) idx[io + k] = k + vo;
      io += count;
    }
    vo += count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** A merged, vertex-coloured geometry from parts given as [geometry, colour]. */
export function parts(list) {
  return merge(list.map(([g, c]) => paint(g, c)));
}

export function instanced(geometry, material, count, { dynamic = false } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  if (dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

/** Shared vertex-coloured materials for decoration. */
export function decorMaterials() {
  return {
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }),
    gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35 }),
    leaf: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false }),
  };
}

/**
 * Collects static decoration by channel (matte, gloss, leaf, glow, glass) and builds one
 * mesh per channel. `add(channel, colour, geometry, [x, y, z], rotY)`.
 */
export class Decor {
  constructor() {
    this.lists = new Map();
  }

  add(channel, color, geo, p = null, ry = 0) {
    if (p || ry) xform(geo, p ?? [0, 0, 0], [0, ry, 0]);
    paint(geo, color);
    if (!this.lists.has(channel)) this.lists.set(channel, []);
    this.lists.get(channel).push(geo);
    return geo;
  }

  /** Adds a group of parts, all placed at p and turned by ry around their own origin. */
  group(list, p = [0, 0, 0], ry = 0) {
    for (const [channel, color, geo] of list) {
      xform(geo, [0, 0, 0], [0, ry, 0]);
      geo.translate(p[0], p[1], p[2]);
      this.add(channel, color, geo);
    }
  }

  build(parent, materials) {
    const meshes = {};
    for (const [channel, list] of this.lists) {
      if (list.length === 0) continue;
      const mesh = new THREE.Mesh(merge(list), materials[channel]);
      mesh.name = `decor-${channel}`;
      if (channel === 'glass') mesh.renderOrder = 4;
      parent.add(mesh);
      meshes[channel] = mesh;
    }
    this.lists.clear();
    return meshes;
  }
}

/** Plane lying on the floor (facing up) of size w×d centred at (x, y, z). */
export const floorPlane = (w, d, x = 0, y = 0, z = 0) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, y, z);

/** Plane standing up facing +z, rotated by ry, centred at (x, y, z). */
export const wallPlane = (w, h, x = 0, y = 0, z = 0, ry = 0) => new THREE.PlaneGeometry(w, h).rotateY(ry).translate(x, y, z);
