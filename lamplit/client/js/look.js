// 3D recipes for everything in the shop, built from simple shapes so the game ships no
// model files. Each item is a list of parts; a part is a placed shape with a colour.
// A colour is a hex value, or 'tint' (your sweater colour), 'hair' or 'skin' (yours).
//
// Parts are positioned in an anchor's frame:
//   body - centre of the body capsule (radius 0.2, top at y = 0.33); front is +z
//   head - centre of the head sphere (radius 0.2); eyes at (±0.072, -0.018, 0.18)
//   hand - in front of the chest, where both hands meet
//   desk - centre of the desk top; the person sits on the +z side
//   pet  - on the floor under the pet; it faces +z

import * as THREE from '../vendor/three.module.min.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sphere = (r, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);
const hemi = (r) => new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const cyl = (rt, rb, h, s = 16) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 12) => new THREE.ConeGeometry(r, h, s);
const torus = (r, t, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, 8, 28, arc);
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);
const HALF = Math.PI / 2;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();

/** A shape at position p, rotation r (radians, XYZ) and scale s, in colour c. */
function P(geo, c, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const sc = Array.isArray(s) ? s : [s, s, s];
  geo.applyMatrix4(tmpM.compose(tmpV.set(p[0], p[1], p[2]), tmpQ.setFromEuler(tmpE.set(r[0], r[1], r[2])), tmpS.set(sc[0], sc[1], sc[2])));
  return { geo, c };
}

// A few shared bits.
const glassesFrame = (color, lens) => [
  ...[-1, 1].map((s) => (lens ? P(cyl(0.054, 0.054, 0.012, 20), lens, [s * 0.072, -0.018, 0.196], [HALF, 0, 0]) : P(torus(0.048, 0.008), color, [s * 0.072, -0.018, 0.197]))),
  P(cyl(0.006, 0.006, 0.048, 6), color, [0, -0.01, 0.203], [0, 0, HALF]),
  ...[-1, 1].map((s) => P(box(0.007, 0.007, 0.15), color, [s * 0.124, -0.012, 0.125], [0, s * -0.22, 0])),
];
const hood = (c) => P(torus(0.13, 0.05), c, [0, 0.29, -0.035], [HALF + 0.25, 0, 0], [1, 1, 0.85]);
const buttons = (c, x = 0.062, ys = [0.1, 0.02, -0.06]) => ys.map((y) => P(sphere(0.016, 8, 6), c, [x, y, 0.2]));

