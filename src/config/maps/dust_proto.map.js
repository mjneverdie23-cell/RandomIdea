/**
 * "DUSTBOWL PROTO" - a primitives-only layout inspired by the three-lane
 * structure of Dust II. Gameplay layout only: no art, no detail geometry.
 *
 * HOW TO EDIT THIS MAP
 *   1. Areas are the walkable footprint. Add/resize a rectangle and the wall
 *      geometry around it is regenerated automatically by MapCompiler.
 *      Two areas connect wherever their rectangles touch or overlap.
 *   2. Props are the cover you place inside those areas.
 *   3. Spawns, buy zones and bomb sites are plain coordinates.
 * Nothing else in the codebase needs to change when this file changes.
 *
 * Orientation: +Z is north (defender side), -Z is south (attacker side),
 * +X is east (A side), -X is west (B side). Y is up, floor at y = 0.
 */

import { area, box, cylinder, stairs, spawn, bombSite, PropKind } from '../../core/world/MapData.js';

const COLORS = {
  wall: 0x9c8d76,
  crate: 0xa8792f,
  container: 0x40606f,
  platform: 0x8a8a8a,
  pillar: 0xb0a894,
  stairs: 0x7d7d7d,
};

/* ------------------------------------------------------------------ AREAS --
 * Lane summary:
 *   West lane : T Hall -> B Tunnels -> B Site
 *   Mid lane  : T Hall -> Mid -> Mid Doors -> Mid Plaza -> (A Short | B Connector | CT)
 *   East lane : T Hall -> A Long -> A Site
 */
const areas = [
  // --- attacker side ---
  area('T_SPAWN', [-30, -72, 30, -58], { label: 'Attacker Spawn', tags: ['spawn', 'attackers'] }),
  area('T_HALL', [-52, -58, 52, -48], { label: 'Ramp', tags: ['connector'] }),

  // --- west lane (B) ---
  area('B_TUNNEL_LOWER', [-52, -48, -40, -6], { label: 'Lower Tunnels' }),
  area('B_TUNNEL_UPPER', [-56, -6, -36, 24], { label: 'Upper Tunnels' }),
  area('B_SITE', [-58, 24, -28, 46], { label: 'B Site', tags: ['site', 'site_b'] }),
  area('B_DOORS', [-44, 46, -30, 56], { label: 'B Doors', tags: ['connector'] }),

  // --- east lane (A) ---
  area('A_LONG_LOWER', [40, -48, 52, -6], { label: 'Long Doors' }),
  area('A_LONG_UPPER', [36, -6, 56, 24], { label: 'A Long' }),
  area('A_SITE', [28, 24, 58, 46], { label: 'A Site', tags: ['site', 'site_a'] }),
  area('A_CT_ENTRY', [30, 46, 44, 56], { label: 'A Entry', tags: ['connector'] }),

  // --- mid ---
  area('MID_LOWER', [-8, -48, 8, 6], { label: 'Lower Mid' }),
  area('MID_DOORS', [-8, 6, 8, 18], { label: 'Mid Doors' }),
  area('MID_PLAZA', [-16, 18, 16, 34], { label: 'Mid' }),
  area('MID_CONNECTOR', [-6, 34, 6, 56], { label: 'Mid Connector', tags: ['connector'] }),
  area('A_SHORT', [16, 26, 28, 34], { label: 'A Short', tags: ['connector'] }),
  area('B_CONNECT', [-28, 26, -16, 34], { label: 'B Connector', tags: ['connector'] }),

  // --- defender side ---
  area('CT_HALL', [-44, 56, 44, 66], { label: 'Defender Hall', tags: ['connector'] }),
  area('CT_SPAWN', [-14, 56, 14, 72], { label: 'Defender Spawn', tags: ['spawn', 'defenders'] }),
];

/* ------------------------------------------------------------------ PROPS --
 * Cover, elevated positions and sight-line breakers. Boxes taller than 1.4
 * units block bot navigation; anything shorter can be walked/jumped over.
 */
