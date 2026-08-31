/**
 * The single input contract of the simulation.
 *
 * A human (BrowserInput) and a bot (BotBrain) both do exactly one thing: fill
 * in an Intent. Nothing downstream can tell them apart, which is why bots can
 * use every mechanic a player can - and why replays/net code could be added
 * later by simply recording this struct.
 */
export function createIntent() {
  return {
    // Movement, in the character's local frame: +1 forward, +1 right.
    moveForward: 0,
    moveRight: 0,
    jump: false,
    crouch: false,
    sprint: false,

    // Look direction, absolute in radians (yaw around Y, pitch up/down).
    yaw: 0,
    pitch: 0,

    // Actions
    fire: false,
    aim: false,
    reload: false,
    use: false,        // plant / defuse / pick up bomb
    drop: false,
    throwGrenade: false,
    /** WeaponSlot value to switch to, or null. Consumed once applied. */
    switchToSlot: null,
    /** Ability index (0 = primary, 1 = secondary) or null. Consumed once used. */
    useAbility: null,
  };
}

export function resetIntent(intent) {
  intent.moveForward = 0;
  intent.moveRight = 0;
  intent.jump = false;
  intent.crouch = false;
  intent.sprint = false;
  intent.fire = false;
  intent.aim = false;
  intent.reload = false;
  intent.use = false;
  intent.drop = false;
  intent.throwGrenade = false;
  intent.switchToSlot = null;
  intent.useAbility = null;
  return intent;
}