/** Clothes: `base` is the body colour (null = your sweater colour); parts sit on the body. */
const OUTFITS = {
  sweater: { base: null, body: () => [P(torus(0.12, 0.03), 'tint', [0, 0.28, 0], [HALF, 0, 0])] },
  hoodie: {
    base: null,
    body: () => [
      hood('tint'),
      P(box(0.2, 0.09, 0.03), 'tint', [0, -0.07, 0.19]),
      ...[-1, 1].map((s) => P(cyl(0.007, 0.007, 0.13, 6), 0xf1ece0, [s * 0.04, 0.16, 0.195])),
    ],
  },
  cardigan: {
    base: null,
    body: () => [P(box(0.1, 0.32, 0.02), 0xefe6d2, [0, 0.04, 0.192]), P(torus(0.12, 0.024), 0xefe6d2, [0, 0.285, 0], [HALF, 0, 0]), ...buttons(0x5a3b2a)],
  },
  stripes: {
    base: 0xf3efe6,
    body: () => [-0.1, 0, 0.1].map((y) => P(torus(0.202, 0.022), 0x2b3d63, [0, y, 0], [HALF, 0, 0])),
  },
  jersey: {
    base: null,
    body: () => [P(box(0.15, 0.13, 0.012), 0xffffff, [0, 0.04, -0.203]), P(torus(0.12, 0.024), 0xffffff, [0, 0.285, 0], [HALF, 0, 0]), P(box(0.05, 0.05, 0.01), 0xffffff, [-0.08, 0.1, 0.197])],
  },
  pajamas: {
    base: 0xa9c4e6,
    body: () => [P(torus(0.205, 0.016), 0xffffff, [0, -0.2, 0], [HALF, 0, 0]), P(torus(0.12, 0.026), 0xffffff, [0, 0.285, 0], [HALF, 0, 0]), ...buttons(0xffffff, 0)],
  },
  raincoat: { base: 0xf2c230, body: () => [hood(0xf2c230), ...buttons(0x3b3b3b, 0.0, [0.12, 0.03, -0.06, -0.15])] },
  overalls: {
    base: 0xf2eee6,
    body: () => [
      P(cyl(0.207, 0.207, 0.16, 20), 0x3d5a80, [0, -0.05, 0]),
      P(new THREE.SphereGeometry(0.207, 20, 8, 0, Math.PI * 2, HALF, HALF), 0x3d5a80, [0, -0.13, 0]),
      P(box(0.17, 0.13, 0.02), 0x3d5a80, [0, 0.08, 0.193]),
      ...[-1, 1].map((s) => P(box(0.035, 0.2, 0.012), 0x3d5a80, [s * 0.07, 0.19, 0.16], [-0.5, 0, 0])),
      ...[-1, 1].map((s) => P(sphere(0.014, 8, 6), 0xe9c46a, [s * 0.065, 0.13, 0.205])),
    ],
  },
  blazer: {
    base: 0x22304f,
    body: () => [
      P(box(0.09, 0.15, 0.02), 0xf7f5ef, [0, 0.17, 0.188]),
      P(box(0.035, 0.17, 0.012), 0xb03a3a, [0, 0.12, 0.203]),
      P(cyl(0.024, 0.024, 0.006, 14), 0xd8b04a, [-0.1, 0.08, 0.198], [HALF, 0, 0]),
      ...buttons(0xd8b04a, 0.05, [0.0, -0.08]),
    ],
  },
};

