using System.Collections.Generic;
using TacticalShooter.Core;
using UnityEngine;
using UnityEngine.UI;

namespace TacticalShooter.UI
{
    /// <summary>
    /// Crosshair drawn from four bars and a dot. Reads the player's crosshair settings every
    /// frame; "dynamic" widens the gap with the current weapon spread.
    /// </summary>
    public sealed class Crosshair : MonoBehaviour
    {
        readonly Image[] bars = new Image[4];
        Image dot;
        bool preview;
        public float SpreadDegrees;

        public static Crosshair Create(RectTransform parent, bool preview)
        {
            var rt = UIFactory.Rect("Crosshair", parent);
            UIFactory.Place(rt, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(10f, 10f));
            var c = rt.gameObject.AddComponent<Crosshair>();
            c.preview = preview;
            for (int i = 0; i < 4; i++) c.bars[i] = UIFactory.Image(rt, "Bar" + i, Color.white);
            c.dot = UIFactory.Image(rt, "Dot", Color.white);
            return c;
        }

        void LateUpdate()
        {
            var s = Game.Settings;
            if (s == null) return;
            Color color = Prims.ToColor(s.crosshairColor);
            float len = s.crosshairSize, thick = s.crosshairThickness;
            float gap = s.crosshairGap;
            if (!preview && s.crosshairDynamic) gap += SpreadDegrees * 6f;
            Vector2[] dirs = { Vector2.up, Vector2.down, Vector2.left, Vector2.right };
            for (int i = 0; i < 4; i++)
            {
                var rt = bars[i].rectTransform;
                bool vertical = i < 2;
                rt.sizeDelta = vertical ? new Vector2(thick, len) : new Vector2(len, thick);
                rt.anchoredPosition = dirs[i] * (gap + len / 2f);
                bars[i].color = color;
            }
            dot.enabled = s.crosshairDot;
            dot.color = color;
            dot.rectTransform.sizeDelta = new Vector2(thick, thick);
        }
    }

    /// <summary>
    /// The in-game HUD: scores and clock, minimap, killfeed, vitals, abilities, ammo and money,
    /// crosshair, hit markers, interaction bar, announcements, screen effects and world markers.
    /// Everything reads simulation state or listens to GameEvents; nothing writes back.
    /// </summary>
    public sealed class HudScreen : UIScreen
    {
        readonly RectTransform canvas;
        readonly Crosshair crosshair;
        readonly Image[] hitBars = new Image[4];
        float hitTime = -9f;
        bool hitKill;
        readonly Text scoreLeft, scoreRight, clock, roundText, phaseText;
        readonly Image[] pipsLeft = new Image[5], pipsRight = new Image[5];
        readonly Image bombBar, bombBarBack;
        readonly Text health, armor, agentName, weaponName, ammo, moneyText, hint, spectate, fps, banner, interactLabel;
        readonly Image healthBar, interactFill, interactBack;
        readonly Image flash, smoke, damage, scopeTop, scopeBottom, scopeLeft, scopeRight, scopeH, scopeV;
        readonly AbilityChip[] chips = new AbilityChip[4];
        readonly RectTransform killfeed;
        readonly List<(GameObject go, float until)> feed = new List<(GameObject, float)>();
        readonly Minimap minimap;
        readonly Text[] siteMarkers = new Text[2];
        readonly Text bombMarker;
        readonly List<Text> markerPool = new List<Text>();
        float bannerUntil;
        float fpsAccum;
        int fpsFrames;
        float damageFlash;

        sealed class AbilityChip
        {
            public Image back;
            public Text key, name, charges;
            public long chargesShown = long.MinValue;
        }

        // The HUD ticks every frame; labels showing numbers are only re-formatted when the number
        // changes, so a steady HUD allocates no strings.
        static readonly object Unset = new object();
        long scoreShown = long.MinValue, clockShown = long.MinValue, roundShown = long.MinValue, healthShown = long.MinValue,
             armorShown = long.MinValue, moneyShown = long.MinValue, ammoShown = long.MinValue;
        object nameShownFor = Unset, weaponShownFor = Unset;

        static bool Changed(ref long shown, long value)
        {
            if (shown == value) return false;
            shown = value;
            return true;
        }

