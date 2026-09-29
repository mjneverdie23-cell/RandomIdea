using TacticalShooter.Core;
using UnityEngine;

namespace TacticalShooter
{
    /// <summary>A weapon in someone's hands (or on the floor): definition plus ammo.</summary>
    public sealed class WeaponInstance
    {
        public readonly WeaponDef def;
        public int mag;
        public int reserve;

        public WeaponInstance(WeaponDef def)
        {
            this.def = def;
            mag = def.magazineSize;
            reserve = def.reserveAmmo;
        }
    }

    /// <summary>
    /// Inventory (primary, secondary, melee), switching, reloading, firing, spread and recoil
    /// (GAME_RULES.md section 5). Hit resolution is done by Combat so bots and players share it.
    /// </summary>
    public sealed class WeaponHandler
    {
        readonly TacticalCharacter owner;
        public readonly WeaponInstance[] Slots = new WeaponInstance[3];
        public int CurrentSlot { get; private set; } = (int)WeaponSlot.Secondary;
        public WeaponInstance Current => Slots[CurrentSlot];
        public WeaponDef CurrentDef => Current?.def;
        public float EquipTimeLeft { get; private set; }
        public float ReloadTimeLeft { get; private set; }
        public bool IsReloading => ReloadTimeLeft > 0f;
        public bool IsAiming { get; private set; }
        public float AimTime { get; private set; }
        public int ShotIndex { get; private set; }
        public int ShotsFired { get; private set; }
        public float CurrentSpread { get; private set; }
        public float LastShotTime { get; private set; } = -99f;
        public bool Ready => EquipTimeLeft <= 0f && !IsReloading && cooldown <= 0f;

        /// <summary>Raised after every shot or swing (camera kick, UI).</summary>
        public event System.Action Fired;

        float cooldown;
        bool triggerHeld;

        public WeaponHandler(TacticalCharacter owner) { this.owner = owner; }

        public void SetLoadout(Loadout lo)
        {
            var d = Game.Data;
            var primary = d.Weapon(lo.primaryId);
            Slots[0] = primary != null ? new WeaponInstance(primary) : null;
            Slots[1] = new WeaponInstance(d.Weapon(lo.secondaryId) ?? d.DefaultSecondary);
            Slots[2] = new WeaponInstance(d.DefaultMelee);
            ShotIndex = 0;
            cooldown = 0f;
            Select(Slots[0] != null ? 0 : 1, true);
        }

        /// <summary>Puts a weapon in its slot and returns what was there (to be dropped), if anything.</summary>
        public WeaponInstance Replace(WeaponInstance weapon, bool select = true)
        {
            int slot = (int)weapon.def.Slot;
            var old = Slots[slot];
            Slots[slot] = weapon;
            if (select) Select(slot, false, true);
            else if (slot == CurrentSlot) Select(slot, true, true);
            return old;
        }

        public WeaponInstance Remove(WeaponSlot slot)
        {
            var old = Slots[(int)slot];
            Slots[(int)slot] = null;
            if (CurrentSlot == (int)slot) SelectBest();
            return old;
        }

        public void RefillAmmo()
        {
            foreach (var w in Slots)
            {
                if (w == null) continue;
                w.mag = w.def.magazineSize;
                w.reserve = w.def.reserveAmmo;
            }
        }

        public void Select(int slot, bool instant = false, bool force = false)
        {
            if (slot < 0 || slot >= Slots.Length || Slots[slot] == null) return;
            if (slot == CurrentSlot && !instant && !force) return;
            CurrentSlot = slot;
            var def = Slots[slot].def;
            EquipTimeLeft = instant ? 0f : def.equipSeconds;
            ReloadTimeLeft = 0f;
            IsAiming = false;
            ShotIndex = 0;
            owner.Visual.SetWeapon(def);
            if (!instant) Game.Audio.Play("equip", owner.EyePosition, 0.6f);
        }

        /// <summary>Primary, else sidearm, else knife.</summary>
        void SelectBest()
        {
            for (int s = 0; s < Slots.Length; s++)
                if (Slots[s] != null) { Select(s, false, true); return; }
        }

