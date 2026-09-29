using System.Collections.Generic;
using TacticalShooter.Core;
using UnityEngine;

namespace TacticalShooter
{
    /// <summary>
    /// Hit resolution shared by players and bots: bullets, melee, explosions and line of sight.
    /// Characters are hit on their CharacterController capsule and the zone comes from the hit
    /// height (GAME_RULES.md 4.1). Smoke blocks sight but not bullets, as in CS and Valorant.
    /// </summary>
    public sealed class Combat
    {
        readonly MatchController match;
        readonly RaycastHit[] hits = new RaycastHit[32];
        static readonly IComparer<RaycastHit> ByDistance = Comparer<RaycastHit>.Create((a, b) => a.distance.CompareTo(b.distance));

        public Combat(MatchController match) { this.match = match; }

        bool FriendlyFire => Game.Data.Game.combat.friendlyFire;

        /// <summary>Traces one bullet and applies damage. Returns where it stopped (for the tracer).</summary>
        public Vector3 FireBullet(TacticalCharacter shooter, Vector3 origin, Vector3 dir, WeaponDef w)
        {
            int n = Physics.RaycastNonAlloc(origin, dir, hits, w.maxRange, Layers.ShotMask, QueryTriggerInteraction.Ignore);
            System.Array.Sort(hits, 0, n, ByDistance);
            for (int i = 0; i < n; i++)
            {
                var h = hits[i];
                var ch = h.collider.GetComponent<TacticalCharacter>();
                if (ch != null)
                {
                    if (ch == shooter || !ch.Alive) continue;
                    if (!FriendlyFire && ch.Team == shooter.Team) continue;
                    HitZone zone = ch.HitZoneAt(h.point);
                    float raw = DamageModel.RawDamage(w, zone, h.distance);
                    ch.ApplyDamage(raw, w.armorPenetration, shooter, w.id, zone, origin);
                    match.Effects.BloodPuff(h.point);
                    return h.point;
                }
                match.Effects.Impact(h.point, h.normal);
                return h.point;
            }
            return origin + dir * w.maxRange;
        }

        /// <summary>Knife: short sphere sweep in front; double damage from behind.</summary>
        public void Melee(TacticalCharacter attacker, WeaponDef w)
        {
            Vector3 eye = attacker.EyePosition;
            Vector3 dir = attacker.AimForward;
            int n = Physics.SphereCastNonAlloc(eye, 0.35f, dir, hits, w.maxRange, Layers.ShotMask, QueryTriggerInteraction.Ignore);
            System.Array.Sort(hits, 0, n, ByDistance);
            for (int i = 0; i < n; i++)
            {
                var ch = hits[i].collider.GetComponent<TacticalCharacter>();
                if (ch == null)
                {
                    if (hits[i].distance > 0f) return; // hit a wall first
                    continue;
                }
                if (ch == attacker || !ch.Alive || (!FriendlyFire && ch.Team == attacker.Team)) continue;
                Vector3 victimForward = ch.transform.forward;
                bool backstab = Vector3.Dot(victimForward, (ch.Feet - attacker.Feet).normalized) > 0.5f;
                ch.ApplyDamage(w.damage * (backstab ? 2f : 1f), w.armorPenetration, attacker, w.id, HitZone.Body, eye);
                match.Effects.BloodPuff(ch.ChestPosition);
                return;
            }
        }

        /// <summary>True if nothing solid and no smoke is between the two points.</summary>
        public bool LineOfSight(Vector3 from, Vector3 to)
        {
            if (Physics.Linecast(from, to, Layers.WorldMask, QueryTriggerInteraction.Ignore)) return false;
            return !match.Effects.SmokeBlocks(from, to);
        }

        /// <summary>
        /// Linear-falloff area damage (frags, the bomb). needsSight: walls block it.
        /// Hits the owner and enemies; teammates only with friendly fire.
        /// </summary>
        public void Explosion(Vector3 center, float radius, float maxDamage, float armorPenetration, TacticalCharacter owner, string sourceId, bool needsSight)
        {
            foreach (var ch in match.AliveCharacters())
            {
                float d = Vector3.Distance(center, ch.ChestPosition);
                if (d > radius) continue;
                if (owner != null && ch != owner && ch.Team == owner.Team && !FriendlyFire) continue;
                if (needsSight && Physics.Linecast(center, ch.ChestPosition, Layers.WorldMask, QueryTriggerInteraction.Ignore)) continue;
                float raw = DamageModel.AreaDamage(maxDamage, d, radius);
                ch.ApplyDamage(raw, armorPenetration, owner, sourceId, HitZone.Body, center);
            }
        }
    }
}