        public HudScreen(RectTransform canvas)
        {
            this.canvas = canvas;
            Root = FullScreen(canvas, "HUD");

            // screen effects (bottom-most)
            flash = FullImage("Flash", Color.white);
            smoke = FullImage("SmokeOverlay", new Color(0.55f, 0.55f, 0.6f, 1f));
            damage = FullImage("Damage", new Color(0.8f, 0f, 0f, 1f));
            scopeTop = FullImage("ScopeTop", Color.black);
            scopeBottom = FullImage("ScopeBottom", Color.black);
            scopeLeft = FullImage("ScopeLeft", Color.black);
            scopeRight = FullImage("ScopeRight", Color.black);
            scopeH = UIFactory.Image(Root, "ScopeH", Color.black);
            UIFactory.Place(scopeH.rectTransform, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(800f, 2f));
            scopeV = UIFactory.Image(Root, "ScopeV", Color.black);
            UIFactory.Place(scopeV.rectTransform, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(2f, 800f));
            SetScope(false);

            crosshair = Crosshair.Create(Root, false);
            for (int i = 0; i < 4; i++)
            {
                hitBars[i] = UIFactory.Image(Root, "Hit" + i, Color.white);
                var rt = hitBars[i].rectTransform;
                float sx = i % 2 == 0 ? 1f : -1f, sy = i < 2 ? 1f : -1f;
                UIFactory.Place(rt, new Vector2(0.5f, 0.5f), new Vector2(sx * 11f, sy * 11f), new Vector2(3f, 12f));
                rt.localRotation = Quaternion.Euler(0f, 0f, sx * sy * -45f);
            }

            // top centre: scores, clock, round, alive pips
            var top = UIFactory.Image(Root, "TopBar", new Color(0f, 0f, 0f, 0.55f));
            UIFactory.Place(top.rectTransform, new Vector2(0.5f, 1f), new Vector2(0f, -10f), new Vector2(560f, 92f));
            scoreLeft = UIFactory.Label(top.transform, "0", 44, TextAnchor.MiddleCenter, UIFactory.TextColor, FontStyle.Bold);
            UIFactory.Place(scoreLeft.rectTransform, new Vector2(0f, 0.5f), new Vector2(60f, 8f), new Vector2(100f, 60f), new Vector2(0.5f, 0.5f));
            scoreRight = UIFactory.Label(top.transform, "0", 44, TextAnchor.MiddleCenter, UIFactory.TextColor, FontStyle.Bold);
            UIFactory.Place(scoreRight.rectTransform, new Vector2(1f, 0.5f), new Vector2(-60f, 8f), new Vector2(100f, 60f), new Vector2(0.5f, 0.5f));
            clock = UIFactory.Label(top.transform, "", 40, TextAnchor.MiddleCenter, UIFactory.TextColor, FontStyle.Bold);
            UIFactory.Place(clock.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(0f, 10f), new Vector2(200f, 56f));
            roundText = UIFactory.Label(top.transform, "", 16, TextAnchor.MiddleCenter, UIFactory.TextDim);
            UIFactory.Place(roundText.rectTransform, new Vector2(0.5f, 0f), new Vector2(0f, 14f), new Vector2(240f, 22f));
            for (int i = 0; i < 5; i++)
            {
                pipsLeft[i] = UIFactory.Image(top.transform, "PipL" + i, Color.white);
                UIFactory.Place(pipsLeft[i].rectTransform, new Vector2(0f, 0f), new Vector2(118f + i * 16f, 16f), new Vector2(12f, 12f));
                pipsRight[i] = UIFactory.Image(top.transform, "PipR" + i, Color.white);
                UIFactory.Place(pipsRight[i].rectTransform, new Vector2(1f, 0f), new Vector2(-118f - i * 16f, 16f), new Vector2(12f, 12f));
            }
            phaseText = UIFactory.Label(Root, "", 22, TextAnchor.MiddleCenter, UIFactory.Warn, FontStyle.Bold);
            UIFactory.Place(phaseText.rectTransform, new Vector2(0.5f, 1f), new Vector2(0f, -118f), new Vector2(700f, 30f));
            bombBarBack = UIFactory.Image(Root, "BombBarBack", new Color(0f, 0f, 0f, 0.5f));
            UIFactory.Place(bombBarBack.rectTransform, new Vector2(0.5f, 1f), new Vector2(0f, -140f), new Vector2(400f, 8f));
            bombBar = UIFactory.Image(bombBarBack.transform, "Fill", new Color(1f, 0.2f, 0.2f));
            bombBar.rectTransform.anchorMin = new Vector2(0f, 0f);
            bombBar.rectTransform.anchorMax = new Vector2(1f, 1f);
            bombBar.rectTransform.offsetMin = bombBar.rectTransform.offsetMax = Vector2.zero;

            // top left: minimap
            minimap = new Minimap(Root);

            // top right: killfeed + fps
            killfeed = UIFactory.Rect("Killfeed", Root);
            UIFactory.Place(killfeed, new Vector2(1f, 1f), new Vector2(-20f, -40f), new Vector2(560f, 300f));
            var kv = UIFactory.VBox(killfeed, 4f, 0, TextAnchor.UpperRight);
            kv.childControlWidth = false;
            fps = UIFactory.Label(Root, "", 16, TextAnchor.UpperRight, UIFactory.TextDim);
            UIFactory.Place(fps.rectTransform, new Vector2(1f, 1f), new Vector2(-20f, -10f), new Vector2(200f, 24f));

            // bottom left: vitals
            var vitals = UIFactory.Image(Root, "Vitals", new Color(0f, 0f, 0f, 0.5f));
            UIFactory.Place(vitals.rectTransform, new Vector2(0f, 0f), new Vector2(20f, 20f), new Vector2(360f, 110f));
            health = UIFactory.Label(vitals.transform, "100", 56, TextAnchor.MiddleLeft, UIFactory.TextColor, FontStyle.Bold);
            UIFactory.Place(health.rectTransform, new Vector2(0f, 0.5f), new Vector2(20f, 10f), new Vector2(140f, 70f), new Vector2(0f, 0.5f));
            armor = UIFactory.Label(vitals.transform, "", 26, TextAnchor.MiddleLeft, new Color(0.55f, 0.8f, 1f));
            UIFactory.Place(armor.rectTransform, new Vector2(0f, 0.5f), new Vector2(160f, 18f), new Vector2(190f, 36f), new Vector2(0f, 0.5f));
            agentName = UIFactory.Label(vitals.transform, "", 18, TextAnchor.MiddleLeft, UIFactory.TextDim);
            UIFactory.Place(agentName.rectTransform, new Vector2(0f, 0.5f), new Vector2(160f, -14f), new Vector2(190f, 26f), new Vector2(0f, 0.5f));
            var hbBack = UIFactory.Image(vitals.transform, "HealthBarBack", new Color(1f, 1f, 1f, 0.15f));
            UIFactory.Place(hbBack.rectTransform, new Vector2(0f, 0f), new Vector2(20f, 12f), new Vector2(320f, 6f), new Vector2(0f, 0f));
            healthBar = UIFactory.Image(hbBack.transform, "Fill", UIFactory.Good);
            healthBar.rectTransform.anchorMin = Vector2.zero;
            healthBar.rectTransform.anchorMax = Vector2.one;
            healthBar.rectTransform.offsetMin = healthBar.rectTransform.offsetMax = Vector2.zero;

            // bottom centre: abilities
            for (int i = 0; i < 4; i++)
            {
                var back = UIFactory.Image(Root, "Ability" + i, new Color(0f, 0f, 0f, 0.55f));
                UIFactory.Place(back.rectTransform, new Vector2(0.5f, 0f), new Vector2(-240f + i * 160f, 20f), new Vector2(150f, 84f), new Vector2(0.5f, 0f));
                var chip = new AbilityChip { back = back };
                chip.key = UIFactory.Label(back.transform, "", 20, TextAnchor.UpperLeft, UIFactory.Warn, FontStyle.Bold);
                UIFactory.Stretch(chip.key.rectTransform, 10f, 4f, 10f, 6f);
                chip.name = UIFactory.Label(back.transform, "", 16, TextAnchor.MiddleCenter);
                UIFactory.Stretch(chip.name.rectTransform, 6f, 16f, 6f, 20f);
                chip.charges = UIFactory.Label(back.transform, "", 16, TextAnchor.LowerCenter, UIFactory.TextDim);
                UIFactory.Stretch(chip.charges.rectTransform, 6f, 6f, 6f, 6f);
                chips[i] = chip;
            }

            // bottom right: weapon, ammo, money
            var weaponPanel = UIFactory.Image(Root, "Weapon", new Color(0f, 0f, 0f, 0.5f));
            UIFactory.Place(weaponPanel.rectTransform, new Vector2(1f, 0f), new Vector2(-20f, 20f), new Vector2(360f, 150f), new Vector2(1f, 0f));
            moneyText = UIFactory.Label(weaponPanel.transform, "", 28, TextAnchor.UpperRight, UIFactory.Good, FontStyle.Bold);
            UIFactory.Stretch(moneyText.rectTransform, 16f, 100f, 20f, 8f);
            weaponName = UIFactory.Label(weaponPanel.transform, "", 22, TextAnchor.MiddleRight, UIFactory.TextDim);
            UIFactory.Stretch(weaponName.rectTransform, 16f, 60f, 20f, 50f);
            ammo = UIFactory.Label(weaponPanel.transform, "", 44, TextAnchor.LowerRight, UIFactory.TextColor, FontStyle.Bold);
            UIFactory.Stretch(ammo.rectTransform, 16f, 8f, 20f, 70f);
            ammo.supportRichText = true;

            // centre: interaction bar, hints, banner, spectate label
            interactBack = UIFactory.Image(Root, "InteractBack", new Color(0f, 0f, 0f, 0.6f));
            UIFactory.Place(interactBack.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(0f, -160f), new Vector2(420f, 16f));
            interactFill = UIFactory.Image(interactBack.transform, "Fill", UIFactory.Warn);
            interactFill.rectTransform.anchorMin = Vector2.zero;
            interactFill.rectTransform.anchorMax = new Vector2(0f, 1f);
            interactFill.rectTransform.offsetMin = interactFill.rectTransform.offsetMax = Vector2.zero;
            interactLabel = UIFactory.Label(Root, "", 22, TextAnchor.MiddleCenter, UIFactory.TextColor, FontStyle.Bold);
            UIFactory.Place(interactLabel.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(0f, -135f), new Vector2(600f, 30f));
            hint = UIFactory.Label(Root, "", 20, TextAnchor.MiddleCenter, UIFactory.TextDim);
            UIFactory.Place(hint.rectTransform, new Vector2(0.5f, 0f), new Vector2(0f, 128f), new Vector2(1000f, 30f));
            banner = UIFactory.Label(Root, "", 52, TextAnchor.MiddleCenter, UIFactory.TextColor, FontStyle.Bold);
            UIFactory.Place(banner.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(0f, 200f), new Vector2(1400f, 160f));
            banner.gameObject.AddComponent<Outline>().effectColor = new Color(0f, 0f, 0f, 0.8f);
            spectate = UIFactory.Label(Root, "", 24, TextAnchor.MiddleCenter, UIFactory.TextColor);
            UIFactory.Place(spectate.rectTransform, new Vector2(0.5f, 0f), new Vector2(0f, 170f), new Vector2(900f, 34f));

            // world markers
            for (int i = 0; i < 2; i++)
            {
                siteMarkers[i] = UIFactory.Label(Root, Ids.SiteName(i), 30, TextAnchor.MiddleCenter, Prims.ToColor(Game.Data.Game.visuals.siteColor), FontStyle.Bold);
                siteMarkers[i].rectTransform.sizeDelta = new Vector2(60f, 40f);
                siteMarkers[i].gameObject.AddComponent<Outline>().effectColor = Color.black;
            }
            bombMarker = UIFactory.Label(Root, "BOMB", 18, TextAnchor.MiddleCenter, Prims.ToColor(Game.Data.Game.visuals.bombColor), FontStyle.Bold);
            bombMarker.rectTransform.sizeDelta = new Vector2(90f, 30f);
            bombMarker.gameObject.AddComponent<Outline>().effectColor = Color.black;

            Game.Events.Announcement += OnAnnouncement;
            Game.Events.Killed += OnKilled;
            Game.Events.Damaged += OnDamaged;
        }

