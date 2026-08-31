/**
 * First-person weapon view model: the gun you see in your own hands.
 *
 * Purely cosmetic - recoil kick, sway, ADS offset and a reload tilt are all
 * driven from weapon state that the simulation already tracks.
 */
import * as THREE from 'three';
import { createWeaponModel } from './ModelRegistry.js';

const HIP_POSITION = new THREE.Vector3(0.22, -0.2, -0.42);
const ADS_POSITION = new THREE.Vector3(0, -0.12, -0.32);

export class ViewModel {
  constructor({ camera }) {
    this.camera = camera;
    this.root = new THREE.Group();
    camera.add(this.root);

    this.currentWeaponId = null;
    this.model = null;

    this.kick = 0;
    this.sway = new THREE.Vector2();
    this._adsBlend = 0;
  }

  setWeapon(weaponDef) {
    if (weaponDef?.id === this.currentWeaponId) return;
    if (this.model) {
      this.root.remove(this.model.object3D);
      this.model.dispose?.();
      this.model = null;
    }
    this.currentWeaponId = weaponDef?.id ?? null;
    if (!weaponDef) return;
    this.model = createWeaponModel(weaponDef);
    this.root.add(this.model.object3D);
  }

  /** Called when the owner fires, to punch the model backwards. */
  addKick(amount = 1) { this.kick = Math.min(1.4, this.kick + amount * 0.35); }

  update(dt, character) {
    if (!character) { this.root.visible = false; return; }
    const weapon = character.inventory.activeWeapon;
    this.setWeapon(weapon?.def ?? null);
    this.root.visible = !!weapon && character.health.alive;
    if (!this.model) return;

    const aiming = character.intent.aim && !!weapon && weapon.def.adsZoom > 1;
    this._adsBlend += ((aiming ? 1 : 0) - this._adsBlend) * Math.min(1, dt / Math.max(0.01, weapon.def.adsTime));

    const target = new THREE.Vector3().lerpVectors(HIP_POSITION, ADS_POSITION, this._adsBlend);

    // Weapon sway follows movement; bobbing sells the walk without animation.
    const speed = character.movement.horizontalSpeed;
    const bob = Math.sin(performance.now() / 1000 * 9) * 0.012 * Math.min(1, speed / 5) * (1 - this._adsBlend);
    this.kick = Math.max(0, this.kick - dt * 6);

    this.root.position.set(
      target.x,
      target.y + bob,
      target.z + this.kick * 0.09,
    );
    this.root.rotation.set(
      -this.kick * 0.25 + (weapon?.reloading ? Math.sin(performance.now() / 200) * 0.25 - 0.35 : 0),
      this._adsBlend * 0.02,
      weapon?.reloading ? 0.4 : 0,
    );
  }
}
