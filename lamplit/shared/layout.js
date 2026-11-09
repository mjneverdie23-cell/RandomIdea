// Geometry shared by the server (seat claims, pathfinding) and the client (rendering):
// seat kits, how a seat is placed, obstacles, the walk grid and spawn points. The places
// themselves (library, coffee shop, net café, town square) are defined in places.js.
//
// Units are metres. +x is to the right, -z is "forward" (away from the default camera).

/** Walking speed in metres per second (server and client must agree). */
export const WALK_SPEED = 1.8;
export const GRID_CELL = 0.25;
export const AVATAR_RADIUS = 0.22;
/** No place extends further than this from its centre, in x or z. */
export const WORLD_LIMIT = 40;
/** Height of every desk and table top. */
export const DESK_TOP = 0.76;

/**
 * Kinds of seat. A seat's frame has the sitter facing local -z with the desk (or nothing,
 * for a bench) in front: `w`×`d` is the desk footprint around the seat's origin, the
 * sitter's chair is `chairZ` behind it, and they walk to `approachZ` before sitting down.
 * `rest` seats (park benches) are for sitting only, not for focus sessions.
 */
export const KITS = Object.freeze({
  desk: Object.freeze({ w: 1.2, d: 0.7, chairZ: 0.68, approachZ: 1.42, chair: 0.46, rest: false }),
  cafe: Object.freeze({ w: 0.76, d: 0.4, chairZ: 0.56, approachZ: 1.24, chair: 0.44, rest: false }),
  bar: Object.freeze({ w: 0.8, d: 0.45, chairZ: 0.5, approachZ: 1.14, chair: 0.36, rest: false }),
  pc: Object.freeze({ w: 1.0, d: 0.65, chairZ: 0.72, approachZ: 1.5, chair: 0.52, rest: false }),
  bench: Object.freeze({ w: 0.9, d: 0.5, chairZ: 0.04, approachZ: -0.9, chair: 0, rest: true }),
});

export function round2(v) {
  return Math.round(v * 100) / 100;
}

/** Rotates a seat-local offset (lx, lz) by `rot` about +y, the same way three.js does. */
export function rotate(lx, lz, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [lx * c + lz * s, -lx * s + lz * c];
}

/** World position of a seat-local point. */
export function seatLocal(desk, lx, lz) {
  const [x, z] = rotate(lx, lz, desk.rot);
  return [desk.x + x, desk.z + z];
}

/**
 * A seat at (x, z) facing along `rot` (0 faces -z, PI faces +z, PI/2 faces -x). The sitter's
 * yaw is PI + rot for a model whose front points along +z.
 */
export function makeDesk(i, kit, x, z, rot = 0) {
  const k = KITS[kit];
  const desk = { i, kit, x: round2(x), z: round2(z), rot: Math.round(rot * 1e6) / 1e6, rest: k.rest };
  const [sx, sz] = seatLocal(desk, 0, k.chairZ);
  const [ax, az] = seatLocal(desk, 0, k.approachZ);
  desk.seat = Object.freeze({ x: round2(sx), z: round2(sz) });
  desk.approach = Object.freeze({ x: round2(ax), z: round2(az) });
  return Object.freeze(desk);
}

/**
 * Everything an avatar can't walk through, as ['box', minX, minZ, maxX, maxZ],
 * ['obb', x, z, halfW, halfD, rot] or ['circle', x, z, r].
 */
export function obstacles(place) {
  const list = [];
  for (const d of place.desks) {
    const k = KITS[d.kit];
    list.push(['obb', d.x, d.z, k.w / 2, k.d / 2, d.rot]);
    if (k.chair > 0) list.push(['obb', d.seat.x, d.seat.z, k.chair / 2, k.chair / 2, d.rot]);
  }
  for (const b of place.blocks) list.push(['box', ...b]);
  for (const c of place.circles) list.push(['circle', ...c]);
  return list;
}

/**
 * Builds the walkability grid used for pathfinding. Obstacles are inflated by the avatar
 * radius so a path through open cells never clips furniture. Each obstacle only visits
 * the cells under its own bounding box, so big outdoor maps stay quick to build.
 */
export function buildWalkGrid(place) {
  const cell = GRID_CELL;
  const cols = Math.round(place.width / cell);
  const rows = Math.round(place.depth / cell);
  const originX = -place.width / 2;
  const originZ = -place.depth / 2;
  const blocked = new Uint8Array(cols * rows);
  const r = AVATAR_RADIUS;
  for (let iz = 0; iz < rows; iz++) {
    const z = originZ + (iz + 0.5) * cell;
    for (let ix = 0; ix < cols; ix++) {
      const x = originX + (ix + 0.5) * cell;
      if (x < originX + r || x > -originX - r || z < originZ + r || z > -originZ - r) blocked[iz * cols + ix] = 1;
    }
  }
  const mark = (minX, minZ, maxX, maxZ, test) => {
    const x0 = Math.max(0, Math.floor((minX - originX) / cell));
    const x1 = Math.min(cols - 1, Math.floor((maxX - originX) / cell));
    const z0 = Math.max(0, Math.floor((minZ - originZ) / cell));
    const z1 = Math.min(rows - 1, Math.floor((maxZ - originZ) / cell));
    for (let iz = z0; iz <= z1; iz++) {
      const z = originZ + (iz + 0.5) * cell;
      for (let ix = x0; ix <= x1; ix++) {
        const x = originX + (ix + 0.5) * cell;
        if (test(x, z)) blocked[iz * cols + ix] = 1;
      }
    }
  };
  for (const o of obstacles(place)) {
    if (o[0] === 'box') {
      const [, a, b, c, d] = o;
      mark(a - r, b - r, c + r, d + r, (x, z) => x > a - r && x < c + r && z > b - r && z < d + r);
    } else if (o[0] === 'circle') {
      const [, cx, cz, rad] = o;
      const R = rad + r;
      mark(cx - R, cz - R, cx + R, cz + R, (x, z) => (x - cx) ** 2 + (z - cz) ** 2 < R * R);
    } else {
      const [, cx, cz, hw, hd, rot] = o;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const ex = Math.abs(hw * c) + Math.abs(hd * s) + r;
      const ez = Math.abs(hw * s) + Math.abs(hd * c) + r;
      mark(cx - ex, cz - ez, cx + ex, cz + ez, (x, z) => {
        const dx = x - cx;
        const dz = z - cz;
        return Math.abs(dx * c - dz * s) < hw + r && Math.abs(dx * s + dz * c) < hd + r;
      });
    }
  }
  return { cell, cols, rows, originX, originZ, blocked };
}

/**
 * A spread-out point where someone appears: in front of the door they came through
 * (`from` is the kind of place they left), or in the place's default spawn area.
 * `random` returns numbers in [0, 1).
 */
export function spawnPoint(place, random = Math.random, from = null) {
  const a = (from && place.arrive[from]) || place.spawn;
  return [round2(a.x + (random() - 0.5) * a.w), round2(a.z + (random() - 0.5) * a.d)];
}
