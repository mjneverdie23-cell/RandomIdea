// World map mode: places in other countries, each a building to study in and the
// outdoors around it. Egypt: inside the Great Pyramid, and the desert at Giza. Italy:
// inside the Colosseum, and the streets of Rome. Japan: a temple hall, and its garden.
// Spain: inside a basilica of tree-like columns and stained glass, and Barcelona.
// Like the town's places, each defines its seats, the things you can't walk through, its
// doors and where people appear; places.js adds them to the list of every place.

import { seatList, area, freezeAll } from './layout.js';

const H = Math.PI / 2;

/** Seats around a point, all facing it (for cushions in a tent, benches round a fountain). */
function ring(add, kit, cx, cz, r, n, start = 0) {
  for (let k = 0; k < n; k++) {
    const a = start + (k / n) * Math.PI * 2;
    add(kit, cx + Math.sin(a) * r, cz + Math.cos(a) * r, a);
  }
}

/** Long tables with `per` seats a side, like the library's. */
function tables(add, xs, zs, per) {
  for (const tz of zs) {
    for (const side of [-1, 1]) {
      for (const tx of xs) {
        for (let k = 0; k < per; k++) add('desk', tx + (k - (per - 1) / 2) * 1.2, tz + side * 0.35, side < 0 ? Math.PI : 0);
      }
    }
  }
}

/** Two-seat benches given as [x, z, rot], seats side by side. */
function benches(add, list, kit = 'bench') {
  for (const [bx, bz, rot] of list) {
    for (const s of [-0.45, 0.45]) add(kit, bx + s * Math.cos(rot), bz - s * Math.sin(rot), rot);
  }
}

// ------------------------------------------------------------------ Egypt: inside the Great Pyramid

const PYR_TABLE_X = [-5.2, 5.2];
const PYR_TABLE_Z = [-7.2, -2.8, 1.6];
const PYR_PILLARS = [-9, -4.5, 0, 4.5].flatMap((z) => [[-9.6, z], [9.6, z]]);

const pyramid = {
  kind: 'pyramid',
  country: 'egypt',
  indoor: true,
  width: 24,
  depth: 28,
  wallHeight: 9,
  tables: freezeAll(PYR_TABLE_Z.flatMap((z) => PYR_TABLE_X.map((x) => [x, z]))),
  pillars: freezeAll(PYR_PILLARS),
  desks: seatList((add) => tables(add, PYR_TABLE_X, PYR_TABLE_Z, 4)),
  // The sarcophagus on its dais, two colossal statues, a pile of treasure.
  blocks: freezeAll([
    [-2.6, -12.6, 2.6, -10.2],
    [-9.2, -14, -4.8, -11],
    [4.8, -14, 9.2, -11],
    [7.4, 10.4, 11.6, 13.6],
    ...PYR_PILLARS.map(([x, z]) => [x - 0.5, z - 0.5, x + 0.5, z + 0.5]),
  ]),
  circles: freezeAll([
    [-4, 10.6, 0.45],
    [4, 10.6, 0.45],
  ]),
  doors: freezeAll([{ to: 'giza', x: -11.1, z: 9 }]),
  spawn: area(-10.0, 9, 1.4, 2.0),
};

// ------------------------------------------------------------------ Egypt: the Giza desert

