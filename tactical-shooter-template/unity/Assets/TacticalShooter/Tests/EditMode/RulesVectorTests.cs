using System;
using System.Collections.Generic;
using System.Text;
using NUnit.Framework;
using TacticalShooter.Core;
using TacticalShooter.Core.Json;

namespace TacticalShooter.Tests
{
    /// <summary>
    /// Replays shared/tests/rules_vectors.json (generated from the Python reference of
    /// GAME_RULES.md). The Unreal project replays the same file, so both engines agree.
    /// </summary>
    public class RulesVectorTests
    {
        // ---- vector file shape (mapped with JsonMapper) --------------------------------------
        public class EconomyV { public bool won; public int lossStreak; public bool isAttacker; public bool bombPlanted; public int expected; }
        public class KillRewardV { public string weaponId; public int expected; }
        public class HitZoneV { public float hitHeight; public float height; public string expected; }
        public class DamageV { public string weaponId; public string zone; public float distance; public int armor; public float damageTakenMultiplier; public int expectedHealth; public int expectedArmor; }
        public class AreaDamageV { public float raw; public int armor; public float armorPenetration; public int expectedHealth; public int expectedArmor; }
        public class SpreadV { public string weaponId; public float speed; public bool airborne; public bool crouched; public bool aiming; public int shotIndex; public float expected; }
        public class RecoilV { public string weaponId; public int shotIndex; public float expectedPitch; public float expectedYaw; }
        public class RoundEndV { public bool detonated; public bool defused; public bool planted; public int aliveAttackers; public int aliveDefenders; public float roundTimeLeft; public string expectedWinnerSide; public string expectedReason; }
        public class MatchFlowV
        {
            public string name; public string startSideA; public int roundsToWin; public int halftimeAfterRound; public bool overtimeEnabled;
            public int overtimeWinMargin; public int overtimeSwapEveryRounds; public int maxOvertimeRounds; public string winners;
            public string expectedWinner; public int expectedRoundsPlayed; public int expectedScoreA; public int expectedScoreB;
            public int[] expectedSwapsAfterRounds; public string expectedResets; public string expectedFinalSideA; public bool expectedOvertime;
        }
        public class CellCountsV { public int wall, floor, lowCover, highCover, siteA, siteB, attackSpawn, defenseSpawn; }
        public class CenterV { public int x, y; public float east, north; }
        public class CellAtV { public float east, north; public int expectedX, expectedY; }
        public class PathV { public int fromX, fromY, toX, toY; public bool found; public float expectedCost; }
        public class MapV { public string mapId; public int width, height; public CellCountsV cellCounts; public CellCountsV boxCounts; public CenterV[] centers; public CellAtV[] cellAt; public PathV[] paths; }
        public class RngV { public uint seed; public uint[] expectedInts; public float[] expectedFloats; }
        public class HashV { public string text; public uint expected; }
        public class SynthV { public string cueId; public int sampleRate; public int expectedCount; public int[] indices; public float[] expectedValues; }
        public class ShopStepV
        {
            public string op, item, expectedResult, expectedDropped, expectedPrimary, expectedSecondary;
            public int expectedMoney, expectedArmor; public bool expectedKit; public int[] expectedCharges;
        }
        public class ShopV { public string name, agentId, side, initialPrimary; public int initialMoney, initialArmor; public ShopStepV[] steps; }
        public class Vectors
        {
            public EconomyV[] economy; public KillRewardV[] killReward; public HitZoneV[] hitZone; public DamageV[] damage;
            public AreaDamageV[] areaDamage; public SpreadV[] spread; public RecoilV[] recoil; public RoundEndV[] roundEnd;
            public MatchFlowV[] matchFlow; public MapV[] maps; public RngV[] rng; public HashV[] hash; public SynthV[] synth; public ShopV[] shop;
        }

        static Vectors vectors;
        static Vectors V => vectors ?? (vectors = JsonMapper.FromJson<Vectors>(TestData.VectorsJson));
        static GameData D => TestData.Data;

        [Test]
        public void ConfigLoadsWithoutErrors()
        {
            var errors = D.Validate();
            Assert.IsEmpty(errors, string.Join("\n", errors));
        }

