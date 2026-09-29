using System.Collections.Generic;
using TacticalShooter.Core;
using UnityEngine;

namespace TacticalShooter
{
    /// <summary>
    /// Per-round team decisions for bots: which site the attackers hit, where each defender holds.
    /// </summary>
    public sealed class TeamPlan
    {
        public int AttackSite;
        public int BombSite = -1;
        readonly Dictionary<int, Cell> defenderSpots = new Dictionary<int, Cell>();
        readonly HashSet<int> viaMid = new HashSet<int>();

        public void OnRoundStart(MatchController m)
        {
            var world = m.WorldMap;
            bool a = world.HasSite(0), b = world.HasSite(1);
            AttackSite = a && b ? m.Rng.Range(0, 2) : (a ? 0 : 1);
            BombSite = -1;
            defenderSpots.Clear();
            viaMid.Clear();
            int defenderIndex = 0;
            foreach (var p in m.Players)
            {
                if (!p.isBot) continue;
                if (m.SideOf(p) == Side.Defense)
                {
                    int site = a && b ? defenderIndex++ % 2 : (a ? 0 : 1);
                    defenderSpots[p.id] = PickSpotNear(m, world.SiteCenter(site), Game.Data.Bots.behaviour.holdRadiusCells);
                }
                else if (m.Rng.Chance(Game.Data.Bots.behaviour.midRouteChance)) viaMid.Add(p.id);
            }
        }

        public void OnBombPlanted(int site) => BombSite = site;

        public bool GoesViaMid(int id) => viaMid.Contains(id);

        public Cell DefenderSpot(MatchController m, int id)
        {
            if (!defenderSpots.TryGetValue(id, out var c))
                defenderSpots[id] = c = PickSpotNear(m, m.WorldMap.SiteCenter(0), 4);
            return c;
        }

        /// <summary>A random walkable cell within radius cells of a point that can see the point.</summary>
        public static Cell PickSpotNear(MatchController m, Vector3 point, int radius)
        {
            var world = m.WorldMap;
            Cell center = world.Nav.NearestWalkable(world.WorldToCell(point));
            var options = new List<Cell>();
            for (int dy = -radius; dy <= radius; dy++)
                for (int dx = -radius; dx <= radius; dx++)
                {
                    var c = new Cell(center.x + dx, center.y + dy);
                    if (dx * dx + dy * dy > radius * radius || !world.Nav.IsWalkable(c)) continue;
                    if (world.Nav.ClearLine(c, center)) options.Add(c);
                }
            return options.Count > 0 ? options[m.Rng.Range(0, options.Count)] : center;
        }
    }

    /// <summary>
    /// Bot AI: perceive (sight cone, line of sight, smoke, hearing, recon) -> decide a task
    /// (hold, move, plant, defuse, fetch the bomb, guard) -> path on the NavGrid -> aim and shoot
    /// with human-like reaction time, aim error and recoil control. Produces the same Intent a
    /// player does, so bots obey every rule players do. Tuning: shared/config/bots.json.
    /// </summary>
    public sealed class BotBrain
    {
        enum Task { Hold, Move, Plant, Defuse, Fetch, Guard }

        readonly MatchController match;
        readonly TacticalCharacter self;
        readonly BotDifficulty diff;
        readonly BotBehaviourSettings beh;
        readonly Rng rng;

        float yaw, pitch;
        Task task;
        float decisionTimer;

        // perception
        float perceiveTimer;
        TacticalCharacter target;
        float targetAcquiredTime;
        bool aimHead;
        Vector2 aimError;
        float aimErrorTimer;
        Vector3 lastKnownPos;
        float lastKnownTime = -99f;

        // navigation
        readonly List<Cell> cellPath = new List<Cell>();
        readonly List<Vector3> waypoints = new List<Vector3>();
        int waypoint;
        Cell goal;
        bool hasGoal;
        bool hasVia;
        Cell via;
        bool arrived;
        float arrivedTime;
        Vector3 progressPos;
        float progressTimer;
        float unstickTimer;
        Vector3 unstickDir;
        bool jumpNext;

        // combat
        int burstFired;
        int lastShotsFired;
        float burstPauseLeft;
        bool fireToggle;
        float strafe = 1f;
        float strafeTimer;
        float abilityTimer;
        float holdYaw;
        float lookTimer;

