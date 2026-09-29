using TacticalShooter.Core;
using UnityEngine;

namespace TacticalShooter
{
    /// <summary>
    /// A living participant: movement (CharacterController), health and armour, weapons,
    /// abilities and status effects. It has no input of its own - it executes whatever Intent
    /// the MatchController hands it (from the PlayerController or a BotBrain).
    /// The transform position is the feet.
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public sealed class TacticalCharacter : MonoBehaviour
    {
        public PlayerRecord Record { get; private set; }
        public AgentDef Agent { get; private set; }
        public MatchController Match { get; private set; }
        public WeaponHandler Weapons { get; private set; }
        public AbilityHandler Abilities { get; private set; }
        public CharacterVisual Visual { get; private set; }
        public Rng Rng { get; private set; }

        public int Id => Record.id;
        public TeamId Team => Record.team;
        public Side Side => Match.Flow.SideOf(Record.team);
        public bool Alive { get; private set; }
        public int Health { get; private set; }
        public int Armor;

        /// <summary>Base view angles from the intent; recoil is added on top.</summary>
        public float Yaw { get; private set; }
        public float Pitch { get; private set; }
        public float RecoilPitch;
        public float RecoilYaw;
        public float ViewYaw => Yaw + RecoilYaw;
        public float ViewPitch => Mathf.Clamp(Pitch + RecoilPitch, -89f, 89f);
        public Quaternion ViewRotation => Quaternion.Euler(-ViewPitch, ViewYaw, 0f);
        public Vector3 AimForward => ViewRotation * Vector3.forward;

        public Vector3 Velocity => velocity;
        public float HorizontalSpeed => new Vector2(velocity.x, velocity.z).magnitude;
        public bool Grounded { get; private set; }
        public bool IsCrouched => crouchAmount > 0.5f;
        public float Height { get; private set; }
        public Vector3 Feet => transform.position;
        public Vector3 EyePosition => transform.position + Vector3.up * Mathf.Lerp(mov.eyeHeightStand, mov.eyeHeightCrouch, crouchAmount);
        public Vector3 ChestPosition => transform.position + Vector3.up * (Height * 0.65f);
        public Vector3 HeadPosition => transform.position + Vector3.up * (Height - 0.17f);

        /// <summary>Set by the match every tick: buy-phase freeze.</summary>
        public bool Frozen;
        /// <summary>Set by the bomb system while planting or defusing.</summary>
        public bool InteractLock;
        public Intent LastIntent;

        public float BlindTimeLeft { get; private set; }
        public float BlindDuration { get; private set; }
        public float RevealedUntil;
        public float LastNoiseTime = -99f;
        public Vector3 LastNoisePosition;
        public float LastDamagedTime = -99f;
        public Vector3 LastDamageFrom;
        public bool CarryingBomb { get; private set; }

        public float SpeedMultiplier { get; private set; } = 1f;
        public float FireRateMultiplier { get; private set; } = 1f;
        public float DamageTakenMultiplier { get; private set; } = 1f;
        public float BuffTimeLeft { get; private set; }
        public float HealTimeLeft { get; private set; }

        CharacterController cc;
        MovementSettings mov;
        CombatSettings combat;
        Vector3 velocity;
        float crouchAmount;
        float healPerSecond, healAccumulator;
        float dashTimeLeft;
        Vector3 dashVelocity;
        float footstepTimer;
        bool wasGrounded = true;

        public static TacticalCharacter Spawn(MatchController match, PlayerRecord record, Transform parent)
        {
            var go = new GameObject(record.name);
            go.layer = Layers.Characters;
            go.transform.SetParent(parent, false);
            var mov = Game.Data.Game.movement;
            var cc = go.AddComponent<CharacterController>();
            cc.radius = mov.radius;
            cc.height = mov.standHeight;
            cc.center = new Vector3(0f, mov.standHeight / 2f, 0f);
            cc.stepOffset = mov.stepHeight;
            cc.slopeLimit = 50f;
            cc.skinWidth = 0.03f;
            cc.minMoveDistance = 0f;
            var ch = go.AddComponent<TacticalCharacter>();
            ch.Init(match, record);
            return ch;
        }

        void Init(MatchController match, PlayerRecord record)
        {
            Match = match;
            Record = record;
            Agent = Game.Data.Agent(record.agentId);
            mov = Game.Data.Game.movement;
            combat = Game.Data.Game.combat;
            cc = GetComponent<CharacterController>();
            Rng = new Rng(match.Seed ^ (uint)(record.id * 7919 + 1));
            var v = Game.Data.Game.visuals;
            Color teamColor = Prims.ToColor(record.team == TeamId.A ? "#E8E8E8" : "#2A2A2A");
            Visual = new CharacterVisual(this, teamColor, Prims.ToColor(Agent?.color ?? "#FFFFFF"), Prims.ToColor(v.skinColor), Prims.ToColor(v.bombColor), mov.standHeight);
            Weapons = new WeaponHandler(this);
            Abilities = new AbilityHandler(this);
            Height = mov.standHeight;
        }

        /// <summary>Team colours follow the side (attack/defense), so they are refreshed every round.</summary>
        public void RefreshColors()
        {
            var v = Game.Data.Game.visuals;
            var body = transform.Find("Model/Body");
            if (body != null) Prims.SetColor(body.gameObject, Prims.ToColor(Side == Side.Attack ? v.attackColor : v.defenseColor));
        }

        public void Respawn(Vector3 feet, float yaw)
        {
            gameObject.SetActive(true);
            Alive = true;
            Record.alive = true;
            Health = combat.maxHealth;
            Armor = Record.loadout.armor;
            Yaw = yaw;
            Pitch = 0f;
            RecoilPitch = RecoilYaw = 0f;
            velocity = Vector3.zero;
            crouchAmount = 0f;
            SpeedMultiplier = FireRateMultiplier = DamageTakenMultiplier = 1f;
            BuffTimeLeft = HealTimeLeft = dashTimeLeft = 0f;
            BlindTimeLeft = BlindDuration = 0f;
            RevealedUntil = 0f;
            LastDamagedTime = -99f;
            SetCarryingBomb(false);
            cc.enabled = false;
            transform.SetPositionAndRotation(feet, Quaternion.Euler(0f, yaw, 0f));
            cc.enabled = true;
            ApplyHeight();
            Visual.SetAlive(true);
            Weapons.SetLoadout(Record.loadout);
            RefreshColors();
            LastIntent = Intent.Idle(yaw, 0f);
        }

        public void Tick(in Intent intent, float dt)
        {
            if (!Alive) return;
            LastIntent = intent;
            Yaw = intent.yaw;
            Pitch = Mathf.Clamp(intent.pitch, -89f, 89f);
            transform.rotation = Quaternion.Euler(0f, Yaw, 0f);
            UpdateStatus(dt);
            Move(intent, dt);
            Weapons.Tick(intent, dt);
            Abilities.Tick(intent, dt);
            Visual.Tick();
        }

        void UpdateStatus(float dt)
        {
            if (BlindTimeLeft > 0f) BlindTimeLeft = Mathf.Max(0f, BlindTimeLeft - dt);
            if (BuffTimeLeft > 0f)
            {
                BuffTimeLeft -= dt;
                if (BuffTimeLeft <= 0f) SpeedMultiplier = FireRateMultiplier = DamageTakenMultiplier = 1f;
            }
            if (HealTimeLeft > 0f)
            {
                HealTimeLeft -= dt;
                healAccumulator += healPerSecond * dt;
                int add = Mathf.FloorToInt(healAccumulator);
                healAccumulator -= add;
                Health = Mathf.Min(combat.maxHealth, Health + add);
            }
        }

        float MaxSpeed(in Intent intent)
        {
            var w = Weapons.CurrentDef;
            float speed = mov.runSpeed * SpeedMultiplier * (w != null ? w.moveSpeedMultiplier : 1f);
            if (intent.walk) speed *= mov.walkMultiplier;
            speed *= Mathf.Lerp(1f, mov.crouchMultiplier, crouchAmount);
            if (Weapons.IsAiming && w != null) speed *= w.adsMoveMultiplier;
            return speed;
        }

        void Move(in Intent intent, float dt)
        {
            bool canMove = !Frozen && !InteractLock;

            bool wantCrouch = intent.crouch;
            if (!wantCrouch && crouchAmount > 0f && !HasHeadroom()) wantCrouch = true;
            crouchAmount = Mathf.MoveTowards(crouchAmount, wantCrouch ? 1f : 0f, mov.crouchTransitionSpeed * dt);
            ApplyHeight();

            Vector3 forward = Quaternion.Euler(0f, Yaw, 0f) * Vector3.forward;
            Vector3 right = Quaternion.Euler(0f, Yaw, 0f) * Vector3.right;
            Vector3 wish = canMove ? forward * intent.moveForward + right * intent.moveRight : Vector3.zero;
            if (wish.sqrMagnitude > 1f) wish.Normalize();
            float maxSpeed = MaxSpeed(intent);

            Vector3 horizontal = new Vector3(velocity.x, 0f, velocity.z);
            if (dashTimeLeft > 0f)
            {
                dashTimeLeft -= dt;
                horizontal = dashVelocity;
                if (dashTimeLeft <= 0f) horizontal = horizontal.normalized * Mathf.Min(horizontal.magnitude, maxSpeed);
            }
            else if (Grounded)
            {
                float rate = wish.sqrMagnitude > 0.01f ? mov.acceleration : mov.deceleration;
                horizontal = Vector3.MoveTowards(horizontal, wish * maxSpeed, rate * dt);
            }
            else
            {
                float before = horizontal.magnitude;
                horizontal += wish * (mov.airAcceleration * dt);
                float cap = Mathf.Max(maxSpeed, before);
                if (horizontal.magnitude > cap) horizontal = horizontal.normalized * cap;
            }

            if (Grounded && canMove && intent.jump && crouchAmount < 0.5f)
            {
                velocity.y = mov.jumpVelocity;
                Grounded = false;
                Game.Audio.Play("jump", Feet);
                MakeNoise(Feet);
            }
            velocity.y -= mov.gravity * dt;
            velocity.x = horizontal.x;
            velocity.z = horizontal.z;

            if (!cc.enabled) return;
            CollisionFlags flags = cc.Move(velocity * dt);
            Vector3 actual = cc.velocity;
            velocity.x = actual.x;
            velocity.z = actual.z;
            Grounded = (flags & CollisionFlags.Below) != 0 || cc.isGrounded;
            if (Grounded && velocity.y < 0f) velocity.y = -2f;
            if ((flags & CollisionFlags.Above) != 0 && velocity.y > 0f) velocity.y = 0f;

            if (Grounded && !wasGrounded) Game.Audio.Play("land", Feet, 0.8f);
            wasGrounded = Grounded;

            // Running is loud (footsteps bots can hear); walking and crouching are silent.
            if (Grounded && HorizontalSpeed > mov.runSpeed * mov.walkMultiplier * 1.1f)
            {
                footstepTimer -= dt;
                if (footstepTimer <= 0f)
                {
                    footstepTimer = 0.36f;
                    Game.Audio.Play("footstep", Feet);
                    MakeNoise(Feet);
                }
            }
        }

        bool HasHeadroom()
        {
            float r = mov.radius * 0.9f;
            Vector3 bottom = transform.position + Vector3.up * (r + 0.1f);
            Vector3 top = transform.position + Vector3.up * (mov.standHeight - r);
            return !Physics.CheckCapsule(bottom, top, r, Layers.WorldMask, QueryTriggerInteraction.Ignore);
        }

        void ApplyHeight()
        {
            Height = Mathf.Lerp(mov.standHeight, mov.crouchHeight, crouchAmount);
            cc.height = Height;
            cc.center = new Vector3(0f, Height / 2f, 0f);
        }

        public HitZone HitZoneAt(Vector3 point) => DamageModel.ZoneFromHeight(combat, point.y - transform.position.y, Height);

        /// <summary>Applies damage through the armour model (GAME_RULES.md 4.3). attacker may be null (bomb).</summary>
        public DamageResult ApplyDamage(float raw, float armorPenetration, TacticalCharacter attacker, string sourceId, HitZone zone, Vector3 from)
        {
            if (!Alive || raw <= 0f) return default;
            var r = DamageModel.ApplyArmor(combat, raw, Armor, armorPenetration, DamageTakenMultiplier);
            int dealt = Mathf.Min(r.healthDamage, Health) + r.armorDamage;
            Armor -= r.armorDamage;
            Health -= r.healthDamage;
            bool killed = Health <= 0;
            if (killed) Health = 0;
            LastDamagedTime = Match.Time;
            LastDamageFrom = from;
            if (attacker != null && attacker != this)
            {
                attacker.Record.damageDealt.TryGetValue(Id, out int prev);
                attacker.Record.damageDealt[Id] = prev + dealt;
            }
            Game.Events.RaiseDamaged(new DamageEvent
            {
                attackerId = attacker != null ? attacker.Id : -1, victimId = Id, healthDamage = r.healthDamage, armorDamage = r.armorDamage,
                zone = zone, killed = killed, sourceX = from.x, sourceY = from.y, sourceZ = from.z,
            });
            if (killed) Die(attacker, sourceId, zone == HitZone.Head);
            return r;
        }

        void Die(TacticalCharacter killer, string sourceId, bool headshot)
        {
            Alive = false;
            Record.alive = false;
            cc.enabled = false;
            velocity = Vector3.zero;
            Visual.SetAlive(false);
            Game.Audio.Play("death", ChestPosition);
            Match.OnCharacterKilled(this, killer, sourceId, headshot);
        }

        /// <summary>Removes the character at the end of a match or when a player leaves.</summary>
        public void Despawn()
        {
            Alive = false;
            Record.alive = false;
            gameObject.SetActive(false);
        }

        public void SetCarryingBomb(bool value)
        {
            CarryingBomb = value;
            Visual.SetBomb(value);
        }

        public void MakeNoise(Vector3 position)
        {
            LastNoiseTime = Match.Time;
            LastNoisePosition = position;
        }

        public void Blind(float seconds)
        {
            if (seconds <= BlindTimeLeft) return;
            BlindTimeLeft = seconds;
            BlindDuration = seconds;
        }

        public void StartDash(AbilityDef a)
        {
            var i = LastIntent;
            Vector3 dir = Quaternion.Euler(0f, Yaw, 0f) * new Vector3(i.moveRight, 0f, i.moveForward);
            if (dir.sqrMagnitude < 0.01f) dir = Quaternion.Euler(0f, Yaw, 0f) * Vector3.forward;
            float duration = Mathf.Max(0.05f, a.duration);
            dashVelocity = dir.normalized * (a.distance / duration);
            dashTimeLeft = duration;
        }

        public void StartHeal(AbilityDef a)
        {
            float duration = Mathf.Max(0.1f, a.duration);
            healPerSecond = a.amount / duration;
            HealTimeLeft = duration;
            healAccumulator = 0f;
        }

        public void ApplyBuff(AbilityDef a)
        {
            SpeedMultiplier = a.speedMultiplier;
            FireRateMultiplier = a.fireRateMultiplier;
            DamageTakenMultiplier = a.damageTakenMultiplier;
            BuffTimeLeft = a.duration;
            if (a.amount > 0f) Armor = Mathf.Max(Armor, Mathf.Min(combat.maxArmor, (int)a.amount));
        }
    }
}