        Image FullImage(string name, Color c)
        {
            var img = UIFactory.Image(Root, name, c);
            UIFactory.Stretch(img.rectTransform);
            img.enabled = false;
            return img;
        }

        void SetScope(bool on)
        {
            scopeTop.enabled = scopeBottom.enabled = scopeLeft.enabled = scopeRight.enabled = scopeH.enabled = scopeV.enabled = on;
            if (!on) return;
            float half = 400f;
            Size(scopeTop.rectTransform, new Vector2(0f, 0.5f), new Vector2(1f, 1f), new Vector2(0f, half), Vector2.zero);
            Size(scopeBottom.rectTransform, new Vector2(0f, 0f), new Vector2(1f, 0.5f), Vector2.zero, new Vector2(0f, -half));
            Size(scopeLeft.rectTransform, new Vector2(0f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0f, -half), new Vector2(-half, half));
            Size(scopeRight.rectTransform, new Vector2(0.5f, 0.5f), new Vector2(1f, 0.5f), new Vector2(half, -half), new Vector2(0f, half));
        }

        static void Size(RectTransform rt, Vector2 min, Vector2 max, Vector2 offMin, Vector2 offMax)
        {
            rt.anchorMin = min;
            rt.anchorMax = max;
            rt.offsetMin = offMin;
            rt.offsetMax = offMax;
        }

