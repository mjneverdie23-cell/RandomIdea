using System.Collections.Generic;
using System.Text;
using TacticalShooter.Core;
using UnityEngine;
using UnityEngine.UI;

namespace TacticalShooter.UI
{
    public sealed class MainMenuScreen : UIScreen
    {
        public MainMenuScreen(RectTransform canvas)
        {
            Root = FullScreen(canvas, "MainMenu");
            var side = UIFactory.Image(Root, "Panel", UIFactory.PanelColor, true);
            side.rectTransform.anchorMin = new Vector2(0f, 0f);
            side.rectTransform.anchorMax = new Vector2(0f, 1f);
            side.rectTransform.pivot = new Vector2(0f, 0.5f);
            side.rectTransform.sizeDelta = new Vector2(640f, 0f);
            side.rectTransform.anchoredPosition = Vector2.zero;
            UIFactory.VBox(side, 18f, 70, TextAnchor.MiddleLeft);

            var title = UIFactory.Label(side.transform, "TACTICAL\nSHOOTER", 84, TextAnchor.MiddleLeft, UIFactory.TextColor, FontStyle.Bold);
            UIFactory.Size(title, -1f, 210f);
            var accent = UIFactory.Image(side.transform, "Accent", UIFactory.Accent);
            UIFactory.Size(accent, 120f, 6f);
            var sub = UIFactory.Label(side.transform, "Round-based 5v5 bomb defusal template.\nSame rules and data in Unity and Unreal Engine 5.", 22, TextAnchor.UpperLeft, UIFactory.TextDim);
            UIFactory.Size(sub, -1f, 90f);

            UIFactory.Size(UIFactory.Button(side.transform, "PLAY VS BOTS", () => Game.UI.ShowSetup(), 28, UIFactory.Accent), 420f, 72f);
            UIFactory.Size(UIFactory.Button(side.transform, "SETTINGS", () => Game.UI.ShowSettings(false), 26), 420f, 62f);
            UIFactory.Size(UIFactory.Button(side.transform, "QUIT", () => Game.Root.Quit(), 26), 420f, 62f);

            var foot = UIFactory.Label(side.transform, "Placeholder art: every model is a basic shape.\nAll tuning lives in shared/config.", 18, TextAnchor.LowerLeft, UIFactory.TextDim);
            UIFactory.Size(foot, -1f, 120f);
        }
    }

    /// <summary>Agent, side, bots, match length and map, then start.</summary>
    public sealed class SetupScreen : UIScreen
    {
        readonly RectTransform body;
        Text agentInfo;

        public SetupScreen(RectTransform canvas)
        {
            Root = FullScreen(canvas, "Setup", new Color(0f, 0f, 0f, 0.55f));
            var panel = UIFactory.Image(Root, "Panel", UIFactory.PanelColor, true);
            UIFactory.Place(panel.rectTransform, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(1500f, 960f));
            body = panel.rectTransform;
            UIFactory.VBox(panel, 14f, 40);
        }