        public BotBrain(MatchController match, TacticalCharacter self, BotDifficulty difficulty)
        {
            this.match = match;
            this.self = self;
            diff = difficulty;
            beh = Game.Data.Bots.behaviour;
            rng = new Rng(match.Seed ^ (uint)(self.Id * 104729 + 17));
        }

        public string DebugTask => task + (target != null ? " -> " + target.Record.name : "");

        public void OnSpawn()
        {
            yaw = self.Yaw;
            pitch = 0f;
            holdYaw = yaw;
            target = null;
            lastKnownTime = -99f;
            hasGoal = hasVia = arrived = false;
            cellPath.Clear();
            waypoints.Clear();
            task = Task.Move;
            decisionTimer = rng.Range(0f, beh.decisionJitterSeconds);
            abilityTimer = rng.Range(1f, 3f);
            progressPos = self.Feet;
            progressTimer = 0f;
            burstFired = 0;
            lastShotsFired = self.Weapons.ShotsFired;
        }

        public Intent Think(float dt)
        {
            var flow = match.Flow;
            if (flow.Phase != MatchPhase.Live)
            {
                // Buy phase / round end: look around a little, nothing else.
                yaw = Mathf.MoveTowardsAngle(yaw, holdYaw, 60f * dt);
                return Intent.Idle(yaw, pitch);
            }
            var intent = Intent.Idle(yaw, pitch);
            Perceive(dt);
            decisionTimer -= dt;
            if (decisionTimer <= 0f)
            {
                Decide();
                decisionTimer = beh.repathSeconds;
            }

            Vector3 moveDir = Vector3.zero;
            bool interact = false;
            if (task == Task.Plant && self.CarryingBomb && match.WorldMap.SiteAt(self.Feet) >= 0 && target == null)
                interact = true;
            else if (task == Task.Defuse && (self.Feet - match.Bomb.Position).sqrMagnitude < 1.2f * 1.2f &&
                     (target == null || MustDefuseNow()))
                interact = true;
            else if (target == null || task == Task.Fetch)
            {
                moveDir = FollowPath(dt);
                // The path ends at a cell centre; walk the last metre to the bomb itself.
                if (moveDir == Vector3.zero && (task == Task.Defuse || task == Task.Fetch))
                {
                    Vector3 d = match.Bomb.Position - self.Feet;
                    d.y = 0f;
                    if (d.magnitude > 0.6f) moveDir = d.normalized;
                }
            }

            if (target != null)
            {
                Aim(dt);
                Fight(dt, ref intent, ref moveDir);
            }
            else Look(dt, moveDir);

            UseAbilities(dt, ref intent);
            ManageWeapons(ref intent);

            if (interact)
            {
                intent.interact = true;
                moveDir = Vector3.zero;
            }
            ToMoveIntent(moveDir, ref intent);
            intent.jump = jumpNext;
            jumpNext = false;
            intent.yaw = yaw;
            intent.pitch = pitch;
            return intent;
        }

        bool MustDefuseNow()
        {
            var s = Game.Data.Game.bomb;
            float need = self.Record.loadout.hasDefuseKit ? s.defuseKitSeconds : s.defuseSeconds;
            return match.Flow.BombTimeLeft < need * (1f - match.Bomb.DefuseProgress) + 1.5f;
        }

        // ---- perception ----------------------------------------------------------------------

