/**
 * Map authoring helpers.
 *
 * A map is authored as a list of *walkable rectangles* ("areas") plus explicit
 * props (cover, platforms, pillars). MapCompiler turns that into solid geometry,
 * a collision set and a navigation grid - so an author never places a wall by
 * hand and can never leave an accidental hole between two rooms.
 *
 * All rectangles are given as [x0, z0, x1, z1] in world units, Y is up.
 */

export const PropKind = Object.freeze({
  WALL: 'WALL',           // auto-generated map boundary/filler
  COVER: 'COVER',         // crates, containers - shootable cover
  PLATFORM: 'PLATFORM',   // elevated stand-on surface
  STAIRS: 'STAIRS',       // generated stack of steps
  PILLAR: 'PILLAR',       // cylinder
  DECOR: 'DECOR',         // non-collidable marker geometry
});

/**
 * A walkable region. Areas may overlap - overlapping areas simply merge.
 * @param {string} id
 * @param {[number,number,number,number]} rect [x0, z0, x1, z1]
 */
export const area = (id, rect, options = {}) => ({
  id,
  label: options.label ?? id.replace(/_/g, ' '),
  rect: normalizeRect(rect),
  /** Callout position used by the UI/bots; defaults to the rect centre. */
  callout: options.callout ?? null,
  tags: options.tags ?? [],
});

/** Axis-aligned solid box. `at` is the centre of the footprint, `y` is its base. */
export const box = (id, { at, size, y = 0, kind = PropKind.COVER, color, rotationY = 0, collidable = true, blocksNav }) => ({
  id, shape: 'box', kind,
  position: { x: at[0], y: y + size[1] / 2, z: at[1] },
  size: { x: size[0], y: size[1], z: size[2] },
  baseY: y,
  rotationY,
  color,
  collidable,
  blocksNav: blocksNav ?? size[1] > 1.4,
});

/** Vertical cylinder (pillar, barrel). Collision uses its bounding box. */
export const cylinder = (id, { at, radius, height, y = 0, kind = PropKind.PILLAR, color, collidable = true, blocksNav }) => ({
  id, shape: 'cylinder', kind,
  position: { x: at[0], y: y + height / 2, z: at[1] },
  size: { x: radius * 2, y: height, z: radius * 2 },
  radius, height, baseY: y,
  color,
  collidable,
  blocksNav: blocksNav ?? height > 1.4,
});

/**
 * A staircase built from `steps` boxes, climbing `height` over `length`
 * along +X/-X/+Z/-Z. Steps stay under MovementConfig.stepHeight so any
 * character can walk up without jumping.
 */
export const stairs = (id, { at, width, length, height, steps = 4, direction = '+z', color }) => {
  const out = [];
  const stepLength = length / steps;
  const stepHeight = height / steps;
  for (let i = 0; i < steps; i++) {
    const offset = -length / 2 + stepLength * (i + 0.5);
    const sx = direction === '+x' ? offset : direction === '-x' ? -offset : 0;
    const sz = direction === '+z' ? offset : direction === '-z' ? -offset : 0;
    const along = direction.includes('x') ? [stepLength, width] : [width, stepLength];
    out.push(box(`${id}_${i}`, {
      at: [at[0] + sx, at[1] + sz],
      size: [along[0], stepHeight * (i + 1), along[1]],
      y: 0,
      kind: PropKind.STAIRS,
      color,
      blocksNav: false,
    }));
  }
  return out;
};

/** Spawn point. `yaw` in radians; PI faces north (+Z), 0 faces south (-Z). */
export const spawn = (at, yaw) => ({ position: { x: at[0], y: 0, z: at[1] }, yaw });

/** Bomb site definition; `rect` is the plantable footprint. */
export const bombSite = (id, rect, options = {}) => ({
  id,
  label: options.label ?? `Site ${id}`,
  rect: normalizeRect(rect),
  /** Where bots head to plant, defaults to the rect centre. */
  plantPoint: options.plantPoint ?? null,
  color: options.color ?? 0xd2a24c,
});

export function normalizeRect([x0, z0, x1, z1]) {
  return [Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)];
}

export const rectCenter = (rect) => ({ x: (rect[0] + rect[2]) / 2, y: 0, z: (rect[1] + rect[3]) / 2 });

export const rectToAABB = (rect, minY = 0, maxY = 8) => ({
  min: { x: rect[0], y: minY, z: rect[1] },
  max: { x: rect[2], y: maxY, z: rect[3] },
});

export const rectContains = (rect, p) => p.x >= rect[0] && p.x <= rect[2] && p.z >= rect[1] && p.z <= rect[3];