        void OnAnnouncement(string text, float seconds)
        {
            banner.text = text;
            bannerUntil = Time.unscaledTime + seconds;
        }

        void OnDamaged(DamageEvent e)
        {
            var m = Game.Match;
            if (m?.Local == null) return;
            if (e.attackerId == m.Local.id && e.victimId != m.Local.id)
            {
                hitTime = Time.unscaledTime;
                hitKill = e.killed;
                Game.Audio.Play2D(e.zone == HitZone.Head ? "hit_head" : "hit_body");
            }
            if (e.victimId == m.Local.id)
            {
                damageFlash = Mathf.Min(0.45f, damageFlash + (e.healthDamage + e.armorDamage) / 120f);
                Game.Audio.Play2D("hurt");
            }
        }

        void OnKilled(KillEvent e)
        {
            var m = Game.Match;
            if (m == null) return;
            var killer = m.Record(e.killerId);
            var victim = m.Record(e.victimId);
            var assist = m.Record(e.assisterId);
            if (killer != null && killer.isLocal && victim != null && victim.team != killer.team) Game.Audio.Play2D("kill_confirm");
            var row = UIFactory.Image(killfeed, "Kill", new Color(0f, 0f, 0f, 0.55f));
            bool involvesLocal = (killer != null && killer.isLocal) || (victim != null && victim.isLocal);
            if (involvesLocal) row.color = new Color(0.6f, 0.1f, 0.15f, 0.7f);
            var t = UIFactory.Label(row.transform, "", 19, TextAnchor.MiddleRight);
            t.supportRichText = true;
            UIFactory.Stretch(t.rectTransform, 10f, 0f, 10f, 0f);
            string K(PlayerRecord p) => p == null ? "" : $"<color=#{Hex(p)}>{p.name}</color>";
            t.text = (killer != null && killer != victim ? K(killer) + (assist != null ? " + " + assist.name : "") + "  " : "") +
                     $"<color=#C8C8C8>[{e.sourceName}{(e.headshot ? " HS" : "")}]</color>  " + K(victim);
            UIFactory.Size(row, 540f, 34f);
            row.transform.SetAsFirstSibling();
            feed.Add((row.gameObject, Time.unscaledTime + 6f));
            if (feed.Count > 6)
            {
                Object.Destroy(feed[0].go);
                feed.RemoveAt(0);
            }
        }

