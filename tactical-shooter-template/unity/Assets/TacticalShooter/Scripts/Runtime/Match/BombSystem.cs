using TacticalShooter.Core;
using UnityEngine;

namespace TacticalShooter
{
    public enum BombState { None, Carried, Dropped, Planted, Defused, Exploded }

    /// <summary>
    /// The objective (GAME_RULES.md section 9): carrier, drop, pickup, plant, defuse, fuse beeps
    /// and the explosion. Reports plants and defuses to MatchFlow, which owns the round outcome.
    /// </summary>
    public sealed class BombSystem
    {
        readonly MatchController match;
        readonly GameObject bombObject;
        readonly GameObject bombLight;

        public BombState State { get; private set; }
        public TacticalCharacter Carrier { get; private set; }
        public Vector3 Position { get; private set; }
        public int Site { get; private set; } = -1;
        public float PlantProgress { get; private set; }
        public float DefuseProgress { get; private set; }
        public TacticalCharacter Planter { get; private set; }
        public TacticalCharacter Defuser { get; private set; }

        float beepTimer;
        bool lightOn;
        /// <summary>Who just dropped the bomb on purpose; they must step away before it can be picked up again.</summary>
        TacticalCharacter droppedBy;

        BombSettings Settings => Game.Data.Game.bomb;

        public BombSystem(MatchController match, Transform parent)
        {
            this.match = match;
            var color = Prims.ToColor(Game.Data.Game.visuals.bombColor);
            bombObject = Prims.Shape(PrimitiveType.Cube, parent, Vector3.zero, new Vector3(0.45f, 0.22f, 0.32f), color, "Bomb");
            bombLight = Prims.Shape(PrimitiveType.Sphere, bombObject.transform, new Vector3(0f, 0.7f, 0f), new Vector3(0.3f, 0.5f, 0.4f), Color.white, "BombLight");
            bombObject.SetActive(false);
        }

        public void Destroy()
        {
            if (bombObject != null) Object.Destroy(bombObject);
        }

        public void Reset()
        {
            if (Carrier != null) Carrier.SetCarryingBomb(false);
            State = BombState.None;
            Carrier = Planter = Defuser = droppedBy = null;
            PlantProgress = DefuseProgress = 0f;
            Site = -1;
            bombObject.SetActive(false);
        }

        public bool IsBusy(TacticalCharacter c) => (c == Planter && PlantProgress > 0f) || (c == Defuser && DefuseProgress > 0f);

        public void GiveTo(TacticalCharacter c)
        {
            State = BombState.Carried;
            Carrier = c;
            droppedBy = null;
            c.SetCarryingBomb(true);
            bombObject.SetActive(false);
            Game.Events.RaiseBombStatus(c.Record.name + " has the bomb");
        }

        /// <summary>by: the character who dropped it on purpose (null when it falls from a dead carrier).</summary>
        public void Drop(Vector3 at, TacticalCharacter by = null)
        {
            if (State != BombState.Carried) return;
            Carrier.SetCarryingBomb(false);
            Carrier = null;
            droppedBy = by;
            Planter = null;
            PlantProgress = 0f;
            State = BombState.Dropped;
            Position = new Vector3(at.x, 0f, at.z);
            Show(Position);
            Game.Events.RaiseBombStatus("Bomb dropped");
        }

        public void Tick(float dt)
        {
            var flow = match.Flow;
            bool live = flow.Phase == MatchPhase.Live;
            switch (State)
            {
                case BombState.Carried:
                {
                    var c = Carrier;
                    if (c == null || !c.Alive) { Drop(c != null ? c.Feet : Position); break; }
                    if (c.LastIntent.drop)
                    {
                        Drop(match.DropPoint(c, Settings.pickupRadius), c);
                        break;
                    }
                    int site = match.WorldMap.SiteAt(c.Feet);
                    bool planting = live && site >= 0 && c.LastIntent.interact && c.Grounded;
                    if (!planting)
                    {
                        PlantProgress = 0f;
                        Planter = null;
                        break;
                    }
                    if (PlantProgress <= 0f) Game.Audio.Play("bomb_plant", c.Feet);
                    Planter = c;
                    PlantProgress += dt / Mathf.Max(0.1f, Settings.plantSeconds);
                    if (PlantProgress >= 1f) Plant(c, site);
                    break;
                }
                case BombState.Dropped:
                    if (!live && flow.Phase != MatchPhase.BuyPhase) break;
                    foreach (var c in match.AliveCharacters())
                    {
                        if (c.Side != Side.Attack) continue;
                        Vector3 d = c.Feet - Position;
                        bool inReach = new Vector2(d.x, d.z).sqrMagnitude <= Settings.pickupRadius * Settings.pickupRadius;
                        if (c == droppedBy)
                        {
                            // The dropper has to leave the pickup radius first, or the bomb would bounce
                            // straight back to them (it lands right at the edge of the radius).
                            if (!inReach) droppedBy = null;
                            continue;
                        }
                        if (inReach) { GiveTo(c); break; }
                    }
                    break;
                case BombState.Planted:
                    Beep(dt);
                    if (live) Defuse(dt);
                    break;
            }
        }