        public override void Refresh()
        {
            UIFactory.Clear(body);
            var s = Game.Settings;
            var d = Game.Data;
            var title = UIFactory.Label(body, "MATCH SETUP", 44, TextAnchor.MiddleLeft, UIFactory.TextColor, FontStyle.Bold);
            UIFactory.Size(title, -1f, 60f);

            UIFactory.Size(UIFactory.Label(body, "AGENT", 20, TextAnchor.LowerLeft, UIFactory.TextDim), -1f, 30f);
            var agentRow = UIFactory.Row(body, 84f);
            var labels = new List<string>();
            int selected = 0;
            for (int i = 0; i < d.Agents.Length; i++)
            {
                labels.Add(d.Agents[i].displayName.ToUpperInvariant() + "\n<size=16>" + d.Agents[i].role + "</size>");
                if (d.Agents[i].id == s.agentId) selected = i;
            }
            UIFactory.Options(agentRow, labels.ToArray(), selected, i =>
            {
                s.agentId = d.Agents[i].id;
                ShowAgent();
            }, 250f, 22);
            agentInfo = UIFactory.Label(body, "", 20, TextAnchor.UpperLeft, UIFactory.TextColor);
            UIFactory.Size(agentInfo, -1f, 170f);
            ShowAgent();

            var sideRow = UIFactory.LabeledRow(body, "Starting side", 52f);
            UIFactory.Options(sideRow, new[] { "ATTACK", "DEFENSE" }, s.playerSide == "defense" ? 1 : 0,
                i => s.playerSide = i == 0 ? "attack" : "defense");

            var diffRow = UIFactory.LabeledRow(body, "Bot difficulty", 52f);
            var diffs = d.Bots.difficulties;
            var diffLabels = new string[diffs.Length];
            int diffSel = 0;
            for (int i = 0; i < diffs.Length; i++)
            {
                diffLabels[i] = diffs[i].displayName.ToUpperInvariant();
                if (diffs[i].id == s.botDifficulty) diffSel = i;
            }
            UIFactory.Options(diffRow, diffLabels, diffSel, i => s.botDifficulty = diffs[i].id);

            var sizeRow = UIFactory.LabeledRow(body, "Players per team", 52f);
            UIFactory.Options(sizeRow, new[] { "1v1", "2v2", "3v3", "4v4", "5v5" }, Mathf.Clamp(s.teamSize, 1, 5) - 1, i => s.teamSize = i + 1, 110f);

            var lengthRow = UIFactory.LabeledRow(body, "Match length", 52f);
            int[] lengths = { 13, 5, 3 };
            int lengthSel = System.Array.IndexOf(lengths, s.roundsToWin);
            UIFactory.Options(lengthRow, new[] { "FIRST TO 13", "FIRST TO 5", "FIRST TO 3" }, lengthSel < 0 ? 0 : lengthSel,
                i => s.roundsToWin = lengths[i], 220f);

            var mapRow = UIFactory.LabeledRow(body, "Map", 52f);
            var maps = new List<string>(d.Game.mapRotation);
            var mapLabels = new List<string>();
            foreach (string id in maps) mapLabels.Add((d.Map(id)?.displayName ?? id).ToUpperInvariant());
            UIFactory.Options(mapRow, mapLabels.ToArray(), Mathf.Max(0, maps.IndexOf(s.mapId)), i => s.mapId = maps[i], 220f);

            var spacer = UIFactory.Rect("Spacer", body);
            UIFactory.Size(spacer, -1f, 10f, -1f, 1f);
            var buttons = UIFactory.Row(body, 70f, 20f);
            UIFactory.Size(UIFactory.Button(buttons, "START MATCH", Start, 28, UIFactory.Accent), 360f, 70f);
            UIFactory.Size(UIFactory.Button(buttons, "BACK", () => Game.UI.ShowMainMenu(), 24), 200f, 70f);
        }

        void ShowAgent()
        {
            var d = Game.Data;
            var a = d.Agent(Game.Settings.agentId);
            if (a == null || agentInfo == null) return;
            var sb = new StringBuilder();
            sb.Append("<b>").Append(a.displayName).Append("</b> - ").Append(a.role).Append("\n").Append(a.description).Append("\n");
            foreach (var slot in a.abilities)
            {
                var ab = d.Ability(slot.abilityId);
                if (ab == null) continue;
                sb.Append("\n<b>").Append(slot.slot).Append("</b>  ").Append(ab.displayName).Append(" - ");
                if (slot.IsUltimate) sb.Append("ultimate, ").Append(slot.ultPoints).Append(" points");
                else if (slot.freeChargesPerRound > 0 && slot.price <= 0) sb.Append("free every round");
                else sb.Append("$").Append(slot.price).Append(" (max ").Append(slot.maxCharges).Append(")");
                sb.Append("   <color=#9AA4AE>").Append(ab.description).Append("</color>");
            }
            agentInfo.supportRichText = true;
            agentInfo.text = sb.ToString();
        }

        void Start()
        {
            SettingsStore.Save(Game.Settings);
            Game.Root.StartMatch(MatchOptions.FromSettings(Game.Settings));
        }
    }

    /// <summary>Gameplay, video, audio, controls (with rebinding) and crosshair settings.</summary>
    public sealed class SettingsScreen : UIScreen
    {
        static readonly string[] Tabs = { "GAMEPLAY", "VIDEO", "AUDIO", "CONTROLS", "CROSSHAIR" };
        static readonly string[] CrosshairColors = { "#00FF7F", "#00E5FF", "#FFFFFF", "#FFE600", "#FF3B30", "#FF4DFF" };

        readonly RectTransform content;
        readonly List<Button> tabButtons = new List<Button>();
        int tab;
        string captureAction;
        bool captureAlt;
        Button captureButton;

        public bool IsCapturing => captureAction != null;