const props = [
  // --- A site ---
  box('a_platform', { at: [46, 40], size: [10, 1.2, 7], kind: PropKind.PLATFORM, color: COLORS.platform, blocksNav: false }),
  ...stairs('a_platform_steps', { at: [46, 34.5], width: 6, length: 3, height: 1.2, steps: 3, direction: '+z', color: COLORS.stairs }),
  box('a_crate_big', { at: [36, 30], size: [3, 2.2, 3], color: COLORS.crate }),
  box('a_crate_low', { at: [40.5, 27.5], size: [2.5, 1, 2.5], color: COLORS.crate, blocksNav: false }),
  box('a_short_wall', { at: [30, 37], size: [2, 2.6, 6], color: COLORS.wall }),
  cylinder('a_barrel', { at: [44, 30], radius: 1, height: 1.8, color: COLORS.container }),

  // --- B site ---
  box('b_platform', { at: [-46, 40], size: [10, 1.2, 7], kind: PropKind.PLATFORM, color: COLORS.platform, blocksNav: false }),
  ...stairs('b_platform_steps', { at: [-46, 34.5], width: 6, length: 3, height: 1.2, steps: 3, direction: '+z', color: COLORS.stairs }),
  box('b_car', { at: [-36, 30], size: [4, 1.8, 2.5], color: COLORS.container }),
  box('b_crate_big', { at: [-50, 29], size: [2.5, 2.2, 2.5], color: COLORS.crate }),
  box('b_crate_low', { at: [-40, 27], size: [2.5, 1, 2.5], color: COLORS.crate, blocksNav: false }),
  cylinder('b_barrel', { at: [-32, 42], radius: 1, height: 1.8, color: COLORS.container }),

  // --- mid ---
  box('mid_door_west', { at: [-6.5, 12], size: [3, 4, 1.5], color: COLORS.wall }),
  box('mid_door_east', { at: [6.5, 12], size: [3, 4, 1.5], color: COLORS.wall }),
  box('mid_xbox', { at: [3, -14], size: [3, 1, 3], color: COLORS.crate, blocksNav: false }),
  box('mid_nest', { at: [0, 30], size: [8, 1.6, 4], kind: PropKind.PLATFORM, color: COLORS.platform, blocksNav: false }),
  ...stairs('mid_nest_steps', { at: [0, 26.5], width: 5, length: 3, height: 1.6, steps: 4, direction: '+z', color: COLORS.stairs }),
  cylinder('mid_pillar_west', { at: [-12, 22], radius: 1.2, height: 5, color: COLORS.pillar }),
  cylinder('mid_pillar_east', { at: [12, 22], radius: 1.2, height: 5, color: COLORS.pillar }),

  // --- long ---
  box('long_container', { at: [46, 4], size: [6, 2.4, 4], color: COLORS.container }),
  box('long_crate', { at: [44, -22], size: [2.5, 2.2, 2.5], color: COLORS.crate }),
  box('long_pit_cover', { at: [52, 12], size: [3, 1, 6], color: COLORS.crate, blocksNav: false }),

  // --- tunnels ---
  box('tunnel_crate_big', { at: [-46, -30], size: [2.5, 2.2, 2.5], color: COLORS.crate }),
  box('tunnel_crate_low', { at: [-49, 2], size: [3, 1, 3], color: COLORS.crate, blocksNav: false }),
  cylinder('tunnel_barrel', { at: [-42, -14], radius: 1, height: 1.8, color: COLORS.container }),

  // --- connectors and defender side ---
  box('a_short_cover', { at: [22, 27.5], size: [2, 2, 2], color: COLORS.crate }),
  box('b_connect_cover', { at: [-22, 32.5], size: [2, 2, 2], color: COLORS.crate }),
  box('ct_barrier_west', { at: [-24, 61], size: [4, 1.8, 2], color: COLORS.container }),
  box('ct_barrier_east', { at: [24, 61], size: [4, 1.8, 2], color: COLORS.container }),
  box('ct_crate', { at: [0, 62], size: [3, 1, 3], color: COLORS.crate, blocksNav: false }),

  // --- attacker spawn ---
  box('t_crate_west', { at: [-20, -64], size: [3, 1, 3], color: COLORS.crate, blocksNav: false }),
  box('t_crate_east', { at: [20, -64], size: [3, 1, 3], color: COLORS.crate, blocksNav: false }),
];

export const DustProtoMap = {
  id: 'dust_proto',
  displayName: 'Dustbowl Proto',
  cellSize: 2,
  wallHeight: 8,
  padding: 6,
  wallColor: COLORS.wall,
  floorColor: 0xc2b280,
  skyColor: 0x8fb2d4,
  fogDensity: 0.006,

  areas,
  props,

  spawns: {
    ATTACKERS: [
      spawn([-16, -66], Math.PI), spawn([-8, -66], Math.PI), spawn([0, -66], Math.PI),
      spawn([8, -66], Math.PI), spawn([16, -66], Math.PI),
    ],
    DEFENDERS: [
      spawn([-10, 68], 0), spawn([-5, 68], 0), spawn([0, 68], 0),
      spawn([5, 68], 0), spawn([10, 68], 0),
    ],
  },

  buyZones: {
    ATTACKERS: [-30, -72, 30, -56],
    DEFENDERS: [-14, 56, 14, 72],
  },

  bombSites: [
    bombSite('A', [34, 28, 52, 42], { label: 'Bomb Site A', plantPoint: { x: 42, y: 0, z: 32 } }),
    bombSite('B', [-52, 28, -34, 42], { label: 'Bomb Site B', plantPoint: { x: -42, y: 0, z: 32 } }),
  ],
};

export default DustProtoMap;