        void Perceive(float dt)
        {
            if (target != null && !target.Alive) target = null;
            perceiveTimer -= dt;
            if (perceiveTimer > 0f) return;
            perceiveTimer = beh.perceptionInterval;
            if (self.BlindTimeLeft > 0.3f) { target = null; return; }

            Vector3 eye = self.EyePosition;
            Vector3 view = Quaternion.Euler(-pitch, yaw, 0f) * Vector3.forward;
            TacticalCharacter best = null;
            float bestDist = float.MaxValue;
            bool currentVisible = false;
            foreach (var enemy in match.AliveCharacters())
            {
                if (enemy.Team == self.Team) continue;
                if (enemy.RevealedUntil > match.Time) Remember(enemy.Feet);
                if (match.Time - enemy.LastNoiseTime < 0.6f && (enemy.LastNoisePosition - self.Feet).sqrMagnitude < 25f * 25f)
                    Remember(enemy.LastNoisePosition);
                Vector3 to = enemy.ChestPosition - eye;
                float dist = to.magnitude;
                if (dist > diff.sightRange) continue;
                bool inCone = Vector3.Angle(view, to) < diff.viewAngle * 0.5f || dist < 2.5f || enemy == target;
                if (!inCone) continue;
                if (!match.Combat.LineOfSight(eye, enemy.HeadPosition) && !match.Combat.LineOfSight(eye, enemy.ChestPosition)) continue;
                if (enemy == target) currentVisible = true;
                if (dist < bestDist) { bestDist = dist; best = enemy; }
            }
            if (currentVisible) best = target;
            if (best == null && match.Time - self.LastDamagedTime < 0.5f) Remember(self.LastDamageFrom);
            if (best != target && best != null)
            {
                targetAcquiredTime = match.Time;
                aimHead = rng.Chance(diff.headshotBias);
                aimError = RandomInCircle() * diff.aimErrorDegrees;
                burstFired = 0;
            }
            target = best;
            if (target != null) Remember(target.Feet);
        }

        void Remember(Vector3 p)
        {
            lastKnownPos = p;
            lastKnownTime = match.Time;
        }

        Vector2 RandomInCircle()
        {
            float a = rng.Range(0f, Mathf.PI * 2f), r = Mathf.Sqrt(rng.NextFloat());
            return new Vector2(Mathf.Cos(a) * r, Mathf.Sin(a) * r);
        }

        // ---- decisions -----------------------------------------------------------------------

        void Decide()
        {
            var bomb = match.Bomb;
            var world = match.WorldMap;
            var plan = match.Plan;
            if (self.Side == Side.Attack)
            {
                if (bomb.State == BombState.Planted)
                {
                    if (task != Task.Guard || !hasGoal)
                    {
                        task = Task.Guard;
                        SetGoal(TeamPlan.PickSpotNear(match, bomb.Position, beh.holdRadiusCells));
                    }
                }
                else if (bomb.State == BombState.Dropped && IsClosestTo(bomb.Position, Side.Attack))
                {
                    task = Task.Fetch;
                    SetGoal(world.WorldToCell(bomb.Position));
                }
                else if (self.CarryingBomb)
                {
                    task = Task.Plant;
                    if (!hasGoal || world.Grid.SiteIndexAt(goal.x, goal.y) != plan.AttackSite)
                        SetGoal(RandomCell(plan.AttackSite == 0 ? CellType.SiteA : CellType.SiteB), plan.GoesViaMid(self.Id));
                }
                else
                {
                    bool atSite = world.SiteAt(self.Feet) == plan.AttackSite;
                    if (!hasGoal || (arrived && match.Time - arrivedTime > 6f))
                    {
                        task = Task.Move;
                        SetGoal(RandomCell(plan.AttackSite == 0 ? CellType.SiteA : CellType.SiteB), !atSite && plan.GoesViaMid(self.Id));
                    }
                    else if (arrived) task = Task.Hold;
                }
            }
            else
            {
                if (bomb.State == BombState.Planted)
                {
                    bool defuser = IsClosestTo(bomb.Position, Side.Defense);
                    var wanted = defuser ? Task.Defuse : Task.Guard;
                    if (task != wanted || !hasGoal)
                    {
                        task = wanted;
                        SetGoal(defuser ? world.WorldToCell(bomb.Position) : TeamPlan.PickSpotNear(match, bomb.Position, 3));
                    }
                }
                else if (match.Time - lastKnownTime < beh.memorySeconds && (lastKnownPos - self.Feet).sqrMagnitude < 20f * 20f && rng.Chance(0.3f))
                {
                    task = Task.Move;
                    SetGoal(world.WorldToCell(lastKnownPos));
                }
                else
                {
                    var spot = match.Plan.DefenderSpot(match, self.Id);
                    if (!hasGoal || !goal.Equals(spot)) SetGoal(spot);
                    task = arrived ? Task.Hold : Task.Move;
                    if (arrived && task == Task.Hold && lookTimer <= 0f)
                    {
                        Vector3 toCenter = match.WorldMap.Center - self.Feet;
                        holdYaw = Mathf.Atan2(toCenter.x, toCenter.z) * Mathf.Rad2Deg;
                    }
                }
            }
        }