        void Plant(TacticalCharacter c, int site)
        {
            var d = Game.Data.Game;
            State = BombState.Planted;
            Site = site;
            Position = new Vector3(c.Feet.x, 0f, c.Feet.z);
            c.SetCarryingBomb(false);
            Carrier = null;
            Planter = null;
            PlantProgress = 0f;
            beepTimer = 0f;
            Show(Position);
            var rec = c.Record;
            rec.plants++;
            rec.score += d.scoring.plant;
            rec.money = EconomyRules.AddMoney(d.economy, rec.money, d.economy.plantRewardPlayer);
            rec.AddUltPoints(c.Agent, d.ultimate.pointsPerPlant);
            match.Flow.NotifyBombPlanted(site);
        }

        void Defuse(float dt)
        {
            var s = Settings;
            TacticalCharacter best = null;
            float bestDist = s.interactRadius * s.interactRadius;
            foreach (var c in match.AliveCharacters())
            {
                if (c.Side != Side.Defense || !c.LastIntent.interact || !c.Grounded) continue;
                float dist = (c.Feet - Position).sqrMagnitude;
                if (dist <= bestDist) { bestDist = dist; best = c; }
            }
            if (best == null || (Defuser != null && best != Defuser))
            {
                if (DefuseProgress > 0f)
                    DefuseProgress = s.halfDefuseCheckpoint && DefuseProgress >= 0.5f ? 0.5f : 0f;
                Defuser = null;
                if (best == null) return;
            }
            if (Defuser == null) Game.Audio.Play("bomb_plant", Position, 0.6f);
            Defuser = best;
            float seconds = best.Record.loadout.hasDefuseKit ? s.defuseKitSeconds : s.defuseSeconds;
            DefuseProgress += dt / Mathf.Max(0.1f, seconds);
            if (DefuseProgress < 1f) return;

            var d = Game.Data.Game;
            var rec = best.Record;
            rec.defuses++;
            rec.score += d.scoring.defuse;
            rec.money = EconomyRules.AddMoney(d.economy, rec.money, d.economy.defuseRewardPlayer);
            rec.AddUltPoints(best.Agent, d.ultimate.pointsPerDefuse);
            State = BombState.Defused;
            DefuseProgress = 1f;
            Defuser = null;
            bombLight.SetActive(false);
            match.Flow.NotifyBombDefused();
        }

        void Beep(float dt)
        {
            var s = Settings;
            beepTimer -= dt;
            if (beepTimer > 0f) return;
            float frac = Mathf.Clamp01(match.Flow.BombTimeLeft / Mathf.Max(1f, s.fuseSeconds));
            beepTimer = Mathf.Lerp(s.beepIntervalEnd, s.beepIntervalStart, frac);
            lightOn = !lightOn;
            bombLight.SetActive(lightOn);
            Game.Audio.Play("bomb_beep", Position);
        }

        /// <summary>Called when MatchFlow reports the fuse ran out.</summary>
        public void Explode()
        {
            var s = Settings;
            State = BombState.Exploded;
            bombObject.SetActive(false);
            match.Effects.Burst(Position + Vector3.up, s.blastRadius, new Color(1f, 0.5f, 0.1f), 0.8f);
            Game.Audio.Play("explosion", Position);
            match.Combat.Explosion(Position + Vector3.up, s.blastRadius, s.blastDamage, 1f, null, "bomb", false);
        }

        void Show(Vector3 at)
        {
            bombObject.SetActive(true);
            bombObject.transform.position = at + Vector3.up * 0.11f;
            bombLight.SetActive(true);
        }
    }
}
