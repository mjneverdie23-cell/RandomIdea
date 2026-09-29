using System.Collections.Generic;

namespace TacticalShooter.Core
{
    public sealed class PurchaseRecord
    {
        public ItemKind kind;
        public string itemId;
        public int price;
        /// <summary>"primary"/"secondary" for weapons, the ability slot index for abilities.</summary>
        public string slot = "";
        public string previousId;
        public int previousArmor;
    }

    /// <summary>What a player owns between rounds. Weapons are ids; ammo is refilled every round.</summary>
    public sealed class Loadout
    {
        public string primaryId;
        public string secondaryId;
        public int armor;
        public bool hasDefuseKit;
        public readonly int[] abilityCharges = new int[4];
        public readonly List<PurchaseRecord> purchases = new List<PurchaseRecord>();

        public Loadout(string defaultSecondary) { secondaryId = defaultSecondary; }

        /// <summary>Death or an economy reset (GAME_RULES.md 2.3 and 7). Ability charges are kept.</summary>
        public void Clear(string defaultSecondary)
        {
            primaryId = null;
            secondaryId = defaultSecondary;
            armor = 0;
            hasDefuseKit = false;
            purchases.Clear();
        }
    }

    /// <summary>
    /// Everything about a participant that outlives a single life: identity, team, money,
    /// stats, loadout. The engine's character object only exists while alive.
    /// </summary>
    public sealed class PlayerRecord
    {
        public int id;
        public string name = "";
        public bool isBot;
        public bool isLocal;
        public TeamId team;
        public string agentId = "";
        public string difficultyId = "normal";
        public int money;
        public int kills, deaths, assists, score, plants, defuses;
        public int ultPoints;
        public bool alive;
        public Loadout loadout;
        /// <summary>Damage this player dealt to each victim id this round (for assists).</summary>
        public readonly Dictionary<int, int> damageDealt = new Dictionary<int, int>();

        public PlayerRecord(string defaultSecondary) { loadout = new Loadout(defaultSecondary); }

        public void AddUltPoints(AgentDef agent, int points)
        {
            int cap = UltCost(agent);
            if (cap <= 0) return;
            ultPoints = System.Math.Min(cap, ultPoints + points);
        }

        public static int UltCost(AgentDef agent)
        {
            if (agent == null) return 0;
            foreach (var s in agent.abilities) if (s.IsUltimate) return s.ultPoints;
            return 0;
        }
    }
}
