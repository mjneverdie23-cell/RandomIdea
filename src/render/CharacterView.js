/**
 * The visual half of a character.
 *
 * A view owns a CharacterModel (from ModelRegistry) plus a name/health tag and
 * mirrors simulation state onto it every frame. It reads the character but
 * never writes to it - all state lives in the simulation.
 */
import * as THREE from 'three';
import { createCharacterModel } from './ModelRegistry.js';

export class CharacterView {
  constructor({ character, scene, teamColor, isLocalPlayer = false, isAlly = false }) {
    this.character = character;
    this.scene = scene;
    this.isLocalPlayer = isLocalPlayer;
    this.isAlly = isAlly;
    this.teamColor = teamColor;

    this.model = createCharacterModel({ character, teamColor });
    this.root = new THREE.Group();
    this.root.add(this.model.object3D);
    scene.add(this.root);

    this.tag = this._createTag();
    this.root.add(this.tag.sprite);

    this._wasAlive = true;
    this._lastTagKey = '';
  }

  /** Canvas-based name + health tag. Cheap, and easy to delete later. */
  _createTag() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.2, 0.55, 1);
    sprite.position.y = this.character.standingHeight + 0.5;
    sprite.renderOrder = 10;
    return { canvas, context: canvas.getContext('2d'), texture, sprite, material };
  }

  _drawTag() {
    const { context, canvas, texture } = this.tag;
    const character = this.character;
    const key = `${character.name}|${Math.ceil(character.health.health)}|${character.health.armor > 0}|${this.isAlly}`;
    if (key === this._lastTagKey) return;
    this._lastTagKey = key;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = 'bold 26px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillStyle = this.isAlly ? '#7fe6a0' : '#ff8a8a';
    context.fillText(character.name, canvas.width / 2, 26);

    // Health bar
    const barWidth = 180;
    const x = (canvas.width - barWidth) / 2;
    context.fillStyle = 'rgba(0,0,0,0.55)';
    context.fillRect(x, 36, barWidth, 14);
    const fraction = Math.max(0, character.health.health / character.health.maxHealth);
    context.fillStyle = this.isAlly ? '#4cd07a' : '#e05555';
    context.fillRect(x, 36, barWidth * fraction, 14);
    if (character.health.armor > 0) {
      context.fillStyle = '#7bb6ff';
      context.fillRect(x, 50, barWidth * (character.health.armor / character.health.maxArmor), 4);
    }
    texture.needsUpdate = true;
  }

  /**
   * @param {number} dt
   * @param {object} options { showTag, cameraPosition }
   */
  update(dt, { showTag = true, localTeamId = null } = {}) {
    const character = this.character;
    const alive = character.health.alive;

    this.root.position.set(character.position.x, character.position.y, character.position.z);

    this.model.setPose?.({
      yaw: character.yaw,
      pitch: character.pitch,
      speed: character.movement.horizontalSpeed,
      crouching: character.movement.crouching,
      airborne: !character.movement.onGround,
      aiming: character.intent.aim,
    });
    this.model.update?.(dt);

    if (alive !== this._wasAlive) {
      this.model.playAnimation?.(alive ? 'idle' : 'death');
      this._wasAlive = alive;
    }

    // The local player's own body is hidden in first person.
    const visible = alive && !this.isLocalPlayer;
    this.model.setVisible?.(visible || (!alive && !this.isLocalPlayer));
    this.root.visible = !this.isLocalPlayer;

    // Camouflaged enemies fade out; teammates always stay visible to allies.
    const invisible = character.isInvisible;
    const isAllyOfViewer = localTeamId != null && character.teamId === localTeamId;
    this.model.setOpacity?.(invisible ? (isAllyOfViewer ? 0.45 : 0.06) : 1);

    this.tag.sprite.visible = showTag && alive && !this.isLocalPlayer && !(invisible && !isAllyOfViewer);
    if (this.tag.sprite.visible) this._drawTag();
  }

  setAlly(isAlly) {
    if (this.isAlly === isAlly) return;
    this.isAlly = isAlly;
    this._lastTagKey = '';
  }

  dispose() {
    this.scene.remove(this.root);
    this.model.dispose?.();
    this.tag.material.dispose();
    this.tag.texture.dispose();
  }
}
