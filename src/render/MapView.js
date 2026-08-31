/**
 * Builds the map's meshes from compiled map data.
 *
 * Every solid becomes a box or cylinder mesh; every walkable area gets a floor
 * quad; bomb sites get a translucent marker volume. Replacing the primitives
 * with real art means changing `createSolidMesh` (or registering a prop model
 * factory) - the layout data stays exactly the same.
 */
import * as THREE from 'three';
import { PropKind } from '../core/world/MapData.js';

/** Optional per-prop model factories, keyed by prop id or prop kind. */
const propModelRegistry = new Map();
export function registerPropModel(key, factory) { propModelRegistry.set(key, factory); }

export class MapView {
  constructor({ map, scene }) {
    this.map = map;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'map';
    scene.add(this.group);

    this._materials = new Map();
    this._buildFloors();
    this._buildSolids();
    this._buildBombSites();
    this._buildSpawnMarkers();
  }

  _material(color, options = {}) {
    const key = `${color}_${JSON.stringify(options)}`;
    if (!this._materials.has(key)) {
      this._materials.set(key, new THREE.MeshLambertMaterial({ color, ...options }));
    }
    return this._materials.get(key);
  }

  _buildFloors() {
    const source = this.map.source;
    const floorMaterial = this._material(source.floorColor ?? 0xc2b280);
    for (const area of this.map.areas) {
      const [x0, z0, x1, z1] = area.rect;
      const geometry = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      const mesh = new THREE.Mesh(geometry, floorMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2);
      mesh.receiveShadow = true;
      mesh.name = `floor_${area.id}`;
      this.group.add(mesh);
    }
    // A dark ground plane under everything so gaps never show the void.
    const bounds = this.map.bounds;
    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(bounds.max.x - bounds.min.x + 40, bounds.max.z - bounds.min.z + 40),
      this._material(0x6d6350),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.set((bounds.min.x + bounds.max.x) / 2, -0.05, (bounds.min.z + bounds.max.z) / 2);
    this.group.add(base);
  }

  _buildSolids() {
    for (const solid of this.map.solids) {
      const custom = propModelRegistry.get(solid.id) ?? propModelRegistry.get(solid.kind);
      const mesh = custom ? custom({ solid, THREE }) : this.createSolidMesh(solid);
      if (!mesh) continue;
      mesh.position.set(solid.position.x, solid.position.y, solid.position.z);
      if (solid.rotationY) mesh.rotation.y = solid.rotationY;
      mesh.name = solid.id;
      this.group.add(mesh);
    }
  }

  /** PLACEHOLDER geometry: boxes and cylinders. Swap for real art here. */
  createSolidMesh(solid) {
    const color = solid.color ?? 0x9a8b74;
    const material = this._material(color);
    if (solid.shape === 'cylinder') {
      return new THREE.Mesh(new THREE.CylinderGeometry(solid.radius, solid.radius, solid.height, 12), material);
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(solid.size.x, solid.size.y, solid.size.z), material);
    mesh.castShadow = solid.kind !== PropKind.WALL;
    mesh.receiveShadow = true;
    return mesh;
  }

  _buildBombSites() {
    this.siteMarkers = [];
    for (const site of this.map.bombSites) {
      const [x0, z0, x1, z1] = site.rect;
      const material = new THREE.MeshBasicMaterial({
        color: site.color, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
      });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), material);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set((x0 + x1) / 2, 0.06, (z0 + z1) / 2);
      this.group.add(floor);

      // A big letter so the site is identifiable from anywhere on it.
      const label = makeTextSprite(site.id, site.color);
      label.position.set((x0 + x1) / 2, 4.5, (z0 + z1) / 2);
      label.scale.set(6, 6, 1);
      this.group.add(label);
      this.siteMarkers.push({ site, floor, label });
    }
  }

  _buildSpawnMarkers() {
    for (const [side, points] of Object.entries(this.map.spawns)) {
      const color = side === 'ATTACKERS' ? 0xe0a54a : 0x59a5e0;
      const material = this._material(color, { transparent: true, opacity: 0.35 });
      for (const point of points) {
        const marker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 16), material);
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(point.position.x, 0.04, point.position.z);
        this.group.add(marker);
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((child) => child.geometry?.dispose());
    for (const material of this._materials.values()) material.dispose();
  }
}

export function makeTextSprite(text, color = 0xffffff, { fontSize = 160, alpha = 0.55 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.font = `bold ${fontSize}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  context.globalAlpha = alpha;
  context.fillText(text, 128, 138);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  return new THREE.Sprite(material);
}
