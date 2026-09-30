using System.Collections.Generic;
using TacticalShooter.Core;
using UnityEngine;

namespace TacticalShooter
{
    /// <summary>
    /// Runs one match: creates the roster and characters, drives everything in one explicit
    /// tick order (think -> act -> world -> rules), and reacts to MatchFlow events with spawning,
    /// economy and announcements. Offline: one human and bots. The Intent/MatchFlow split is
    /// where a network layer would go (clients send Intents, the server runs this class).
    /// </summary>
    public sealed class MatchController : MonoBehaviour
    {
        public bool Running { get; private set; }
        public MatchFlow Flow { get; private set; }
        public MatchOptions Options { get; private set; }
        public readonly List<PlayerRecord> Players = new List<PlayerRecord>();
        public PlayerRecord Local { get; private set; }
        public BombSystem Bomb { get; private set; }
        public EffectsWorld Effects { get; private set; }
        public Combat Combat { get; private set; }
        public PlayerController Player { get; private set; }
        public TeamPlan Plan { get; private set; }
        public float Time { get; private set; }
        public uint Seed { get; private set; }
        public Rng Rng { get; private set; }
        public int MvpId { get; private set; } = -1;
        public WorldMap WorldMap => Game.World;

        readonly Dictionary<int, TacticalCharacter> characters = new Dictionary<int, TacticalCharacter>();
        readonly Dictionary<int, BotBrain> brains = new Dictionary<int, BotBrain>();
        readonly Dictionary<int, bool> previousInteract = new Dictionary<int, bool>();
        Transform charactersRoot;

        static GameData Data => Game.Data;
        static GameConfig Config => Game.Data.Game;

        public TacticalCharacter Character(int id) => characters.TryGetValue(id, out var c) ? c : null;
        public TacticalCharacter LocalCharacter => Local != null ? Character(Local.id) : null;
        public IEnumerable<TacticalCharacter> AllCharacters => characters.Values;
        public BotBrain Brain(int id) => brains.TryGetValue(id, out var b) ? b : null;

        /// <summary>A fresh list every call, so callers may kill characters while iterating.</summary>
        public List<TacticalCharacter> AliveCharacters()
        {
            var list = new List<TacticalCharacter>(characters.Count);
            foreach (var c in characters.Values) if (c.Alive) list.Add(c);
            return list;
        }

        public PlayerRecord Record(int id)
        {
            foreach (var p in Players) if (p.id == id) return p;
            return null;
        }

        public Side SideOf(PlayerRecord p) => Flow.SideOf(p.team);

        // ---- lifecycle ------------------------------------------------------------------------

        public void Begin(MatchOptions options)
        {
            End();
            Options = options;
            Seed = options.seed != 0 ? options.seed : (uint)System.Environment.TickCount | 1u;
            Rng = new Rng(Seed);
            Time = 0f;
            MvpId = -1;

            var match = Core.Json.JsonMapper.FromJson<MatchSettings>(Core.Json.JsonMapper.ToJson(Config.match));
            match.roundsToWin = Mathf.Max(1, options.roundsToWin);
            match.halftimeAfterRound = Mathf.Max(1, options.roundsToWin - 1);
            match.teamSize = Mathf.Clamp(options.teamSize, 1, 5);
            Flow = new MatchFlow(match, Config.round, Config.bomb);

            charactersRoot = new GameObject("Characters").transform;
            charactersRoot.SetParent(transform, false);
            Effects = new EffectsWorld(this, transform);
            Bomb = new BombSystem(this, transform);
            Combat = new Combat(this);
            Player = new PlayerController(this);
            Plan = new TeamPlan();

            CreateRoster(match.teamSize);
            foreach (var rec in Players)
            {
                var ch = TacticalCharacter.Spawn(this, rec, charactersRoot);
                ch.gameObject.SetActive(false);
                characters[rec.id] = ch;
                if (rec.isBot) brains[rec.id] = new BotBrain(this, ch, Data.Difficulty(rec.difficultyId));
                ch.Weapons.Fired += () => { if (ch == Player.ViewTarget) Game.Camera.Kick(); };
            }
            Running = true;
            foreach (var e in Flow.Start(options.playerSide)) Handle(e);
        }