        public SettingsScreen(RectTransform canvas)
        {
            Root = FullScreen(canvas, "Settings", new Color(0f, 0f, 0f, 0.6f));
            var panel = UIFactory.Image(Root, "Panel", UIFactory.PanelColor, true);
            UIFactory.Place(panel.rectTransform, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(1400f, 940f));
            UIFactory.VBox(panel, 16f, 36);
            UIFactory.Size(UIFactory.Label(panel.transform, "SETTINGS", 44, TextAnchor.MiddleLeft, UIFactory.TextColor, FontStyle.Bold), -1f, 58f);
            var tabRow = UIFactory.Row(panel.transform, 52f, 8f);
            for (int i = 0; i < Tabs.Length; i++)
            {
                int index = i;
                var b = UIFactory.Button(tabRow, Tabs[i], () => SelectTab(index), 20);
                UIFactory.Size(b, 200f, -1f);
                tabButtons.Add(b);
            }
            content = UIFactory.Rect("Content", panel.transform);
            UIFactory.Size(content, -1f, 640f, -1f, 1f);
            UIFactory.VBox(content, 8f, 6);
            var bottom = UIFactory.Row(panel.transform, 60f, 16f);
            UIFactory.Size(UIFactory.Button(bottom, "BACK", () => Game.UI.CloseSettings(), 24, UIFactory.Accent), 220f, -1f);
            UIFactory.Size(UIFactory.Button(bottom, "RESET TO DEFAULTS", ResetDefaults, 22), 300f, -1f);
        }

        public override void Refresh() => SelectTab(tab);

        public override void Hide()
        {
            captureAction = null;
            base.Hide();
        }

        void ResetDefaults()
        {
            var keepSetup = Game.Settings;
            var fresh = Game.Data.DefaultSettings.Clone();
            fresh.agentId = keepSetup.agentId;
            fresh.playerSide = keepSetup.playerSide;
            fresh.botDifficulty = keepSetup.botDifficulty;
            fresh.teamSize = keepSetup.teamSize;
            fresh.roundsToWin = keepSetup.roundsToWin;
            fresh.mapId = keepSetup.mapId;
            Game.Settings = fresh;
            Game.RebuildKeyMap();
            SettingsStore.Apply(fresh);
            SelectTab(tab);
        }

        void SelectTab(int index)
        {
            tab = index;
            captureAction = null;
            for (int i = 0; i < tabButtons.Count; i++) UIFactory.SetColor(tabButtons[i], i == index ? UIFactory.Accent : UIFactory.ButtonColor);
            UIFactory.Clear(content);
            var s = Game.Settings;
            switch (index)
            {
                case 0:
                    SliderRow("Mouse sensitivity", 0.05f, 3f, s.mouseSensitivity, false, v => s.mouseSensitivity = v, "0.00");
                    SliderRow("Aim-down-sights sensitivity", 0.2f, 2f, s.adsSensitivityMultiplier, false, v => s.adsSensitivityMultiplier = v, "0.00");
                    ToggleRow("Invert mouse Y", s.invertY, v => s.invertY = v);
                    SliderRow("Field of view (horizontal)", 80f, 120f, s.fieldOfView, true, v => s.fieldOfView = v, "0");
                    ToggleRow("Show FPS counter", s.showFps, v => s.showFps = v);
                    break;
                case 1:
                    ToggleRow("Fullscreen (builds only)", s.fullscreen, v => { s.fullscreen = v; SettingsStore.Apply(s); });
                    ToggleRow("V-Sync", s.vsync, v => { s.vsync = v; SettingsStore.Apply(s); });
                    SliderRow("FPS limit (0 = unlimited)", 0f, 300f, s.fpsLimit, true, v => { s.fpsLimit = (int)v; SettingsStore.Apply(s); }, "0");
                    var qRow = UIFactory.LabeledRow(content, "Quality", 52f);
                    var names = QualitySettings.names;
                    int current = s.qualityLevel >= 0 ? s.qualityLevel : QualitySettings.GetQualityLevel();
                    UIFactory.Options(qRow, names, current, i => { s.qualityLevel = i; SettingsStore.Apply(s); }, Mathf.Min(170f, 1000f / Mathf.Max(1, names.Length)), 16);
                    break;
                case 2:
                    SliderRow("Master volume", 0f, 1f, s.masterVolume, false, v => { s.masterVolume = v; SettingsStore.Apply(s); }, "0%");
                    UIFactory.Size(UIFactory.Label(content, "Every sound is synthesised from shared/config/audio.json. Drop an AudioClip named after a cue into Resources/TacticalShooter/Audio to replace it.", 18, TextAnchor.UpperLeft, UIFactory.TextDim), -1f, 60f);
                    break;
                case 3:
                    BuildControls();
                    break;
                case 4:
                    var cRow = UIFactory.LabeledRow(content, "Colour", 52f);
                    UIFactory.Options(cRow, new[] { "GREEN", "CYAN", "WHITE", "YELLOW", "RED", "PINK" }, System.Array.IndexOf(CrosshairColors, s.crosshairColor),
                        i => s.crosshairColor = CrosshairColors[i], 150f, 18);
                    SliderRow("Line length", 1f, 20f, s.crosshairSize, true, v => s.crosshairSize = v, "0");
                    SliderRow("Gap", 0f, 15f, s.crosshairGap, true, v => s.crosshairGap = v, "0");
                    SliderRow("Thickness", 1f, 6f, s.crosshairThickness, true, v => s.crosshairThickness = v, "0");
                    ToggleRow("Centre dot", s.crosshairDot, v => s.crosshairDot = v);
                    ToggleRow("Dynamic (shows weapon spread)", s.crosshairDynamic, v => s.crosshairDynamic = v);
                    var previewRow = UIFactory.LabeledRow(content, "Preview", 120f);
                    var box = UIFactory.Image(previewRow, "PreviewBox", new Color(0.3f, 0.34f, 0.38f, 1f));
                    UIFactory.Size(box, 120f, 120f);
                    Crosshair.Create(box.rectTransform, true);
                    break;
            }
        }