/** Accessories in their anchor frames. */
const ACCESSORIES = {
  glasses: { anchor: 'head', parts: () => glassesFrame(0x2b2b2b) },
  sunglasses: { anchor: 'head', parts: () => glassesFrame(0x151515, 0x151515) },
  beanie: {
    anchor: 'head',
    parts: () => [P(hemi(0.226), 0xd9a441, [0, 0.03, -0.012]), P(torus(0.212, 0.036), 0xb98a2e, [0, 0.04, -0.012], [HALF, 0, 0]), P(sphere(0.055), 0xf3e7c9, [0, 0.27, -0.012])],
  },
  beret: { anchor: 'head', parts: () => [P(cyl(0.215, 0.2, 0.05, 24), 0x7a2733, [0.03, 0.205, -0.02], [0.05, 0, 0.24]), P(cyl(0.012, 0.012, 0.035, 6), 0x7a2733, [0.075, 0.245, -0.02], [0, 0, 0.24])] },
  nightcap: {
    anchor: 'head',
    parts: () => [P(cone(0.2, 0.4, 18), 0x4c5fa8, [0, 0.31, -0.08], [-0.55, 0, 0]), P(torus(0.2, 0.03), 0xf4f1ea, [0, 0.13, -0.02], [HALF + 0.05, 0, 0]), P(sphere(0.05), 0xf4f1ea, [0, 0.46, -0.2])],
  },
  flowers: {
    anchor: 'head',
    parts: () => {
      const petals = [0xf6a6c1, 0xfff3b0, 0xffffff, 0xffb5a7, 0xcdb4db];
      const out = [P(torus(0.172, 0.012), 0x5c8a4a, [0, 0.135, -0.01], [HALF, 0, 0])];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const x = Math.sin(a) * 0.172;
        const z = Math.cos(a) * 0.172 - 0.01;
        out.push(P(sphere(0.04, 10, 8), petals[k % petals.length], [x, 0.15, z]));
        out.push(P(sphere(0.016, 6, 5), 0xf2c230, [x * 1.08, 0.165, z * 1.08]));
      }
      return out;
    },
  },
  gradcap: {
    anchor: 'head',
    parts: () => [
      P(cyl(0.175, 0.185, 0.09, 20), 0x1b1b1f, [0, 0.17, -0.01]),
      P(box(0.46, 0.025, 0.46), 0x1b1b1f, [0, 0.225, -0.01], [0, Math.PI / 4, 0]),
      P(sphere(0.02, 8, 6), 0xd8b04a, [0, 0.245, -0.01]),
      P(cyl(0.006, 0.006, 0.2, 6), 0xd8b04a, [0.17, 0.14, 0.16]),
      P(cyl(0.022, 0.012, 0.05, 8), 0xd8b04a, [0.17, 0.035, 0.16]),
    ],
  },
  crown: {
    anchor: 'head',
    parts: () => {
      const out = [P(cyl(0.12, 0.13, 0.075, 22), 0xe0b43c, [0, 0.23, -0.01])];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        out.push(P(cone(0.032, 0.07, 8), 0xe0b43c, [Math.sin(a) * 0.11, 0.3, Math.cos(a) * 0.11 - 0.01]));
        out.push(P(sphere(0.016, 8, 6), k % 2 ? 0x4ea8de : 0xc0392b, [Math.sin(a) * 0.125, 0.23, Math.cos(a) * 0.125 - 0.01]));
      }
      return out;
    },
  },
  headphones: {
    anchor: 'head',
    parts: () => [
      P(torus(0.222, 0.022, Math.PI), 0xeeeae0, [0, 0.0, -0.01]),
      ...[-1, 1].map((s) => P(cyl(0.07, 0.07, 0.055, 20), 0xff8a6b, [s * 0.215, -0.01, -0.01], [0, 0, HALF])),
      ...[-1, 1].map((s) => P(cyl(0.055, 0.055, 0.02, 16), 0x2b2b2b, [s * 0.19, -0.01, -0.01], [0, 0, HALF])),
    ],
  },
  catears: {
    anchor: 'head',
    parts: () => [
      ...[-1, 1].map((s) => P(cone(0.068, 0.13, 10), 'hair', [s * 0.115, 0.205, -0.01], [0, 0, s * -0.38])),
      ...[-1, 1].map((s) => P(cone(0.036, 0.075, 8), 0xf4a3b4, [s * 0.112, 0.2, 0.025], [0, 0, s * -0.38])),
    ],
  },
  bunnyears: {
    anchor: 'head',
    parts: () => [
      ...[-1, 1].map((s) => P(capsule(0.042, 0.22), 0xf7f3ec, [s * 0.075, 0.36, -0.03], [-0.08, 0, s * -0.14])),
      ...[-1, 1].map((s) => P(box(0.03, 0.2, 0.01), 0xf4a3b4, [s * 0.077, 0.36, 0.009], [-0.08, 0, s * -0.14])),
    ],
  },
  scarf: {
    anchor: 'body',
    parts: () => [
      P(torus(0.145, 0.052), 0xc0392b, [0, 0.27, 0], [HALF, 0, 0]),
      P(box(0.075, 0.2, 0.035), 0xc0392b, [0.07, 0.15, 0.185], [0.15, 0, 0.12]),
      P(box(0.077, 0.018, 0.037), 0xf4f1ea, [0.072, 0.1, 0.193], [0.15, 0, 0.12]),
    ],
  },
  bowtie: {
    anchor: 'body',
    parts: () => [...[-1, 1].map((s) => P(cone(0.038, 0.07, 8), 0xb03a3a, [s * 0.034, 0.27, 0.2], [0, 0, s * HALF])), P(sphere(0.018, 8, 6), 0x8e2b2b, [0, 0.27, 0.205])],
  },
};