        public void End()
        {
            Running = false;
            foreach (var c in characters.Values) if (c != null) Destroy(c.gameObject);
            characters.Clear();
            brains.Clear();
            previousInteract.Clear();
            Effects?.Destroy();
            Bomb?.Destroy();
            Effects = null;
            Bomb = null;
            if (charactersRoot != null) Destroy(charactersRoot.gameObject);
            Players.Clear();
            Local = null;
        }

        void CreateRoster(int teamSize)
        {
            Players.Clear();
            string defaultSecondary = Config.loadout.defaultSecondary;
            var names = new List<string>(Data.Bots.names);
            Rng.Shuffle(names);
            int nameIndex = 0;
            var agents = new List<AgentDef>(Data.Agents);

            Local = new PlayerRecord(defaultSecondary)
            {
                id = 0, name = Options.playerName, isLocal = true, team = TeamId.A, agentId = Data.Agent(Options.agentId).id,
            };
            Players.Add(Local);
            int nextId = 1;
            foreach (TeamId team in new[] { TeamId.A, TeamId.B })
            {
                var pool = new List<AgentDef>(agents);
                if (team == TeamId.A) pool.RemoveAll(a => a.id == Local.agentId);
                Rng.Shuffle(pool);
                int bots = team == TeamId.A ? teamSize - 1 : teamSize;
                for (int i = 0; i < bots; i++)
                {
                    string name = names.Count > 0 ? names[nameIndex++ % names.Count] : "Bot";
                    if (nameIndex > names.Count) name += " " + (nameIndex / names.Count + 1);
                    var agent = pool.Count > 0 ? pool[i % pool.Count] : agents[0];
                    Players.Add(new PlayerRecord(defaultSecondary)
                    {
                        id = nextId++, name = name, isBot = true, team = team, agentId = agent.id, difficultyId = Options.difficulty,
                    });
                }
            }
        }

        // ---- tick -----------------------------------------------------------------------------

        void Update()
        {
            if (!Running) return;
            float dt = Mathf.Min(UnityEngine.Time.deltaTime, 0.05f);
            if (dt > 0f && !Game.Paused) Tick(dt);
            Player.UpdateCamera();
        }

        void Tick(float dt)
        {
            Time += dt;
            bool frozen = Flow.MovementFrozen || Flow.IsMatchOver;
            // 1. think + 2. act, in roster order (players and bots are treated identically).
            foreach (var rec in Players)
            {
                var ch = Character(rec.id);
                if (ch == null || !ch.Alive) continue;
                Intent intent = rec.isLocal ? Player.BuildIntent(ch) : brains[rec.id].Think(dt);
                ch.Frozen = frozen;
                ch.InteractLock = Bomb.IsBusy(ch);
                ch.Tick(intent, dt);
                HandleDropAndSwap(ch, intent);
            }
            // 3. world
            Effects.Tick(dt);
            Bomb.Tick(dt);
            // 4. rules
            foreach (var e in Flow.Tick(dt, Snapshot())) Handle(e);
        }

        RoundSnapshot Snapshot()
        {
            var s = new RoundSnapshot();
            foreach (var rec in Players)
            {
                if (!rec.alive) continue;
                if (Flow.SideOf(rec.team) == Side.Attack) s.aliveAttackers++; else s.aliveDefenders++;
            }
            return s;
        }

        void HandleDropAndSwap(TacticalCharacter ch, in Intent intent)
        {
            if (!ch.Alive) return;
            previousInteract.TryGetValue(ch.Id, out bool wasInteract);
            previousInteract[ch.Id] = intent.interact;
            if (intent.drop && !ch.CarryingBomb)
            {
                var slot = (WeaponSlot)ch.Weapons.CurrentSlot;
                var current = ch.Weapons.Current;
                if (slot != WeaponSlot.Melee && current != null && (slot == WeaponSlot.Primary || current.def.price > 0))
                {
                    var dropped = ch.Weapons.Remove(slot);
                    if (slot == WeaponSlot.Primary) ch.Record.loadout.primaryId = null; else ch.Record.loadout.secondaryId = null;
                    Effects.SpawnPickup(dropped, DropPoint(ch, 1.2f), ch);
                }
            }
            float defuseRadius = Config.bomb.interactRadius;
            bool busyWithBomb = Bomb.IsBusy(ch) || (ch.CarryingBomb && WorldMap.SiteAt(ch.Feet) >= 0) ||
                                (Bomb.State == BombState.Planted && ch.Side == Side.Defense &&
                                 (ch.Feet - Bomb.Position).sqrMagnitude <= defuseRadius * defuseRadius);
            if (intent.interact && !wasInteract && !busyWithBomb) Effects.TrySwap(ch);
        }