        [Test]
        public void Economy()
        {
            foreach (var v in V.economy)
                Assert.AreEqual(v.expected, EconomyRules.RoundIncome(D.Game.economy, v.won, v.lossStreak, v.isAttacker, v.bombPlanted),
                    $"won={v.won} streak={v.lossStreak} attacker={v.isAttacker} planted={v.bombPlanted}");
            foreach (var v in V.killReward)
                Assert.AreEqual(v.expected, EconomyRules.KillReward(D.Game.economy, D.Weapon(v.weaponId)), v.weaponId);
        }

        [Test]
        public void HitZones()
        {
            foreach (var v in V.hitZone)
                Assert.AreEqual(v.expected, Ids.ToId(DamageModel.ZoneFromHeight(D.Game.combat, v.hitHeight, v.height)), $"{v.hitHeight}/{v.height}");
        }

        [Test]
        public void WeaponDamage()
        {
            foreach (var v in V.damage)
            {
                var w = D.Weapon(v.weaponId);
                float raw = DamageModel.RawDamage(w, Ids.ParseZone(v.zone), v.distance);
                var r = DamageModel.ApplyArmor(D.Game.combat, raw, v.armor, w.armorPenetration, v.damageTakenMultiplier);
                string what = $"{v.weaponId} {v.zone} d={v.distance} armor={v.armor} x{v.damageTakenMultiplier}";
                Assert.AreEqual(v.expectedHealth, r.healthDamage, what + " health");
                Assert.AreEqual(v.expectedArmor, r.armorDamage, what + " armor");
            }
            foreach (var v in V.areaDamage)
            {
                var r = DamageModel.ApplyArmor(D.Game.combat, v.raw, v.armor, v.armorPenetration);
                Assert.AreEqual(v.expectedHealth, r.healthDamage, $"area raw={v.raw}");
                Assert.AreEqual(v.expectedArmor, r.armorDamage, $"area raw={v.raw}");
            }
        }

        [Test]
        public void SpreadAndRecoil()
        {
            foreach (var v in V.spread)
            {
                var s = new SpreadInput { horizontalSpeed = v.speed, airborne = v.airborne, crouched = v.crouched, aiming = v.aiming, shotIndex = v.shotIndex };
                Assert.AreEqual(v.expected, WeaponMath.Spread(D.Weapon(v.weaponId), D.Game.movement, s), 1e-4, $"{v.weaponId} speed={v.speed} shot={v.shotIndex}");
            }
            foreach (var v in V.recoil)
            {
                WeaponMath.RecoilKick(D.Weapon(v.weaponId), v.shotIndex, out float p, out float y);
                Assert.AreEqual(v.expectedPitch, p, 1e-5, $"{v.weaponId} #{v.shotIndex} pitch");
                Assert.AreEqual(v.expectedYaw, y, 1e-5, $"{v.weaponId} #{v.shotIndex} yaw");
            }
        }

        [Test]
        public void RoundEndConditions()
        {
            foreach (var v in V.roundEnd)
            {
                bool ended = MatchFlow.EvaluateRoundEnd(v.detonated, v.defused, v.planted, v.aliveAttackers, v.aliveDefenders, v.roundTimeLeft,
                    out Side side, out RoundEndReason reason);
                string what = $"det={v.detonated} def={v.defused} planted={v.planted} att={v.aliveAttackers} def={v.aliveDefenders} t={v.roundTimeLeft}";
                Assert.AreEqual(v.expectedWinnerSide, ended ? Ids.ToId(side) : "none", what);
                Assert.AreEqual(v.expectedReason, reason.ToString(), what);
            }
        }