        static string Hex(PlayerRecord p)
        {
            var side = Game.Match.Flow.SideOf(p.team);
            var v = Game.Data.Game.visuals;
            return (side == Side.Attack ? v.attackColor : v.defenseColor).TrimStart('#');
        }

        public override void Show()
        {
            base.Show();
            minimap.Rebuild();
            foreach (var f in feed) if (f.go != null) Object.Destroy(f.go);
            feed.Clear();
            banner.text = "";
        }

        public override void Tick()
        {
            var m = Game.Match;
            if (m == null || m.Flow == null || m.Local == null) return;
            var flow = m.Flow;
            var local = m.Local;
            var me = m.LocalCharacter;
            var view = m.Player.ViewTarget;
            var s = Game.Settings;
            var vis = Game.Data.Game.visuals;

            // scores
            var mine = local.team;
            var theirs = Ids.Other(mine);
            if (Changed(ref scoreShown, flow.Score[(int)mine] * 10000L + flow.Score[(int)theirs]))
            {
                scoreLeft.text = flow.Score[(int)mine].ToString();
                scoreRight.text = flow.Score[(int)theirs].ToString();
            }
            scoreLeft.color = Prims.ToColor(flow.SideOf(mine) == Side.Attack ? vis.attackColor : vis.defenseColor);
            scoreRight.color = Prims.ToColor(flow.SideOf(theirs) == Side.Attack ? vis.attackColor : vis.defenseColor);
            float secs = Mathf.Max(0f, flow.ClockSeconds);
            long clockValue = flow.Phase == MatchPhase.Live && flow.BombPlanted ? -1 : (int)secs;
            if (Changed(ref clockShown, clockValue)) clock.text = clockValue < 0 ? "" : $"{clockValue / 60}:{clockValue % 60:00}";
            if (Changed(ref roundShown, flow.Round * 2L + (flow.InOvertime ? 1 : 0))) roundText.text = "ROUND " + flow.Round + (flow.InOvertime ? "  OT" : "");
            FillPips(pipsLeft, mine, m, scoreLeft.color);
            FillPips(pipsRight, theirs, m, scoreRight.color);
            switch (flow.Phase)
            {
                case MatchPhase.BuyPhase: phaseText.text = "BUY PHASE"; break;
                case MatchPhase.Live: phaseText.text = flow.BombPlanted ? "BOMB PLANTED - SITE " + Ids.SiteName(flow.BombSite) : ""; break;
                case MatchPhase.Halftime: phaseText.text = "HALFTIME"; break;
                default: phaseText.text = ""; break;
            }
            bool fuse = flow.Phase == MatchPhase.Live && flow.BombPlanted && !flow.BombDefused;
            bombBarBack.enabled = bombBar.enabled = fuse;
            if (fuse) bombBar.rectTransform.anchorMax = new Vector2(flow.BombTimeLeft / Mathf.Max(1f, Game.Data.Game.bomb.fuseSeconds), 1f);

            // vitals / weapon / abilities come from whoever the camera is watching
            var subject = view != null ? view : me;
            if (subject != null)
            {
                if (Changed(ref healthShown, subject.Health)) health.text = subject.Health.ToString();
                health.color = subject.Health > 30 ? UIFactory.TextColor : UIFactory.Accent;
                if (Changed(ref armorShown, subject.Armor)) armor.text = subject.Armor > 0 ? "ARMOR " + subject.Armor : "";
                if (!ReferenceEquals(nameShownFor, subject))
                {
                    nameShownFor = subject;
                    agentName.text = subject.Record.name + " - " + (subject.Agent?.displayName ?? "");
                }
                healthBar.rectTransform.anchorMax = new Vector2(subject.Health / (float)Game.Data.Game.combat.maxHealth, 1f);
                var w = subject.Weapons.Current;
                object wdef = w?.def;
                if (!ReferenceEquals(weaponShownFor, wdef))
                {
                    weaponShownFor = wdef;
                    weaponName.text = w != null ? w.def.displayName.ToUpperInvariant() : "";
                }
                long ammoValue = w == null ? -1 : w.def.magazineSize <= 0 ? -2 : subject.Weapons.IsReloading ? -3 : w.mag * 100000L + w.reserve;
                if (Changed(ref ammoShown, ammoValue))
                    ammo.text = ammoValue == -1 ? "" : ammoValue == -2 ? "-" : ammoValue == -3 ? "<size=26>RELOADING</size>" : $"{w.mag}<size=26> / {w.reserve}</size>";
                if (Changed(ref moneyShown, subject.Record.money)) moneyText.text = "$" + subject.Record.money;
                for (int i = 0; i < 4; i++) UpdateChip(chips[i], subject, i);
                crosshair.SpreadDegrees = subject.Weapons.CurrentSpread;
            }
            bool alive = me != null && me.Alive;
            bool scoped = view != null && view.Alive && view.Weapons.IsAiming && view.Weapons.CurrentDef != null && view.Weapons.CurrentDef.scoped;
            crosshair.gameObject.SetActive(view != null && view.Alive && !scoped);
            SetScope(scoped);

            // hit marker
            float since = Time.unscaledTime - hitTime;
            foreach (var bar in hitBars)
            {
                bar.enabled = since < 0.18f;
                bar.color = hitKill ? UIFactory.Accent : Color.white;
            }

            // screen effects
            flash.enabled = view != null && view.BlindTimeLeft > 0f;
            if (flash.enabled) flash.color = new Color(1f, 1f, 1f, Mathf.Clamp01(view.BlindTimeLeft / Mathf.Max(0.3f, view.BlindDuration * 0.6f)));
            smoke.enabled = view != null && m.Effects != null && m.Effects.InsideSmoke(view.EyePosition);
            damageFlash = Mathf.MoveTowards(damageFlash, 0f, Time.unscaledDeltaTime * 0.8f);
            damage.enabled = damageFlash > 0.01f && alive;
            damage.color = new Color(0.8f, 0f, 0f, damageFlash);

            // interaction + hints
            var bomb = m.Bomb;
            float progress = 0f;
            string label = "";
            if (me != null && bomb.Planter == me && bomb.PlantProgress > 0f) { progress = bomb.PlantProgress; label = "PLANTING"; }
            else if (me != null && bomb.Defuser == me && bomb.DefuseProgress > 0f) { progress = bomb.DefuseProgress; label = "DEFUSING"; }
            interactBack.enabled = interactFill.enabled = progress > 0f;
            interactFill.rectTransform.anchorMax = new Vector2(progress, 1f);
            interactLabel.text = label;
            hint.text = HintFor(m, me);
            spectate.text = !alive && view != null ? $"SPECTATING {view.Record.name.ToUpperInvariant()}   ({KeyNames.Label(Game.Keys.Key("Fire"))}: next)" : (!alive ? "YOU ARE DEAD" : "");

            // announcements, killfeed expiry, fps
            if (Time.unscaledTime > bannerUntil) banner.text = "";
            for (int i = feed.Count - 1; i >= 0; i--)
                if (Time.unscaledTime > feed[i].until) { Object.Destroy(feed[i].go); feed.RemoveAt(i); }
            fps.enabled = s.showFps;
            fpsAccum += Time.unscaledDeltaTime;
            fpsFrames++;
            if (fpsAccum >= 0.5f)
            {
                fps.text = Mathf.RoundToInt(fpsFrames / fpsAccum) + " FPS";
                fpsAccum = 0f;
                fpsFrames = 0;
            }

            minimap.Tick(m, local);
            UpdateWorldMarkers(m, local);
        }