        bool IsClosestTo(Vector3 point, Side side)
        {
            float mine = (self.Feet - point).sqrMagnitude;
            foreach (var c in match.AliveCharacters())
            {
                if (c == self || c.Side != side || match.Brain(c.Id) == null) continue;
                if ((c.Feet - point).sqrMagnitude < mine - 0.01f) return false;
            }
            return true;
        }

        Cell RandomCell(CellType type)
        {
            var cells = match.WorldMap.Cells(type);
            return cells.Count > 0 ? cells[rng.Range(0, cells.Count)] : match.WorldMap.WorldToCell(self.Feet);
        }

        void SetGoal(Cell c, bool throughMid = false)
        {
            var nav = match.WorldMap.Nav;
            goal = nav.NearestWalkable(c);
            hasGoal = true;
            hasVia = throughMid;
            if (throughMid) via = nav.NearestWalkable(match.WorldMap.WorldToCell(match.WorldMap.Center));
            RebuildPath();
        }

        void RebuildPath()
        {
            var world = match.WorldMap;
            var nav = world.Nav;
            arrived = false;
            waypoints.Clear();
            waypoint = 0;
            Cell start = nav.NearestWalkable(world.WorldToCell(self.Feet));
            Cell dest = hasVia ? via : goal;
            if (!nav.FindPath(start, dest, cellPath)) return;
            var smooth = nav.Smooth(cellPath);
            float jitter = world.Grid.CellSize * 0.2f;
            for (int i = 1; i < smooth.Count; i++)
            {
                Vector3 p = world.CellToWorld(smooth[i]);
                if (i < smooth.Count - 1) p += new Vector3(rng.Range(-jitter, jitter), 0f, rng.Range(-jitter, jitter));
                waypoints.Add(p);
            }
            progressPos = self.Feet;
            progressTimer = 0f;
        }

        Vector3 FollowPath(float dt)
        {
            if (!hasGoal) return Vector3.zero;
            if (waypoint >= waypoints.Count)
            {
                if (hasVia)
                {
                    hasVia = false;
                    RebuildPath();
                    return Vector3.zero;
                }
                if (!arrived) { arrived = true; arrivedTime = match.Time; }
                return Vector3.zero;
            }
            Vector3 d = waypoints[waypoint] - self.Feet;
            d.y = 0f;
            if (d.magnitude < 0.6f)
            {
                waypoint++;
                return FollowPath(dt);
            }

            progressTimer += dt;
            if (progressTimer > beh.stuckSeconds)
            {
                if ((self.Feet - progressPos).magnitude < 0.5f)
                {
                    unstickTimer = 0.6f;
                    unstickDir = Quaternion.Euler(0f, rng.Chance(0.5f) ? 90f : -90f, 0f) * d.normalized;
                    jumpNext = true;
                    RebuildPath();
                }
                progressPos = self.Feet;
                progressTimer = 0f;
            }
            if (unstickTimer > 0f)
            {
                unstickTimer -= dt;
                return (d.normalized + unstickDir).normalized;
            }
            return d.normalized;
        }

        // ---- aiming and shooting --------------------------------------------------------------

        void Aim(float dt)
        {
            Vector3 point = aimHead ? target.HeadPosition : target.ChestPosition;
            Vector3 to = point - self.EyePosition;
            float desiredYaw = Mathf.Atan2(to.x, to.z) * Mathf.Rad2Deg;
            float desiredPitch = Mathf.Atan2(to.y, new Vector2(to.x, to.z).magnitude) * Mathf.Rad2Deg;
            aimErrorTimer -= dt;
            if (aimErrorTimer <= 0f)
            {
                aimErrorTimer = 0.25f;
                aimError = aimError * 0.6f + RandomInCircle() * (diff.aimErrorDegrees * 0.4f);
            }
            float tracking = Mathf.Clamp01(1f - (match.Time - targetAcquiredTime) / 1.5f) * 0.7f + 0.3f;
            float blind = self.BlindTimeLeft > 0f ? 4f : 1f;
            desiredYaw += aimError.x * tracking * blind - self.RecoilYaw * diff.recoilControl;
            desiredPitch += aimError.y * tracking * blind - self.RecoilPitch * diff.recoilControl;
            yaw = Mathf.MoveTowardsAngle(yaw, desiredYaw, diff.turnSpeed * dt);
            pitch = Mathf.MoveTowards(pitch, Mathf.Clamp(desiredPitch, -89f, 89f), diff.turnSpeed * dt);
        }