const book = (cover, pages = 0xf3ead6) => [P(box(0.15, 0.21, 0.035), cover), P(box(0.01, 0.2, 0.031), pages, [0.074, 0, 0])];
const openBook = (cover, pages = 0xf3ead6, x = -0.05, z = 0.1) => [
  P(box(0.31, 0.008, 0.21), cover, [x, 0.004, z]),
  ...[-1, 1].map((s) => P(box(0.145, 0.012, 0.2), pages, [x + s * 0.074, 0.013, z], [0, 0, s * -0.07])),
];
const mug = () => [P(cyl(0.04, 0.036, 0.09, 16), 0xf4f1ea, [0, 0.045, 0]), P(torus(0.024, 0.008), 0xf4f1ea, [0.047, 0.05, 0]), P(cyl(0.035, 0.035, 0.004, 14), 0x4a2c1a, [0, 0.087, 0])];
const bubbleTea = () => [
  P(cyl(0.046, 0.036, 0.13, 16), 0xe8d2b0, [0, 0.065, 0]),
  P(cyl(0.037, 0.037, 0.03, 14), 0x2b1d14, [0, 0.016, 0]),
  P(hemi(0.046), 0xf4f1ea, [0, 0.13, 0], [0, 0, 0], [1, 0.4, 1]),
  P(cyl(0.008, 0.008, 0.12, 6), 0xf28482, [0.01, 0.18, 0], [0, 0, -0.15]),
];
const teddy = () => [
  P(sphere(0.07), 0xa8744a, [0, 0.07, 0]),
  P(sphere(0.058), 0xa8744a, [0, 0.17, 0.01]),
  ...[-1, 1].map((s) => P(sphere(0.024, 8, 6), 0xa8744a, [s * 0.045, 0.22, 0])),
  P(sphere(0.025, 8, 6), 0xe8c9a5, [0, 0.16, 0.06]),
  ...[-1, 1].map((s) => P(sphere(0.008, 6, 4), 0x1b1716, [s * 0.022, 0.185, 0.055])),
];
const globe = () => [
  P(cyl(0.05, 0.06, 0.02, 16), 0xb08d57, [0, 0.01, 0]),
  P(cyl(0.008, 0.008, 0.06, 6), 0xb08d57, [0, 0.04, 0]),
  P(sphere(0.085, 18, 12), 0x3f7cc4, [0, 0.15, 0]),
  P(sphere(0.04, 8, 6), 0x5c9a4f, [0.04, 0.18, 0.05], [0, 0, 0], [1, 0.6, 1]),
  P(sphere(0.035, 8, 6), 0x5c9a4f, [-0.05, 0.12, 0.04], [0, 0, 0], [1, 0.7, 1]),
  P(torus(0.097, 0.006, Math.PI), 0xb08d57, [0, 0.15, 0], [0, HALF, 0.4]),
];

