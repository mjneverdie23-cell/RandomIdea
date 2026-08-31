/**
 * Keyboard/mouse bindings and look sensitivity.
 * Keys use KeyboardEvent.code values so they are layout-independent.
 */
export const InputConfig = {
  bindings: {
    moveForward: ['KeyW', 'ArrowUp'],
    moveBackward: ['KeyS', 'ArrowDown'],
    moveLeft: ['KeyA', 'ArrowLeft'],
    moveRight: ['KeyD', 'ArrowRight'],
    jump: ['Space'],
    crouch: ['ControlLeft', 'KeyC'],
    sprint: ['ShiftLeft'],
    reload: ['KeyR'],
    use: ['KeyE'],            // plant / defuse / pick up the bomb
    drop: ['KeyG'],
    abilityPrimary: ['KeyQ'],
    abilitySecondary: ['KeyF'],
    grenade: ['KeyV'],
    shop: ['KeyB'],
    scoreboard: ['Tab'],
    slotPrimary: ['Digit1'],
    slotSecondary: ['Digit2'],
    slotMelee: ['Digit3'],
    slotGrenade: ['Digit4'],
    toggleFreeCam: ['KeyP'],
  },
  mouse: {
    sensitivity: 0.0022,
    adsSensitivityMultiplier: 0.6,
    invertY: false,
    fireButton: 0,
    aimButton: 2,
  },
  /** Max look-up/look-down angle in radians. */
  pitchLimit: Math.PI / 2 - 0.05,
};