const GIZA_PALMS = [
  [-21.5, 9.5],
  [-12.5, 9.2],
  [-22.5, 14.5],
  [-11.8, 15],
  [-17, 16.6],
  [-27, -12],
  [27, 14],
  [24, 22],
  [-30, 20],
  [3, 24],
];
const GIZA_STONES = [-12, -9, -6, 6, 9, 12].map((x) => [x, -7.4, Math.PI]);
const giza = {
  kind: 'giza',
  country: 'egypt',
  indoor: false,
  width: 70,
  depth: 60,
  pyramid: Object.freeze({ x: 0, z: -30, side: 36, height: 23 }),
  sphinx: Object.freeze([18.2, -12, 23.8, 1.6]),
  oasis: Object.freeze({ x: -17, z: 12.4, a: 4.6, b: 2.8 }),
  tent: Object.freeze({ x: -20, z: -3 }),
  obelisk: Object.freeze([10, 9]),
  ruins: freezeAll([[-8, 19], [-5.2, 20], [-2.4, 19.2], [-10.4, 20.6]]),
  palms: freezeAll(GIZA_PALMS),
  stall: Object.freeze([6, 19, 10, 21]),
  restingCamels: freezeAll([[-27, 5, 0.6], [15, 15, -2.2]]),
  desks: seatList((add) => {
    ring(add, 'mat', -20, -3, 1.65, 6, Math.PI / 6);
    for (const [x, z, rot] of GIZA_STONES) add('stone', x, z, rot);
  }),
  blocks: freezeAll([
    [-18, -30, 18, -12],
    [-2.2, -12, 2.2, -11.2],
    [18.2, -12, 23.8, 1.6],
    [9.2, 8.2, 10.8, 9.8],
    [6, 19, 10, 21],
  ]),
  circles: freezeAll([
    [-20, -3, 0.42],
    ...[[-22.6, -5.6], [-17.4, -5.6], [-22.6, -0.4], [-17.4, -0.4]].map(([x, z]) => [x, z, 0.12]),
    ...GIZA_PALMS.map(([x, z]) => [x, z, 0.32]),
    [-8, 19, 0.5],
    [-5.2, 20, 0.5],
    [-2.4, 19.2, 0.5],
    [-10.4, 20.6, 0.5],
    [-27, 5, 1.0],
    [15, 15, 1.0],
  ]),
  ellipses: freezeAll([[-17, 12.4, 4.6, 2.8]]),
  doors: freezeAll([{ to: 'pyramid', x: 0, z: -10.4 }]),
  spawn: area(0, 6, 5, 2),
  arrive: Object.freeze({ pyramid: area(0, -7.8, 3, 1.2) }),
};

// ------------------------------------------------------------------ Italy: inside the Colosseum

const COL_TABLE_X = [-4.6, 4.6];
const COL_TABLE_Z = [-6, -1.6, 2.8];
const COL_BRAZIERS = [[-9, -9.6], [9, -9.6], [-9, 9.6], [9, 9.6]];
const colosseum = {
  kind: 'colosseum',
  country: 'italy',
  indoor: true,
  width: 44,
  depth: 30,
  /** The arena floor is an ellipse with these half-axes. */
  arena: Object.freeze({ a: 20.5, b: 13.2 }),
  bounds: Object.freeze({ ellipse: Object.freeze([0, 0, 20.5, 13.2]) }),
  tables: freezeAll(COL_TABLE_Z.flatMap((z) => COL_TABLE_X.map((x) => [x, z]))),
  hypogeum: Object.freeze([-17.5, -4.5, -11, 4.5]),
  braziers: freezeAll(COL_BRAZIERS),
  desks: seatList((add) => tables(add, COL_TABLE_X, COL_TABLE_Z, 4)),
  blocks: freezeAll([[-17.5, -4.5, -11, 4.5]]),
  circles: freezeAll([...COL_BRAZIERS.map(([x, z]) => [x, z, 0.45]), [0, -11.4, 0.6], [-14.5, -7.6, 0.55], [14.5, -7.6, 0.55]]),
  doors: freezeAll([{ to: 'rome', x: 18.6, z: 0 }]),
  spawn: area(17.0, 0, 1.4, 2.4),
};

// ------------------------------------------------------------------ Italy: Rome

