import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESKS, DESK_COUNT, ENTRANCE, HALL, buildWalkGrid, spawnPoint } from '../shared/layout.js';
import { findPath, cellOf, isOpen, lineOpen, pathLength, samplePath } from '../shared/path.js';

const grid = buildWalkGrid();

test('there are 100 desks with unique positions', () => {
  assert.equal(DESK_COUNT, 100);
  const keys = new Set(DESKS.map((d) => `${d.x},${d.z}`));
  assert.equal(keys.size, 100);
  DESKS.forEach((d, i) => assert.equal(d.i, i));
});

test('every desk can be reached from the entrance and the path ends behind its chair', () => {
  for (const d of DESKS) {
    assert.ok(isOpen(grid, cellOf(grid, d.approach.x, d.approach.z)), `approach of desk ${d.i} is walkable`);
    const path = findPath(grid, [ENTRANCE.x, ENTRANCE.z], [d.approach.x, d.approach.z]);
    assert.ok(path, `desk ${d.i} is reachable`);
    assert.deepEqual(path.at(-1), [d.approach.x, d.approach.z]);
    for (let i = 1; i < path.length; i++) {
      assert.ok(lineOpen(grid, ...path[i - 1], ...path[i]), `segment ${i} of the path to desk ${d.i} is clear`);
    }
  }
});

test('desks and walls are blocked, aisles are open', () => {
  assert.ok(!isOpen(grid, cellOf(grid, DESKS[0].x, DESKS[0].z)), 'desk top');
  assert.ok(!isOpen(grid, cellOf(grid, -HALL.width / 2 + 0.05, 0)), 'side wall');
  assert.ok(isOpen(grid, cellOf(grid, 0, 0)), 'centre aisle');
  assert.ok(isOpen(grid, cellOf(grid, ENTRANCE.x, ENTRANCE.z)), 'entrance');
});

test('spawn points are walkable', () => {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 200; i++) {
    const [x, z] = spawnPoint(random);
    assert.ok(isOpen(grid, cellOf(grid, x, z)), `spawn ${x},${z}`);
  }
});

test('a target inside furniture is moved to the nearest open spot', () => {
  const d = DESKS[55];
  const path = findPath(grid, [0, 0], [d.x, d.z]);
  assert.ok(path);
  const end = path.at(-1);
  assert.ok(isOpen(grid, cellOf(grid, end[0], end[1])));
  assert.ok(Math.hypot(end[0] - d.x, end[1] - d.z) < 1.5);
});

test('points outside the hall have no path', () => {
  assert.equal(findPath(grid, [0, 0], [100, 100]), null);
});

test('samplePath walks along the path and reports when done', () => {
  const path = [[0, 0], [0, 3], [4, 3]];
  assert.equal(pathLength(path), 7);
  const mid = samplePath(path, 1.5);
  assert.deepEqual([mid.x, mid.z, mid.done], [0, 1.5, false]);
  assert.ok(Math.abs(mid.angle - 0) < 1e-9, 'facing +z');
  const turn = samplePath(path, 5);
  assert.deepEqual([turn.x, turn.z], [2, 3]);
  assert.ok(Math.abs(turn.angle - Math.PI / 2) < 1e-9, 'facing +x');
  const end = samplePath(path, 99);
  assert.deepEqual([end.x, end.z, end.done], [4, 3, true]);
});
