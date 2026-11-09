// The places you can be in: a sunlit library, a warm coffee shop, a neon net café and the
// town square outside them. Each has its seats, the furniture you can't walk through, its
// doors and where people appear. Shared by the server and the client, so both agree on
// every seat and wall; the client adds the decoration that needs no collision.

import { makeDesk } from './layout.js';

export const PLACE_KINDS = Object.freeze(['library', 'cafe', 'netcafe', 'square']);
export const DEFAULT_PLACE = 'library';
export const OUTSIDE = 'square';

const H = Math.PI / 2;

function seats(build) {
  const desks = [];
  build((kit, x, z, rot) => desks.push(makeDesk(desks.length, kit, x, z, rot)));
  return Object.freeze(desks);
}

const rect = (x, z, w, d) => Object.freeze({ x, z, w, d });
const freeze = (list) => Object.freeze(list.map((v) => Object.freeze(v)));

// ------------------------------------------------------------------ the library

/** Long reading tables, five seats a side, in two columns of five. */
const LIB_TABLE_X = [-5.6, 5.6];
const LIB_TABLE_Z = [-11.2, -7.0, -2.8, 1.4, 5.6];

const library = {
  kind: 'library',
  indoor: true,
  width: 26,
  depth: 32,
  wallHeight: 9,
  tables: freeze(LIB_TABLE_Z.flatMap((z) => LIB_TABLE_X.map((x) => [x, z]))),
  desks: seats((add) => {
    for (const tz of LIB_TABLE_Z) {
      for (const side of [-1, 1]) {
        for (const tx of LIB_TABLE_X) {
          for (let k = 0; k < 5; k++) add('desk', tx + (k - 2) * 1.2, tz + side * 0.35, side < 0 ? Math.PI : 0);
        }
      }
    }
  }),
  // Shelves along the side walls (the left one stops short of the door), the librarian's
  // desk, the reading nook, a globe and plants.
  shelves: freeze([
    [-13, -15.2, -12.4, 10.6],
    [12.4, -15.2, 13, 14.6],
  ]),
  blocks: freeze([
    [-13, -15.2, -12.4, 10.6],
    [12.4, -15.2, 13, 14.6],
    [3.6, 10.4, 8.6, 11.5],
    [9.3, 13.85, 12.1, 14.95],
  ]),
  circles: freeze([
    [-10.4, 8.8, 0.45],
    [-12.25, -15.3, 0.42],
    [12.25, -15.3, 0.42],
    [-12.25, 15.3, 0.42],
    [0, -15.45, 0.5],
  ]),
  doors: freeze([{ to: 'square', x: -12.1, z: 13 }]),
  spawn: rect(-10.8, 13, 1.4, 2.2),
  arrive: Object.freeze({}),
};

// ------------------------------------------------------------------ the coffee shop

const CAFE_TWO_TOP_X = [-7.0, -4.5];
const CAFE_TWO_TOP_Z = [-4.6, -1.1, 2.4, 5.9];
const CAFE_LONG_TABLE = { x: -1.4, z: [-3.6, -2.4, -1.2, 0, 1.2, 2.4, 3.6] };

const cafe = {
  kind: 'cafe',
  indoor: true,
  width: 22,
  depth: 20,
  wallHeight: 5,
  twoTops: freeze(CAFE_TWO_TOP_Z.flatMap((z) => CAFE_TWO_TOP_X.map((x) => [x, z]))),
  longTable: Object.freeze({ x: CAFE_LONG_TABLE.x, z0: -4.2, z1: 4.2 }),
  desks: seats((add) => {
    // Stools at the window counter, facing the glass.
    for (let k = 0; k < 14; k++) add('bar', -10.7, -5.2 + k * 0.8, H);
    // Little tables for two.
    for (const tz of CAFE_TWO_TOP_Z) {
      for (const tx of CAFE_TWO_TOP_X) {
        add('cafe', tx, tz - 0.2, Math.PI);
        add('cafe', tx, tz + 0.2, 0);
      }
    }
    // The long communal table, seats facing each other across it.
    for (const tz of CAFE_LONG_TABLE.z) {
      add('desk', CAFE_LONG_TABLE.x - 0.35, tz, -H);
      add('desk', CAFE_LONG_TABLE.x + 0.35, tz, H);
    }
  }),
  // The counter, the window bar, the lounge (sofa, armchairs, coffee table, bookshelf),
  // the piano and plants.
  blocks: freeze([
    [-4.8, -10, 5.8, -8.1],
    [-11, -5.65, -10.45, 5.65],
    [10.0, -5.6, 11, -2.6],
    [8.4, -4.7, 9.3, -3.5],
    [10.6, -1.4, 11, 2.2],
    [-8.7, 8.5, -6.6, 9.7],
  ]),
  circles: freeze([
    [7.3, -4.8, 0.46],
    [7.3, -3.3, 0.46],
    [5.2, 1.6, 0.42],
    [6.4, 3.0, 0.46],
    [4.0, 3.0, 0.46],
    [-10.35, -9.35, 0.42],
    [-10.35, 9.35, 0.42],
    [10.35, -9.35, 0.48],
    [10.35, 9.35, 0.42],
  ]),
  doors: freeze([{ to: 'square', x: 10.1, z: 7 }]),
  spawn: rect(9.3, 7.2, 1.2, 2.0),
  arrive: Object.freeze({}),
};

