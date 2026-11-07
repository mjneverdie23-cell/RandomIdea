// Grid A* pathfinding with line-of-sight smoothing, plus helpers to sample a walk along
// a path. The server computes every path and broadcasts it; clients only replay them.

import { round2 } from './layout.js';

const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

export function cellOf(grid, x, z) {
  const ix = Math.floor((x - grid.originX) / grid.cell);
  const iz = Math.floor((z - grid.originZ) / grid.cell);
  if (ix < 0 || iz < 0 || ix >= grid.cols || iz >= grid.rows) return -1;
  return iz * grid.cols + ix;
}

export function cellCenter(grid, idx) {
  const ix = idx % grid.cols;
  const iz = (idx - ix) / grid.cols;
  return [round2(grid.originX + (ix + 0.5) * grid.cell), round2(grid.originZ + (iz + 0.5) * grid.cell)];
}

export function isOpen(grid, idx) {
  return idx >= 0 && grid.blocked[idx] === 0;
}

/** Nearest open cell to `idx` within `radius` cells (ring search), or -1. */
export function nearestOpen(grid, idx, radius = 6) {
  if (idx < 0) return -1;
  if (isOpen(grid, idx)) return idx;
  const cx = idx % grid.cols;
  const cz = (idx - cx) / grid.cols;
  for (let r = 1; r <= radius; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || z < 0 || x >= grid.cols || z >= grid.rows) continue;
        const j = z * grid.cols + x;
        const d = dx * dx + dz * dz;
        if (grid.blocked[j] === 0 && d < bestD) {
          bestD = d;
          best = j;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** True when the straight segment between two points only crosses open cells. */
export function lineOpen(grid, x0, z0, x1, z1) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(1, Math.ceil(len / (grid.cell / 3)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    if (!isOpen(grid, cellOf(grid, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t))) return false;
  }
  return true;
}

class MinHeap {
  constructor() {
    this.items = [];
    this.keys = [];
  }
  get size() {
    return this.items.length;
  }
  push(item, key) {
    const items = this.items;
    const keys = this.keys;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      items[i] = items[p];
      keys[i] = keys[p];
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }
  pop() {
    const items = this.items;
    const keys = this.keys;
    const top = items[0];
    const lastItem = items.pop();
    const lastKey = keys.pop();
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        items[i] = items[c];
        keys[i] = keys[c];
        i = c;
      }
      items[i] = lastItem;
      keys[i] = lastKey;
    }
    return top;
  }
}

/**
 * Finds a walkable path from `from` to `to` (both [x, z]). Returns a list of waypoints
 * (first = start, last = destination), or null when no path exists. Start and goal
 * points inside furniture are moved to the nearest open cell.
 */
export function findPath(grid, from, to, maxExpand = 40000) {
  let start = nearestOpen(grid, cellOf(grid, from[0], from[1]));
  let goal = nearestOpen(grid, cellOf(grid, to[0], to[1]));
  if (start < 0 || goal < 0) return null;

  const startPt = isOpen(grid, cellOf(grid, from[0], from[1])) ? [round2(from[0]), round2(from[1])] : cellCenter(grid, start);
  const goalPt = isOpen(grid, cellOf(grid, to[0], to[1])) ? [round2(to[0]), round2(to[1])] : cellCenter(grid, goal);
  if (start === goal) return [startPt, goalPt];

  const { cols, rows, blocked } = grid;
  const n = cols * rows;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gx = goal % cols;
  const gz = (goal - gx) / cols;
  const h = (idx) => {
    const x = idx % cols;
    const dx = Math.abs(x - gx);
    const dz = Math.abs((idx - x) / cols - gz);
    return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
  };

  const open = new MinHeap();
  gScore[start] = 0;
  open.push(start, h(start));
  let expanded = 0;
  let found = false;
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === goal) {
      found = true;
      break;
    }
    closed[cur] = 1;
    if (++expanded > maxExpand) return null;
    const cx = cur % cols;
    const cz = (cur - cx) / cols;
    for (const [dx, dz, cost] of DIRS) {
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || z < 0 || x >= cols || z >= rows) continue;
      const nb = z * cols + x;
      if (blocked[nb] || closed[nb]) continue;
      // No cutting corners past furniture.
      if (dx !== 0 && dz !== 0 && (blocked[cz * cols + x] || blocked[z * cols + cx])) continue;
      const g = gScore[cur] + cost;
      if (g < gScore[nb]) {
        gScore[nb] = g;
        came[nb] = cur;
        open.push(nb, g + h(nb));
      }
    }
  }
  if (!found) return null;

  const cells = [];
  for (let c = goal; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => cellCenter(grid, c));
  pts[0] = startPt;
  pts[pts.length - 1] = goalPt;
  return smooth(grid, pts);
}

/** Removes waypoints that have a clear line of sight past them ("string pulling"). */
function smooth(grid, pts) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  let anchor = 0;
  for (let i = 2; i < pts.length; i++) {
    const a = pts[anchor];
    const b = pts[i];
    if (!lineOpen(grid, a[0], a[1], b[0], b[1])) {
      out.push(pts[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function pathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return len;
}

/**
 * Position `dist` metres along `path`. `angle` is the facing yaw (rotation about +y)
 * for a model whose front points along +z.
 */
export function samplePath(path, dist) {
  if (path.length === 1 || dist <= 0) {
    const a = path.length > 1 ? segAngle(path[0], path[1]) : 0;
    return { x: path[0][0], z: path[0][1], angle: a, done: path.length === 1 };
  }
  let left = dist;
  for (let i = 1; i < path.length; i++) {
    const p = path[i - 1];
    const q = path[i];
    const seg = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (left <= seg) {
      const t = seg > 0 ? left / seg : 1;
      return { x: p[0] + (q[0] - p[0]) * t, z: p[1] + (q[1] - p[1]) * t, angle: segAngle(p, q), done: false };
    }
    left -= seg;
  }
  const last = path[path.length - 1];
  return { x: last[0], z: last[1], angle: segAngle(path[path.length - 2], last), done: true };
}

function segAngle(p, q) {
  return Math.atan2(q[0] - p[0], q[1] - p[1]);
}
