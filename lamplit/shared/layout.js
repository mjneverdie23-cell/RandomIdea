// Geometry of a reading room, shared by the server (seat claims, pathfinding) and the
// client (rendering). Every hall uses this same layout.
//
// Units are metres. +x is to the right, -z is toward the front wall (windows, clock and
// board), +z is toward the entrance at the back.

export const HALL = Object.freeze({
  width: 28, // x runs from -14 to 14
  depth: 34, // z runs from -17 to 17
  wallHeight: 7,
});

export const DESK = Object.freeze({ width: 1.2, depth: 0.7, height: 0.76 });
export const CHAIR = Object.freeze({ offsetZ: 0.68, size: 0.46, seatHeight: 0.46 });
/** Distance behind the desk centre where an avatar stands before sitting down. */
export const APPROACH_Z = 1.42;
export const AVATAR_RADIUS = 0.22;
/** Walking speed in metres per second (server and client must agree). */
export const WALK_SPEED = 1.8;
export const GRID_CELL = 0.25;

// Two blocks of desks on each side of a centre aisle, front and back halves.
const COLS_X = [-9.4, -7.6, -5.8, -4.0, -2.2, 2.2, 4.0, 5.8, 7.6, 9.4];
const ROWS_Z = [-11.8, -9.5, -7.2, -4.9, -2.6, 2.2, 4.5, 6.8, 9.1, 11.4];

/** Side bookshelves run along both side walls. */
export const SHELF = Object.freeze({ depth: 0.6, zMin: -15.2, zMax: 14.6, height: 2.7 });

/** Potted plants: [x, z, radius]. */
export const PLANTS = Object.freeze([
  [-12.4, -15.9, 0.42],
  [12.4, -15.9, 0.42],
  [-12.4, 15.9, 0.42],
  [12.4, 15.9, 0.42],
  [0, -15.6, 0.5],
]);

export const ENTRANCE = Object.freeze({ x: 0, z: 15.2 });

/**
 * Desks are numbered front-to-back, left-to-right: index = row * 10 + col.
 * Each desk records where its chair is and where you stand to sit down.
 */
export const DESKS = Object.freeze(
  ROWS_Z.flatMap((z, row) =>
    COLS_X.map((x, col) =>
      Object.freeze({
        i: row * COLS_X.length + col,
        row,
        col,
        x,
        z,
        seat: Object.freeze({ x, z: round2(z + CHAIR.offsetZ) }),
        approach: Object.freeze({ x, z: round2(z + APPROACH_Z) }),
      }),
    ),
  ),
);

export const DESK_COUNT = DESKS.length; // 100

/** Axis-aligned obstacles as [minX, minZ, maxX, maxZ] (before inflating by the avatar radius). */
export function obstacles() {
  const list = [];
  for (const d of DESKS) {
    list.push([d.x - DESK.width / 2, d.z - DESK.depth / 2, d.x + DESK.width / 2, d.z + DESK.depth / 2]);
    const c = CHAIR.size / 2;
    list.push([d.x - c, d.seat.z - c, d.x + c, d.seat.z + c]);
  }
  const hw = HALL.width / 2;
  list.push([-hw, SHELF.zMin, -hw + SHELF.depth, SHELF.zMax]);
  list.push([hw - SHELF.depth, SHELF.zMin, hw, SHELF.zMax]);
  for (const [x, z, r] of PLANTS) list.push([x - r, z - r, x + r, z + r]);
  return list;
}

/**
 * Builds the walkability grid used for pathfinding. Obstacles are inflated by the
 * avatar radius so a path through open cells never clips furniture.
 */
export function buildWalkGrid() {
  const cell = GRID_CELL;
  const cols = Math.round(HALL.width / cell);
  const rows = Math.round(HALL.depth / cell);
  const originX = -HALL.width / 2;
  const originZ = -HALL.depth / 2;
  const blocked = new Uint8Array(cols * rows);
  const r = AVATAR_RADIUS;
  const boxes = obstacles().map(([a, b, c, d]) => [a - r, b - r, c + r, d + r]);
  for (let iz = 0; iz < rows; iz++) {
    const z = originZ + (iz + 0.5) * cell;
    for (let ix = 0; ix < cols; ix++) {
      const x = originX + (ix + 0.5) * cell;
      let hit = x < originX + r || x > -originX - r || z < originZ + r || z > -originZ - r;
      for (let k = 0; !hit && k < boxes.length; k++) {
        const b = boxes[k];
        hit = x > b[0] && x < b[2] && z > b[1] && z < b[3];
      }
      if (hit) blocked[iz * cols + ix] = 1;
    }
  }
  return { cell, cols, rows, originX, originZ, blocked };
}

/** A spread-out spawn point near the entrance. `random` returns numbers in [0, 1). */
export function spawnPoint(random = Math.random) {
  return [round2(ENTRANCE.x + (random() - 0.5) * 4.5), round2(ENTRANCE.z + (random() - 0.5) * 1.6)];
}

export function round2(v) {
  return Math.round(v * 100) / 100;
}
