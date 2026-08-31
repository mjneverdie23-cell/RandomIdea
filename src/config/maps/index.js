/**
 * Map registry.
 *
 * TO ADD A MAP: create `my_map.map.js` next to this file (copy dust_proto as a
 * starting point), import it here and add it to MAPS. Select it at runtime with
 * `new GameManager({ mapId: 'my_map' })` or the ?map= URL parameter.
 */
import DustProtoMap from './dust_proto.map.js';

export const MAPS = Object.freeze({
  [DustProtoMap.id]: DustProtoMap,
});

export const DEFAULT_MAP_ID = DustProtoMap.id;

export function getMap(mapId = DEFAULT_MAP_ID) {
  return MAPS[mapId] ?? MAPS[DEFAULT_MAP_ID];
}

export function listMaps() {
  return Object.values(MAPS).map((map) => ({ id: map.id, displayName: map.displayName }));
}
