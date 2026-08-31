/**
 * Minimal 3D vector math for the simulation layer.
 *
 * The simulation deliberately does NOT depend on three.js (or any renderer) so
 * the whole game can run headless in Node for tests and bot-only match sims.
 * Vectors are plain `{x, y, z}` objects; the render layer converts them.
 *
 * Convention: Y is up. The ground plane is X (east/west) by Z (north/south).
 */

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });

export const clone = (a) => ({ x: a.x, y: a.y, z: a.z });
export const copy = (out, a) => { out.x = a.x; out.y = a.y; out.z = a.z; return out; };
export const set = (out, x, y, z) => { out.x = x; out.y = y; out.z = z; return out; };

export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });

export const addInto = (out, a) => { out.x += a.x; out.y += a.y; out.z += a.z; return out; };
export const scaleInto = (out, s) => { out.x *= s; out.y *= s; out.z *= s; return out; };

export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const lengthSq = (a) => a.x * a.x + a.y * a.y + a.z * a.z;
export const length = (a) => Math.sqrt(lengthSq(a));
export const distanceSq = (a, b) => {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};
export const distance = (a, b) => Math.sqrt(distanceSq(a, b));

/** Horizontal (XZ) distance - used a lot for gameplay ranges that ignore height. */
export const distanceXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const normalize = (a) => {
  const len = length(a);
  return len > 1e-8 ? { x: a.x / len, y: a.y / len, z: a.z / len } : v3();
};

export const lerp = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/**
 * Convert yaw/pitch (radians) into a forward direction.
 * yaw 0 looks toward -Z (north); yaw increases counter-clockwise seen from above.
 */
export const dirFromAngles = (yaw, pitch) => {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
};

/** Yaw that points from `from` toward `to` (ignores height). */
export const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

/** Pitch that points from `from` toward `to`. */
export const pitchTo = (from, to) => {
  const flat = Math.hypot(to.x - from.x, to.z - from.z);
  return Math.atan2(to.y - from.y, flat);
};

/** Wrap an angle into (-PI, PI]. */
export const wrapAngle = (a) => {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return r;
};

export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
