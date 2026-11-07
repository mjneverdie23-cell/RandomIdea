// Visitors as little chibi students, drawn with four instanced meshes for the whole room.
// Every avatar replays the walk the server sent, then sits, reads, stretches or waves.

import * as THREE from '../vendor/three.module.min.js';
import { DESKS, WALK_SPEED } from '../shared/layout.js';
import { samplePath } from '../shared/path.js';
import { STATE } from '../shared/protocol.js';
import { SWEATERS } from '../shared/words.js';

const SKIN = [0xf3d3b8, 0xe3b590, 0xc99069, 0x9f6b4b, 0x7a4e35, 0xf7dfcc];
const HAIR = [0x2b211c, 0x4a3324, 0x18181e, 0x7a5232, 0xb98a55, 0x5a2a2a, 0x3a3a48];
const SIT_MS = 480;
const SEAT_LIFT = 0.42;
const EMOTE_MS = [1400, 1700, 1300];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (k) => k * k * (3 - 2 * k);
const hash = (n) => {
  let h = n * 2654435761;
  h ^= h >>> 16;
  return h >>> 0;
};
function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Avatars {
  constructor(scene, max = 110) {
    this.max = max;
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, ...o });
    this.body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.26, 4, 12), std({}), max);
    this.head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 20, 16), std({ roughness: 0.6 }), max);
    this.hair = new THREE.InstancedMesh(new THREE.SphereGeometry(0.213, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), std({ roughness: 0.9 }), max);
    this.eyes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.024, 8, 6), new THREE.MeshBasicMaterial({ color: 0x1b1716 }), max * 2);
    const white = new THREE.Color(1, 1, 1);
    for (const mesh of [this.body, this.head, this.hair, this.eyes]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      if (mesh !== this.eyes) for (let i = 0; i < max; i++) mesh.setColorAt(i, white);
      scene.add(mesh);
    }
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.38, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false }),
    );
    this.ring.visible = false;
    scene.add(this.ring);

    this.list = [];
    this.slots = new Map();
    this.selfId = 0;
    this._root = new THREE.Matrix4();
    this._local = new THREE.Matrix4();
    this._head = new THREE.Matrix4();
    this._out = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
  }

  clear() {
    this.list = [];
    this.slots.clear();
    this.setCounts();
  }

  add(m) {
    if (this.slots.has(m.id)) {
      this.paint(this.slots.get(m.id), m);
      return;
    }
    if (this.list.length >= this.max) return;
    m.yaw ??= Math.PI;
    m.rx ??= m.pos[0];
    m.rz ??= m.pos[1];
    const i = this.list.length;
    this.list.push(m);
    this.slots.set(m.id, i);
    this.paint(i, m);
    this.setCounts();
  }

  remove(id) {
    const i = this.slots.get(id);
    if (i === undefined) return;
    const last = this.list.length - 1;
    if (i !== last) {
      const moved = this.list[last];
      this.list[i] = moved;
      this.slots.set(moved.id, i);
      this.paint(i, moved);
    }
    this.list.pop();
    this.slots.delete(id);
    this.setCounts();
  }

  repaint(m) {
    const i = this.slots.get(m.id);
    if (i !== undefined) this.paint(i, m);
  }

  paint(i, m) {
    this.body.setColorAt(i, this._c.setHex(SWEATERS[m.col] ?? SWEATERS[0]));
    this.head.setColorAt(i, this._c.setHex(SKIN[hash(m.id) % SKIN.length]));
    this.hair.setColorAt(i, this._c.setHex(HAIR[hash(m.id * 7 + 3) % HAIR.length]));
    this.body.instanceColor.needsUpdate = true;
    this.head.instanceColor.needsUpdate = true;
    this.hair.instanceColor.needsUpdate = true;
  }

  setCounts() {
    const n = this.list.length;
    this.body.count = n;
    this.head.count = n;
    this.hair.count = n;
    this.eyes.count = n * 2;
  }

  emote(id, e, now) {
    const i = this.slots.get(id);
    if (i === undefined) return;
    const m = this.list[i];
    m.emote = e;
    m.emoteT = now;
  }

  /** Where an avatar is drawn right now (x, z), or null. */
  where(id) {
    const i = this.slots.get(id);
    if (i === undefined) return null;
    const m = this.list[i];
    return { x: m.rx, z: m.rz, y: m.ry ?? 0 };
  }

  /** World position just above an avatar's head, for labels and bubbles. */
  anchor(id, out) {
    const w = this.where(id);
    if (!w) return null;
    return out.set(w.x, w.y + 1.18, w.z);
  }

  /**
   * Advances every avatar to `now` (server clock, ms). Returns the ids that finished
   * walking this frame.
   */
  update(now, time, dt) {
    const arrived = [];
    const turn = 1 - Math.exp(-dt * 12);
    for (let i = 0; i < this.list.length; i++) {
      const m = this.list[i];
      let x;
      let z;
      let y = 0;
      let headPitch = 0.05;
      let headRoll = 0;
      let lean = 0;
      let scaleY = 1;

      if (m.path) {
        const dist = Math.max(0, ((now - m.t0) / 1000) * WALK_SPEED);
        const p = samplePath(m.path, dist);
        x = p.x;
        z = p.z;
        m.yaw = lerpAngle(m.yaw, p.angle, turn);
        if (p.done) {
          m.pos = m.path[m.path.length - 1];
          m.path = null;
          if (m.desk >= 0) m.sitT = now;
          arrived.push(m.id);
        } else if (dist > 0) {
          y = Math.abs(Math.sin(dist * 5.6)) * 0.05;
          headRoll = Math.sin(dist * 5.6) * 0.05;
        }
      } else if (m.desk >= 0) {
        const d = DESKS[m.desk];
        const k = ease(clamp01(m.sitT ? (now - m.sitT) / SIT_MS : 1));
        x = d.x;
        z = d.approach.z + (d.seat.z - d.approach.z) * k;
        y = SEAT_LIFT * k;
        m.yaw = lerpAngle(m.yaw, Math.PI, Math.max(turn, k));
        if (k >= 1) {
          if (m.st === STATE.FOCUS) {
            headPitch = 0.42 + Math.sin(time * 0.8 + m.id) * 0.035;
            headRoll = Math.sin(time * 0.45 + m.id * 3) * 0.04;
          } else if (m.st === STATE.BREAK) {
            headPitch = -0.28;
            lean = -0.12;
          } else {
            headPitch = 0.12;
          }
        }
      } else {
        x = m.pos[0];
        z = m.pos[1];
        if (m.standT && m.standFrom) {
          const k = ease(clamp01((now - m.standT) / SIT_MS));
          x = m.standFrom.x + (x - m.standFrom.x) * k;
          z = m.standFrom.z + (z - m.standFrom.z) * k;
          y = SEAT_LIFT * (1 - k);
          if (k >= 1) m.standT = 0;
        }
        scaleY = 1 + Math.sin(time * 2 + m.id) * 0.012;
      }

      if (m.emoteT) {
        const e = m.emote;
        const k = (now - m.emoteT) / EMOTE_MS[e];
        if (k >= 1 || k < 0) {
          m.emoteT = 0;
        } else if (e === 0) {
          headRoll += Math.sin(k * Math.PI * 6) * 0.3 * (1 - k);
        } else if (e === 1) {
          const s = Math.sin(k * Math.PI);
          scaleY *= 1 + 0.16 * s;
          headPitch -= 0.55 * s;
        } else {
          y += Math.abs(Math.sin(k * Math.PI * 3)) * 0.2 * (1 - k * 0.5);
        }
      }

      m.rx = x;
      m.rz = z;
      m.ry = y;
      this.write(i, x, y, z, m.yaw, lean, headPitch, headRoll, scaleY);
      if (m.id === this.selfId) {
        this.ring.visible = true;
        this.ring.position.set(x, 0.015, z);
      }
    }
    for (const mesh of [this.body, this.head, this.hair, this.eyes]) mesh.instanceMatrix.needsUpdate = true;
    if (!this.slots.has(this.selfId)) this.ring.visible = false;
    return arrived;
  }

  write(i, x, y, z, yaw, lean, headPitch, headRoll, scaleY) {
    const root = this._root.compose(this._p.set(x, y, z), this._q.setFromEuler(this._e.set(lean, yaw, 0)), this._s.set(1, 1, 1));
    this._local.makeScale(1, scaleY, 1).setPosition(0, 0.33 * scaleY, 0);
    this.body.setMatrixAt(i, this._out.multiplyMatrices(root, this._local));
    this._local.compose(this._p.set(0, 0.66 * scaleY + 0.17, 0), this._q.setFromEuler(this._e.set(headPitch, 0, headRoll)), this._s.set(1, 1, 1));
    const head = this._head.multiplyMatrices(root, this._local);
    this.head.setMatrixAt(i, head);
    this._local.makeTranslation(0, 0.022, -0.012);
    this.hair.setMatrixAt(i, this._out.multiplyMatrices(head, this._local));
    this._local.makeTranslation(-0.072, -0.018, 0.183);
    this.eyes.setMatrixAt(i * 2, this._out.multiplyMatrices(head, this._local));
    this._local.makeTranslation(0.072, -0.018, 0.183);
    this.eyes.setMatrixAt(i * 2 + 1, this._out.multiplyMatrices(head, this._local));
  }
}