/** Things to hold: `hand` while standing or walking, `desk` once you sit down. */
const HELD = {
  flashcards: {
    hand: () => [P(box(0.13, 0.085, 0.04), 0xfdfbf5, [0, 0, 0], [0.3, 0, 0]), P(torus(0.05, 0.006), 0xc0392b, [0, 0, 0], [0.3, HALF, 0], [1, 0.9, 1.4])],
    desk: () => [P(box(0.12, 0.04, 0.085), 0xfdfbf5, [0.22, 0.02, 0.16]), P(box(0.124, 0.006, 0.02), 0xc0392b, [0.22, 0.041, 0.16])],
  },
  book: { hand: () => book(0x7b3f2b).map((p) => p), desk: () => openBook(0x7b3f2b) },
  coffee: { hand: () => mug(), desk: () => mug().map((p) => (p.geo.translate(0.3, 0, 0.17), p)) },
  comic: {
    hand: () => [P(box(0.15, 0.21, 0.015), 0xf2c230), P(box(0.06, 0.08, 0.004), 0xe76f51, [-0.035, 0.045, 0.009]), P(box(0.06, 0.08, 0.004), 0x4ea8de, [0.035, -0.04, 0.009])],
    desk: () => [...openBook(0xf2c230, 0xfdfbf5), P(box(0.05, 0.004, 0.06), 0xe76f51, [-0.13, 0.021, 0.08]), P(box(0.05, 0.004, 0.06), 0x4ea8de, [0.03, 0.021, 0.12])],
  },
  bubbletea: { hand: () => bubbleTea(), desk: () => bubbleTea().map((p) => (p.geo.translate(0.3, 0, 0.15), p)) },
  textbooks: {
    hand: () => [P(box(0.2, 0.035, 0.15), 0x2e5a8a, [0, -0.035, 0]), P(box(0.19, 0.035, 0.15), 0xa8445c, [0.005, 0, 0]), P(box(0.18, 0.035, 0.14), 0x3a7a5a, [-0.005, 0.035, 0])],
    desk: () => [P(box(0.2, 0.035, 0.15), 0x2e5a8a, [-0.32, 0.018, 0.12]), P(box(0.19, 0.035, 0.15), 0xa8445c, [-0.32, 0.053, 0.12], [0, 0.1, 0]), P(box(0.18, 0.035, 0.14), 0x3a7a5a, [-0.32, 0.088, 0.12], [0, -0.08, 0])],
  },
  plushie: { hand: () => teddy(), desk: () => teddy().map((p) => (p.geo.rotateY(Math.PI * 0.1).translate(-0.46, 0, 0.18), p)) },
  globe: { hand: () => globe(), desk: () => globe().map((p) => (p.geo.translate(-0.46, 0, 0.17), p)) },
  tablet: {
    hand: () => [P(box(0.17, 0.24, 0.012), 0x2b2b30), P(box(0.15, 0.21, 0.004), 0x9fd0ff, [0, 0, 0.008]), P(cyl(0.006, 0.006, 0.17, 6), 0xf4f1ea, [0.1, 0, 0.01])],
    desk: () => [P(box(0.24, 0.012, 0.17), 0x2b2b30, [-0.04, 0.006, 0.1]), P(box(0.21, 0.004, 0.15), 0x9fd0ff, [-0.04, 0.014, 0.1]), P(cyl(0.006, 0.006, 0.16, 6), 0xf4f1ea, [0.12, 0.01, 0.12], [HALF, 0, 0.2])],
  },
  laptop: {
    hand: () => [P(box(0.28, 0.2, 0.022), 0xc9ccd2), P(sphere(0.012, 8, 6), 0xf4f1ea, [0, 0, 0.012])],
    desk: () => [
      P(box(0.32, 0.015, 0.22), 0xc9ccd2, [-0.03, 0.008, 0.1]),
      P(box(0.32, 0.21, 0.012), 0xc9ccd2, [-0.03, 0.11, -0.01], [-0.22, 0, 0]),
      P(box(0.29, 0.18, 0.004), 0x9fd0ff, [-0.03, 0.11, -0.002], [-0.22, 0, 0]),
      P(box(0.26, 0.004, 0.1), 0x8d9097, [-0.03, 0.017, 0.11]),
    ],
  },
};

/** Desk items that replace the notebook on your desk. */
export const DESK_WORK_ITEMS = new Set(['book', 'comic', 'tablet', 'laptop']);
/** Small pets ride on you while you walk and sit on your desk; the rest walk beside you. */
export const SMALL_PETS = new Set(['hamster', 'owlet']);

const eyesAt = (x, y, z, r = 0.012) => [-1, 1].map((s) => P(sphere(r, 6, 5), 0x1b1716, [s * x, y, z]));