const ROME_PINES = [[-14, 14], [14, 9], [-18, -6], [21, 17], [-6, 20], [10, 21]];
const ROME_CYPRESS = [[-12, -12], [12, -12], [-17, -15.6], [16.5, -15.4]];
const ROME_LAMPS = [[-6, -9], [6, -9], [-9, 2], [9, 2], [-6, 16], [6, 16]];
const ROME_FOUNTAIN = Object.freeze({ x: 0, z: 5, r: 3.4 });
const ROME_BENCHES = [0, 1, 2, 3].map((k) => {
  const a = Math.PI / 4 + (k * Math.PI) / 2;
  return [ROME_FOUNTAIN.x + Math.sin(a) * 6.1, ROME_FOUNTAIN.z + Math.cos(a) * 6.1, a];
});
const ROME_CAFE = [7, 10.4, 13.8].map((z) => [-20.6, z]);
const rome = {
  kind: 'rome',
  country: 'italy',
  indoor: false,
  width: 64,
  depth: 52,
  colosseum: Object.freeze({ x: 0, z: -40, a: 26, b: 21 }),
  arch: Object.freeze({ x: 19, z: -9 }),
  fountain: ROME_FOUNTAIN,
  pines: freezeAll(ROME_PINES),
  cypress: freezeAll(ROME_CYPRESS),
  lamps: freezeAll(ROME_LAMPS),
  cafeTables: freezeAll(ROME_CAFE),
  benchSpots: freezeAll(ROME_BENCHES),
  /** Rows of buildings along the edges: [minX, minZ, maxX, maxZ]. */
  buildings: freezeAll([
    [-32, -14, -23, 26],
    [23, 0, 32, 26],
    [-23, 21, -4, 26],
    [4, 21, 23, 26],
  ]),
  ruins: freezeAll([[-21, -18], [-18, -19.5], [-15, -18.4]]),
  fiat: Object.freeze([10.6, 16.6, 13.4, 18.2]),
  cart: Object.freeze([-9.2, 12.6, -6.8, 13.8]),
  desks: seatList((add) => {
    benches(add, ROME_BENCHES);
    for (const [tx, tz] of ROME_CAFE) {
      add('chair', tx - 0.55, tz, -H);
      add('chair', tx + 0.55, tz, H);
    }
  }),
  blocks: freezeAll([
    [-32, -14, -23, 26],
    [23, 0, 32, 26],
    [-23, 21, -4, 26],
    [4, 21, 23, 26],
    [15.6, -10.4, 17.6, -7.6],
    [20.4, -10.4, 22.4, -7.6],
    [10.6, 16.6, 13.4, 18.2],
    [-9.2, 12.6, -6.8, 13.8],
  ]),
  circles: freezeAll([
    [ROME_FOUNTAIN.x, ROME_FOUNTAIN.z, ROME_FOUNTAIN.r],
    ...ROME_PINES.map(([x, z]) => [x, z, 0.4]),
    ...ROME_CYPRESS.map(([x, z]) => [x, z, 0.35]),
    ...ROME_LAMPS.map(([x, z]) => [x, z, 0.15]),
    ...ROME_CAFE.map(([x, z]) => [x, z, 0.32]),
    [-21, -18, 0.55],
    [-18, -19.5, 0.55],
    [-15, -18.4, 0.55],
  ]),
  ellipses: freezeAll([[0, -40, 26, 21]]),
  doors: freezeAll([{ to: 'colosseum', x: 0, z: -17.3 }]),
  spawn: area(0, 13.5, 6, 2),
  arrive: Object.freeze({ colosseum: area(0, -15.4, 3.2, 1.2) }),
};

// ------------------------------------------------------------------ Japan: a temple hall

const TEMPLE_COLS = [-6.75, -4.05, -1.35, 1.35, 4.05, 6.75];
const TEMPLE_ROWS = [-5.8, -3.4, -1.0, 1.4, 3.8, 6.2];
const TEMPLE_PILLARS = [
  ...[-8, -4, 0, 4, 8].map((z) => [-9, z]),
  ...[-8, -4, 0, 4].map((z) => [9, z]),
];
const temple = {
  kind: 'temple',
  country: 'japan',
  indoor: true,
  width: 22,
  depth: 22,
  wallHeight: 6,
  pillars: freezeAll(TEMPLE_PILLARS),
  dais: Object.freeze([-6, -11, 6, -8.2]),
  desks: seatList((add) => {
    for (const z of TEMPLE_ROWS) for (const x of TEMPLE_COLS) add('low', x, z, 0);
  }),
  blocks: freezeAll([
    [-6, -11, 6, -8.2],
    [-7, 10.5, 7, 11],
  ]),
  circles: freezeAll([...TEMPLE_PILLARS.map(([x, z]) => [x, z, 0.24]), [-9.6, -9.6, 0.6], [9.6, -9.6, 0.4], [-9.8, 9.8, 0.4]]),
  doors: freezeAll([{ to: 'garden', x: 10.1, z: 8 }]),
  spawn: area(9.3, 8.2, 1.2, 1.8),
};

// ------------------------------------------------------------------ Japan: the temple garden

