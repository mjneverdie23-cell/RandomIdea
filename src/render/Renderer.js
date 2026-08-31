/**
 * The renderer: scene setup, camera control and per-frame syncing of views.
 *
 * It is a *consumer* of the simulation. Deleting this whole folder would leave
 * a fully working headless game - which is exactly why swapping in another
 * engine later is cheap.
 */
import * as THREE from 'three';
import { MapView } from './MapView.js';
import { CharacterView } from './CharacterView.js';
import { Effects } from './Effects.js';
import { ViewModel } from './ViewModel.js';
import { VisualsConfig } from '../config/visuals.config.js';
import { GameEvents } from '../core/events/GameEvents.js';

export const CameraMode = Object.freeze({
  FIRST_PERSON: 'FIRST_PERSON',
  SPECTATE: 'SPECTATE',
  FREE: 'FREE',
});

export class Renderer {
  constructor({ canvas, game }) {
    this.game = game;
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    const source = game.world.map.source;
    this.scene.background = new THREE.Color(source.skyColor ?? 0x8fb2d4);
    this.scene.fog = new THREE.FogExp2(source.skyColor ?? 0x8fb2d4, source.fogDensity ?? 0.006);

    const cameraConfig = VisualsConfig.camera;
    this.baseFov = cameraConfig.fov;
    this.camera = new THREE.PerspectiveCamera(cameraConfig.fov, 1, cameraConfig.near, cameraConfig.far);
    this.scene.add(this.camera);

    this._setupLights();
    this.mapView = new MapView({ map: game.world.map, scene: this.scene });
    this.effects = new Effects({ scene: this.scene, bus: game.bus, game });
    this.viewModel = new ViewModel({ camera: this.camera });

    /** @type {Map<import('../core/entities/Character.js').Character, CharacterView>} */
    this.characterViews = new Map();
    this.cameraMode = CameraMode.FIRST_PERSON;
    this.spectateTarget = null;
    this.freeCamPosition = new THREE.Vector3(0, 60, -40);

    game.bus.on(GameEvents.WEAPON_FIRED, ({ character }) => {
      if (character === game.localPlayer) this.viewModel.addKick(1);
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _setupLights() {
    const config = VisualsConfig.lighting;
    this.scene.add(new THREE.AmbientLight(config.ambient, config.ambientIntensity));
    const sun = new THREE.DirectionalLight(config.sun, config.sunIntensity);
    sun.position.set(config.sunPosition.x, config.sunPosition.y, config.sunPosition.z);
    sun.castShadow = config.shadows;
    this.scene.add(sun);
    // A dim fill from below keeps the undersides of props readable.
    const fill = new THREE.HemisphereLight(0xbfd4e8, 0x6b5f4a, 0.45);
    this.scene.add(fill);
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Creates/destroys character views to match the simulation roster. */
  _syncCharacterViews() {
    const localTeamId = this.game.localPlayer?.teamId ?? null;
    for (const character of this.game.world.characters) {
      if (!this.characterViews.has(character)) {
        this.characterViews.set(character, new CharacterView({
          character,
          scene: this.scene,
          teamColor: VisualsConfig.teamColors[character.teamId] ?? 0xffffff,
          isLocalPlayer: character === this.game.localPlayer,
          isAlly: character.teamId === localTeamId,
        }));
      }
    }
    for (const [character, view] of this.characterViews) {
      if (!this.game.world.characters.includes(character)) {
        view.dispose();
        this.characterViews.delete(character);
      } else {
        view.setAlly(character.teamId === localTeamId);
      }
    }
  }

  update(dt) {
    this._syncCharacterViews();
    const localTeamId = this.game.localPlayer?.teamId ?? null;
    for (const view of this.characterViews.values()) {
      view.update(dt, { showTag: true, localTeamId });
    }
    this._updateCamera(dt);
    this.viewModel.update(dt, this.game.localPlayer);
    this.effects.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _updateCamera(dt) {
    const player = this.game.localPlayer;

    if (this.cameraMode === CameraMode.FREE || !player) {
      const bounds = this.game.world.map.bounds;
      this.camera.position.copy(this.freeCamPosition);
      this.camera.lookAt((bounds.min.x + bounds.max.x) / 2, 0, (bounds.min.z + bounds.max.z) / 2);
      return;
    }

    if (player.health.alive) {
      const eye = player.eyePosition;
      this.camera.position.set(eye.x, eye.y, eye.z);
      this.camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');

      const weapon = player.inventory.activeWeapon;
      const aiming = player.intent.aim && weapon && weapon.def.adsZoom > 1;
      const targetFov = aiming
        ? this.baseFov / weapon.def.adsZoom
        : this.baseFov + (player.intent.sprint && player.movement.horizontalSpeed > 4 ? VisualsConfig.camera.sprintFovBonus : 0);
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
      this.camera.updateProjectionMatrix();
      return;
    }

    // Dead: orbit-follow a living teammate, otherwise hover over the corpse.
    if (!this.spectateTarget || !this.spectateTarget.health.alive) {
      this.spectateTarget = this.game.world.characters.find(
        (c) => c.teamId === player.teamId && c.health.alive,
      ) ?? null;
    }
    const config = VisualsConfig.camera;
    const focus = this.spectateTarget ?? player;
    const behind = {
      x: focus.position.x + Math.sin(focus.yaw) * config.spectatorDistance,
      y: focus.position.y + config.spectatorHeight,
      z: focus.position.z + Math.cos(focus.yaw) * config.spectatorDistance,
    };
    this.camera.position.lerp(new THREE.Vector3(behind.x, behind.y, behind.z), Math.min(1, dt * 4));
    this.camera.lookAt(focus.position.x, focus.position.y + 1.2, focus.position.z);
    if (Math.abs(this.camera.fov - this.baseFov) > 0.01) {
      this.camera.fov += (this.baseFov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }
  }

  toggleFreeCam() {
    this.cameraMode = this.cameraMode === CameraMode.FREE ? CameraMode.FIRST_PERSON : CameraMode.FREE;
    if (this.cameraMode === CameraMode.FREE) {
      const bounds = this.game.world.map.bounds;
      const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
      this.freeCamPosition.set(
        (bounds.min.x + bounds.max.x) / 2,
        span * 1.15,
        (bounds.min.z + bounds.max.z) / 2 + 0.001,
      );
    }
    return this.cameraMode;
  }

  dispose() {
    for (const view of this.characterViews.values()) view.dispose();
    this.characterViews.clear();
    this.effects.dispose();
    this.mapView.dispose();
    this.renderer.dispose();
  }
}