const PETS = {
  cat: () => [
    P(capsule(0.075, 0.14), 0xe8954a, [0, 0.11, 0], [HALF, 0, 0]),
    P(sphere(0.078), 0xe8954a, [0, 0.2, 0.11]),
    ...[-1, 1].map((s) => P(cone(0.032, 0.06, 8), 0xe8954a, [s * 0.042, 0.275, 0.1], [0, 0, s * -0.3])),
    P(sphere(0.035, 8, 6), 0xf6e3c8, [0, 0.18, 0.165], [0, 0, 0], [1, 0.8, 0.8]),
    ...eyesAt(0.03, 0.215, 0.175),
    P(capsule(0.018, 0.17), 0xe8954a, [0, 0.21, -0.14], [-0.6, 0, 0]),
    ...[-0.05, 0.05].flatMap((z) => [-1, 1].map((s) => P(sphere(0.026, 8, 6), 0xf6e3c8, [s * 0.045, 0.026, z + 0.01]))),
  ],
  puppy: () => [
    P(capsule(0.082, 0.15), 0xd9b38c, [0, 0.12, 0], [HALF, 0, 0]),
    P(sphere(0.085), 0xd9b38c, [0, 0.22, 0.12]),
    ...[-1, 1].map((s) => P(sphere(0.05, 10, 8), 0x8a5a3c, [s * 0.08, 0.205, 0.11], [0, 0, s * 0.3], [0.45, 1, 0.8])),
    P(sphere(0.04, 10, 8), 0xf3e3cc, [0, 0.195, 0.19]),
    P(sphere(0.014, 6, 5), 0x1b1716, [0, 0.205, 0.228]),
    ...eyesAt(0.032, 0.24, 0.185),
    P(capsule(0.016, 0.07), 0xd9b38c, [0, 0.2, -0.15], [-0.9, 0, 0]),
    ...[-0.06, 0.06].flatMap((z) => [-1, 1].map((s) => P(sphere(0.028, 8, 6), 0xd9b38c, [s * 0.05, 0.028, z]))),
  ],
  hamster: () => [
    P(sphere(0.07, 14, 10), 0xe7a35c, [0, 0.06, 0], [0, 0, 0], [1, 0.85, 1.15]),
    P(sphere(0.05, 12, 8), 0xfbf0dd, [0, 0.05, 0.04], [0, 0, 0], [1, 0.8, 1]),
    ...[-1, 1].map((s) => P(sphere(0.018, 8, 6), 0xf4a3b4, [s * 0.04, 0.115, 0.03])),
    ...eyesAt(0.028, 0.085, 0.07, 0.009),
  ],
  bunny: () => [
    P(sphere(0.085, 14, 10), 0xf7f3ec, [0, 0.085, -0.01], [0, 0, 0], [1, 0.95, 1.15]),
    P(sphere(0.062, 12, 10), 0xf7f3ec, [0, 0.165, 0.07]),
    ...[-1, 1].map((s) => P(capsule(0.021, 0.11), 0xf7f3ec, [s * 0.026, 0.27, 0.05], [-0.15, 0, s * -0.12])),
    ...[-1, 1].map((s) => P(box(0.016, 0.1, 0.006), 0xf4a3b4, [s * 0.027, 0.27, 0.07], [-0.15, 0, s * -0.12])),
    P(sphere(0.012, 6, 5), 0xf28482, [0, 0.16, 0.13]),
    ...eyesAt(0.03, 0.18, 0.118, 0.01),
    P(sphere(0.03, 8, 6), 0xffffff, [0, 0.08, -0.11]),
  ],
  owlet: () => [
    P(capsule(0.07, 0.07), 0x8a6a4a, [0, 0.11, 0]),
    P(sphere(0.055, 12, 8), 0xd8c3a5, [0, 0.09, 0.03], [0, 0, 0], [1, 1.1, 0.8]),
    ...[-1, 1].map((s) => P(cyl(0.028, 0.028, 0.01, 14), 0xffffff, [s * 0.03, 0.155, 0.062], [HALF, 0, 0])),
    ...[-1, 1].map((s) => P(sphere(0.013, 6, 5), 0x1b1716, [s * 0.03, 0.155, 0.07])),
    P(cone(0.013, 0.03, 6), 0xf2a541, [0, 0.13, 0.075], [HALF + 0.4, 0, 0]),
    ...[-1, 1].map((s) => P(cone(0.018, 0.045, 6), 0x8a6a4a, [s * 0.045, 0.215, 0], [0, 0, s * -0.35])),
  ],
  turtle: () => [
    P(hemi(0.11), 0x5b8f4f, [0, 0.035, 0], [0, 0, 0], [1, 0.75, 1.2]),
    P(torus(0.105, 0.012), 0x4a7a40, [0, 0.038, 0], [HALF, 0, 0], [1, 1.2, 1]),
    P(sphere(0.036, 10, 8), 0xa3c77f, [0, 0.055, 0.15]),
    ...eyesAt(0.016, 0.065, 0.18, 0.006),
    ...[-0.07, 0.07].flatMap((z) => [-1, 1].map((s) => P(sphere(0.025, 8, 6), 0xa3c77f, [s * 0.08, 0.02, z]))),
  ],
};