        public void Tick(in Intent intent, float dt)
        {
            float now = owner.Match.Time;
            if (intent.selectSlot >= 0) Select(intent.selectSlot);
            if (Current == null) SelectBest();
            if (Current == null) return;
            var w = Current.def;

            if (EquipTimeLeft > 0f) EquipTimeLeft -= dt;
            if (cooldown > 0f) cooldown -= dt;
            if (ReloadTimeLeft > 0f)
            {
                ReloadTimeLeft -= dt;
                if (ReloadTimeLeft <= 0f) FinishReload();
            }
            if (intent.reload) StartReload();

            bool blocked = owner.Frozen || owner.InteractLock;
            IsAiming = intent.aim && w.HasAds && EquipTimeLeft <= 0f && !IsReloading && !blocked;
            AimTime = IsAiming ? AimTime + dt : 0f;
            if (now - LastShotTime > w.recoilResetSeconds) ShotIndex = 0;

            bool pressed = intent.fire && !triggerHeld;
            triggerHeld = intent.fire;
            bool wantsToFire = w.Mode == FireMode.Auto ? intent.fire : pressed;
            if (wantsToFire && !blocked && EquipTimeLeft <= 0f && cooldown <= 0f)
            {
                if (w.Mode == FireMode.Melee) Swing();
                else if (IsReloading) { }
                else if (Current.mag > 0) Shoot();
                else
                {
                    if (pressed) Game.Audio.Play("dry_fire", owner.EyePosition);
                    StartReload();
                }
            }
            if (w.magazineSize > 0 && Current.mag == 0 && Current.reserve > 0 && !IsReloading && !intent.fire) StartReload();

            float interval = WeaponMath.FireInterval(w, owner.FireRateMultiplier);
            if (now - LastShotTime > interval + 0.05f)
            {
                owner.RecoilPitch = Mathf.MoveTowards(owner.RecoilPitch, 0f, w.recoilRecovery * dt);
                owner.RecoilYaw = Mathf.MoveTowards(owner.RecoilYaw, 0f, w.recoilRecovery * dt);
            }
            CurrentSpread = ComputeSpread(w);
        }

        float ComputeSpread(WeaponDef w) => WeaponMath.Spread(w, Game.Data.Game.movement, new SpreadInput
        {
            horizontalSpeed = owner.HorizontalSpeed, airborne = !owner.Grounded, crouched = owner.IsCrouched,
            aiming = IsAiming, shotIndex = ShotIndex,
        });

        void Shoot()
        {
            var w = Current.def;
            Current.mag--;
            float spread = ComputeSpread(w);
            Vector3 eye = owner.EyePosition;
            Vector3 muzzle = eye + owner.AimForward * 0.6f + owner.transform.right * 0.18f - Vector3.up * 0.12f;
            int pellets = Mathf.Max(1, w.pellets);
            for (int p = 0; p < pellets; p++)
            {
                WeaponMath.SampleCone(owner.Rng, spread, out float dp, out float dy);
                Vector3 dir = Quaternion.Euler(-(owner.ViewPitch + dp), owner.ViewYaw + dy, 0f) * Vector3.forward;
                Vector3 end = owner.Match.Combat.FireBullet(owner, eye, dir, w);
                if (p < 3) owner.Match.Effects.Tracer(muzzle, end);
            }
            WeaponMath.RecoilKick(w, ShotIndex, out float kickPitch, out float kickYaw);
            kickYaw += owner.Rng.Range(-w.recoilRandomYaw, w.recoilRandomYaw);
            owner.RecoilPitch += kickPitch;
            owner.RecoilYaw += kickYaw;
            ShotIndex++;
            ShotsFired++;
            LastShotTime = owner.Match.Time;
            cooldown = WeaponMath.FireInterval(w, owner.FireRateMultiplier);
            Game.Audio.Play(w.fireSound, eye);
            owner.Match.Effects.MuzzleFlash(muzzle);
            owner.MakeNoise(eye);
            Fired?.Invoke();
        }

        void Swing()
        {
            var w = Current.def;
            cooldown = WeaponMath.FireInterval(w, owner.FireRateMultiplier);
            LastShotTime = owner.Match.Time;
            ShotsFired++;
            Game.Audio.Play(w.fireSound, owner.EyePosition);
            owner.Match.Combat.Melee(owner, w);
            Fired?.Invoke();
        }

        public void StartReload()
        {
            var c = Current;
            if (c == null || c.def.magazineSize <= 0 || IsReloading || c.mag >= c.def.magazineSize || c.reserve <= 0 || EquipTimeLeft > 0f) return;
            ReloadTimeLeft = c.def.reloadSeconds;
            IsAiming = false;
            Game.Audio.Play("reload", owner.EyePosition);
        }

        void FinishReload()
        {
            ReloadTimeLeft = 0f;
            var c = Current;
            int take = Mathf.Min(c.def.magazineSize - c.mag, c.reserve);
            c.mag += take;
            c.reserve -= take;
        }
    }
}