        void Fight(float dt, ref Intent intent, ref Vector3 moveDir)
        {
            var w = self.Weapons;
            var def = w.CurrentDef;
            if (def == null) return;
            Vector3 to = (aimHead ? target.HeadPosition : target.ChestPosition) - self.EyePosition;
            float dist = to.magnitude;
            float error = Vector3.Angle(self.AimForward, to);
            bool reacting = match.Time - targetAcquiredTime < diff.reactionTime * (self.BlindTimeLeft > 0f ? 3f : 1f);
            float tolerance = Mathf.Max(1.5f, w.CurrentSpread + 1f) + (dist < 5f ? 6f : 0f);

            if (def.Mode == FireMode.Melee)
            {
                moveDir = new Vector3(to.x, 0f, to.z).normalized;
                intent.fire = dist < def.maxRange + 0.5f && error < 20f;
                return;
            }
            if (def.scoped) intent.aim = true;
            bool canShoot = !reacting && error < tolerance && w.Current.mag > 0 && !w.IsReloading && (!def.scoped || w.AimTime > 0.3f);

            if (def.Mode == FireMode.Auto)
            {
                if (w.ShotsFired != lastShotsFired) burstFired += w.ShotsFired - lastShotsFired;
                if (burstFired >= diff.burstShots)
                {
                    burstFired = 0;
                    burstPauseLeft = diff.burstPause;
                }
                if (burstPauseLeft > 0f)
                {
                    burstPauseLeft -= dt;
                    canShoot = false;
                }
                intent.fire = canShoot;
            }
            else if (canShoot && w.Ready)
            {
                fireToggle = !fireToggle;
                intent.fire = fireToggle;
            }
            lastShotsFired = w.ShotsFired;

            // Rifles and snipers stop to shoot accurately; SMGs and shotguns strafe.
            bool mobile = def.Category == WeaponCategory.Smg || def.Category == WeaponCategory.Shotgun;
            if (mobile)
            {
                strafeTimer -= dt;
                if (strafeTimer <= 0f)
                {
                    strafe = rng.Chance(0.5f) ? 1f : -1f;
                    strafeTimer = rng.Range(0.3f, 0.8f);
                }
                Vector3 right = Quaternion.Euler(0f, yaw, 0f) * Vector3.right;
                moveDir = right * strafe;
                if (def.Category == WeaponCategory.Shotgun && dist > 8f) moveDir += new Vector3(to.x, 0f, to.z).normalized;
            }
            else moveDir = Vector3.zero;
        }

        void Look(float dt, Vector3 moveDir)
        {
            Vector3 dir;
            if (match.Time - lastKnownTime < beh.memorySeconds) dir = lastKnownPos + Vector3.up * 1.4f - self.EyePosition;
            else if (moveDir.sqrMagnitude > 0.01f) dir = moveDir;
            else
            {
                lookTimer -= dt;
                if (lookTimer <= 0f)
                {
                    lookTimer = rng.Range(1.5f, 3.5f);
                    holdYaw += rng.Range(-50f, 50f);
                }
                dir = Quaternion.Euler(0f, holdYaw, 0f) * Vector3.forward;
            }
            float desiredYaw = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;
            float desiredPitch = moveDir.sqrMagnitude > 0.01f ? 0f : Mathf.Clamp(Mathf.Atan2(dir.y, new Vector2(dir.x, dir.z).magnitude) * Mathf.Rad2Deg, -30f, 30f);
            yaw = Mathf.MoveTowardsAngle(yaw, desiredYaw, diff.turnSpeed * 0.6f * dt);
            pitch = Mathf.MoveTowards(pitch, desiredPitch, diff.turnSpeed * 0.6f * dt);
            if (moveDir.sqrMagnitude > 0.01f) holdYaw = yaw;
        }