// ------------------------------------------------------------------ building geometry

/** Merges parts into one geometry per colour source: fixed (vertex colours), tint, hair, skin. */
export function mergeParts(parts) {
  const groups = { fixed: [], tint: [], hair: [], skin: [] };
  for (const p of parts) groups[typeof p.c === 'number' ? 'fixed' : p.c].push(p);
  const out = {};
  const color = new THREE.Color();
  for (const [key, list] of Object.entries(groups)) {
    if (list.length === 0) continue;
    let vertices = 0;
    let indices = 0;
    for (const { geo } of list) {
      vertices += geo.attributes.position.count;
      indices += geo.index ? geo.index.count : geo.attributes.position.count;
    }
    const pos = new Float32Array(vertices * 3);
    const nor = new Float32Array(vertices * 3);
    const col = key === 'fixed' ? new Float32Array(vertices * 3) : null;
    const idx = new Uint32Array(indices);
    let vo = 0;
    let io = 0;
    for (const { geo, c } of list) {
      const n = geo.attributes.position.count;
      pos.set(geo.attributes.position.array, vo * 3);
      nor.set(geo.attributes.normal.array, vo * 3);
      if (col) {
        color.setHex(c);
        for (let k = 0; k < n; k++) col.set([color.r, color.g, color.b], (vo + k) * 3);
      }
      if (geo.index) {
        const src = geo.index.array;
        for (let k = 0; k < src.length; k++) idx[io + k] = src[k] + vo;
        io += src.length;
      } else {
        for (let k = 0; k < n; k++) idx[io + k] = vo + k;
        io += n;
      }
      vo += n;
      geo.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    out[key] = g;
  }
  return out;
}

const cache = new Map();

/**
 * Geometry groups for an item in a variant: 'body' (clothes), 'acc' (accessories),
 * 'hand' / 'desk' (held items) or 'pet'. Cached; null if the item has no such variant.
 */
export function itemGeometry(id, variant) {
  const key = `${id}:${variant}`;
  if (cache.has(key)) return cache.get(key);
  let parts = null;
  if (variant === 'body' && OUTFITS[id]) parts = OUTFITS[id].body();
  else if (variant === 'acc' && ACCESSORIES[id]) parts = ACCESSORIES[id].parts();
  else if ((variant === 'hand' || variant === 'desk') && HELD[id]) parts = HELD[id][variant]();
  else if (variant === 'pet' && PETS[id]) parts = PETS[id]();
  const merged = parts ? mergeParts(parts) : null;
  cache.set(key, merged);
  return merged;
}

/** Body colour for an outfit, or null to use the sweater colour. */
export const outfitBase = (id) => OUTFITS[id]?.base ?? null;
export const accessoryAnchor = (id) => ACCESSORIES[id]?.anchor ?? 'head';
