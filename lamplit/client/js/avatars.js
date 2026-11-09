// Visitors as little chibi students, drawn with instanced meshes for the whole room:
// one draw call per body part and per kind of item, however many people wear it.
// Every frame, each avatar's parts are packed into those meshes again, which keeps
// changes of outfit, pets and held items trivial.

import * as THREE from '../vendor/three.module.min.js';
import { WALK_SPEED, KITS } from '../shared/layout.js';
import { samplePath } from '../shared/path.js';
import * as tex from './textures.js';
import { STATE } from '../shared/protocol.js';
import { SWEATERS } from '../shared/words.js';
import { sanitizeLook } from '../shared/catalog.js';
import { itemGeometry, outfitBase, accessoryAnchor, SMALL_PETS } from './look.js';

const SKIN = [0xf3d3b8, 0xe3b590, 0xc99069, 0x9f6b4b, 0x7a4e35, 0xf7dfcc];
const HAIR = [0x2b211c, 0x4a3324, 0x18181e, 0x7a5232, 0xb98a55, 0x5a2a2a, 0x3a3a48];
const DESK_TOP = 0.76;
const SIT_MS = 480;
const SEAT_LIFT = 0.42;
const EMOTE_MS = [1400, 1700, 1300];
const HAND_ANCHOR = new THREE.Vector3(0, 0.34, 0.25);

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
    this.scene = scene;
    this.max = max;
    this.matSkin = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    this.matCloth = new THREE.MeshStandardMaterial({ roughness: 0.82 });
    this.matVertex = new THREE.MeshStandardMaterial({ roughness: 0.7, vertexColors: true });
    this.body = this.mesh(new THREE.CapsuleGeometry(0.2, 0.26, 4, 12), this.matCloth, max, true);
    this.head = this.mesh(new THREE.SphereGeometry(0.2, 20, 16), this.matSkin, max, true);
    this.hair = this.mesh(new THREE.SphereGeometry(0.213, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), new THREE.MeshStandardMaterial({ roughness: 0.9 }), max, true);
    this.eyes = this.mesh(new THREE.SphereGeometry(0.024, 8, 6), new THREE.MeshBasicMaterial({ color: 0x1b1716 }), max * 2, false);
    this.hands = this.mesh(new THREE.SphereGeometry(0.055, 10, 8), this.matSkin, max * 2, true);
    // Soft contact shadows under everyone and their pets.
    this.shadows = this.mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex.blob(), color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
      max * 2,
      false,
    );
    this.shadows.renderOrder = 1;
    this.base = [this.body, this.head, this.hair, this.eyes, this.hands, this.shadows];
    /** Seats of the place being shown (from shared/places.js). */
    this.desks = [];
    this._frame = new THREE.Matrix4();
    /** `${item}:${variant}` -> [[group, InstancedMesh], ...] */
    this.parts = new Map();

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
    this._body = new THREE.Matrix4();
    this._head = new THREE.Matrix4();
    this._local = new THREE.Matrix4();
    this._out = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._s = new THREE.Vector3(1, 1, 1);
    this._colors = { tint: new THREE.Color(), hair: new THREE.Color(), skin: new THREE.Color() };
    this._c = new THREE.Color();
  }

  mesh(geometry, material, count, colored) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.userData.n = 0;
    if (colored) {
      const white = new THREE.Color(1, 1, 1);
      for (let i = 0; i < count; i++) mesh.setColorAt(i, white);
    }
    this.scene.add(mesh);
    return mesh;
  }

  /** The instanced meshes for an item variant, created the first time someone needs them. */
  partSet(id, variant) {
    const key = `${id}:${variant}`;
    let set = this.parts.get(key);
    if (set) return set;
    const geo = itemGeometry(id, variant);
    set = [];
    if (geo) {
      for (const [group, g] of Object.entries(geo)) {
        set.push([group, this.mesh(g, group === 'fixed' ? this.matVertex : this.matCloth, this.max, group !== 'fixed')]);
      }
    }
    this.parts.set(key, set);
    return set;
  }

  clear() {
    this.list = [];
    this.slots.clear();
  }

  /** The seats of the place now on screen. */
  setDesks(desks) {
    this.desks = desks;
  }

  /** Seat d's frame (at the desk, turned the way the sitter faces), times a local offset. */
  deskMatrix(d, x, y, z, out) {
    this._frame.makeRotationY(d.rot).setPosition(d.x, 0, d.z);
    return out.multiplyMatrices(this._frame, this._local.makeTranslation(x, y, z));
  }

  add(m) {
    m.look = sanitizeLook(m.lk ?? m.look);
    if (this.slots.has(m.id)) return;
    if (this.list.length >= this.max) return;
    m.yaw ??= Math.PI;
    m.rx ??= m.pos[0];
    m.rz ??= m.pos[1];
    this.slots.set(m.id, this.list.length);
    this.list.push(m);
  }

  remove(id) {
    const i = this.slots.get(id);
    if (i === undefined) return;
    const last = this.list.length - 1;
    if (i !== last) {
      const moved = this.list[last];
      this.list[i] = moved;
      this.slots.set(moved.id, i);
    }
    this.list.pop();
    this.slots.delete(id);
  }

  /** Colours and items are read every frame, so a changed look only needs sanitising. */
  repaint(m) {
    m.look = sanitizeLook(m.lk ?? m.look);
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
    for (const mesh of this.base) mesh.userData.n = 0;
    for (const set of this.parts.values()) for (const [, mesh] of set) mesh.userData.n = 0;

    for (const m of this.list) {
      let x;
      let z;
      let y = 0;
      let headPitch = 0.05;
      let headRoll = 0;
      let lean = 0;
      let scaleY = 1;
      let seated = false;
      let walking = false;
      let stride = 0;

      if (m.preview) {
        x = m.pos[0];
        z = m.pos[1];
        scaleY = 1 + Math.sin(time * 2) * 0.012;
      } else if (m.path) {
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
          walking = true;
          stride = dist * 5.6;
          y = Math.abs(Math.sin(stride)) * 0.05;
          headRoll = Math.sin(stride) * 0.05;
        }
      } else if (m.desk >= 0 && this.desks[m.desk]) {
        const d = this.desks[m.desk];
        const k = ease(clamp01(m.sitT ? (now - m.sitT) / SIT_MS : 1));
        x = d.approach.x + (d.seat.x - d.approach.x) * k;
        z = d.approach.z + (d.seat.z - d.approach.z) * k;
        y = SEAT_LIFT * k;
        m.yaw = lerpAngle(m.yaw, Math.PI + d.rot, Math.max(turn, k));
        seated = k >= 1;
        if (seated) {
          if (m.st === STATE.FOCUS) {
            headPitch = 0.42 + Math.sin(time * 0.8 + m.id) * 0.035;
            headRoll = Math.sin(time * 0.45 + m.id * 3) * 0.04;
          } else if (m.st === STATE.BREAK) {
            headPitch = -0.28;
            lean = -0.12;
          } else if (d.rest) {
            // Sitting on a bench, looking around.
            headPitch = -0.05 + Math.sin(time * 0.3 + m.id) * 0.06;
            headRoll = Math.sin(time * 0.21 + m.id * 2) * 0.05;
            lean = -0.06;
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

      let emote = -1;
      let ek = 0;
      if (m.emoteT) {
        ek = (now - m.emoteT) / EMOTE_MS[m.emote];
        if (ek >= 1 || ek < 0) {
          m.emoteT = 0;
        } else {
          emote = m.emote;
          if (emote === 0) headRoll += Math.sin(ek * Math.PI * 6) * 0.3 * (1 - ek);
          else if (emote === 1) {
            const s = Math.sin(ek * Math.PI);
            scaleY *= 1 + 0.16 * s;
            headPitch -= 0.55 * s;
          } else y += Math.abs(Math.sin(ek * Math.PI * 3)) * 0.2 * (1 - ek * 0.5);
        }
      }

      m.rx = x;
      m.rz = z;
      m.ry = y;
      const bench = seated && this.desks[m.desk]?.rest;
      this.drawAvatar(m, x, y, z, { lean, headPitch, headRoll, scaleY, seated, bench, walking, stride, emote, ek, time, dt, now });
      // A soft shadow on the ground, smaller while sitting up on a chair.
      const sh = seated ? 0.62 : 0.56 - Math.min(0.2, y * 0.6);
      this.push(this.shadows, this._out.makeScale(sh, 1, sh).setPosition(x, 0.011, z));
      if (m.id === this.selfId) {
        this.ring.visible = true;
        this.ring.position.set(x, 0.015, z);
      }
    }

    for (const mesh of this.base) this.flush(mesh);
    for (const set of this.parts.values()) for (const [, mesh] of set) this.flush(mesh);
    if (!this.slots.has(this.selfId)) this.ring.visible = false;
    return arrived;
  }

  flush(mesh) {
    mesh.count = mesh.userData.n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  push(mesh, matrix, color) {
    const n = mesh.userData.n;
    if (n >= mesh.instanceMatrix.count) return;
    mesh.setMatrixAt(n, matrix);
    if (color && mesh.instanceColor) mesh.setColorAt(n, color);
    mesh.userData.n = n + 1;
  }

  emit(id, variant, matrix) {
    for (const [group, mesh] of this.partSet(id, variant)) this.push(mesh, matrix, group === 'fixed' ? null : this._colors[group]);
  }

  drawAvatar(m, x, y, z, o) {
    const look = m.look;
    const colors = this._colors;
    colors.skin.setHex(SKIN[hash(m.id) % SKIN.length]);
    colors.hair.setHex(HAIR[hash(m.id * 7 + 3) % HAIR.length]);
    colors.tint.setHex(SWEATERS[look.c] ?? SWEATERS[0]);
    const bodyColor = this._c.setHex(outfitBase(look.o) ?? SWEATERS[look.c] ?? SWEATERS[0]);

    const root = this._root.compose(this._p.set(x, y, z), this._q.setFromEuler(this._e.set(o.lean, m.yaw, 0)), this._s.set(1, 1, 1));
    this._local.makeScale(1, o.scaleY, 1).setPosition(0, 0.33 * o.scaleY, 0);
    const body = this._body.multiplyMatrices(root, this._local);
    this.push(this.body, body, bodyColor);
    this._local.compose(this._p.set(0, 0.66 * o.scaleY + 0.17, 0), this._q.setFromEuler(this._e.set(o.headPitch, 0, o.headRoll)), this._s.set(1, 1, 1));
    const head = this._head.multiplyMatrices(root, this._local);
    this.push(this.head, head, colors.skin);
    this._local.makeTranslation(0, 0.022, -0.012);
    this.push(this.hair, this._out.multiplyMatrices(head, this._local), colors.hair);
    for (const s of [-1, 1]) {
      this._local.makeTranslation(s * 0.072, -0.018, 0.183);
      this.push(this.eyes, this._out.multiplyMatrices(head, this._local));
    }

    // Hands: by your sides, swinging, holding something, on the desk, in your lap, or in the air.
    const atDesk = o.seated && !o.bench;
    const holding = look.held && !atDesk;
    for (const s of [-1, 1]) {
      let hx = s * 0.215;
      let hy = 0.23;
      let hz = 0.02;
      if (o.walking && !holding) hz = Math.sin(o.stride) * 0.07 * s;
      if (holding) {
        hx = s * 0.1;
        hy = 0.33;
        hz = 0.22;
      }
      if (atDesk) {
        hx = s * 0.17;
        hy = 0.37;
        hz = 0.4;
        if (m.st === STATE.FOCUS && s > 0) hx += Math.sin(o.time * 5 + m.id) * 0.015;
      } else if (o.bench && !holding) {
        hx = s * 0.13;
        hy = 0.2;
        hz = 0.2;
      }
      if (o.emote === 0 && s > 0) {
        hx = 0.25;
        hy = 0.62 + Math.sin(o.ek * Math.PI * 8) * 0.03;
        hz = 0.06;
      } else if (o.emote === 1) {
        hx = s * 0.12;
        hy = 0.9;
        hz = 0;
      } else if (o.emote === 2) {
        hx = s * 0.17;
        hy = 0.74;
        hz = 0.08;
      }
      this._local.makeTranslation(hx, hy * o.scaleY, hz);
      this.push(this.hands, this._out.multiplyMatrices(root, this._local), colors.skin);
    }

    this.emit(look.o, 'body', body);
    for (const slot of ['hat', 'face', 'ears', 'neck']) {
      if (look[slot]) this.emit(look[slot], 'acc', accessoryAnchor(look[slot]) === 'body' ? body : head);
    }
    if (look.held) {
      if (atDesk) {
        this.emit(look.held, 'desk', this.deskMatrix(this.desks[m.desk], 0, DESK_TOP, 0, this._out));
      } else {
        this._local.makeTranslation(HAND_ANCHOR.x, HAND_ANCHOR.y * o.scaleY, HAND_ANCHOR.z);
        this.emit(look.held, 'hand', this._out.multiplyMatrices(root, this._local));
      }
    }
    if (look.pet) this.drawPet(m, look.pet, x, z, root, body, head, o);
  }

  drawPet(m, pet, x, z, root, body, head, o) {
    const out = this._out;
    const atDesk = o.seated && !o.bench;
    if (SMALL_PETS.has(pet)) {
      if (atDesk) {
        // On top of the stack of books at the back of the desk (or just on the desk).
        const d = this.desks[m.desk];
        const onBooks = d.kit === 'desk';
        this.deskMatrix(d, onBooks ? -0.38 : -0.3, DESK_TOP + (onBooks ? 0.145 : 0), onBooks ? -0.13 : -0.05, out);
        out.multiply(this._local.makeRotationY(0.2));
      } else if (pet === 'hamster') {
        this._local.makeTranslation(0, 0.215, -0.01);
        out.multiplyMatrices(head, this._local);
      } else {
        this._local.makeTranslation(0.16, 0.29, -0.02);
        out.multiplyMatrices(body, this._local);
      }
      this.emit(pet, 'pet', out);
      return;
    }
    let px;
    let pz;
    let pyaw;
    let hop = 0;
    if (m.preview) {
      px = x + 0.5;
      pz = z + 0.1;
      pyaw = -0.35;
    } else if (o.seated) {
      // Beside your chair, or on the ground in front of your bench.
      const d = this.desks[m.desk];
      const lx = o.bench ? 0.5 : 0.52;
      const lz = o.bench ? -0.55 : KITS[d.kit].chairZ + 0.05;
      const c = Math.cos(d.rot);
      const s = Math.sin(d.rot);
      px = d.x + lx * c + lz * s;
      pz = d.z - lx * s + lz * c;
      pyaw = d.rot + (o.bench ? 0.4 : 0.35);
    } else {
      // Follow a little behind and to the right.
      const fx = Math.sin(m.yaw);
      const fz = Math.cos(m.yaw);
      const tx = x - fx * 0.6 + fz * 0.32;
      const tz = z - fz * 0.6 - fx * 0.32;
      if (m.petX === undefined) {
        m.petX = tx;
        m.petZ = tz;
        m.petYaw = m.yaw;
      }
      const dx = tx - m.petX;
      const dz = tz - m.petZ;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.03) {
        const step = Math.min(dist, o.dt * (dist > 1.2 ? 4 : 2.2));
        m.petX += (dx / dist) * step;
        m.petZ += (dz / dist) * step;
        m.petYaw = lerpAngle(m.petYaw, Math.atan2(dx, dz), 1 - Math.exp(-o.dt * 10));
        hop = Math.abs(Math.sin(o.time * 14)) * 0.035;
      } else {
        m.petYaw = lerpAngle(m.petYaw, m.yaw, 1 - Math.exp(-o.dt * 2));
      }
      px = m.petX;
      pz = m.petZ;
      pyaw = m.petYaw;
    }
    if (o.seated || m.preview) {
      m.petX = px;
      m.petZ = pz;
      m.petYaw = pyaw;
    }
    out.compose(this._p.set(px, hop, pz), this._q.setFromEuler(this._e.set(0, pyaw, 0)), this._s.set(1, 1 + Math.sin(o.time * 3 + m.id) * 0.02, 1));
    this.emit(pet, 'pet', out);
  }
}