const GARDEN_POND = Object.freeze({ x: -11, z: 4, a: 6.5, b: 4 });
const GARDEN_LANTERNS = [[-3.4, 8], [3.4, 8], [-3.4, 0], [3.4, 0], [-3.4, -8], [3.4, -8]];
/** [x, z, kind]: 0 cherry, 1 maple, 2 pine. */
const GARDEN_TREES = [
  [-17, -8, 0],
  [-6, -9, 0],
  [7, -7, 1],
  [12.5, 13, 0],
  [-18.5, 12, 1],
  [-4.5, 13.5, 0],
  [17, 8.6, 2],
  [-27.5, -15, 1],
  [6.5, 20, 1],
  [-11, 18.5, 2],
];
const GARDEN_TORII = Array.from({ length: 16 }, (_, k) => -5 + k * 1.3);
/** [x, z, rot]: two facing the rock garden, two looking over the pond. */
const GARDEN_BENCHES = [
  [7, 2.6, -H],
  [7, 5.8, -H],
  [-6.6, 10.5, 0.59],
  [-17.8, -1.2, -2.23],
];
const garden = {
  kind: 'garden',
  country: 'japan',
  indoor: false,
  width: 60,
  depth: 52,
  hall: Object.freeze([-13, -26, 13, -15]),
  pagoda: Object.freeze({ x: 20, z: -14, side: 6 }),
  bell: Object.freeze([-22.5, -16.5, -17.5, -11.5]),
  pond: GARDEN_POND,
  bridge: Object.freeze([-11.75, -0.8, -10.25, 8.8]),
  rockGarden: Object.freeze([9, 1, 18, 7.4]),
  gate: Object.freeze({ x: 0, z: 16, span: 4.6 }),
  torii: freezeAll(GARDEN_TORII),
  lanterns: freezeAll(GARDEN_LANTERNS),
  trees: freezeAll(GARDEN_TREES),
  basin: Object.freeze([5.8, 11.2, 8.2, 12.8]),
  bamboo: Object.freeze([24, -8, 30, 26]),
  benchSpots: freezeAll(GARDEN_BENCHES),
  desks: seatList((add) => benches(add, GARDEN_BENCHES)),
  blocks: freezeAll([
    [-13, -26, 13, -15],
    [-4, -15, 4, -13.6],
    [17, -17, 23, -11],
    [-22.5, -16.5, -17.5, -11.5],
    [9, 1, 18, 7.4],
    [5.8, 11.2, 8.2, 12.8],
    [24, -8, 30, 26],
  ]),
  circles: freezeAll([
    [-2.3, 16, 0.32],
    [2.3, 16, 0.32],
    ...GARDEN_TORII.flatMap((z) => [[-25.4, z, 0.14], [-22.6, z, 0.14]]),
    ...GARDEN_LANTERNS.map(([x, z]) => [x, z, 0.36]),
    ...GARDEN_TREES.map(([x, z]) => [x, z, 0.4]),
  ]),
  ellipses: freezeAll([[GARDEN_POND.x, GARDEN_POND.z, GARDEN_POND.a, GARDEN_POND.b]]),
  open: freezeAll([[-11.75, -0.8, -10.25, 8.8]]),
  doors: freezeAll([{ to: 'temple', x: 0, z: -12.6 }]),
  spawn: area(0, 11, 4, 2),
  arrive: Object.freeze({ temple: area(0, -10.2, 3, 1.2) }),
};

// ------------------------------------------------------------------ Spain: inside the basilica