// ------------------------------------------------------------------ the net café

const NET_ROW_X = [-5.4, 5.4];
const NET_ROW_Z = [-5.6, -1.6, 2.4];

const netcafe = {
  kind: 'netcafe',
  indoor: true,
  width: 24,
  depth: 22,
  wallHeight: 4.6,
  rows: freeze(NET_ROW_Z.flatMap((z) => NET_ROW_X.map((x) => [x, z]))),
  desks: seats((add) => {
    for (const tz of NET_ROW_Z) {
      for (const side of [-1, 1]) {
        for (const tx of NET_ROW_X) {
          for (let k = 0; k < 5; k++) add('pc', tx + (k - 2) * 1.1, tz + side * 0.325, side < 0 ? Math.PI : 0);
        }
      }
    }
  }),
  // The snack counter and drinks fridges, vending machines, the claw machine, beanbags and plants.
  blocks: freeze([
    [-4.2, -11, 4.2, -9.3],
    [-5.5, -11, -4.2, -10.25],
    [4.2, -11, 5.5, -10.25],
    [11.1, 4.6, 12, 7.0],
    [10.5, 8.7, 12, 10.3],
  ]),
  circles: freeze([
    [-1.6, 9.0, 0.55],
    [0.4, 9.5, 0.55],
    [2.4, 9.0, 0.55],
    [0.4, 7.7, 0.38],
    [-11.4, -10.4, 0.4],
    [11.4, -10.4, 0.4],
  ]),
  doors: freeze([{ to: 'square', x: -11.1, z: 7 }]),
  spawn: rect(-10.3, 7.2, 1.2, 2.0),
  arrive: Object.freeze({}),
};

// ------------------------------------------------------------------ the town square

const FOUNTAIN = Object.freeze({ x: 0, z: -1, r: 2.7 });
/** Benches facing the fountain sit between the four paths. */
const RING = 6.4;
const ringBench = (k) => {
  const a = ((k + 0.5) / 8) * Math.PI * 2;
  return [FOUNTAIN.x + Math.sin(a) * RING, FOUNTAIN.z + Math.cos(a) * RING, a];
};
/** [x, z, rot] for every two-seat bench. rot 0 faces -z (north, toward the plaza). */
const BENCHES = [
  ...Array.from({ length: 8 }, (_, k) => ringBench(k)),
  [-9, 12.5, 0],
  [-4.6, 12.5, 0],
  [4.6, 12.5, 0],
  [9, 12.5, 0],
  [17, 21.4, 0],
  [11.6, 17, -H],
];
const TREES = [
  ...Array.from({ length: 8 }, (_, k) => {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    return [FOUNTAIN.x + Math.sin(a) * 11, FOUNTAIN.z + Math.cos(a) * 11, 1];
  }),
  [-24, 9.5, 0],
  [-18.5, 15.5, 0],
  [-25.5, 21, 0],
  [-13, 20.5, 0],
  [-6, 23.5, 1],
  [24, 9.5, 0],
  [26, 16, 0],
  [24.5, 22.5, 0],
  [8.5, 22.6, 1],
  [-27, 2, 0],
  [27, 2, 0],
  [-15.5, 9, 1],
  [15.5, 9, 1],
];
const LAMP_POSTS = [
  [-2.6, -10.6],
  [2.6, -10.6],
  [-12.5, -4.4],
  [-12.5, 0.4],
  [12.5, -4.4],
  [12.5, 0.4],
  [-2.6, 10],
  [2.6, 10],
  [-2.6, 19],
  [2.6, 19],
];
const TERRACE = [
  [-16.4, -9.0],
  [-16.4, -6.0],
  [-16.4, 2.0],
];
const FLOWER_BEDS = [
  [-7.5, -13.6, 1.1],
  [7.5, -13.6, 1.1],
];
const POND = Object.freeze({ x: 17, z: 17, r: 3.0 });