        /// <summary>
        /// Where something the character drops lands: up to distance in front of the feet, stopped
        /// short of walls and cover so it can always be picked up again.
        /// </summary>
        public Vector3 DropPoint(TacticalCharacter ch, float distance)
        {
            Vector3 dir = ch.transform.forward;
            Vector3 from = ch.Feet + Vector3.up * 0.3f;
            if (Physics.SphereCast(from, 0.1f, dir, out RaycastHit hit, distance, Layers.WorldMask, QueryTriggerInteraction.Ignore))
                distance = Mathf.Max(0f, hit.distance - 0.15f);
            return ch.Feet + dir * distance;
        }

        // ---- flow events ----------------------------------------------------------------------

        void Handle(FlowEvent e)
        {
            switch (e.type)
            {
                case FlowEventType.RoundStarted:
                    StartRound(e.reset);
                    break;
                case FlowEventType.PhaseChanged:
                    if (e.phase == MatchPhase.Live)
                    {
                        Game.Audio.Play2D("round_start");
                        Game.Events.Announce("GO!", 1.2f);
                    }
                    break;
                case FlowEventType.OvertimeStarted:
                    Game.Events.Announce("OVERTIME", 3f);
                    break;
                case FlowEventType.BombPlanted:
                    Game.Audio.Play2D("bomb_planted");
                    Game.Events.Announce("BOMB PLANTED AT " + Ids.SiteName(e.site), 2.5f);
                    Plan.OnBombPlanted(e.site);
                    break;
                case FlowEventType.BombDefused:
                    Game.Audio.Play2D("bomb_defused");
                    break;
                case FlowEventType.BombDetonated:
                    Bomb.Explode();
                    break;
                case FlowEventType.RoundEnded:
                    OnRoundEnded(e);
                    break;
                case FlowEventType.SidesSwapped:
                    Game.Events.Announce("SWITCHING SIDES", 3f);
                    break;
                case FlowEventType.MatchEnded:
                    OnMatchEnded();
                    break;
            }
            Game.Events.RaiseFlow(e);
        }