const BAS_TABLE_X = [-5, 5];
const BAS_TABLE_Z = [-5.2, -0.8, 3.6];
/** The tree-like columns down each side aisle. */
const BAS_COLUMNS = [-10, -5.5, -1, 3.5, 8].flatMap((z) => [[-9.4, z], [9.4, z]]);
const BAS_FONTS = [[-3.6, 12.6], [3.6, 12.6]];
const basilica = {
  kind: 'basilica',
  country: 'spain',
  indoor: true,
  width: 26,
  depth: 32,
  wallHeight: 14,
  tables: freezeAll(BAS_TABLE_Z.flatMap((z) => BAS_TABLE_X.map((x) => [x, z]))),
  columns: freezeAll(BAS_COLUMNS),
  /** The altar on its steps at the apse end, under a hanging canopy. */
  altar: Object.freeze([-4.5, -16, 4.5, -11.6]),
  organ: Object.freeze([-13, -16, -8.6, -13.4]),
  /** Two giant seashells for holy water, by the door. */
  fonts: freezeAll(BAS_FONTS),
  desks: seatList((add) => tables(add, BAS_TABLE_X, BAS_TABLE_Z, 4)),
  blocks: freezeAll([
    [-4.5, -16, 4.5, -11.6],
    [-13, -16, -8.6, -13.4],
  ]),
  circles: freezeAll([...BAS_COLUMNS.map(([x, z]) => [x, z, 0.55]), ...BAS_FONTS.map(([x, z]) => [x, z, 0.62])]),
  doors: freezeAll([{ to: 'barcelona', x: 0, z: 15.1 }]),
  spawn: area(0, 13.3, 2.4, 1.2),
};

// ------------------------------------------------------------------ Spain: Barcelona

/** London planes down both sides of the Rambla, and a few in the parks by the basilica. */
const BCN_PLANES = [
  ...[2, 7, 12, 17, 22, 27].flatMap((z) => [[-5.4, z], [5.4, z]]),
  [-25, -21],
  [-29, -15],
  [24, -21],
  [28.5, -16],
];
const BCN_PALMS = [[-12, -11], [12, -11], [-17, -2.5], [16.5, -7], [-10, 21], [10.5, 21]];
/** Lamp posts with a crown of lanterns. */
const BCN_LAMPS = [[-6, -6], [6, -6], [-9, 3], [9, 3]];
const BCN_POND = Object.freeze({ x: -22, z: -9, a: 5.5, b: 3.2 });
/** The mosaic bench winds along a wave; each seat faces out of the bench's front. */
const BCN_BENCH = Object.freeze({ from: -18.3, to: -7.7, z: 8, amp: 0.7, freq: 0.75, mid: -13 });
const BCN_WAVE = (x) => BCN_BENCH.z + Math.sin((x - BCN_BENCH.mid) * BCN_BENCH.freq) * BCN_BENCH.amp;
const BCN_WAVE_SEATS = Array.from({ length: 9 }, (_, k) => {
  const x = -17.6 + k * 1.15;
  const slope = (BCN_WAVE(x + 0.01) - BCN_WAVE(x - 0.01)) / 0.02;
  return [x, BCN_WAVE(x), Math.atan2(slope, -1)];
});
/** Fill the gaps between the bench's seats (and its ends) so nobody walks through it. */
const BCN_WAVE_FILL = [
  ...BCN_WAVE_SEATS.slice(1).map(([x, z], k) => [(x + BCN_WAVE_SEATS[k][0]) / 2, (z + BCN_WAVE_SEATS[k][1]) / 2, 0.36]),
  [BCN_BENCH.from, BCN_WAVE(BCN_BENCH.from), 0.3],
  [BCN_BENCH.to, BCN_WAVE(BCN_BENCH.to), 0.3],
];
/** Two-seat benches [x, z, rot]: by the pond, and along the Rambla. */
const BCN_BENCHES = [
  [-22, -4.2, 0],
  [-14.8, -9, H],
  [-4.4, 4.5, -H],
  [4.4, 9.5, H],
  [-4.4, 14.5, -H],
  [4.4, 24.5, H],
];
const BCN_CAFE = [11, 14.5, 18].map((z) => [16.8, z]);
const BCN_DRAGON = Object.freeze({ x: -12, z: 13.6, r: 1.0 });
const barcelona = {
  kind: 'barcelona',
  country: 'spain',
  indoor: false,
  width: 66,
  depth: 58,
  /** The basilica's footprint; its façade faces the square at z = -16. */
  basilica: Object.freeze([-15, -29, 15, -16]),
  rambla: Object.freeze([-4, -1, 4, 29]),
  /** City blocks round the square: [minX, minZ, maxX, maxZ]. */
  buildings: freezeAll([
    [-33, -2, -21, 29],
    [21, -12, 33, 29],
    [-21, 23, -7, 29],
    [7, 23, 21, 29],
  ]),
  /** The house of mosaics and the wavy stone house, on the east and west rows. */
  mosaicHouse: Object.freeze([21, 1, 25, 9]),
  wavyHouse: Object.freeze([-25, 6, -21, 15]),
  kiosks: freezeAll([[-2.6, 9.5], [2.6, 19.5]]),
  taxis: freezeAll([[19.7, -3.5], [19.7, 2.5]]),
  mosaic: Object.freeze({ x: 0, z: 14.5, r: 1.6 }),
  pond: BCN_POND,
  dragon: BCN_DRAGON,
  planes: freezeAll(BCN_PLANES),
  palms: freezeAll(BCN_PALMS),
  lamps: freezeAll(BCN_LAMPS),
  /** The winding bench's centre line: z = z + sin((x - mid) * freq) * amp, from x to x. */
  wave: BCN_BENCH,
  waveSeats: freezeAll(BCN_WAVE_SEATS),
  benchSpots: freezeAll(BCN_BENCHES),
  cafeTables: freezeAll(BCN_CAFE),
  desks: seatList((add) => {
    // The winding bench is one long mosaic seat, drawn in one piece: its seats are bare.
    for (const [x, z, rot] of BCN_WAVE_SEATS) add('stone', x, z, rot);
    benches(add, BCN_BENCHES);
    for (const [tx, tz] of BCN_CAFE) {
      add('chair', tx - 0.55, tz, -H);
      add('chair', tx + 0.55, tz, H);
    }
  }),
  blocks: freezeAll([
    [-15, -29, 15, -16],
    [-3.4, -16, 3.4, -15.3],
    [-11.4, -16, -6.6, -15],
    [6.6, -16, 11.4, -15],
    [-33, -2, -21, 29],
    [21, -12, 33, 29],
    [-21, 23, -7, 29],
    [7, 23, 21, 29],
    [-3.6, 8.5, -1.6, 10.5],
    [1.6, 18.5, 3.6, 20.5],
    [18.9, -5.7, 20.5, -1.3],
    [18.9, 0.3, 20.5, 4.7],
  ]),
  circles: freezeAll([
    ...BCN_PLANES.map(([x, z]) => [x, z, 0.35]),
    ...BCN_PALMS.map(([x, z]) => [x, z, 0.32]),
    ...BCN_LAMPS.map(([x, z]) => [x, z, 0.16]),
    ...BCN_CAFE.map(([x, z]) => [x, z, 0.32]),
    [BCN_DRAGON.x, BCN_DRAGON.z, BCN_DRAGON.r],
    ...BCN_WAVE_FILL,
  ]),
  ellipses: freezeAll([[BCN_POND.x, BCN_POND.z, BCN_POND.a, BCN_POND.b]]),
  doors: freezeAll([{ to: 'basilica', x: 0, z: -14.9 }]),
  spawn: area(0, 4, 6, 2),
  arrive: Object.freeze({ basilica: area(0, -12.2, 3, 1.2) }),
};

