using TacticalShooter.Core;
using UnityEngine;

namespace TacticalShooter
{
    /// <summary>
    /// The agent's four ability slots (C, Q, E, X). Charges live in the PlayerRecord's loadout so
    /// they survive death (GAME_RULES.md 7); ultimates use ultimate points instead.
    /// Each ability type is executed here or by EffectsWorld.
    /// </summary>
    public sealed class AbilityHandler
    {
        readonly TacticalCharacter owner;
        float cooldown;

        public AbilityHandler(TacticalCharacter owner) { this.owner = owner; }

        public int SlotCount => owner.Agent != null ? owner.Agent.abilities.Length : 0;

        public AgentAbilitySlot Slot(int i) => owner.Agent != null && i >= 0 && i < owner.Agent.abilities.Length ? owner.Agent.abilities[i] : null;

        public AbilityDef Def(int i) => Game.Data.Ability(Slot(i)?.abilityId);

        public int Charges(int i) => i >= 0 && i < 4 ? owner.Record.loadout.abilityCharges[i] : 0;

        public bool IsReady(int i)
        {
            var s = Slot(i);
            if (s == null) return false;
            return s.IsUltimate ? owner.Record.ultPoints >= s.ultPoints : Charges(i) > 0;
        }

        /// <summary>First ready slot whose ability has the given type, or -1.</summary>
        public int FindReady(AbilityType type)
        {
            for (int i = 0; i < SlotCount; i++)
            {
                var d = Def(i);
                if (d != null && d.Type == type && IsReady(i)) return i;
            }
            return -1;
        }

        public void Tick(in Intent intent, float dt)
        {
            if (cooldown > 0f) cooldown -= dt;
            if (intent.useAbility >= 0) TryUse(intent.useAbility);
        }

        public bool TryUse(int i)
        {
            if (owner.Frozen || owner.InteractLock || cooldown > 0f || !IsReady(i)) return false;
            var s = Slot(i);
            var a = Def(i);
            if (a == null) return false;
            if (s.IsUltimate) owner.Record.ultPoints = 0;
            else owner.Record.loadout.abilityCharges[i]--;
            cooldown = Game.Data.Game.combat.abilityCooldownSeconds;
            Execute(a, s.IsUltimate);
            Game.Events.RaiseAbilityUsed(owner.Id, i);
            return true;
        }

        void Execute(AbilityDef a, bool ultimate)
        {
            var effects = owner.Match.Effects;
            if (ultimate) Game.Audio.Play("ultimate", owner.EyePosition);
            switch (a.Type)
            {
                case AbilityType.Flash:
                case AbilityType.Smoke:
                case AbilityType.Frag:
                case AbilityType.Incendiary:
                {
                    Vector3 dir = owner.AimForward;
                    Vector3 start = owner.EyePosition + dir * 0.5f;
                    Vector3 velocity = dir * a.throwSpeed + Vector3.up * 2f + new Vector3(owner.Velocity.x, 0f, owner.Velocity.z) * 0.5f;
                    effects.Throw(owner, a, start, velocity);
                    Game.Audio.Play("ability_throw", owner.EyePosition);
                    break;
                }
                case AbilityType.Dash:
                    owner.StartDash(a);
                    Game.Audio.Play("dash", owner.Feet);
                    break;
                case AbilityType.Heal:
                    owner.StartHeal(a);
                    Game.Audio.Play("heal", owner.Feet);
                    break;
                case AbilityType.Wall:
                    effects.SpawnBarrier(owner, a);
                    Game.Audio.Play("barrier", owner.Feet);
                    break;
                case AbilityType.Recon:
                    effects.Recon(owner, a);
                    Game.Audio.Play("recon", owner.Feet);
                    break;
                case AbilityType.Buff:
                    owner.ApplyBuff(a);
                    break;
            }
        }
    }
}
