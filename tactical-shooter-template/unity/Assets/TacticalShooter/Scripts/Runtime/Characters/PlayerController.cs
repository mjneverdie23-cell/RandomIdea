using TacticalShooter.Core;
using UnityEngine;

namespace TacticalShooter
{
    /// <summary>
    /// Turns the keyboard and mouse into an Intent for the local character, and decides what
    /// the camera looks at (own eyes, a teammate while dead, or an overview).
    /// </summary>
    public sealed class PlayerController
    {
        readonly MatchController match;
        public float Yaw, Pitch;
        public TacticalCharacter ViewTarget { get; private set; }
        float deathTime = -99f;
        float jumpBufferedUntil = -1f;

        public PlayerController(MatchController match) { this.match = match; }

        public void OnSpawn(TacticalCharacter c)
        {
            Yaw = c.Yaw;
            Pitch = 0f;
            deathTime = -99f;
            SetView(c);
        }

        public void OnLocalDeath() => deathTime = match.Time;

        public Intent BuildIntent(TacticalCharacter c)
        {
            var s = Game.Settings;
            bool input = Game.UI == null || Game.UI.GameplayInputAllowed;
            if (input)
            {
                Vector2 d = InputReader.MouseDelta();
                var w = c.Weapons.CurrentDef;
                float scale = s.mouseSensitivity * InputReader.MouseCountsToDegrees;
                if (c.Weapons.IsAiming && w != null) scale *= s.adsSensitivityMultiplier * w.adsFovMultiplier;
                Yaw = Mathf.Repeat(Yaw + d.x * scale, 360f);
                Pitch = Mathf.Clamp(Pitch + d.y * scale * (s.invertY ? -1f : 1f), -89f, 89f);
            }
            var i = Intent.Idle(Yaw, Pitch);
            if (!input) return i;

            i.moveForward = (InputReader.ActionDown("MoveForward") ? 1f : 0f) - (InputReader.ActionDown("MoveBack") ? 1f : 0f);
            i.moveRight = (InputReader.ActionDown("MoveRight") ? 1f : 0f) - (InputReader.ActionDown("MoveLeft") ? 1f : 0f);
            if (InputReader.ActionPressed("Jump")) jumpBufferedUntil = match.Time + 0.12f;
            i.jump = match.Time <= jumpBufferedUntil;
            if (i.jump && c.Grounded) jumpBufferedUntil = -1f;
            i.crouch = InputReader.ActionDown("Crouch");
            i.walk = InputReader.ActionDown("Walk");
            i.fire = InputReader.ActionDown("Fire");
            i.aim = InputReader.ActionDown("Aim");
            i.reload = InputReader.ActionPressed("Reload");
            i.interact = InputReader.ActionDown("Interact");
            i.drop = InputReader.ActionPressed("Drop");
            if (InputReader.ActionPressed("Primary")) i.selectSlot = 0;
            else if (InputReader.ActionPressed("Secondary")) i.selectSlot = 1;
            else if (InputReader.ActionPressed("Melee")) i.selectSlot = 2;
            else
            {
                float scroll = InputReader.Scroll();
                if (Mathf.Abs(scroll) > 0.01f) i.selectSlot = NextSlot(c, scroll < 0f ? 1 : -1);
            }
            if (InputReader.ActionPressed("Ability1")) i.useAbility = 0;
            else if (InputReader.ActionPressed("Ability2")) i.useAbility = 1;
            else if (InputReader.ActionPressed("Ability3")) i.useAbility = 2;
            else if (InputReader.ActionPressed("Ultimate")) i.useAbility = 3;
            return i;
        }

        static int NextSlot(TacticalCharacter c, int step)
        {
            int s = c.Weapons.CurrentSlot;
            for (int k = 0; k < 3; k++)
            {
                s = (s + step + 3) % 3;
                if (c.Weapons.Slots[s] != null) return s;
            }
            return -1;
        }

        /// <summary>Called every frame (also while paused).</summary>
        public void UpdateCamera()
        {
            var local = match.LocalCharacter;
            if (local != null && local.Alive)
            {
                SetView(local);
                return;
            }
            if (match.Time - deathTime < 1.5f && ViewTarget == local) return; // brief pause on death
            var target = ViewTarget;
            bool next = Game.UI != null && Game.UI.GameplayInputAllowed && InputReader.ActionPressed("Fire");
            if (target == null || !target.Alive || target == local || next) target = NextTeammate(target);
            if (target == null)
            {
                ViewTarget = null;
                Game.Camera.Overview();
            }
            else SetView(target);
        }

        TacticalCharacter NextTeammate(TacticalCharacter after)
        {
            var local = match.Local;
            if (local == null) return null;
            TacticalCharacter first = null;
            bool passed = after == null;
            foreach (var p in match.Players)
            {
                var c = match.Character(p.id);
                if (c == null || !c.Alive || p.team != local.team || p.isLocal) continue;
                if (first == null) first = c;
                if (passed) return c;
                if (c == after) passed = true;
            }
            return first;
        }

        void SetView(TacticalCharacter c)
        {
            if (ViewTarget == c && Game.Camera.IsFollowing(c)) return;
            ViewTarget = c;
            Game.Camera.Follow(c);
        }
    }
}