        void StartRound(EconomyReset reset)
        {
            var eco = Config.economy;
            string defaultSecondary = Config.loadout.defaultSecondary;
            Effects.ClearAll();
            Bomb.Reset();
            foreach (var rec in Players)
            {
                switch (reset)
                {
                    case EconomyReset.StartMoney:
                        rec.money = eco.startMoney;
                        rec.loadout.Clear(defaultSecondary);
                        break;
                    case EconomyReset.OvertimeMoney:
                        rec.money = Config.match.overtimeStartMoney;
                        break;
                    case EconomyReset.OvertimeMoneyAndClear:
                        rec.money = Config.match.overtimeStartMoney;
                        rec.loadout.Clear(defaultSecondary);
                        break;
                }
                rec.loadout.purchases.Clear();
                rec.damageDealt.Clear();
                ShopRules.GrantFreeCharges(Data.Agent(rec.agentId), rec.loadout);
            }

            foreach (Side side in new[] { Side.Attack, Side.Defense })
            {
                var cells = new List<Cell>(WorldMap.SpawnCells(side));
                Rng.Shuffle(cells);
                Vector3 centroid = Vector3.zero;
                foreach (var c in cells) centroid += WorldMap.CellToWorld(c);
                if (cells.Count > 0) centroid /= cells.Count;
                Vector3 toCenter = WorldMap.Center - centroid;
                float yaw = Mathf.Atan2(toCenter.x, toCenter.z) * Mathf.Rad2Deg;
                int i = 0;
                foreach (var rec in Players)
                {
                    if (Flow.SideOf(rec.team) != side) continue;
                    var cell = cells.Count > 0 ? cells[i++ % cells.Count] : new Cell(0, 0);
                    float jitter = WorldMap.Grid.CellSize * 0.25f;
                    Vector3 pos = WorldMap.CellToWorld(cell) + new Vector3(Rng.Range(-jitter, jitter), 0.05f, Rng.Range(-jitter, jitter));
                    Character(rec.id).Respawn(pos, yaw);
                }
            }

            var attackers = AliveCharacters().FindAll(c => c.Side == Side.Attack);
            if (attackers.Count > 0) Bomb.GiveTo(attackers[Rng.Range(0, attackers.Count)]);
            Plan.OnRoundStart(this);
            foreach (var b in brains.Values) b.OnSpawn();
            if (LocalCharacter != null) Player.OnSpawn(LocalCharacter);

            foreach (var rec in Players)
            {
                if (!rec.isBot) continue;
                var plan = BotBuyPlanner.Plan(Data, Data.Agent(rec.agentId), SideOf(rec), rec.loadout, rec.money, Rng);
                foreach (string item in plan) TryBuy(rec, item);
            }
            Game.Events.Announce(reset == EconomyReset.None ? "BUY PHASE" : "BUY PHASE - press " + KeyNames.Label(Game.Keys.Key("BuyMenu")), 2.5f);
        }

        void OnRoundEnded(FlowEvent e)
        {
            var eco = Config.economy;
            foreach (var rec in Players)
            {
                bool won = rec.team == e.team;
                bool attacker = Flow.SideOf(rec.team) == Side.Attack;
                int income = EconomyRules.RoundIncome(eco, won, Flow.LossStreak[(int)rec.team], attacker, e.bombPlanted);
                rec.money = EconomyRules.AddMoney(eco, rec.money, income);
                var ch = Character(rec.id);
                if (ch != null && ch.Alive) rec.loadout.armor = ch.Armor;
            }
            string who = e.side == Side.Attack ? "ATTACKERS WIN" : "DEFENDERS WIN";
            string why;
            switch (e.reason)
            {
                case RoundEndReason.BombDetonated: why = "The bomb detonated"; break;
                case RoundEndReason.BombDefused: why = "The bomb was defused"; break;
                case RoundEndReason.TimeExpired: why = "Time ran out"; break;
                default: why = e.side == Side.Attack ? "Defenders eliminated" : "Attackers eliminated"; break;
            }
            Game.Events.Announce(who + "\n" + why, Config.round.roundEndSeconds);
            Game.Audio.Play2D(Local != null && e.team == Local.team ? "round_win" : "round_lose");
        }

        void OnMatchEnded()
        {
            int best = int.MinValue;
            foreach (var p in Players)
                if (p.score > best) { best = p.score; MvpId = p.id; }
            Game.UI.ShowMatchEnd();
        }

        // ---- combat callbacks -----------------------------------------------------------------

        public void OnCharacterKilled(TacticalCharacter victim, TacticalCharacter killer, string sourceId, bool headshot)
        {
            var d = Config;
            var v = victim.Record;
            v.deaths++;
            v.AddUltPoints(victim.Agent, d.ultimate.pointsPerDeath);
            if (killer != null && killer != victim && killer.Team != victim.Team)
            {
                var k = killer.Record;
                k.kills++;
                k.score += d.scoring.kill;
                k.money = EconomyRules.AddMoney(d.economy, k.money, EconomyRules.KillReward(d.economy, Data.Weapon(sourceId)));
                k.AddUltPoints(killer.Agent, d.ultimate.pointsPerKill);
            }
            int assister = -1;
            foreach (var p in Players)
            {
                if ((killer != null && p == killer.Record) || p.team == v.team) continue;
                if (p.damageDealt.TryGetValue(v.id, out int dmg) && dmg >= d.combat.assistMinDamage)
                {
                    p.assists++;
                    p.score += d.scoring.assist;
                    if (assister < 0) assister = p.id;
                }
            }

            var w = victim.Weapons;
            var drop = w.Slots[0] ?? (w.Slots[1] != null && w.Slots[1].def.price > 0 ? w.Slots[1] : null);
            if (drop != null) Effects.SpawnPickup(drop, victim.Feet + new Vector3(Rng.Range(-0.5f, 0.5f), 0f, Rng.Range(-0.5f, 0.5f)));
            if (Bomb.Carrier == victim) Bomb.Drop(victim.Feet);
            v.loadout.Clear(d.loadout.defaultSecondary);

            string sourceName = sourceId == "bomb" ? "Bomb" : Data.Weapon(sourceId)?.displayName ?? Data.Ability(sourceId)?.displayName ?? sourceId;
            Game.Events.RaiseKilled(new KillEvent
            {
                killerId = killer != null ? killer.Id : -1, victimId = victim.Id, assisterId = assister, sourceId = sourceId,
                sourceName = sourceName, headshot = headshot,
            });
            if (victim == LocalCharacter) Player.OnLocalDeath();
        }