        [Test]
        public void MatchFlowScenarios()
        {
            foreach (var v in V.matchFlow)
            {
                var match = JsonMapper.FromJson<MatchSettings>(JsonMapper.ToJson(D.Game.match));
                match.roundsToWin = v.roundsToWin;
                match.halftimeAfterRound = v.halftimeAfterRound;
                match.overtimeEnabled = v.overtimeEnabled;
                match.overtimeWinMargin = v.overtimeWinMargin;
                match.overtimeSwapEveryRounds = v.overtimeSwapEveryRounds;
                match.maxOvertimeRounds = v.maxOvertimeRounds;
                var flow = new MatchFlow(match, D.Game.round, D.Game.bomb);
                var resets = new StringBuilder();
                var swaps = new List<int>();
                void Process(List<FlowEvent> events)
                {
                    foreach (var e in events)
                    {
                        if (e.type == FlowEventType.RoundStarted)
                            resets.Append(e.reset == EconomyReset.StartMoney ? 'S' : e.reset == EconomyReset.OvertimeMoney ? 'O' : e.reset == EconomyReset.OvertimeMoneyAndClear ? 'C' : '.');
                        if (e.type == FlowEventType.SidesSwapped) swaps.Add(e.round);
                    }
                }
                var idle = new RoundSnapshot { aliveAttackers = 5, aliveDefenders = 5 };
                Process(flow.Start(Ids.ParseSide(v.startSideA)));
                foreach (char w in v.winners)
                {
                    Assert.IsFalse(flow.IsMatchOver, $"{v.name}: match ended early");
                    int guard = 0;
                    while (flow.Phase == MatchPhase.BuyPhase && guard++ < 1000) Process(flow.Tick(1f, idle));
                    Assert.AreEqual(MatchPhase.Live, flow.Phase, v.name);
                    TeamId team = w == 'A' ? TeamId.A : TeamId.B;
                    bool attackWins = flow.SideOf(team) == Side.Attack;
                    var snap = attackWins ? new RoundSnapshot { aliveAttackers = 3, aliveDefenders = 0 } : new RoundSnapshot { aliveAttackers = 0, aliveDefenders = 3 };
                    Process(flow.Tick(0.1f, snap));
                    Assert.AreEqual(MatchPhase.RoundEnd, flow.Phase, v.name);
                    Assert.AreEqual(team, flow.LastWinner, v.name);
                    guard = 0;
                    while ((flow.Phase == MatchPhase.RoundEnd || flow.Phase == MatchPhase.Halftime) && guard++ < 1000) Process(flow.Tick(1f, idle));
                }
                Assert.IsTrue(flow.IsMatchOver, $"{v.name}: match did not end");
                Assert.AreEqual(v.expectedWinner, flow.IsDraw ? "draw" : flow.Winner.ToString(), v.name);
                Assert.AreEqual(v.expectedRoundsPlayed, flow.Round, v.name + " rounds");
                Assert.AreEqual(v.expectedScoreA, flow.Score[0], v.name + " score A");
                Assert.AreEqual(v.expectedScoreB, flow.Score[1], v.name + " score B");
                CollectionAssert.AreEqual(v.expectedSwapsAfterRounds, swaps, v.name + " swaps");
                Assert.AreEqual(v.expectedResets, resets.ToString(), v.name + " economy resets");
                Assert.AreEqual(v.expectedFinalSideA, Ids.ToId(flow.SideOfA), v.name + " final side");
                Assert.AreEqual(v.expectedOvertime, flow.InOvertime, v.name + " overtime");
            }
        }