const square = {
  kind: 'square',
  indoor: false,
  width: 60,
  depth: 52,
  fountain: FOUNTAIN,
  pond: POND,
  benches: freeze(BENCHES),
  trees: freeze(TREES),
  lampPosts: freeze(LAMP_POSTS),
  terrace: freeze(TERRACE),
  flowerBeds: freeze(FLOWER_BEDS),
  /** Footprints [minX, minZ, maxX, maxZ] of the buildings you can go into. */
  buildings: Object.freeze({
    library: Object.freeze([-11, -26, 11, -15]),
    cafe: Object.freeze([-30, -13, -19, 5]),
    netcafe: Object.freeze([19, -13, 30, 5]),
  }),
  gardens: freeze([
    [-30, -26, -11, -13],
    [11, -26, 30, -13],
  ]),
  steps: Object.freeze([-3.6, -15, 3.6, -14.0]),
  busStop: Object.freeze([4.5, 24.3, 7.5, 25.6]),
  desks: seats((add) => {
    for (const [bx, bz, rot] of BENCHES) {
      for (const s of [-0.45, 0.45]) add('bench', bx + s * Math.cos(rot), bz - s * Math.sin(rot), rot);
    }
  }),
  blocks: freeze([
    [-11, -26, 11, -15],
    [-30, -13, -19, 5],
    [19, -13, 30, 5],
    [-30, -26, -11, -13],
    [11, -26, 30, -13],
    [-3.6, -15, 3.6, -14.0],
    [18.3, 1.2, 19, 3.0],
    [17.4, -11.5, 18.8, -8.8],
    [4.5, 24.3, 7.5, 25.6],
  ]),
  circles: freeze([
    [FOUNTAIN.x, FOUNTAIN.z, FOUNTAIN.r],
    [POND.x, POND.z, POND.r],
    ...TREES.map(([x, z]) => [x, z, 0.4]),
    ...LAMP_POSTS.map(([x, z]) => [x, z, 0.16]),
    ...TERRACE.map(([x, z]) => [x, z, 0.85]),
    ...FLOWER_BEDS,
  ]),
  doors: freeze([
    { to: 'library', x: 0, z: -13.6 },
    { to: 'cafe', x: -18.2, z: -2 },
    { to: 'netcafe', x: 18.2, z: -2 },
  ]),
  spawn: rect(0, 7.2, 5, 2),
  /** Where you appear when you walk out of each building. */
  arrive: Object.freeze({
    library: rect(0, -12.4, 3.2, 1.2),
    cafe: rect(-16.6, -2, 1.0, 2.4),
    netcafe: rect(16.6, -2, 1.0, 2.4),
  }),
};

for (const p of [library, cafe, netcafe]) p.arrive = Object.freeze({ square: p.spawn });

export const PLACES = Object.freeze({
  library: Object.freeze(library),
  cafe: Object.freeze(cafe),
  netcafe: Object.freeze(netcafe),
  square: Object.freeze(square),
});

/** People per room of each kind: one per seat indoors, a crowd outside. */
export const PLACE_CAP = Object.freeze({ library: 100, cafe: PLACES.cafe.desks.length, netcafe: PLACES.netcafe.desks.length, square: 100 });

/** The most seats any place has (for validating seat numbers). */
export const MAX_DESKS = Math.max(...PLACE_KINDS.map((k) => PLACES[k].desks.length));

export const isPlace = (k) => typeof k === 'string' && PLACE_KINDS.includes(k);
export const placeIndex = (k) => PLACE_KINDS.indexOf(k);
