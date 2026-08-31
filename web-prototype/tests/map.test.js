import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileMap } from '../src/core/world/MapCompiler.js';
import { NavGrid } from '../src/core/ai/NavGrid.js';
import DustProtoMap from '../src/config/maps/dust_proto.map.js';

const map = compileMap(DustProtoMap);

test('map compiles into geometry, colliders and a nav grid', () => {
  assert.ok(map.solids.length > 20, 'walls were generated from the authored areas');
  assert.ok(map.colliders.length >= map.solids.length, 'every solid has a collider');
  assert.ok(map.navGrid.cols > 10 && map.navGrid.rows > 10);
  assert.equal(map.bombSites.length, 2);
});

test('every walkable cell is reachable from the attacker spawn', () => {
  const grid = map.navGrid;
  const start = grid.toCell(map.spawns.ATTACKERS[0].position);
  const seen = new Set();
  const queue = [start];
  const key = (cx, cz) => `${cx},${cz}`;
  seen.add(key(start.cx, start.cz));

  while (queue.length > 0) {
    const { cx, cz } = queue.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!grid.isOpen(nx, nz) || seen.has(key(nx, nz))) continue;
      seen.add(key(nx, nz));
      queue.push({ cx: nx, cz: nz });
    }
  }

  const openCells = grid.cells.reduce((total, value) => total + value, 0);
  assert.equal(seen.size, openCells, 'the layout has no unreachable pockets');
});

test('spawns are inside the map and not inside geometry', () => {
  for (const [side, points] of Object.entries(map.spawns)) {
    assert.ok(points.length >= 5, `${side} has enough spawn points`);
    for (const point of points) {
      const cell = map.navGrid.toCell(point.position);
      assert.ok(map.navGrid.isOpen(cell.cx, cell.cz), `${side} spawn ${JSON.stringify(point.position)} is walkable`);
    }
  }
});

test('bots can path from either spawn to either bomb site', () => {
  const nav = new NavGrid(map.navGrid);
  for (const side of ['ATTACKERS', 'DEFENDERS']) {
    for (const site of map.bombSites) {
      const path = nav.findPath(map.spawns[side][0].position, site.plantPoint);
      assert.ok(path.length > 1, `${side} can reach site ${site.id}`);
      const last = path[path.length - 1];
      const distance = Math.hypot(last.x - site.plantPoint.x, last.z - site.plantPoint.z);
      assert.ok(distance < 4, `path ends at site ${site.id} (got ${distance.toFixed(1)} units away)`);
    }
  }
});

test('buy zones cover their spawns', () => {
  for (const side of ['ATTACKERS', 'DEFENDERS']) {
    const zone = map.buyZones[side];
    for (const point of map.spawns[side]) {
      assert.ok(
        point.position.x >= zone.min.x && point.position.x <= zone.max.x &&
        point.position.z >= zone.min.z && point.position.z <= zone.max.z,
        `${side} spawn is inside its buy zone`,
      );
    }
  }
});