        [Test]
        public void MapGridAndNavigation()
        {
            foreach (var v in V.maps)
            {
                var g = MapGrid.Parse(D.Map(v.mapId), out var errors);
                Assert.IsEmpty(errors, string.Join("\n", errors));
                Assert.AreEqual(v.width, g.Width);
                Assert.AreEqual(v.height, g.Height);
                var counts = new[] { v.cellCounts.wall, v.cellCounts.floor, v.cellCounts.lowCover, v.cellCounts.highCover, v.cellCounts.siteA, v.cellCounts.siteB, v.cellCounts.attackSpawn, v.cellCounts.defenseSpawn };
                var boxes = new[] { v.boxCounts.wall, v.boxCounts.floor, v.boxCounts.lowCover, v.boxCounts.highCover, v.boxCounts.siteA, v.boxCounts.siteB, v.boxCounts.attackSpawn, v.boxCounts.defenseSpawn };
                for (int t = 0; t < 8; t++)
                {
                    Assert.AreEqual(counts[t], g.Count((CellType)t), $"count {(CellType)t}");
                    Assert.AreEqual(boxes[t], g.Boxes((CellType)t).Count, $"boxes {(CellType)t}");
                }
                foreach (var c in v.centers)
                {
                    g.CellCenter(c.x, c.y, out float e, out float n);
                    Assert.AreEqual(c.east, e, 1e-4);
                    Assert.AreEqual(c.north, n, 1e-4);
                }
                foreach (var c in v.cellAt)
                {
                    var cell = g.CellAt(c.east, c.north);
                    Assert.AreEqual(c.expectedX, cell.x, $"cellAt({c.east},{c.north}).x");
                    Assert.AreEqual(c.expectedY, cell.y, $"cellAt({c.east},{c.north}).y");
                }
                var nav = new NavGrid(g);
                var path = new List<Cell>();
                foreach (var p in v.paths)
                {
                    bool found = nav.FindPath(new Cell(p.fromX, p.fromY), new Cell(p.toX, p.toY), path);
                    Assert.AreEqual(p.found, found, $"path ({p.fromX},{p.fromY})->({p.toX},{p.toY})");
                    if (!found) continue;
                    Assert.AreEqual(p.expectedCost, nav.LastPathCost, 1e-3, "path cost");
                    var smooth = nav.Smooth(path);
                    Assert.AreEqual(path[0], smooth[0]);
                    Assert.AreEqual(path[path.Count - 1], smooth[smooth.Count - 1]);
                    for (int i = 0; i + 1 < smooth.Count; i++)
                        Assert.IsTrue(nav.ClearLine(smooth[i], smooth[i + 1]) || IsNeighbour(smooth[i], smooth[i + 1]),
                            $"smoothed segment {smooth[i]}->{smooth[i + 1]} crosses a wall");
                }
            }
        }

        static bool IsNeighbour(Cell a, Cell b) => Math.Abs(a.x - b.x) <= 1 && Math.Abs(a.y - b.y) <= 1;

        [Test]
        public void RandomAndHash()
        {
            foreach (var v in V.rng)
            {
                var r = new Rng(v.seed);
                foreach (uint expected in v.expectedInts) Assert.AreEqual(expected, r.NextUInt(), $"seed {v.seed}");
                var f = new Rng(v.seed);
                foreach (float expected in v.expectedFloats) Assert.AreEqual(expected, f.NextFloat(), 1e-6, $"seed {v.seed}");
            }
            foreach (var v in V.hash) Assert.AreEqual(v.expected, Hash.Fnv1a(v.text), v.text);
        }

        [Test]
        public void AudioSynthesis()
        {
            foreach (var v in V.synth)
            {
                var samples = Synth.Generate(D.Cue(v.cueId), v.sampleRate);
                Assert.AreEqual(v.expectedCount, samples.Length, v.cueId);
                for (int i = 0; i < v.indices.Length; i++)
                    Assert.AreEqual(v.expectedValues[i], samples[v.indices[i]], 2e-4, $"{v.cueId}[{v.indices[i]}]");
            }
        }

        [Test]
        public void Shop()
        {
            foreach (var v in V.shop)
            {
                var agent = D.Agent(v.agentId);
                var side = Ids.ParseSide(v.side);
                var lo = new Loadout(D.Game.loadout.defaultSecondary)
                {
                    primaryId = string.IsNullOrEmpty(v.initialPrimary) ? null : v.initialPrimary,
                    armor = v.initialArmor,
                };
                int money = v.initialMoney;
                int n = 0;
                foreach (var s in v.steps)
                {
                    string what = $"{v.name} step {n++}: {s.op} {s.item}";
                    ShopOutcome o = s.op == "buy" ? ShopRules.Buy(D, agent, side, lo, money, s.item) : ShopRules.Sell(D, lo, money, s.item);
                    money = o.money;
                    Assert.AreEqual(s.expectedResult, Ids.ToId(o.result), what);
                    Assert.AreEqual(s.expectedMoney, money, what + " money");
                    Assert.AreEqual(s.expectedDropped, o.droppedWeaponId ?? "", what + " dropped");
                    Assert.AreEqual(s.expectedPrimary, lo.primaryId ?? "", what + " primary");
                    Assert.AreEqual(s.expectedSecondary, lo.secondaryId ?? "", what + " secondary");
                    Assert.AreEqual(s.expectedArmor, lo.armor, what + " armor");
                    Assert.AreEqual(s.expectedKit, lo.hasDefuseKit, what + " kit");
                    CollectionAssert.AreEqual(s.expectedCharges, lo.abilityCharges, what + " charges");
                }
            }
        }
    }
}
