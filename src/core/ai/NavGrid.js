/**
 * Grid navigation for bots.
 *
 * The walkable grid is produced by MapCompiler from the map's areas, so bots
 * automatically understand any map you author - there is no nav mesh to bake
 * and no waypoints to place by hand.
 */
import * as V3 from '../math/vec3.js';

const NEIGHBOURS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export class NavGrid {
  constructor(navGrid) {
    this.grid = navGrid;
  }

  isOpen(cx, cz) { return this.grid.isOpen(cx, cz); }
  toCell(position) { return this.grid.toCell(position); }
  toWorld(cx, cz) { return this.grid.toWorld(cx, cz); }

  /** Nearest open cell to a position (spiral search). */
  nearestOpenCell(position, maxRadius = 12) {
    const { cx, cz } = this.toCell(position);
    if (this.isOpen(cx, cz)) return { cx, cz };
    for (let r = 1; r <= maxRadius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.isOpen(cx + dx, cz + dz)) return { cx: cx + dx, cz: cz + dz };
        }
      }
    }
    return null;
  }

  /**
   * A* path between two world positions.
   * @returns {Array<{x:number,y:number,z:number}>} waypoints (empty when unreachable)
   */
  findPath(from, to) {
    const start = this.nearestOpenCell(from);
    const goal = this.nearestOpenCell(to);
    if (!start || !goal) return [];

    const { cols } = this.grid;
    const key = (cx, cz) => cz * cols + cx;
    const startKey = key(start.cx, start.cz);
    const goalKey = key(goal.cx, goal.cz);
    if (startKey === goalKey) return [this.toWorld(goal.cx, goal.cz)];

    const open = new MinHeap();
    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);
    open.push(startKey, heuristic(start, goal));

    let iterations = 0;
    const maxIterations = 20000; // safety valve on a pathological request
    while (open.size > 0 && iterations++ < maxIterations) {
      const currentKey = open.pop();
      if (currentKey === goalKey) return this._reconstruct(cameFrom, currentKey);

      const cx = currentKey % cols;
      const cz = (currentKey - cx) / cols;
      const currentG = gScore.get(currentKey) ?? Infinity;

      for (const [dx, dz, cost] of NEIGHBOURS) {
        const nx = cx + dx, nz = cz + dz;
        if (!this.isOpen(nx, nz)) continue;
        // Do not cut corners diagonally through a blocked cell.
        if (dx !== 0 && dz !== 0 && (!this.isOpen(cx + dx, cz) || !this.isOpen(cx, cz + dz))) continue;

        const neighbourKey = key(nx, nz);
        const tentative = currentG + cost;
        if (tentative < (gScore.get(neighbourKey) ?? Infinity)) {
          cameFrom.set(neighbourKey, currentKey);
          gScore.set(neighbourKey, tentative);
          open.push(neighbourKey, tentative + heuristic({ cx: nx, cz: nz }, goal));
        }
      }
    }
    return [];
  }

  _reconstruct(cameFrom, currentKey) {
    const { cols } = this.grid;
    const cells = [currentKey];
    while (cameFrom.has(currentKey)) {
      currentKey = cameFrom.get(currentKey);
      cells.push(currentKey);
    }
    cells.reverse();
    const path = cells.map((k) => {
      const cx = k % cols;
      const cz = (k - cx) / cols;
      return this.toWorld(cx, cz);
    });
    return this.simplify(path);
  }

  /** Drops waypoints that a straight line already covers. */
  simplify(path) {
    if (path.length <= 2) return path;
    const out = [path[0]];
    let anchor = 0;
    for (let i = 2; i < path.length; i++) {
      if (!this.isWalkableLine(path[anchor], path[i])) {
        out.push(path[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(path[path.length - 1]);
    return out;
  }

  /** Samples the grid along a segment to check it stays on open cells. */
  isWalkableLine(from, to) {
    const distance = V3.distanceXZ(from, to);
    const steps = Math.ceil(distance / (this.grid.cellSize * 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const point = { x: from.x + (to.x - from.x) * t, y: 0, z: from.z + (to.z - from.z) * t };
      const { cx, cz } = this.toCell(point);
      if (!this.isOpen(cx, cz)) return false;
    }
    return true;
  }
}

function heuristic(a, b) {
  const dx = Math.abs(a.cx - b.cx);
  const dz = Math.abs(a.cz - b.cz);
  // Octile distance - admissible for 8-way movement.
  return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
}

/** Binary heap keyed by priority; plenty for a 64x78 grid. */
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(value, priority) {
    this.items.push({ value, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1, right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left;
        if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top.value;
  }
}