        public void OnWeaponChanged(TacticalCharacter ch, WeaponDef def)
        {
            if (def.Slot == WeaponSlot.Primary) ch.Record.loadout.primaryId = def.id;
            else if (def.Slot == WeaponSlot.Secondary) ch.Record.loadout.secondaryId = def.id;
        }

        // ---- shop -----------------------------------------------------------------------------

        public bool CanBuyNow(PlayerRecord rec)
        {
            if (!Running || rec == null || !Flow.CanBuy) return false;
            var ch = Character(rec.id);
            if (ch == null || !ch.Alive) return false;
            return !Config.round.buyOnlyInSpawnZone || WorldMap.InSpawnZone(SideOf(rec), ch.Feet);
        }

        public ShopResult TryBuy(PlayerRecord rec, string itemId)
        {
            if (!CanBuyNow(rec)) return Report(rec, itemId, ShopResult.NotAllowed);
            var ch = Character(rec.id);
            var o = ShopRules.Buy(Data, Data.Agent(rec.agentId), SideOf(rec), rec.loadout, rec.money, itemId);
            if (o.Ok)
            {
                rec.money = o.money;
                var def = Data.Weapon(itemId);
                if (def != null)
                {
                    var old = ch.Weapons.Replace(new WeaponInstance(def));
                    if (o.droppedWeaponId != null && old != null) Effects.SpawnPickup(old, ch.Feet + ch.transform.forward * 0.8f);
                }
                // Only an armour purchase changes armour. The loadout copy is stale during the buy
                // grace period (damage, Fortify), so copying it for other items would undo those.
                if (IsArmor(itemId)) ch.Armor = rec.loadout.armor;
            }
            return Report(rec, itemId, o.result);
        }

        public ShopResult TrySell(PlayerRecord rec, string itemId)
        {
            if (!Running || rec == null || !Flow.CanSell || !Config.economy.sellBackDuringBuyPhase) return ShopResult.NotAllowed;
            var ch = Character(rec.id);
            if (ch == null || !ch.Alive) return ShopResult.NotAllowed;
            var o = ShopRules.Sell(Data, rec.loadout, rec.money, itemId);
            if (o.Ok)
            {
                rec.money = o.money;
                var def = Data.Weapon(itemId);
                if (def != null)
                {
                    string now = def.Slot == WeaponSlot.Primary ? rec.loadout.primaryId : rec.loadout.secondaryId;
                    if (now == null) ch.Weapons.Remove(def.Slot);
                    else ch.Weapons.Replace(new WeaponInstance(Data.Weapon(now)));
                }
                if (IsArmor(itemId)) ch.Armor = rec.loadout.armor;
            }
            return Report(rec, itemId, o.result);
        }

        static bool IsArmor(string itemId) => Data.EquipmentItem(itemId)?.type == "armor";

        ShopResult Report(PlayerRecord rec, string itemId, ShopResult result)
        {
            Game.Events.RaisePurchased(rec.id, itemId, result);
            if (rec.isLocal) Game.Audio.Play2D(result == ShopResult.Ok ? "buy" : "ui_error");
            return result;
        }
    }
}
