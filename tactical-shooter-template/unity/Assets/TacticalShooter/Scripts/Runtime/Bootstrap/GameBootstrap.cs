using System.Collections.Generic;
using System.IO;
using TacticalShooter.Core;
using TacticalShooter.UI;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace TacticalShooter
{
    /// <summary>
    /// Entry point. Loads data and settings, builds the map, creates the camera, audio, UI and
    /// match controller, then shows the main menu. Press Play in an empty scene and this object
    /// creates itself (see AutoCreate); or add it to a scene yourself
    /// (menu: Tactical Shooter &gt; Create Game Scene).
    /// </summary>
    [DefaultExecutionOrder(-100)]
    public sealed class GameBootstrap : MonoBehaviour
    {
        const string ResourceRoot = "TacticalShooter/";

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void AutoCreate()
        {
            if (FindFirstObjectByType<GameBootstrap>() != null) return;
            // Only take over scenes that are empty apart from the default camera and light, so
            // dropping this template into an existing project does not hijack other scenes.
            foreach (var root in SceneManager.GetActiveScene().GetRootGameObjects())
                if (root.GetComponent<Camera>() == null && root.GetComponent<Light>() == null) return;
            new GameObject("TacticalShooter").AddComponent<GameBootstrap>();
        }

        void Awake()
        {
            if (Game.Root != null && Game.Root != this)
            {
                Destroy(gameObject);
                return;
            }
            Game.Root = this;
            Game.Paused = false;
            Time.timeScale = 1f;

            Game.Data = GameData.Load(ReadResource);
            foreach (string error in Game.Data.Validate()) Debug.LogWarning("[TacticalShooter] config: " + error);

            Game.Settings = SettingsStore.Load(Game.Data);
            Game.RebuildKeyMap();
            SettingsStore.Apply(Game.Settings);
            Game.Events = new GameEvents();

            Game.Audio = new GameObject("Audio").AddComponent<AudioManager>();
            Game.Audio.transform.SetParent(transform, false);
            Game.Audio.Init(Game.Data);

            EnsureLighting();
            Game.Camera = CameraRig.Create(transform);
            BuildMap(Game.Settings.mapId);

            Game.Match = gameObject.AddComponent<MatchController>();
            Game.UI = UIManager.Create(transform);
            Game.UI.ShowMainMenu();
        }

        void OnDestroy()
        {
            if (Game.Root != this) return;
            Game.Events?.Clear();
            Game.Root = null;
            Time.timeScale = 1f;
        }

        void OnApplicationQuit() => SettingsStore.Save(Game.Settings);

        static string ReadResource(string key)
        {
            var asset = Resources.Load<TextAsset>(ResourceRoot + key);
            return asset != null ? asset.text : null;
        }

        public void BuildMap(string mapId)
        {
            var def = Game.Data.Map(mapId);
            if (Game.World != null && Game.World.Def == def) return;
            Game.World?.Destroy();
            Game.World = MapBuilder.Build(def, Game.Data.Game.visuals, transform);
            Game.Camera.SetMenuTarget(Game.World);
        }

        public void StartMatch(MatchOptions options)
        {
            BuildMap(options.mapId);
            Game.Paused = false;
            Time.timeScale = 1f;
            Game.UI.ShowInGame();
            Game.Match.Begin(options);
        }

        public void ReturnToMenu()
        {
            Game.Match.End();
            Game.Paused = false;
            Time.timeScale = 1f;
            Game.Camera.MenuMode();
            Game.UI.ShowMainMenu();
        }

        public void Quit()
        {
            SettingsStore.Save(Game.Settings);
#if UNITY_EDITOR
            UnityEditor.EditorApplication.isPlaying = false;
#else
            Application.Quit();
#endif
        }

        static void EnsureLighting()
        {
            Light sun = null;
            foreach (var l in FindObjectsByType<Light>(FindObjectsSortMode.None))
                if (l.type == LightType.Directional) { sun = l; break; }
            if (sun == null)
            {
                sun = new GameObject("Sun").AddComponent<Light>();
                sun.type = LightType.Directional;
            }
            sun.transform.rotation = Quaternion.Euler(52f, -35f, 0f);
            sun.intensity = 1.1f;
            sun.shadows = LightShadows.Soft;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.62f, 0.7f, 0.8f);
            RenderSettings.ambientEquatorColor = new Color(0.5f, 0.5f, 0.5f);
            RenderSettings.ambientGroundColor = new Color(0.3f, 0.28f, 0.25f);
        }
    }

    /// <summary>Loads, saves and applies UserSettings (persistentDataPath/tactical_shooter_settings.json).</summary>
    public static class SettingsStore
    {
        static string FilePath => Path.Combine(Application.persistentDataPath, "tactical_shooter_settings.json");

        public static UserSettings Load(GameData data)
        {
            var s = data.DefaultSettings.Clone();
            try
            {
                if (File.Exists(FilePath)) Core.Json.JsonMapper.Populate(s, File.ReadAllText(FilePath));
            }
            catch (System.Exception e)
            {
                Debug.LogWarning("[TacticalShooter] could not read settings, using defaults: " + e.Message);
            }
            return s;
        }

        public static void Save(UserSettings s)
        {
            if (s == null) return;
            try { File.WriteAllText(FilePath, Core.Json.JsonMapper.ToJson(s)); }
            catch (System.Exception e) { Debug.LogWarning("[TacticalShooter] could not save settings: " + e.Message); }
        }

        public static void Apply(UserSettings s)
        {
            AudioListener.volume = Mathf.Clamp01(s.masterVolume);
            QualitySettings.vSyncCount = s.vsync ? 1 : 0;
            Application.targetFrameRate = s.fpsLimit > 0 ? s.fpsLimit : -1;
            if (s.qualityLevel >= 0 && s.qualityLevel < QualitySettings.names.Length)
                QualitySettings.SetQualityLevel(s.qualityLevel, true);
#if !UNITY_EDITOR
            Screen.fullScreenMode = s.fullscreen ? FullScreenMode.FullScreenWindow : FullScreenMode.Windowed;
#endif
        }

        /// <summary>Stores a key override for one action (the entry keeps both of its keys).</summary>
        public static void SetKey(UserSettings s, GameData data, string action, string key, bool alt)
        {
            var list = new List<KeyBinding>(s.keyOverrides ?? new KeyBinding[0]);
            var entry = list.Find(k => k.action == action);
            if (entry == null)
            {
                // An override always carries both keys (empty altKey = no alternative key).
                entry = new KeyBinding { action = action, key = Game.Keys.Key(action), altKey = Game.Keys.AltKey(action) };
                list.Add(entry);
            }
            if (alt) entry.altKey = key; else entry.key = key;
            s.keyOverrides = list.ToArray();
            Game.RebuildKeyMap();
        }
    }
}
