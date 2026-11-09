import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACES, PLACE_KINDS, PLACE_CAP, MAX_DESKS } from '../shared/places.js';
import { KITS, buildWalkGrid, spawnPoint, seatLocal } from '../shared/layout.js';
import { findPath, cellOf, isOpen, lineOpen, pathLength, samplePath } from '../shared/path.js';

const grids = Object.fromEntries(PLACE_KINDS.map((k) => [k, buildWalkGrid(PLACES[k])]));
const open = (kind, x, z) => isOpen(grids[kind], cellOf(grids[kind], x, z));

test('every place numbers its seats in order, with no two in the same spot', () => {
  assert.deepEqual(PLACE_KINDS, ['library', 'cafe', 'netcafe', 'square']);
  for (const kind of PLACE_KINDS) {
    const { desks } = PLACES[kind];
    assert.ok(desks.length > 0, `${kind} has seats`);
    assert.equal(new Set(desks.map((d) => `${d.x},${d.z}`)).size, desks.length, `${kind} seats are unique`);
    desks.forEach((d, i) => assert.equal(d.i, i));
  }
  assert.equal(PLACES.library.desks.length, 100);
  assert.equal(MAX_DESKS, 100);
  for (const kind of ['library', 'cafe', 'netcafe']) assert.equal(PLACE_CAP[kind], PLACES[kind].desks.length, `one person per seat in the ${kind}`);
});

test('study seats are indoors; the square only has benches, which are for resting', () => {
  for (const kind of ['library', 'cafe', 'netcafe']) assert.ok(PLACES[kind].desks.every((d) => !d.rest), kind);
  assert.ok(PLACES.square.desks.every((d) => d.kit === 'bench' && d.rest));
});

test('a seat faces its desk: the chair is behind it and you approach from further back', () => {
  for (const kind of PLACE_KINDS) {
    for (const d of PLACES[kind].desks) {
      const k = KITS[d.kit];
      const [sx, sz] = seatLocal(d, 0, k.chairZ);
      assert.ok(Math.abs(sx - d.seat.x) < 0.011 && Math.abs(sz - d.seat.z) < 0.011, `${kind} seat ${d.i}`);
      // Facing (-sin rot, -cos rot): the desk is in front of the chair, the approach behind (or in front, for benches).
      const fx = -Math.sin(d.rot);
      const fz = -Math.cos(d.rot);
      const ahead = (p) => (p.x - d.seat.x) * fx + (p.z - d.seat.z) * fz;
      if (k.chair > 0) {
        assert.ok(ahead({ x: d.x, z: d.z }) > 0.3, `${kind} desk ${d.i} is in front of its chair`);
        assert.ok(ahead(d.approach) < -0.3, `${kind} desk ${d.i} is approached from behind`);
      } else {
        assert.ok(ahead(d.approach) > 0.5, `${kind} bench ${d.i} is approached from the front`);
      }
    }
  }
});

test('every seat and door can be reached from where people appear, and paths stay clear', () => {
  for (const kind of PLACE_KINDS) {
    const p = PLACES[kind];
    const grid = grids[kind];
    const start = [p.spawn.x, p.spawn.z];
    for (const d of p.desks) {
      assert.ok(open(kind, d.approach.x, d.approach.z), `${kind}: approach of seat ${d.i} is walkable`);
      const path = findPath(grid, start, [d.approach.x, d.approach.z]);
      assert.ok(path, `${kind}: seat ${d.i} is reachable`);
      assert.deepEqual(path.at(-1), [d.approach.x, d.approach.z]);
      for (let i = 1; i < path.length; i++) assert.ok(lineOpen(grid, ...path[i - 1], ...path[i]), `${kind}: segment ${i} to seat ${d.i} is clear`);
    }
    for (const door of p.doors) {
      assert.ok(open(kind, door.x, door.z), `${kind}: door to ${door.to} is walkable`);
      assert.ok(findPath(grid, start, [door.x, door.z]), `${kind}: door to ${door.to} is reachable`);
    }
  }
});

test('the doors connect: every building opens onto the square and the square has a door to each', () => {
  for (const kind of ['library', 'cafe', 'netcafe']) {
    assert.deepEqual(PLACES[kind].doors.map((d) => d.to), ['square']);
    assert.ok(PLACES.square.doors.some((d) => d.to === kind), `the square has a door to the ${kind}`);
    assert.ok(PLACES.square.arrive[kind], `walking out of the ${kind} puts you in front of it`);
  }
});

test('spawn and arrival points are walkable', () => {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const kind of PLACE_KINDS) {
    for (const from of [null, ...PLACE_KINDS]) {
      for (let i = 0; i < 100; i++) {
        const [x, z] = spawnPoint(PLACES[kind], random, from);
        assert.ok(open(kind, x, z), `${kind} from ${from}: ${x},${z}`);
      }
    }
  }
});

test('furniture and walls are blocked, aisles are open', () => {
  const d = PLACES.library.desks[0];
  assert.ok(!open('library', d.x, d.z), 'desk top');
  assert.ok(!open('library', -PLACES.library.width / 2 + 0.05, 0), 'side wall');
  assert.ok(open('library', 0, 0), 'centre aisle');
  const { fountain } = PLACES.square;
  assert.ok(!open('square', fountain.x, fountain.z), 'the fountain');
  assert.ok(!open('square', 0, -20), 'inside the library building');
});

test('a target inside furniture is moved to the nearest open spot', () => {
  const d = PLACES.library.desks[55];
  const path = findPath(grids.library, [0, 0], [d.x, d.z]);
  assert.ok(path);
  const end = path.at(-1);
  assert.ok(open('library', end[0], end[1]));
  assert.ok(Math.hypot(end[0] - d.x, end[1] - d.z) < 1.5);
});

test('points outside a place have no path', () => {
  assert.equal(findPath(grids.library, [0, 0], [100, 100]), null);
  assert.equal(findPath(grids.cafe, [0, 0], [-40, 0]), null);
});

test('the square is big but paths across it are found', () => {
  const p = PLACES.square;
  const path = findPath(grids.square, [p.arrive.cafe.x, p.arrive.cafe.z], [p.doors[2].x, p.doors[2].z]);
  assert.ok(path, 'from the coffee shop to the net café');
  assert.ok(pathLength(path) > 34 && pathLength(path) < 45);
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
