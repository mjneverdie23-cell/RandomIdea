using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using TacticalShooter.Core;

namespace TacticalShooter.Tests
{
    /// <summary>Property tests that go beyond the fixed vectors.</summary>
    public class CoreGameplayTests
    {
        static GameData D => TestData.Data;

        [Test]
        public void UnityCopyOfConfigMatchesShared()
        {
            // Unity loads Resources/TacticalShooter/{Config,Maps}. They must equal shared/.
            foreach (var pair in new[] { ("config", "Config"), ("maps", "Maps") })
            {
                string src = Path.Combine(TestData.SharedDir, pair.Item1);
                foreach (string file in Directory.GetFiles(src, "*.json"))
                {
                    string copy = Path.Combine(TestData.UnityDataDir, pair.Item2, Path.GetFileName(file));
                    Assert.IsTrue(File.Exists(copy), $"missing {copy}; run python3 shared/tools/sync_shared.py");
                    Assert.AreEqual(File.ReadAllText(file), File.ReadAllText(copy),
                        $"{Path.GetFileName(file)} differs from shared/; run python3 shared/tools/sync_shared.py");
                }
            }
        }

        [Test]
        public void BotPurchasesAreAlwaysLegal()
        {
            var rng = new Rng(42);
            foreach (var agent in D.Agents)
            {
                foreach (Side side in new[] { Side.Attack, Side.Defense })
                {
                    for (int trial = 0; trial < 50; trial++)
                    {
                        int money = rng.Range(0, D.Game.economy.maxMoney + 1);
                        var lo = new Loadout(D.Game.loadout.defaultSecondary);
                        var plan = BotBuyPlanner.Plan(D, agent, side, lo, money, rng);
                        foreach (string item in plan)
                        {
                            var o = ShopRules.Buy(D, agent, side, lo, money, item);
                            Assert.AreEqual(ShopResult.Ok, o.result, $"{agent.id} {side} ${money}: {item}");
                            money = o.money;
                        }
                        Assert.GreaterOrEqual(money, 0);
                        if (lo.primaryId == null && money >= D.Bots.buy.fullBuyMoney)
                            Assert.Fail($"{agent.id} kept ${money} without buying a primary");
                    }
                }
            }
        }

        [Test]
        public void RandomMatchesAlwaysEndAndMoneyStaysInRange()
        {
            var rng = new Rng(7);
            for (int match = 0; match < 200; match++)
            {
                var flow = new MatchFlow(D.Game.match, D.Game.round, D.Game.bomb);
                var money = new[] { 0, 0 };
                void Apply(List<FlowEvent> events)
                {
                    foreach (var e in events)
                    {
                        if (e.type == FlowEventType.RoundStarted)
                        {
                            if (e.reset == EconomyReset.StartMoney) money[0] = money[1] = D.Game.economy.startMoney;
                            else if (e.reset != EconomyReset.None) money[0] = money[1] = D.Game.match.overtimeStartMoney;
                        }
                        if (e.type == FlowEventType.RoundEnded)
                        {
                            for (int t = 0; t < 2; t++)
                            {
                                bool won = (int)e.team == t;
                                bool attacker = flow.SideOf((TeamId)t) == Side.Attack;
                                int income = EconomyRules.RoundIncome(D.Game.economy, won, flow.LossStreak[t], attacker, e.bombPlanted);
                                money[t] = EconomyRules.AddMoney(D.Game.economy, money[t], income);
                                Assert.LessOrEqual(money[t], D.Game.economy.maxMoney);
                            }
                        }
                    }
                }
                Apply(flow.Start(rng.Chance(0.5f) ? Side.Attack : Side.Defense));
                int ticks = 0;
                while (!flow.IsMatchOver && ticks++ < 200000)
                {
                    var snap = new RoundSnapshot { aliveAttackers = 5, aliveDefenders = 5 };
                    if (flow.Phase == MatchPhase.Live)
                    {
                        float roll = rng.NextFloat();
                        if (roll < 0.05f) snap.aliveAttackers = 0;
                        else if (roll < 0.10f) snap.aliveDefenders = 0;
                        else if (roll < 0.12f) flow.NotifyBombPlanted(rng.Range(0, 2));
                        else if (roll < 0.13f) flow.NotifyBombDefused();
                    }
                    Apply(flow.Tick(0.5f, snap));
                }
                Assert.IsTrue(flow.IsMatchOver, "match never ended");
                int total = flow.Score[0] + flow.Score[1];
                Assert.AreEqual(flow.Round, total, "one point per round");
                if (!flow.IsDraw && !flow.InOvertime) Assert.AreEqual(D.Game.match.roundsToWin, flow.Score[(int)flow.Winner]);
            }
        }

        [Test]
        public void EveryAgentCanBeBoughtForAndHasFourSlots()
        {
            foreach (var agent in D.Agents)
            {
                Assert.AreEqual(4, agent.abilities.Length, agent.id);
                var catalog = ShopRules.Catalog(D, agent);
                Assert.IsTrue(catalog.Exists(i => i.kind == ItemKind.Ability), agent.id);
                Assert.IsFalse(catalog.Exists(i => i.id == D.Game.loadout.defaultMelee), "knife must not be in the shop");
            }
        }

        [Test]
        public void ArmourTakesTheFirstHitsOfARifle()
        {
            var rifle = D.Weapon("valkyrie");
            int health = D.Game.combat.maxHealth, armor = 50, shots = 0;
            while (health > 0 && shots < 20)
            {
                var r = DamageModel.ApplyArmor(D.Game.combat, DamageModel.RawDamage(rifle, HitZone.Body, 10f), armor, rifle.armorPenetration);
                armor -= r.armorDamage;
                health -= r.healthDamage;
                shots++;
            }
            Assert.AreEqual(4, shots, "a Valkyrie needs four body shots against heavy shields");
        }

        [Test]
        public void SmoothedPathsBetweenAllSpawnsAndSitesExist()
        {
            var g = MapGrid.Parse(D.Map("outpost"), out _);
            var nav = new NavGrid(g);
            var path = new List<Cell>();
            foreach (var from in new[] { CellType.AttackSpawn, CellType.DefenseSpawn })
                foreach (var to in new[] { CellType.SiteA, CellType.SiteB })
                    foreach (var a in g.CellsOf(from))
                    {
                        var b = g.CellsOf(to)[0];
                        Assert.IsTrue(nav.FindPath(a, b, path), $"{a} -> {b}");
                    }
        }
    }
}