        void FillPips(Image[] pips, TeamId team, MatchController m, Color color)
        {
            int n = 0;
            foreach (var p in m.Players)
            {
                if (p.team != team) continue;
                if (n < pips.Length)
                {
                    pips[n].enabled = true;
                    pips[n].color = p.alive ? color : new Color(0.3f, 0.3f, 0.3f, 0.8f);
                }
                n++;
            }
            for (int i = n; i < pips.Length; i++) pips[i].enabled = false;
        }

        static void UpdateChip(AbilityChip chip, TacticalCharacter c, int i)
        {
            var slot = c.Abilities.Slot(i);
            var def = c.Abilities.Def(i);
            chip.back.enabled = slot != null;
            if (slot == null)
            {
                chip.key.text = chip.name.text = chip.charges.text = "";
                chip.chargesShown = long.MinValue;
                return;
            }
            string key = Game.Keys.Key(i == 0 ? "Ability1" : i == 1 ? "Ability2" : i == 2 ? "Ability3" : "Ultimate");
            chip.key.text = KeyNames.Label(key);
            chip.name.text = def != null ? def.displayName : slot.abilityId;
            bool ready = c.Abilities.IsReady(i);
            chip.name.color = ready ? UIFactory.TextColor : UIFactory.TextDim;
            int charges = c.Abilities.Charges(i);
            long shown = slot.IsUltimate ? (1L << 40) + c.Record.ultPoints * 1000L + slot.ultPoints : charges * 1000L + slot.maxCharges;
            if (chip.chargesShown != shown)
            {
                chip.chargesShown = shown;
                chip.charges.text = slot.IsUltimate ? $"{c.Record.ultPoints}/{slot.ultPoints}" : new string('|', charges) + new string('.', Mathf.Max(0, slot.maxCharges - charges));
            }
            chip.back.color = slot.IsUltimate && ready ? new Color(1f, 0.8f, 0.2f, 0.45f) : new Color(0f, 0f, 0f, 0.55f);
        }

        static string HintFor(MatchController m, TacticalCharacter me)
        {
            if (me == null || !me.Alive) return "";
            var flow = m.Flow;
            string interact = KeyNames.Label(Game.Keys.Key("Interact"));
            if (flow.Phase == MatchPhase.BuyPhase) return $"Press {KeyNames.Label(Game.Keys.Key("BuyMenu"))} to buy";
            if (me.CarryingBomb)
                return m.WorldMap.SiteAt(me.Feet) >= 0 ? $"Hold {interact} to plant" : "You carry the bomb - plant it on site A or B";
            float defuseRadius = Game.Data.Game.bomb.interactRadius;
            if (m.Bomb.State == BombState.Planted && me.Side == Side.Defense && (me.Feet - m.Bomb.Position).sqrMagnitude <= defuseRadius * defuseRadius)
                return $"Hold {interact} to defuse" + (me.Record.loadout.hasDefuseKit ? " (kit)" : "");
            if (m.Effects.NearestPickup(me.Feet, 1.8f) >= 0) return $"Press {interact} to pick up the weapon";
            return "";
        }

