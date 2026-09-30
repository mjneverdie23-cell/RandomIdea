using System.Collections.Generic;
using TacticalShooter.Core;
using UnityEngine;

namespace TacticalShooter
{
    /// <summary>
    /// Everything that exists in the world for a limited time: thrown utility, smoke, fire,
    /// barriers, dropped weapons and short-lived visual effects. Cleared at every round start.
    /// All visuals are basic shapes.
    /// </summary>
    public sealed class EffectsWorld
    {
        sealed class Projectile
        {
            public TacticalCharacter owner;
            public AbilityDef def;
            public Vector3 position, velocity;
            public float fuse;
            public bool resting;
            public GameObject go;
        }

        public sealed class Smoke
        {
            public Vector3 center;
            public float radius, maxRadius, timeLeft;
            public GameObject go;
        }

        sealed class Fire
        {
            public TacticalCharacter owner;
            public AbilityDef def;
            public Vector3 center;
            public float radius, timeLeft, tick;
            public GameObject go;
        }

        sealed class Barrier
        {
            public GameObject go;
            public float timeLeft;
            public List<Cell> cells;
        }

        public sealed class Pickup
        {
            public WeaponInstance weapon;
            public Vector3 position;
            public GameObject go;
            /// <summary>Who dropped it on purpose; they only pick it up by walking over it after stepping away.</summary>
            public TacticalCharacter droppedBy;
        }

        sealed class Temp
        {
            public GameObject go;
            public PrimitiveType type;
            public float life, timeLeft;
            public Vector3 fromScale, toScale;
        }

        readonly MatchController match;
        readonly Transform root;
        readonly List<Projectile> projectiles = new List<Projectile>();
        readonly List<Smoke> smokes = new List<Smoke>();
        readonly List<Fire> fires = new List<Fire>();
        readonly List<Barrier> barriers = new List<Barrier>();
        readonly List<Pickup> pickups = new List<Pickup>();
        readonly List<Temp> temps = new List<Temp>();
        // Short-lived shapes (tracers, flashes, impacts) are recycled instead of created and
        // destroyed for every shot: a full lobby firing automatics would otherwise churn hundreds
        // of GameObjects per second.
        readonly Dictionary<PrimitiveType, Stack<GameObject>> tempPool = new Dictionary<PrimitiveType, Stack<GameObject>>();
        readonly Stack<Temp> spareTemps = new Stack<Temp>();

        public IReadOnlyList<Smoke> Smokes => smokes;
        public IReadOnlyList<Pickup> Pickups => pickups;

        public EffectsWorld(MatchController match, Transform parent)
        {
            this.match = match;
            root = new GameObject("Effects").transform;
            root.SetParent(parent, false);
        }

        public void Destroy()
        {
            ClearAll();
            if (root != null) Object.Destroy(root.gameObject);
        }

        public void ClearAll()
        {
            foreach (var p in projectiles) Object.Destroy(p.go);
            foreach (var s in smokes) Object.Destroy(s.go);
            foreach (var f in fires) Object.Destroy(f.go);
            foreach (var b in barriers) Object.Destroy(b.go);
            foreach (var p in pickups) Object.Destroy(p.go);
            foreach (var t in temps) ReleaseTemp(t);
            projectiles.Clear();
            smokes.Clear();
            fires.Clear();
            barriers.Clear();
            pickups.Clear();
            temps.Clear();
            Game.World?.Nav.ClearDynamicBlocks();
        }

