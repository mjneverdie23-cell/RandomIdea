using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace TacticalShooter.UI
{
    /// <summary>
    /// Owns the canvas and every screen, routes UI hotkeys (pause, buy, scoreboard) and decides
    /// whether the cursor is locked. Gameplay asks GameplayInputAllowed before reading input.
    /// </summary>
    public sealed class UIManager : MonoBehaviour
    {
        public RectTransform CanvasRect { get; private set; }

        HudScreen hud;
        BuyScreen buy;
        ScoreboardScreen scoreboard;
        PauseScreen pause;
        MatchEndScreen matchEnd;
        MainMenuScreen mainMenu;
        SetupScreen setup;
        SettingsScreen settings;
        UIScreen[] all;
        bool settingsFromPause;

        public HudScreen Hud => hud;

        public bool GameplayInputAllowed =>
            Game.InMatch && !Game.Paused && !buy.Visible && !pause.Visible && !settings.Visible && !matchEnd.Visible && Application.isFocused;

        bool WantsCursor => !Game.InMatch || buy.Visible || pause.Visible || settings.Visible || matchEnd.Visible;

        public static UIManager Create(Transform parent)
        {
            UIFactory.Init();
            var go = new GameObject("UI", typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var canvas = go.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = 50;
            var scaler = go.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920f, 1080f);
            scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
            scaler.matchWidthOrHeight = 0.5f;
            go.AddComponent<GraphicRaycaster>();
            EnsureEventSystem();
            var ui = go.AddComponent<UIManager>();
            ui.CanvasRect = (RectTransform)go.transform;
            ui.Build();
            return ui;
        }

        static void EnsureEventSystem()
        {
            if (FindFirstObjectByType<EventSystem>() != null) return;
            var go = new GameObject("EventSystem", typeof(EventSystem));
#if TS_INPUT_SYSTEM && ENABLE_INPUT_SYSTEM
            go.AddComponent<UnityEngine.InputSystem.UI.InputSystemUIInputModule>();
#else
            go.AddComponent<StandaloneInputModule>();
#endif
        }

        void Build()
        {
            hud = new HudScreen(CanvasRect);
            scoreboard = new ScoreboardScreen(CanvasRect);
            buy = new BuyScreen(CanvasRect);
            pause = new PauseScreen(CanvasRect);
            matchEnd = new MatchEndScreen(CanvasRect);
            mainMenu = new MainMenuScreen(CanvasRect);
            setup = new SetupScreen(CanvasRect);
            settings = new SettingsScreen(CanvasRect);
            all = new UIScreen[] { hud, scoreboard, buy, pause, matchEnd, mainMenu, setup, settings };
            HideAll();
        }

        void HideAll()
        {
            foreach (var s in all) s.Hide();
        }

        public void ShowMainMenu()
        {
            HideAll();
            mainMenu.Show();
        }

        public void ShowSetup()
        {
            HideAll();
            setup.Show();
        }

        public void ShowSettings(bool fromPause)
        {
            settingsFromPause = fromPause;
            mainMenu.Hide();
            pause.Hide();
            settings.Show();
        }

        public void CloseSettings()
        {
            settings.Hide();
            SettingsStore.Apply(Game.Settings);
            SettingsStore.Save(Game.Settings);
            if (settingsFromPause && Game.InMatch) pause.Show();
            else mainMenu.Show();
        }

        public void ShowInGame()
        {
            HideAll();
            hud.Show();
        }

        public void ShowMatchEnd()
        {
            SetPaused(false);
            buy.Hide();
            scoreboard.Hide();
            matchEnd.Show();
        }

        public void SetPaused(bool paused)
        {
            Game.Paused = paused;
            Time.timeScale = paused ? 0f : 1f;
            if (paused)
            {
                buy.Hide();
                pause.Show();
            }
            else
            {
                pause.Hide();
                settings.Hide();
            }
        }

        public void ToggleBuy()
        {
            if (buy.Visible) { buy.Hide(); return; }
            var m = Game.Match;
            if (m.CanBuyNow(m.Local)) buy.Show();
            else
            {
                Game.Audio.Play2D("ui_error");
                Game.Events.Announce(m.Flow.CanBuy ? "Buy only in your spawn zone" : "The buy phase is over", 1.5f);
            }
        }

        void Update()
        {
            if (Game.InMatch && !matchEnd.Visible)
            {
                if (settings.Visible)
                {
                    if (!settings.IsCapturing && InputReader.WasPressed("Escape")) CloseSettings();
                }
                else if (InputReader.ActionPressed("Pause"))
                {
                    if (buy.Visible) buy.Hide();
                    else SetPaused(!Game.Paused);
                }
                else if (!Game.Paused && InputReader.ActionPressed("BuyMenu")) ToggleBuy();

                bool board = !Game.Paused && InputReader.ActionDown("Scoreboard");
                if (board && !scoreboard.Visible) scoreboard.Show();
                else if (!board && scoreboard.Visible) scoreboard.Hide();
                if (buy.Visible && !Game.Match.CanBuyNow(Game.Match.Local)) buy.Hide();
            }
            else if (!Game.InMatch && InputReader.WasPressed("Escape"))
            {
                if (settings.Visible && !settings.IsCapturing) CloseSettings();
                else if (setup.Visible) ShowMainMenu();
            }

            bool cursor = WantsCursor;
            Cursor.lockState = cursor ? CursorLockMode.None : CursorLockMode.Locked;
            Cursor.visible = cursor;

            foreach (var s in all) if (s.Visible) s.Tick();
        }
    }
}