        void UseAbilities(float dt, ref Intent intent)
        {
            abilityTimer -= dt;
            if (abilityTimer > 0f || self.Frozen) return;
            abilityTimer = 0.5f;
            var ab = self.Abilities;
            float chance = diff.abilityUseChance;
            int slot;

            if (target == null && self.Health < 60 && (slot = ab.FindReady(AbilityType.Heal)) >= 0) { intent.useAbility = slot; return; }
            if (target != null)
            {
                if ((slot = ab.FindReady(AbilityType.Buff)) >= 0 && rng.Chance(chance)) { intent.useAbility = slot; return; }
                float dist = Vector3.Distance(self.Feet, target.Feet);
                if (dist > 8f && match.Time - targetAcquiredTime < 1f && rng.Chance(chance * 0.5f))
                {
                    foreach (var type in new[] { AbilityType.Frag, AbilityType.Incendiary, AbilityType.Flash })
                    {
                        if ((slot = ab.FindReady(type)) < 0) continue;
                        pitch = Mathf.Clamp(pitch + 8f, -89f, 89f);
                        intent.useAbility = slot;
                        return;
                    }
                }
                return;
            }
            if ((slot = ab.FindReady(AbilityType.Recon)) >= 0 && rng.Chance(chance * 0.3f) &&
                (match.Bomb.State == BombState.Planted || (self.Feet - match.WorldMap.SiteCenter(match.Plan.AttackSite)).magnitude < 20f))
            {
                intent.useAbility = slot;
                return;
            }
            if (self.Side == Side.Attack && match.Bomb.State != BombState.Planted)
            {
                Vector3 site = match.WorldMap.SiteCenter(match.Plan.AttackSite);
                float d = Vector3.Distance(self.Feet, site);
                if (d < 22f && d > 8f)
                {
                    if ((slot = ab.FindReady(AbilityType.Smoke)) >= 0 && rng.Chance(chance))
                    {
                        Vector3 to = site - self.EyePosition;
                        yaw = Mathf.Atan2(to.x, to.z) * Mathf.Rad2Deg;
                        pitch = 12f;
                        intent.useAbility = slot;
                        return;
                    }
                    if ((slot = ab.FindReady(AbilityType.Dash)) >= 0 && rng.Chance(chance * 0.5f)) { intent.useAbility = slot; return; }
                }
            }
            if (self.Side == Side.Defense && task == Task.Hold && arrived && (slot = ab.FindReady(AbilityType.Wall)) >= 0 && rng.Chance(chance * 0.2f))
                intent.useAbility = slot;
        }

        void ManageWeapons(ref Intent intent)
        {
            var w = self.Weapons;
            var primary = w.Slots[0];
            var secondary = w.Slots[1];
            bool primaryHasAmmo = primary != null && (primary.mag > 0 || primary.reserve > 0);
            bool secondaryHasAmmo = secondary != null && (secondary.mag > 0 || secondary.reserve > 0);
            if (target != null && w.CurrentSlot == 0 && primary.mag == 0 && secondary != null && secondary.mag > 0) intent.selectSlot = 1;
            else if (target == null && primaryHasAmmo && w.CurrentSlot != 0) intent.selectSlot = 0;
            else if (w.CurrentSlot == 0 && !primaryHasAmmo) intent.selectSlot = secondaryHasAmmo ? 1 : 2;
            else if (w.CurrentSlot == 1 && !secondaryHasAmmo && !primaryHasAmmo) intent.selectSlot = 2;
            else if (w.CurrentSlot == 2 && (primaryHasAmmo || secondaryHasAmmo)) intent.selectSlot = primaryHasAmmo ? 0 : 1;
            var cur = w.Current;
            if (target == null && cur != null && cur.def.magazineSize > 0 && cur.mag < cur.def.magazineSize * 0.4f && cur.reserve > 0) intent.reload = true;
        }

        void ToMoveIntent(Vector3 dir, ref Intent intent)
        {
            if (dir.sqrMagnitude < 0.01f) return;
            float r = yaw * Mathf.Deg2Rad;
            var forward = new Vector3(Mathf.Sin(r), 0f, Mathf.Cos(r));
            var right = new Vector3(Mathf.Cos(r), 0f, -Mathf.Sin(r));
            intent.moveForward = Mathf.Clamp(Vector3.Dot(dir, forward), -1f, 1f);
            intent.moveRight = Mathf.Clamp(Vector3.Dot(dir, right), -1f, 1f);
        }
    }
}
