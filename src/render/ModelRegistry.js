/**
 * ===========================================================================
 *  THE MODEL SWAP POINT
 * ===========================================================================
 * Everything visual about a character is created here and nowhere else.
 * Gameplay code never touches a mesh, so replacing the capsule placeholders
 * with real animated dinosaurs is a change to THIS FILE only.
 *
 * A model factory receives { character, classDef, teamColor, THREE } and must
 * return an object implementing the CharacterModel interface:
 *
 *   {
 *     object3D: THREE.Object3D,             // added to the scene, origin at feet
 *     setPose?({ yaw, pitch, speed, crouching, airborne, aiming }),
 *     playAnimation?(name, options),        // 'idle' | 'run' | 'jump' | 'fire' | 'death'
 *     setVisible?(visible),
 *     setTeamColor?(color),
 *     dispose?(),
 *   }
 *
 * To use a GLTF dinosaur instead of a capsule:
 *
 *   import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
 *   const loader = new GLTFLoader();
 *   registerModel('dino_raptor', async ({ character, THREE }) => {
 *     const gltf = await loader.loadAsync('assets/models/raptor.glb');
 *     const mixer = new THREE.AnimationMixer(gltf.scene);
 *     const clips = Object.fromEntries(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));
 *     gltf.scene.scale.setScalar(character.classDef.visual.scale);
 *     return {
 *       object3D: gltf.scene,
 *       playAnimation: (name) => clips[name]?.reset().play(),
 *       setPose: ({ yaw }) => { gltf.scene.rotation.y = yaw; },
 *       update: (dt) => mixer.update(dt),
 *     };
 *   });
 *
 * The `modelKey` comes from classes.config.js -> visual.modelKey.
 */
import * as THREE from 'three';
import { VisualsConfig } from '../config/visuals.config.js';

/** @type {Map<string, Function>} */
const registry = new Map();

export function registerModel(modelKey, factory) {
  registry.set(modelKey, factory);
}

export function hasModel(modelKey) { return registry.has(modelKey); }

/**
 * Builds the visual for a character, falling back to the capsule placeholder.
 * @returns {object} CharacterModel
 */
export function createCharacterModel({ character, teamColor }) {
  const key = character.visual?.modelKey;
  const factory = registry.get(key) ?? createPlaceholderCapsule;
  return factory({ character, classDef: character.classDef, teamColor, THREE });
}

/**
 * PLACEHOLDER: a capsule with a head marker and a snout showing facing.
 * Proportions come from the class hitbox so the visual matches what bullets hit.
 */
export function createPlaceholderCapsule({ character, teamColor }) {
  const group = new THREE.Group();
  const radius = character.radius;
  const height = character.standingHeight;
  const bodyLength = Math.max(0.1, height - radius * 2);

  const bodyMaterial = new THREE.MeshLambertMaterial({ color: character.visual.color ?? 0x999999 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(radius, bodyLength, 6, 12), bodyMaterial);
  body.position.y = height / 2;
  group.add(body);

  // Team band around the middle - instantly readable at a distance.
  const bandMaterial = new THREE.MeshLambertMaterial({ color: teamColor });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.06, radius * 1.06, 0.24, 12, 1, true), bandMaterial);
  band.position.y = height * 0.55;
  group.add(band);

  // Head marker: shows where the headshot hitbox actually is.
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(radius * VisualsConfig.placeholder.headMarkerRadiusScale, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xf2e2c4 }),
  );
  head.position.y = height * 0.92;
  group.add(head);

  // Snout: a facing indicator, and a stand-in for a dinosaur head.
  if (VisualsConfig.placeholder.showFacingSpike) {
    const snout = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 0.3, VisualsConfig.placeholder.snoutLength, 8),
      new THREE.MeshLambertMaterial({ color: 0xf2e2c4 }),
    );
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, height * 0.92, -radius - VisualsConfig.placeholder.snoutLength * 0.4);
    group.add(snout);
  }

  const scale = character.visual.scale ?? 1;
  group.scale.set(scale, 1, scale); // keep height exact: it is the hitbox

  return {
    object3D: group,
    _body: body,
    _band: band,
    setPose({ yaw, crouching }) {
      group.rotation.y = yaw;
      // Crouch squashes the placeholder rather than animating it.
      const targetScaleY = crouching ? 0.62 : 1;
      group.scale.y += (targetScaleY - group.scale.y) * 0.35;
    },
    playAnimation(name) {
      // PLACEHOLDER: capsules have no animation. Death tips the capsule over.
      if (name === 'death') group.rotation.z = Math.PI / 2.2;
      if (name === 'idle') group.rotation.z = 0;
    },
    setVisible(visible) { group.visible = visible; },
    setOpacity(opacity) {
      for (const material of [bodyMaterial, bandMaterial]) {
        material.transparent = opacity < 1;
        material.opacity = opacity;
      }
    },
    setTeamColor(color) { bandMaterial.color.setHex(color); },
    dispose() {
      group.traverse((child) => {
        child.geometry?.dispose();
        child.material?.dispose();
      });
    },
  };
}

/**
 * PLACEHOLDER weapon models. Same idea as characters: swap the factory, keep
 * the gameplay. `weaponDef.visual.modelKey` selects the factory.
 */
const weaponRegistry = new Map();

export function registerWeaponModel(modelKey, factory) { weaponRegistry.set(modelKey, factory); }

export function createWeaponModel(weaponDef) {
  const factory = weaponRegistry.get(weaponDef.visual?.modelKey) ?? createPlaceholderWeapon;
  return factory({ weaponDef, THREE });
}

export function createPlaceholderWeapon({ weaponDef }) {
  const group = new THREE.Group();
  const color = weaponDef.visual?.color ?? 0x888888;
  const material = new THREE.MeshLambertMaterial({ color });

  // Length scales with range so different guns read differently in hand.
  const length = Math.min(1.3, 0.45 + weaponDef.range / 220);
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, length), material);
  receiver.position.z = -length / 2;
  group.add(receiver);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.09), material);
  grip.position.set(0, -0.14, -0.12);
  group.add(grip);

  if (weaponDef.adsZoom >= 2) {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 8), material);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.11, -length * 0.45);
    group.add(scope);
  }

  return { object3D: group, dispose: () => { material.dispose(); } };
}
