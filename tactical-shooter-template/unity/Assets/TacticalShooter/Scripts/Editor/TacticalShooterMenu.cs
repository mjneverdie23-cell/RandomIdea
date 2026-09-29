using System.Collections.Generic;
using System.IO;
using TacticalShooter.Core;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace TacticalShooter.EditorTools
{
    /// <summary>Menu: Tactical Shooter. Scene creation, config sync from shared/, validation.</summary>
    public static class TacticalShooterMenu
    {
        const string ScenePath = "Assets/TacticalShooter/Scenes/TacticalShooter.unity";
        const string DataPath = "Assets/TacticalShooter/Resources/TacticalShooter";

        /// <summary>The repository's shared/ folder (one level above the Unity project).</summary>
        static string SharedDir => Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "shared"));

        [MenuItem("Tactical Shooter/Create Game Scene", priority = 1)]
        static void CreateScene()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("TacticalShooter").AddComponent<GameBootstrap>();
            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            EditorSceneManager.SaveScene(scene, ScenePath);
            var scenes = new List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            scenes.RemoveAll(s => s.path == ScenePath);
            scenes.Insert(0, new EditorBuildSettingsScene(ScenePath, true));
            EditorBuildSettings.scenes = scenes.ToArray();
            Debug.Log($"[TacticalShooter] Created {ScenePath} and made it the first scene in Build Settings. Press Play.");
        }

        [MenuItem("Tactical Shooter/Sync Config From shared", priority = 20)]
        static void SyncConfig()
        {
            if (!Directory.Exists(SharedDir))
            {
                EditorUtility.DisplayDialog("Tactical Shooter", "Could not find " + SharedDir + ".\nThe Unity project must stay next to the shared/ folder, or run shared/tools/sync_shared.py.", "OK");
                return;
            }
            int copied = 0;
            foreach (var pair in new[] { ("config", "Config"), ("maps", "Maps") })
            {
                string dst = Path.Combine(DataPath, pair.Item2);
                Directory.CreateDirectory(dst);
                foreach (string file in Directory.GetFiles(Path.Combine(SharedDir, pair.Item1), "*.json"))
                {
                    string target = Path.Combine(dst, Path.GetFileName(file));
                    string text = File.ReadAllText(file);
                    if (File.Exists(target) && File.ReadAllText(target) == text) continue;
                    File.WriteAllText(target, text);
                    copied++;
                }
            }
            AssetDatabase.Refresh();
            Debug.Log($"[TacticalShooter] Synced config from shared/ ({copied} file(s) updated).");
        }

        [MenuItem("Tactical Shooter/Validate Config", priority = 21)]
        static void Validate()
        {
            var data = GameData.Load(key => Resources.Load<TextAsset>("TacticalShooter/" + key)?.text);
            var errors = data.Validate();
            if (errors.Count == 0) Debug.Log("[TacticalShooter] Config OK: " + data.Weapons.Length + " weapons, " + data.Agents.Length + " agents, " + data.Maps.Count + " map(s).");
            foreach (string e in errors) Debug.LogError("[TacticalShooter] " + e);
        }

        [MenuItem("Tactical Shooter/Open Handbook", priority = 40)]
        static void OpenHandbook()
        {
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "HANDBOOK.md"));
            if (File.Exists(path)) Application.OpenURL("file://" + path);
            else Debug.LogWarning("[TacticalShooter] HANDBOOK.md not found at " + path);
        }
    }
}
