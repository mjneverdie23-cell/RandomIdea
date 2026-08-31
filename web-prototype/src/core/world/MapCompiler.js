/**
 * Compiles authored map data into everything the rest of the game needs:
 *
 *   - `solids`     : collision + render geometry (walls generated from the
 *                    negative space around the authored walkable areas)
 *   - `navGrid`    : coarse walkability grid used by bot pathfinding
 *   - `bounds`     : world extents
 *
 * Wall generation: the map is rasterised on a grid; every cell not covered by a
 * walkable area becomes solid, and solid cells are merged greedily into as few
 * boxes as possible so the renderer draws tens of meshes rather than thousands.
 */

import { PropKind, rectToAABB } from './MapData.js';
import { boxFromCenterSize } from '../math/aabb.js';

export function compileMap(mapData) {
  const cellSize = mapData.cellSize ?? 2;
  const wallHeight = mapData.wallHeight ?? 8;
  const padding = mapData.padding ?? 6;

  const bounds = computeBounds(mapData.areas, padding);
  const cols = Math.ceil((bounds.max.x - bounds.min.x) / cellSize);
  const rows = Math.ceil((bounds.max.z - bounds.min.z) / cellSize);

  // --- rasterise walkable areas ------------------------------------------
  const open = new Uint8Array(cols * rows);
  const idx = (cx, cz) => cz * cols + cx;
  const cellCenter = (cx, cz) => ({
    x: bounds.min.x + (cx + 0.5) * cellSize,
    z: bounds.min.z + (cz + 0.5) * cellSize,
  });

  for (const a of mapData.areas) {
    const [x0, z0, x1, z1] = a.rect;
    const cx0 = Math.max(0, Math.floor((x0 - bounds.min.x) / cellSize));
    const cx1 = Math.min(cols - 1, Math.ceil((x1 - bounds.min.x) / cellSize) - 1);
    const cz0 = Math.max(0, Math.floor((z0 - bounds.min.z) / cellSize));
    const cz1 = Math.min(rows - 1, Math.ceil((z1 - bounds.min.z) / cellSize) - 1);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) open[idx(cx, cz)] = 1;
    }
  }

  // --- merge closed cells into wall boxes ---------------------------------
  const solids = [];
  const consumed = new Uint8Array(cols * rows);
  let wallCounter = 0;
  for (let cz = 0; cz < rows; cz++) {
    for (let cx = 0; cx < cols; cx++) {
      if (open[idx(cx, cz)] || consumed[idx(cx, cz)]) continue;
      // Grow east as far as possible, then south as far as the full width allows.
      let width = 1;
      while (cx + width < cols && !open[idx(cx + width, cz)] && !consumed[idx(cx + width, cz)]) width++;
      let height = 1;
      grow: while (cz + height < rows) {
        for (let k = 0; k < width; k++) {
          if (open[idx(cx + k, cz + height)] || consumed[idx(cx + k, cz + height)]) break grow;
        }
        height++;
      }
      for (let dz = 0; dz < height; dz++) {
        for (let dx = 0; dx < width; dx++) consumed[idx(cx + dx, cz + dz)] = 1;
      }
      const sizeX = width * cellSize;
      const sizeZ = height * cellSize;
      solids.push({
        id: `wall_${wallCounter++}`,
        shape: 'box',
        kind: PropKind.WALL,
        position: {
          x: bounds.min.x + cx * cellSize + sizeX / 2,
          y: wallHeight / 2,
          z: bounds.min.z + cz * cellSize + sizeZ / 2,
        },
        size: { x: sizeX, y: wallHeight, z: sizeZ },
        baseY: 0,
        rotationY: 0,
        color: mapData.wallColor ?? 0x9a8b74,
        collidable: true,
        blocksNav: true,
        generated: true,
      });
    }
  }

  // --- authored props ------------------------------------------------------
  for (const prop of mapData.props ?? []) solids.push(prop);

  // --- collision bodies ----------------------------------------------------
  const colliders = solids
    .filter((s) => s.collidable !== false)
    .map((s) => ({ id: s.id, box: boxFromCenterSize(s.position, s.size), kind: s.kind, source: s }));

  // Invisible ceiling/floor so nothing can escape the playable volume.
  colliders.push({
    id: 'floor',
    box: {
      min: { x: bounds.min.x, y: -2, z: bounds.min.z },
      max: { x: bounds.max.x, y: 0, z: bounds.max.z },
    },
    kind: 'FLOOR',
  });

  // --- navigation grid -----------------------------------------------------
  // A cell is navigable when it is open and no nav-blocking prop covers it.
  const nav = new Uint8Array(open);
  for (const prop of mapData.props ?? []) {
    if (!prop.blocksNav || prop.collidable === false) continue;
    const half = { x: prop.size.x / 2, z: prop.size.z / 2 };
    const cx0 = Math.max(0, Math.floor((prop.position.x - half.x - bounds.min.x) / cellSize));
    const cx1 = Math.min(cols - 1, Math.floor((prop.position.x + half.x - bounds.min.x) / cellSize));
    const cz0 = Math.max(0, Math.floor((prop.position.z - half.z - bounds.min.z) / cellSize));
    const cz1 = Math.min(rows - 1, Math.floor((prop.position.z + half.z - bounds.min.z) / cellSize));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) nav[idx(cx, cz)] = 0;
    }
  }

  const navGrid = {
    cols, rows, cellSize,
    origin: { x: bounds.min.x, z: bounds.min.z },
    cells: nav,
    isOpen(cx, cz) {
      return cx >= 0 && cz >= 0 && cx < cols && cz < rows && this.cells[cz * cols + cx] === 1;
    },
    toCell(position) {
      return {
        cx: Math.floor((position.x - this.origin.x) / this.cellSize),
        cz: Math.floor((position.z - this.origin.z) / this.cellSize),
      };
    },
    toWorld(cx, cz) {
      return {
        x: this.origin.x + (cx + 0.5) * this.cellSize,
        y: 0,
        z: this.origin.z + (cz + 0.5) * this.cellSize,
      };
    },
  };

  const areaLookup = new Map(mapData.areas.map((a) => [a.id, a]));

  return {
    id: mapData.id,
    displayName: mapData.displayName,
    source: mapData,
    bounds,
    cellSize,
    wallHeight,
    solids,
    colliders,
    navGrid,
    areas: mapData.areas,
    areaLookup,
    spawns: mapData.spawns,
    buyZones: {
      ATTACKERS: rectToAABB(mapData.buyZones.ATTACKERS, 0, wallHeight),
      DEFENDERS: rectToAABB(mapData.buyZones.DEFENDERS, 0, wallHeight),
    },
    bombSites: mapData.bombSites.map((site) => ({
      ...site,
      zone: rectToAABB(site.rect, 0, wallHeight),
      plantPoint: site.plantPoint ?? {
        x: (site.rect[0] + site.rect[2]) / 2, y: 0, z: (site.rect[1] + site.rect[3]) / 2,
      },
    })),
    /** Human-readable area under a position, for callouts in the UI/killfeed. */
    areaAt(position) {
      for (const a of mapData.areas) {
        const [x0, z0, x1, z1] = a.rect;
        if (position.x >= x0 && position.x <= x1 && position.z >= z0 && position.z <= z1) return a;
      }
      return null;
    },
    cellCenter,
    stats: { cols, rows, wallBoxes: solids.filter((s) => s.generated).length, props: (mapData.props ?? []).length },
  };
}

function computeBounds(areas, padding) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const a of areas) {
    minX = Math.min(minX, a.rect[0]);
    minZ = Math.min(minZ, a.rect[1]);
    maxX = Math.max(maxX, a.rect[2]);
    maxZ = Math.max(maxZ, a.rect[3]);
  }
  return {
    min: { x: minX - padding, y: 0, z: minZ - padding },
    max: { x: maxX + padding, y: 20, z: maxZ + padding },
  };
}
