/**
 * Colours and render tuning. Nothing here affects gameplay.
 */
export const VisualsConfig = Object.freeze({
  teamColors: {
    TEAM_ONE: 0xd8763a,
    TEAM_TWO: 0x3a86d8,
  },
  sideAccent: {
    ATTACKERS: 0xe0a54a,
    DEFENDERS: 0x59a5e0,
  },
  enemyOutline: 0xff4d4d,
  allyOutline: 0x54d67a,

  /** Placeholder capsule proportions are derived from the class hitbox. */
  placeholder: {
    headMarkerRadiusScale: 0.42,
    snoutLength: 0.55,
    showFacingSpike: true,
  },

  camera: {
    fov: 90,
    near: 0.05,
    far: 400,
    /** Extra FOV added while sprinting, for a sense of speed. */
    sprintFovBonus: 6,
    spectatorHeight: 3.5,
    spectatorDistance: 7,
  },

  lighting: {
    ambient: 0x9fb0c4,
    ambientIntensity: 1.05,
    sun: 0xfff2d8,
    sunIntensity: 1.5,
    sunPosition: { x: 60, y: 120, z: -40 },
    shadows: false, // off by default: the prototype favours framerate over looks
  },

  effects: {
    tracerLifetime: 0.06,
    tracerColor: 0xffe9a8,
    impactLifetime: 0.35,
    impactColor: 0xd8d0c0,
    bloodColor: 0xc0392b,
    muzzleFlashLifetime: 0.05,
    explosionLifetime: 0.5,
    explosionColor: 0xff8844,
  },

  bomb: {
    carriedColor: 0xff3b30,
    plantedColor: 0xff0000,
    beaconHeight: 1.2,
  },
});