pyramid.arrive = Object.freeze({ giza: pyramid.spawn });
colosseum.arrive = Object.freeze({ rome: colosseum.spawn });
temple.arrive = Object.freeze({ garden: temple.spawn });
basilica.arrive = Object.freeze({ barcelona: basilica.spawn });

export const WORLD_PLACES = Object.freeze({
  pyramid: Object.freeze(pyramid),
  giza: Object.freeze(giza),
  colosseum: Object.freeze(colosseum),
  rome: Object.freeze(rome),
  temple: Object.freeze(temple),
  garden: Object.freeze(garden),
  basilica: Object.freeze(basilica),
  barcelona: Object.freeze(barcelona),
});

/** Countries on the world map you can visit, and where a visit starts. */
export const COUNTRIES = Object.freeze({
  egypt: Object.freeze({ places: Object.freeze(['pyramid', 'giza']), start: 'pyramid', code: 'EG' }),
  italy: Object.freeze({ places: Object.freeze(['colosseum', 'rome']), start: 'colosseum', code: 'IT' }),
  japan: Object.freeze({ places: Object.freeze(['temple', 'garden']), start: 'temple', code: 'JP' }),
  spain: Object.freeze({ places: Object.freeze(['basilica', 'barcelona']), start: 'basilica', code: 'ES' }),
});
