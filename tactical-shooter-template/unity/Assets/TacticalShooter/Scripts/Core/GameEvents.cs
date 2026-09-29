using System;

namespace TacticalShooter.Core
{
    public struct KillEvent
    {
        public int killerId;
        public int victimId;
        public int assisterId;
        /// <summary>Weapon id or ability id that dealt the final blow.</summary>
        public string sourceId;
        public string sourceName;
        public bool headshot;
    }

    public struct DamageEvent
    {
        public int attackerId;
        public int victimId;
        public int healthDamage;
        public int armorDamage;
        public HitZone zone;
        public bool killed;
        /// <summary>World position the damage came from (engine coordinates), for direction indicators.</summary>
        public float sourceX, sourceY, sourceZ;
    }

    /// <summary>
    /// The global notification hub. Simulation code raises events; UI, audio and effects
    /// subscribe and never reach back into the simulation.
    /// </summary>
    public sealed class GameEvents
    {
        public event Action<FlowEvent> Flow;
        public event Action<KillEvent> Killed;
        public event Action<DamageEvent> Damaged;
        /// <summary>Short banner text for the HUD (text, seconds).</summary>
        public event Action<string, float> Announcement;
        /// <summary>Player id, item id, result.</summary>
        public event Action<int, string, ShopResult> Purchased;
        /// <summary>Player id, ability slot.</summary>
        public event Action<int, int> AbilityUsed;
        /// <summary>Bomb state changed (picked up, dropped, plant started...).</summary>
        public event Action<string> BombStatus;

        public void RaiseFlow(FlowEvent e) => Flow?.Invoke(e);
        public void RaiseKilled(KillEvent e) => Killed?.Invoke(e);
        public void RaiseDamaged(DamageEvent e) => Damaged?.Invoke(e);
        public void Announce(string text, float seconds = 2.5f) => Announcement?.Invoke(text, seconds);
        public void RaisePurchased(int playerId, string itemId, ShopResult result) => Purchased?.Invoke(playerId, itemId, result);
        public void RaiseAbilityUsed(int playerId, int slot) => AbilityUsed?.Invoke(playerId, slot);
        public void RaiseBombStatus(string status) => BombStatus?.Invoke(status);

        public void Clear()
        {
            Flow = null;
            Killed = null;
            Damaged = null;
            Announcement = null;
            Purchased = null;
            AbilityUsed = null;
            BombStatus = null;
        }
    }
}
