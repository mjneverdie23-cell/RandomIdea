/**
 * Transient visual effects: tracers, impacts, muzzle flashes, explosions and
 * the bomb beacon. Everything is pooled and driven by game events, so no
 * gameplay system needs to know that a renderer exists.
 */
import * as THREE from 'three';
import { GameEvents } from '../core/events/GameEvents.js';
import { VisualsConfig } from '../config/visuals.config.js';

export class Effects {
  constructor({ scene, bus, game }) {
    this.scene = scene;
    this.bus = bus;
    this.game = game;
    this.config = VisualsConfig.effects;

    this.group = new THREE.Group();
    scene.add(this.group);

    /** @type {Array<{object: THREE.Object3D, life: number, maxLife: number, kind: string}>} */
    this.active = [];

    this._tracerGeometry = new THREE.BufferGeometry();
    this._impactGeometry = new THREE.SphereGeometry(0.07, 6, 5);
    this._bombBeacon = this._createBombBeacon();

    this._subscriptions = [
      bus.on(GameEvents.WEAPON_FIRED, (p) => this.onWeaponFired(p)),
      bus.on(GameEvents.WEAPON_HIT, (p) => this.onWeaponHit(p)),
      bus.on(GameEvents.GRENADE_EXPLODED, (p) => this.spawnExplosion(p.position, 8)),
      bus.on(GameEvents.BOMB_EXPLODED, (p) => this.spawnExplosion(p.position, 22)),
    ];
  }

  onWeaponFired({ character, weapon, origin, direction }) {
    // Tracer from the muzzle to wherever the shot ends up.
    const distance = weapon.def.range;
    const end = {
      x: origin.x + direction.x * distance,
      y: origin.y + direction.y * distance,
      z: origin.z + direction.z * distance,
    };
    this._lastMuzzle = { character, origin: { ...origin }, end };
    this.spawnMuzzleFlash(origin, character);
  }

  onWeaponHit({ point, target, isHeadshot }) {
    if (this._lastMuzzle) {
      this.spawnTracer(this._lastMuzzle.origin, point);
      this._lastMuzzle = null;
    }
    this.spawnImpact(point, target ? (isHeadshot ? 0xff5555 : this.config.bloodColor) : this.config.impactColor);
  }

  spawnTracer(from, to) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
      color: this.config.tracerColor, transparent: true, opacity: 0.85,
    }));
    this.group.add(line);
    this.active.push({ object: line, life: this.config.tracerLifetime, maxLife: this.config.tracerLifetime, kind: 'tracer' });
  }

  spawnImpact(point, color) {
    const mesh = new THREE.Mesh(this._impactGeometry, new THREE.MeshBasicMaterial({ color, transparent: true }));
    mesh.position.set(point.x, point.y, point.z);
    this.group.add(mesh);
    this.active.push({ object: mesh, life: this.config.impactLifetime, maxLife: this.config.impactLifetime, kind: 'impact' });
  }

  spawnMuzzleFlash(origin, character) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffd27f, transparent: true }),
    );
    mesh.position.set(origin.x, origin.y, origin.z);
    this.group.add(mesh);
    this.active.push({ object: mesh, life: this.config.muzzleFlashLifetime, maxLife: this.config.muzzleFlashLifetime, kind: 'flash' });
  }

  spawnExplosion(position, radius) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.35, 12, 10),
      new THREE.MeshBasicMaterial({ color: this.config.explosionColor, transparent: true, opacity: 0.8 }),
    );
    mesh.position.set(position.x, position.y + 1, position.z);
    mesh.userData.targetScale = 2.6;
    this.group.add(mesh);
    this.active.push({ object: mesh, life: this.config.explosionLifetime, maxLife: this.config.explosionLifetime, kind: 'explosion' });
  }

  _createBombBeacon() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.3, 0.35),
      new THREE.MeshLambertMaterial({ color: VisualsConfig.bomb.carriedColor }),
    );
    body.position.y = 0.15;
    group.add(body);
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff2222 }),
    );
    light.position.y = 0.45;
    group.add(light);
    group.visible = false;
    this.scene.add(group);
    return { group, light };
  }

  /** Grenades in flight get a simple sphere each frame. */
  _syncProjectiles() {
    if (!this._projectilePool) {
      this._projectilePool = [];
    }
    const projectiles = this.game.world.projectiles;
    while (this._projectilePool.length < projectiles.length) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 8, 6),
        new THREE.MeshLambertMaterial({ color: 0x4a6b3a }),
      );
      this.group.add(mesh);
      this._projectilePool.push(mesh);
    }
    this._projectilePool.forEach((mesh, index) => {
      const projectile = projectiles[index];
      mesh.visible = !!projectile;
      if (projectile) mesh.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
    });
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const entry = this.active[i];
      entry.life -= dt;
      const t = Math.max(0, entry.life / entry.maxLife);
      if (entry.object.material) {
        entry.object.material.transparent = true;
        entry.object.material.opacity = t;
      }
      if (entry.kind === 'explosion') {
        const scale = 1 + (1 - t) * (entry.object.userData.targetScale ?? 2);
        entry.object.scale.setScalar(scale);
      }
      if (entry.life <= 0) {
        this.group.remove(entry.object);
        entry.object.geometry?.dispose?.();
        entry.object.material?.dispose?.();
        this.active.splice(i, 1);
      }
    }

    this._syncProjectiles();
    this._updateBombBeacon(dt);
  }

  _updateBombBeacon(dt) {
    const bomb = this.game.bomb;
    const { group, light } = this._bombBeacon;
    const visible = bomb.state === 'DROPPED' || bomb.state === 'PLANTED';
    group.visible = visible;
    if (!visible) return;
    group.position.set(bomb.position.x, bomb.position.y, bomb.position.z);
    const planted = bomb.state === 'PLANTED';
    // Blink faster as the fuse runs down.
    const speed = planted ? 2 + (1 - bomb.fuseRemaining / bomb.config.fuseDuration) * 12 : 2;
    const pulse = (Math.sin(performance.now() / 1000 * speed * Math.PI) + 1) / 2;
    light.material.color.setHex(planted ? VisualsConfig.bomb.plantedColor : VisualsConfig.bomb.carriedColor);
    light.scale.setScalar(0.7 + pulse * 0.8);
  }

  dispose() {
    for (const off of this._subscriptions) off();
    this.scene.remove(this.group);
    this.scene.remove(this._bombBeacon.group);
  }
}