        void SliderRow(string caption, float min, float max, float value, bool whole, System.Action<float> set, string format)
        {
            var row = UIFactory.LabeledRow(content, caption, 50f);
            var valueText = UIFactory.Label(row, "", 22, TextAnchor.MiddleRight);
            var slider = UIFactory.Slider(row, min, max, value, whole, null);
            UIFactory.Size(slider, 560f, 40f);
            valueText.transform.SetAsLastSibling();
            UIFactory.Size(valueText, 110f, -1f);
            valueText.text = Format(value, format);
            slider.onValueChanged.AddListener(v =>
            {
                set(v);
                valueText.text = Format(v, format);
            });
        }

        static string Format(float v, string format) => format == "0%" ? Mathf.RoundToInt(v * 100f) + "%" : v.ToString(format);

        void ToggleRow(string caption, bool value, System.Action<bool> set)
        {
            var row = UIFactory.LabeledRow(content, caption, 46f);
            var t = UIFactory.Toggle(row, value, set);
            UIFactory.Size(t, 60f, 40f);
        }

        void BuildControls()
        {
            var grid = UIFactory.Rect("Grid", content);
            UIFactory.Size(grid, -1f, 620f);
            var layout = grid.gameObject.AddComponent<GridLayoutGroup>();
            layout.cellSize = new Vector2(650f, 50f);
            layout.spacing = new Vector2(20f, 6f);
            layout.constraint = GridLayoutGroup.Constraint.FixedColumnCount;
            layout.constraintCount = 2;
            foreach (string action in KeyNames.Actions)
            {
                var row = UIFactory.Rect("Row", grid);
                UIFactory.HBox(row, 8f);
                UIFactory.Size(UIFactory.Label(row, KeyNames.ActionLabel(action), 19, TextAnchor.MiddleLeft, UIFactory.TextDim), 310f, -1f);
                for (int alt = 0; alt < 2; alt++)
                {
                    bool isAlt = alt == 1;
                    string key = isAlt ? Game.Keys.AltKey(action) : Game.Keys.Key(action);
                    Button b = null;
                    b = UIFactory.Button(row, KeyNames.Label(key), () => BeginCapture(action, isAlt, b), 19);
                    UIFactory.Size(b, 160f, -1f);
                }
            }
            UIFactory.Size(UIFactory.Label(content, "Click a key, then press the new key or mouse button. Esc cancels, Backspace clears the alternative key.", 17, TextAnchor.UpperLeft, UIFactory.TextDim), -1f, 30f);
        }

        void BeginCapture(string action, bool alt, Button button)
        {
            captureAction = action;
            captureAlt = alt;
            captureButton = button;
            UIFactory.SetLabel(button, "press a key...");
            UIFactory.SetColor(button, UIFactory.Accent);
        }

