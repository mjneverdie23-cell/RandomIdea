/**
 * Axis-aligned bounding boxes + the ray/segment tests the shooting code needs.
 *
 * Every solid in the prototype map is an AABB. Characters are treated as
 * vertical capsules for hit detection but as AABBs for movement collision -
 * that keeps the collision resolver trivial and stable, which matters far more
 * for a prototype than physical accuracy.
 */

/** Build an AABB from a center point and full-size extents. */
export const boxFromCenterSize = (center, size) => ({
  min: { x: center.x - size.x / 2, y: center.y - size.y / 2, z: center.z - size.z / 2 },
  max: { x: center.x + size.x / 2, y: center.y + size.y / 2, z: center.z + size.z / 2 },
});

export const boxCenter = (b) => ({
  x: (b.min.x + b.max.x) / 2,
  y: (b.min.y + b.max.y) / 2,
  z: (b.min.z + b.max.z) / 2,
});

export const boxSize = (b) => ({
  x: b.max.x - b.min.x,
  y: b.max.y - b.min.y,
  z: b.max.z - b.min.z,
});

export const overlaps = (a, b) =>
  a.min.x < b.max.x && a.max.x > b.min.x &&
  a.min.y < b.max.y && a.max.y > b.min.y &&
  a.min.z < b.max.z && a.max.z > b.min.z;

export const containsPoint = (b, p) =>
  p.x >= b.min.x && p.x <= b.max.x &&
  p.y >= b.min.y && p.y <= b.max.y &&
  p.z >= b.min.z && p.z <= b.max.z;

/** Horizontal containment - bomb sites care about footprint, not height. */
export const containsPointXZ = (b, p) =>
  p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z;

export const expand = (b, amount) => ({
  min: { x: b.min.x - amount, y: b.min.y - amount, z: b.min.z - amount },
  max: { x: b.max.x + amount, y: b.max.y + amount, z: b.max.z + amount },
});

/**
 * Slab-method ray/AABB intersection.
 * @returns {number|null} distance along the ray, or null when there is no hit.
 */
export function rayBox(origin, dir, box, maxDistance = Infinity) {
  let tmin = 0;
  let tmax = maxDistance;

  for (const axis of ['x', 'y', 'z']) {
    const d = dir[axis];
    if (Math.abs(d) < 1e-8) {
      // Ray runs parallel to this slab: miss unless the origin is already inside it.
      if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) return null;
    } else {
      const inv = 1 / d;
      let t1 = (box.min[axis] - origin[axis]) * inv;
      let t2 = (box.max[axis] - origin[axis]) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/**
 * Ray against a vertical capsule (character hitbox).
 * The capsule is the segment from `base` up to `base + height` with `radius`.
 * @returns {number|null} distance along the ray, or null.
 */
export function rayVerticalCapsule(origin, dir, base, height, radius, maxDistance = Infinity) {
  // Solve the infinite-cylinder equation in the XZ plane first...
  const ox = origin.x - base.x;
  const oz = origin.z - base.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  const b = 2 * (ox * dir.x + oz * dir.z);
  const c = ox * ox + oz * oz - radius * radius;

  let best = null;
  if (a > 1e-8) {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (t < 0 || t > maxDistance) continue;
        const y = origin.y + dir.y * t;
        // ...then clip it to the capsule's vertical span (cap spheres included).
        if (y >= base.y - radius && y <= base.y + height + radius) {
          if (best === null || t < best) best = t;
        }
      }
    }
  }
  return best;
}