        public void Tick(float dt)
        {
            var combat = Game.Data.Game.combat;
            for (int i = projectiles.Count - 1; i >= 0; i--)
            {
                var p = projectiles[i];
                if (!p.resting)
                {
                    p.velocity.y -= combat.projectileGravity * dt;
                    Vector3 step = p.velocity * dt;
                    float dist = step.magnitude;
                    if (dist > 1e-5f && Physics.SphereCast(p.position, 0.1f, step / dist, out RaycastHit hit, dist, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                    {
                        p.position = hit.point + hit.normal * 0.11f;
                        p.velocity = Vector3.Reflect(p.velocity, hit.normal) * combat.projectileBounce;
                        if (hit.normal.y > 0.7f && p.velocity.magnitude < 1.5f) { p.resting = true; p.velocity = Vector3.zero; }
                    }
                    else p.position += step;
                    p.go.transform.position = p.position;
                }
                p.fuse -= dt;
                if (p.fuse <= 0f)
                {
                    projectiles.RemoveAt(i);
                    Object.Destroy(p.go);
                    Detonate(p);
                }
            }

            for (int i = smokes.Count - 1; i >= 0; i--)
            {
                var s = smokes[i];
                s.timeLeft -= dt;
                s.radius = Mathf.MoveTowards(s.radius, s.timeLeft < 1f ? 0f : s.maxRadius, s.maxRadius * 2f * dt);
                s.go.transform.localScale = Vector3.one * (s.radius * 2f);
                if (s.timeLeft <= 0f) { Object.Destroy(s.go); smokes.RemoveAt(i); }
            }

            for (int i = fires.Count - 1; i >= 0; i--)
            {
                var f = fires[i];
                f.timeLeft -= dt;
                f.tick -= dt;
                if (f.tick <= 0f)
                {
                    f.tick += 0.25f;
                    foreach (var ch in match.AliveCharacters())
                    {
                        if (f.owner != null && ch.Team == f.owner.Team && !combat.friendlyFire) continue;
                        Vector3 d = ch.Feet - f.center;
                        if (Mathf.Abs(d.y) > 1.5f || new Vector2(d.x, d.z).magnitude > f.radius) continue;
                        ch.ApplyDamage(f.def.damage * 0.25f, 0f, f.owner, f.def.id, HitZone.Body, f.center);
                    }
                }
                if (f.timeLeft <= 0f) { Object.Destroy(f.go); fires.RemoveAt(i); }
            }

            for (int i = barriers.Count - 1; i >= 0; i--)
            {
                var b = barriers[i];
                b.timeLeft -= dt;
                if (b.timeLeft > 0f) continue;
                foreach (var c in b.cells) Game.World.Nav.AddDynamicBlock(c.x, c.y, -1);
                Object.Destroy(b.go);
                barriers.RemoveAt(i);
            }

            // Walking over a weapon picks it up if that slot is empty.
            var alive = pickups.Count > 0 ? match.AliveCharacters() : null;
            for (int i = pickups.Count - 1; i >= 0; i--)
            {
                var p = pickups[i];
                p.go.transform.Rotate(0f, 90f * dt, 0f);
                foreach (var ch in alive)
                {
                    bool inReach = (ch.Feet - p.position).sqrMagnitude <= 1.2f * 1.2f;
                    if (ch == p.droppedBy)
                    {
                        if (!inReach) p.droppedBy = null;
                        continue;
                    }
                    if (!inReach || ch.Weapons.Slots[(int)p.weapon.def.Slot] != null) continue;
                    GiveTo(ch, i);
                    break;
                }
            }

            for (int i = temps.Count - 1; i >= 0; i--)
            {
                var t = temps[i];
                t.timeLeft -= dt;
                if (t.timeLeft <= 0f || t.go == null)
                {
                    ReleaseTemp(t);
                    temps[i] = temps[temps.Count - 1];
                    temps.RemoveAt(temps.Count - 1);
                    continue;
                }
                t.go.transform.localScale = Vector3.Lerp(t.toScale, t.fromScale, t.timeLeft / t.life);
            }
        }

        // ---- utility ---------------------------------------------------------------------

        public void Throw(TacticalCharacter owner, AbilityDef def, Vector3 start, Vector3 velocity)
        {
            var go = Prims.Shape(PrimitiveType.Sphere, root, start, Vector3.one * 0.2f, Prims.ToColor(def.color), def.id);
            projectiles.Add(new Projectile { owner = owner, def = def, position = start, velocity = velocity, fuse = def.fuseSeconds, go = go });
        }

        void Detonate(Projectile p)
        {
            var a = p.def;
            switch (a.Type)
            {
                case AbilityType.Flash:
                    Flash(p.owner, p.position, a);
                    break;
                case AbilityType.Smoke:
                {
                    var go = Prims.Shape(PrimitiveType.Sphere, root, p.position, Vector3.one, Prims.ToColor(a.color), "Smoke");
                    smokes.Add(new Smoke { center = p.position, radius = 0.5f, maxRadius = a.radius, timeLeft = a.duration, go = go });
                    Game.Audio.Play("smoke_pop", p.position);
                    break;
                }
                case AbilityType.Frag:
                    match.Combat.Explosion(p.position, a.radius, a.damage, 0f, p.owner, a.id, true);
                    Burst(p.position, a.radius, new Color(1f, 0.55f, 0.1f), 0.35f);
                    Game.Audio.Play("explosion", p.position, 0.8f);
                    break;
                case AbilityType.Incendiary:
                {
                    Vector3 ground = p.position;
                    if (Physics.Raycast(p.position + Vector3.up * 0.2f, Vector3.down, out RaycastHit hit, 6f, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                        ground = hit.point;
                    var go = Prims.Shape(PrimitiveType.Cylinder, root, ground + Vector3.up * 0.03f, new Vector3(a.radius * 2f, 0.03f, a.radius * 2f), Prims.ToColor(a.color), "Fire");
                    fires.Add(new Fire { owner = p.owner, def = a, center = ground, radius = a.radius, timeLeft = a.duration, go = go });
                    Game.Audio.Play("fire_ignite", ground);
                    break;
                }
            }
        }

        void Flash(TacticalCharacter owner, Vector3 pos, AbilityDef a)
        {
            Burst(pos, 2.5f, Color.white, 0.15f);
            Game.Audio.Play("flash_pop", pos);
            foreach (var ch in match.AliveCharacters())
            {
                if (ch == owner) continue; // the thrower never blinds themself
                Vector3 eye = ch.EyePosition;
                float d = Vector3.Distance(eye, pos);
                if (d > a.radius || !match.Combat.LineOfSight(eye, pos)) continue;
                float angle = Vector3.Angle(ch.AimForward, pos - eye);
                float facing = angle < 30f ? 1f : angle > 110f ? 0f : 1f - (angle - 30f) / 80f;
                float seconds = a.duration * facing * (1f - 0.5f * d / a.radius);
                if (seconds > 0.2f) ch.Blind(seconds);
            }
        }

        public void SpawnBarrier(TacticalCharacter owner, AbilityDef a)
        {
            Vector3 forward = Quaternion.Euler(0f, owner.Yaw, 0f) * Vector3.forward;
            Vector3 center = owner.Feet + forward * a.distance + Vector3.up * (a.height / 2f);
            var go = Prims.SolidBox(root, center, new Vector3(a.width, a.height, 0.4f), Prims.ToColor(a.color), "Barrier");
            go.transform.rotation = Quaternion.Euler(0f, owner.Yaw, 0f);
            var cells = new List<Cell>();
            Vector3 right = Quaternion.Euler(0f, owner.Yaw, 0f) * Vector3.right;
            for (float s = -a.width / 2f; s <= a.width / 2f; s += 0.5f)
            {
                var c = Game.World.WorldToCell(center + right * s);
                if (cells.Contains(c)) continue;
                cells.Add(c);
                Game.World.Nav.AddDynamicBlock(c.x, c.y, 1);
            }
            barriers.Add(new Barrier { go = go, timeLeft = a.duration, cells = cells });
        }

        public void Recon(TacticalCharacter owner, AbilityDef a)
        {
            Burst(owner.Feet + Vector3.up * 0.1f, Mathf.Min(a.radius, 40f), Prims.ToColor(a.color), 0.6f, true);
            foreach (var ch in match.AliveCharacters())
            {
                if (ch.Team == owner.Team) continue;
                Vector3 d = ch.Feet - owner.Feet;
                if (new Vector2(d.x, d.z).magnitude > a.radius) continue;
                ch.RevealedUntil = Mathf.Max(ch.RevealedUntil, match.Time + a.duration);
            }
        }

        /// <summary>True if any smoke sphere intersects the segment a-b.</summary>
        public bool SmokeBlocks(Vector3 a, Vector3 b)
        {
            foreach (var s in smokes)
            {
                if (s.radius < 0.5f) continue;
                Vector3 ab = b - a;
                float t = Mathf.Clamp01(Vector3.Dot(s.center - a, ab) / Mathf.Max(1e-5f, ab.sqrMagnitude));
                if ((a + ab * t - s.center).sqrMagnitude < s.radius * s.radius) return true;
            }
            return false;
        }

        public bool InsideSmoke(Vector3 p)
        {
            foreach (var s in smokes) if ((p - s.center).sqrMagnitude < s.radius * s.radius) return true;
            return false;
        }

        // ---- dropped weapons ---------------------------------------------------------------

        /// <summary>droppedBy: the character who dropped it on purpose, if any.</summary>
        public void SpawnPickup(WeaponInstance weapon, Vector3 position, TacticalCharacter droppedBy = null)
        {
            if (weapon == null) return;
            Vector3 ground = new Vector3(position.x, 0.1f, position.z);
            var go = Prims.Shape(PrimitiveType.Cube, root, ground, new Vector3(0.12f, 0.12f, 0.7f), Prims.ToColor(weapon.def.color), "Pickup_" + weapon.def.id);
            pickups.Add(new Pickup { weapon = weapon, position = ground, go = go, droppedBy = droppedBy });
        }

        /// <summary>Interact near a weapon: swap it with the one in the same slot.</summary>
        public bool TrySwap(TacticalCharacter ch)
        {
            int best = -1;
            float bestDist = 1.8f * 1.8f;
            for (int i = 0; i < pickups.Count; i++)
            {
                float d = (pickups[i].position - ch.Feet).sqrMagnitude;
                if (d < bestDist) { bestDist = d; best = i; }
            }
            if (best < 0) return false;
            GiveTo(ch, best);
            return true;
        }

        public int NearestPickup(Vector3 p, float maxDistance)
        {
            for (int i = 0; i < pickups.Count; i++)
                if ((pickups[i].position - p).sqrMagnitude < maxDistance * maxDistance) return i;
            return -1;
        }

        void GiveTo(TacticalCharacter ch, int index)
        {
            var p = pickups[index];
            pickups.RemoveAt(index);
            Object.Destroy(p.go);
            var old = ch.Weapons.Replace(p.weapon);
            match.OnWeaponChanged(ch, p.weapon.def);
            if (old != null && old.def.price > 0) SpawnPickup(old, ch.Feet + ch.transform.forward * 0.5f);
            Game.Audio.Play("equip", ch.Feet);
        }

        // ---- cosmetic effects --------------------------------------------------------------

        public void Tracer(Vector3 from, Vector3 to)
        {
            Vector3 d = to - from;
            float len = d.magnitude;
            if (len < 0.5f) return;
            var scale = new Vector3(0.02f, 0.02f, len);
            AddTemp(PrimitiveType.Cube, from + d * 0.5f, new Color(1f, 0.9f, 0.5f), 0.05f, scale, new Vector3(0.005f, 0.005f, len), Quaternion.LookRotation(d));
        }

        public void MuzzleFlash(Vector3 at)
        {
            AddTemp(PrimitiveType.Sphere, at, new Color(1f, 0.85f, 0.4f), 0.04f, Vector3.one * 0.12f, Vector3.one * 0.02f);
        }

        public void Impact(Vector3 at, Vector3 normal)
        {
            AddTemp(PrimitiveType.Cube, at + normal * 0.02f, new Color(0.25f, 0.22f, 0.2f), 0.6f, Vector3.one * 0.08f, Vector3.one * 0.02f);
        }

        public void BloodPuff(Vector3 at)
        {
            AddTemp(PrimitiveType.Sphere, at, new Color(0.7f, 0.05f, 0.05f), 0.2f, Vector3.one * 0.15f, Vector3.one * 0.35f);
        }

        /// <summary>Expanding sphere (or flat ring) used for explosions, flashes and pulses.</summary>
        public void Burst(Vector3 at, float radius, Color color, float seconds, bool flat = false)
        {
            Vector3 from = flat ? new Vector3(0.2f, 0.02f, 0.2f) : Vector3.one * 0.2f;
            Vector3 to = flat ? new Vector3(radius * 2f, 0.02f, radius * 2f) : Vector3.one * (radius * 2f);
            AddTemp(flat ? PrimitiveType.Cylinder : PrimitiveType.Sphere, at, color, seconds, from, to);
        }

        /// <summary>A shape that scales from 'from' to 'to' over 'seconds', then goes back to the pool.</summary>
        void AddTemp(PrimitiveType type, Vector3 at, Color color, float seconds, Vector3 from, Vector3 to, Quaternion? rotation = null)
        {
            GameObject go = null;
            if (tempPool.TryGetValue(type, out var pool))
                while (go == null && pool.Count > 0) go = pool.Pop();
            if (go == null) go = Prims.Shape(type, root, at, from, color, "Fx");
            else
            {
                go.transform.localPosition = at;
                go.transform.localScale = from;
                Prims.SetColor(go, color);
                go.SetActive(true);
            }
            go.transform.rotation = rotation ?? Quaternion.identity;
            var t = spareTemps.Count > 0 ? spareTemps.Pop() : new Temp();
            t.go = go;
            t.type = type;
            t.life = t.timeLeft = seconds;
            t.fromScale = from;
            t.toScale = to;
            temps.Add(t);
        }

        void ReleaseTemp(Temp t)
        {
            if (t.go != null)
            {
                t.go.SetActive(false);
                if (!tempPool.TryGetValue(t.type, out var pool)) tempPool[t.type] = pool = new Stack<GameObject>();
                pool.Push(t.go);
            }
            t.go = null;
            spareTemps.Push(t);
        }
    }
}