        public override void Tick()
        {
            if (captureAction == null) return;
            string key = InputReader.AnyKeyPressed();
            if (key == null) return;
            if (key == "Escape" && captureAction != "Pause")
            {
                captureAction = null;
                SelectTab(tab);
                return;
            }
            if (key == "Backspace" && captureAlt) key = "";
            SettingsStore.SetKey(Game.Settings, Game.Data, captureAction, key, captureAlt);
            captureAction = null;
            captureButton = null;
            SelectTab(tab);
        }
    }

    public sealed class PauseScreen : UIScreen
    {
        public PauseScreen(RectTransform canvas)
        {
            Root = FullScreen(canvas, "Pause", new Color(0f, 0f, 0f, 0.6f));
            var panel = UIFactory.Image(Root, "Panel", UIFactory.PanelColor, true);
            UIFactory.Place(panel.rectTransform, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(520f, 560f));
            UIFactory.VBox(panel, 16f, 40, TextAnchor.UpperCenter);
            UIFactory.Size(UIFactory.Label(panel.transform, "PAUSED", 48, TextAnchor.MiddleCenter, UIFactory.TextColor, FontStyle.Bold), -1f, 80f);
            UIFactory.Size(UIFactory.Button(panel.transform, "RESUME", () => Game.UI.SetPaused(false), 26, UIFactory.Accent), -1f, 64f);
            UIFactory.Size(UIFactory.Button(panel.transform, "SETTINGS", () => Game.UI.ShowSettings(true), 24), -1f, 60f);
            UIFactory.Size(UIFactory.Button(panel.transform, "LEAVE MATCH", () => Game.Root.ReturnToMenu(), 24), -1f, 60f);
            UIFactory.Size(UIFactory.Button(panel.transform, "QUIT GAME", () => Game.Root.Quit(), 24), -1f, 60f);
        }
    }

    public sealed class MatchEndScreen : UIScreen
    {
        readonly Text title;
        readonly Text subtitle;
        readonly ScoreTable table;

        public MatchEndScreen(RectTransform canvas)
        {
            Root = FullScreen(canvas, "MatchEnd", new Color(0f, 0f, 0f, 0.7f));
            var panel = UIFactory.Image(Root, "Panel", UIFactory.PanelColor, true);
            UIFactory.Place(panel.rectTransform, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(1300f, 940f));
            UIFactory.VBox(panel, 12f, 36, TextAnchor.UpperCenter);
            title = UIFactory.Label(panel.transform, "", 72, TextAnchor.MiddleCenter, UIFactory.TextColor, FontStyle.Bold);
            UIFactory.Size(title, -1f, 100f);
            subtitle = UIFactory.Label(panel.transform, "", 26, TextAnchor.MiddleCenter, UIFactory.TextDim);
            UIFactory.Size(subtitle, -1f, 70f);
            var tableRoot = UIFactory.Rect("Table", panel.transform);
            UIFactory.Size(tableRoot, -1f, 560f);
            table = new ScoreTable(tableRoot);
            var buttons = UIFactory.Row(panel.transform, 70f, 20f);
            buttons.GetComponent<HorizontalLayoutGroup>().childAlignment = TextAnchor.MiddleCenter;
            UIFactory.Size(UIFactory.Button(buttons, "PLAY AGAIN", () => Game.Root.StartMatch(MatchOptions.FromSettings(Game.Settings)), 26, UIFactory.Accent), 300f, -1f);
            UIFactory.Size(UIFactory.Button(buttons, "MAIN MENU", () => Game.Root.ReturnToMenu(), 24), 260f, -1f);
        }

        public override void Refresh()
        {
            var m = Game.Match;
            if (m == null || m.Flow == null) return;
            var flow = m.Flow;
            int mine = (int)m.Local.team;
            if (flow.IsDraw) { title.text = "DRAW"; title.color = UIFactory.Warn; }
            else if ((int)flow.Winner == mine) { title.text = "VICTORY"; title.color = UIFactory.Good; }
            else { title.text = "DEFEAT"; title.color = UIFactory.Accent; }
            var mvp = m.Record(m.MvpId);
            subtitle.text = $"{flow.Score[mine]} - {flow.Score[1 - mine]}" + (mvp != null ? $"    MVP: {mvp.name} ({mvp.score} pts)" : "");
            table.Refresh();
        }
    }
}