        void UpdateWorldMarkers(MatchController m, PlayerRecord local)
        {
            var cam = Game.Camera != null ? Game.Camera.Cam : null;
            if (cam == null) return;
            for (int i = 0; i < 2; i++)
                PlaceMarker(siteMarkers[i], cam, m.WorldMap.HasSite(i) ? m.WorldMap.SiteCenter(i) + Vector3.up * 3f : (Vector3?)null, true);
            var bomb = m.Bomb;
            bool showBomb = bomb.State == BombState.Planted || (bomb.State == BombState.Dropped && m.SideOf(local) == Side.Attack);
            PlaceMarker(bombMarker, cam, showBomb ? bomb.Position + Vector3.up * 0.8f : (Vector3?)null, true);

            // revealed enemies and teammates' names
            int used = 0;
            foreach (var c in m.AllCharacters)
            {
                if (!c.Alive || c == m.Player.ViewTarget) continue;
                bool enemy = c.Team != local.team;
                bool revealed = enemy && c.RevealedUntil > m.Time;
                if (enemy && !revealed) continue;
                if (!enemy && (c.Feet - cam.transform.position).sqrMagnitude > 60f * 60f) continue;
                if (used >= markerPool.Count)
                {
                    var t = UIFactory.Label(Root, "", 16, TextAnchor.MiddleCenter);
                    t.rectTransform.sizeDelta = new Vector2(160f, 24f);
                    t.gameObject.AddComponent<Outline>().effectColor = Color.black;
                    markerPool.Add(t);
                }
                var marker = markerPool[used++];
                marker.text = enemy ? "[ ! ]" : c.Record.name;
                marker.color = enemy ? UIFactory.Accent : new Color(0.7f, 0.9f, 1f);
                PlaceMarker(marker, cam, c.Feet + Vector3.up * (c.Height + 0.35f), enemy);
            }
            for (int i = used; i < markerPool.Count; i++) markerPool[i].enabled = false;
        }

        void PlaceMarker(Text t, Camera cam, Vector3? world, bool clampToScreen)
        {
            if (world == null) { t.enabled = false; return; }
            Vector3 sp = cam.WorldToScreenPoint(world.Value);
            if (sp.z <= 0f && !clampToScreen) { t.enabled = false; return; }
            if (sp.z <= 0f) { sp.x = Screen.width - sp.x; sp.y = 0f; }
            if (clampToScreen)
            {
                sp.x = Mathf.Clamp(sp.x, 40f, Screen.width - 40f);
                sp.y = Mathf.Clamp(sp.y, 40f, Screen.height - 40f);
            }
            RectTransformUtility.ScreenPointToLocalPointInRectangle(canvas, sp, null, out Vector2 local);
            t.enabled = true;
            t.rectTransform.anchorMin = t.rectTransform.anchorMax = new Vector2(0.5f, 0.5f);
            t.rectTransform.anchoredPosition = local;
        }
    }

    /// <summary>Top-left minimap: a texture rendered from the ASCII grid plus live dots.</summary>
    public sealed class Minimap
    {
        const int PixelsPerCell = 4;
        const float Size = 300f;
        readonly RectTransform root;
        readonly RawImage image;
        readonly List<Image> dots = new List<Image>();
        MapGrid grid;
        // Which enemies the team can see is re-checked 10 times a second, not every frame:
        // it costs up to one line-of-sight test per (teammate, enemy) pair.
        const float SpotInterval = 0.1f;
        readonly HashSet<TacticalCharacter> spotted = new HashSet<TacticalCharacter>();
        float spotTimer;

        public Minimap(RectTransform parent)
        {
            var back = UIFactory.Image(parent, "Minimap", new Color(0f, 0f, 0f, 0.55f));
            root = back.rectTransform;
            UIFactory.Place(root, new Vector2(0f, 1f), new Vector2(20f, -20f), new Vector2(Size, Size), new Vector2(0f, 1f));
            var rt = UIFactory.Rect("Map", root);
            UIFactory.Stretch(rt, 6f, 6f, 6f, 6f);
            image = rt.gameObject.AddComponent<RawImage>();
            image.raycastTarget = false;
        }

