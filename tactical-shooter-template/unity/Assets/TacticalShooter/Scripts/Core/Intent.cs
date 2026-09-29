namespace TacticalShooter.Core
{
    /// <summary>
    /// The one input contract. The player controller builds it from keys and the mouse, the bot
    /// brain builds it from decisions; the character only ever reads an Intent, so every mechanic
    /// a player can use, a bot can use too. It is also the natural message to send to a server
    /// if the template is networked later.
    /// </summary>
    public struct Intent
    {
        /// <summary>-1..1 each, relative to the view yaw.</summary>
        public float moveForward, moveRight;
        /// <summary>Absolute desired view angles in degrees (pitch up is positive).</summary>
        public float yaw, pitch;
        public bool jump, crouch, walk, fire, aim, reload, interact, drop;
        /// <summary>-1 none, otherwise a WeaponSlot index.</summary>
        public int selectSlot;
        /// <summary>-1 none, otherwise ability slot 0..3 (C, Q, E, X).</summary>
        public int useAbility;

        public static Intent Idle(float yaw, float pitch) =>
            new Intent { yaw = yaw, pitch = pitch, selectSlot = -1, useAbility = -1 };
    }
}