        public void Rebuild()
        {
            var world = Game.World;
            if (world == null || world.Grid == grid) return;
            grid = world.Grid;
            var v = Game.Data.Game.visuals;
            var tex = new Texture2D(grid.Width * PixelsPerCell, grid.Height * PixelsPerCell, TextureFormat.RGBA32, false)
            {
                filterMode = FilterMode.Point,
                wrapMode = TextureWrapMode.Clamp,
            };
            var pixels = new Color32[tex.width * tex.height];
            for (int y = 0; y < grid.Height; y++)
                for (int x = 0; x < grid.Width; x++)
                {
                    Color c;
                    switch (grid.Get(x, y))
                    {
                        case CellType.Wall: c = new Color(0f, 0f, 0f, 0f); break;
                        case CellType.LowCover: c = Prims.ToColor(v.lowCoverColor); break;
                        case CellType.HighCover: c = Prims.ToColor(v.highCoverColor); break;
                        case CellType.SiteA:
                        case CellType.SiteB: c = Prims.ToColor(v.siteColor) * 0.8f; break;
                        case CellType.AttackSpawn: c = Prims.ToColor(v.attackSpawnColor); break;
                        case CellType.DefenseSpawn: c = Prims.ToColor(v.defenseSpawnColor); break;
                        default: c = new Color(0.55f, 0.55f, 0.52f, 1f); break;
                    }
                    Color32 c32 = c;
                    int py0 = (grid.Height - 1 - y) * PixelsPerCell; // texture rows go bottom-up, the grid top-down
                    for (int py = 0; py < PixelsPerCell; py++)
                        for (int px = 0; px < PixelsPerCell; px++)
                            pixels[(py0 + py) * tex.width + x * PixelsPerCell + px] = c32;
                }
            tex.SetPixels32(pixels);
            tex.Apply();
            image.texture = tex;
            float aspect = grid.Width / (float)grid.Height;
            root.sizeDelta = aspect >= 1f ? new Vector2(Size, Size / aspect) : new Vector2(Size * aspect, Size);
        }

        public void Tick(MatchController m, PlayerRecord local)
        {
            if (grid == null) Rebuild();
            if (grid == null) return;
            var rect = image.rectTransform.rect;
            int used = 0;
            var vis = Game.Data.Game.visuals;
            spotTimer -= Time.unscaledDeltaTime;
            if (spotTimer <= 0f)
            {
                spotTimer = SpotInterval;
                spotted.Clear();
                foreach (var c in m.AllCharacters)
                    if (c.Alive && c.Team != local.team && SeenByTeam(m, c, local.team)) spotted.Add(c);
            }
            foreach (var c in m.AllCharacters)
            {
                if (!c.Alive) continue;
                bool enemy = c.Team != local.team;
                if (enemy && c.RevealedUntil <= m.Time && !spotted.Contains(c)) continue;
                var dot = Dot(used++);
                Color color = enemy ? UIFactory.Accent : Prims.ToColor(c.Side == Side.Attack ? vis.attackColor : vis.defenseColor);
                if (c.Record.isLocal) color = Color.white;
                dot.color = color;
                dot.rectTransform.sizeDelta = c.Record.isLocal ? new Vector2(12f, 12f) : new Vector2(9f, 9f);
                dot.rectTransform.anchoredPosition = ToMap(c.Feet, rect);
                dot.rectTransform.localRotation = Quaternion.Euler(0f, 0f, -c.Yaw + 45f);
            }
            var bomb = m.Bomb;
            // Same visibility as the world marker: a dropped bomb is only shown to the attackers.
            bool attacking = m.SideOf(local) == Side.Attack;
            if (bomb.State == BombState.Planted || (bomb.State == BombState.Dropped && attacking) ||
                (bomb.State == BombState.Carried && bomb.Carrier != null && bomb.Carrier.Team == local.team))
            {
                var dot = Dot(used++);
                dot.color = Prims.ToColor(vis.bombColor);
                dot.rectTransform.sizeDelta = new Vector2(8f, 8f);
                dot.rectTransform.localRotation = Quaternion.identity;
                dot.rectTransform.anchoredPosition = ToMap(bomb.State == BombState.Carried ? bomb.Carrier.Feet : bomb.Position, rect) + new Vector2(0f, 8f);
            }
            for (int i = used; i < dots.Count; i++) dots[i].enabled = false;
        }

        static bool SeenByTeam(MatchController m, TacticalCharacter enemy, TeamId team)
        {
            // An enemy shows on the map while any teammate has line of sight to them.
            foreach (var c in m.AllCharacters)
            {
                if (!c.Alive || c.Team != team) continue;
                if ((c.Feet - enemy.Feet).sqrMagnitude > 60f * 60f) continue;
                if (Vector3.Angle(c.AimForward, enemy.ChestPosition - c.EyePosition) > 60f) continue;
                if (m.Combat.LineOfSight(c.EyePosition, enemy.ChestPosition)) return true;
            }
            return false;
        }

        Image Dot(int i)
        {
            while (dots.Count <= i)
            {
                var d = UIFactory.Image(image.transform, "Dot", Color.white);
                d.rectTransform.anchorMin = d.rectTransform.anchorMax = new Vector2(0.5f, 0.5f);
                dots.Add(d);
            }
            dots[i].enabled = true;
            return dots[i];
        }

        Vector2 ToMap(Vector3 p, Rect rect) =>
            new Vector2(p.x / grid.WorldWidth * rect.width, p.z / grid.WorldHeight * rect.height);
    }
}
