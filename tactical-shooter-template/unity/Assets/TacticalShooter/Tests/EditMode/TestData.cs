using System;
using System.IO;
using System.Runtime.CompilerServices;
using TacticalShooter.Core;

namespace TacticalShooter.Tests
{
    /// <summary>
    /// Locates the repository's shared/ folder from this source file, so the same tests run in
    /// Unity's Test Runner and under `dotnet test` (tools/dotnet-core-tests) without changes.
    /// </summary>
    public static class TestData
    {
        static string sharedDir;
        static GameData data;

        public static string SharedDir
        {
            get
            {
                if (sharedDir != null) return sharedDir;
                foreach (string start in new[] { SourceDir(), Environment.CurrentDirectory })
                {
                    var dir = new DirectoryInfo(Path.GetFullPath(start));
                    while (dir != null)
                    {
                        string candidate = Path.Combine(dir.FullName, "shared");
                        if (File.Exists(Path.Combine(candidate, "tests", "rules_vectors.json"))) return sharedDir = candidate;
                        dir = dir.Parent;
                    }
                }
                throw new DirectoryNotFoundException("Could not find shared/tests/rules_vectors.json above " + SourceDir());
            }
        }

        /// <summary>The Unity project's copy of the config (what the game actually loads).</summary>
        public static string UnityDataDir =>
            Path.Combine(Path.GetDirectoryName(SharedDir), "unity", "Assets", "TacticalShooter", "Resources", "TacticalShooter");

        static string SourceDir([CallerFilePath] string path = "") => Path.GetDirectoryName(path) ?? ".";

        /// <summary>Config loaded from shared/ (the source of truth).</summary>
        public static GameData Data => data ?? (data = GameData.Load(ReadShared));

        public static string ReadShared(string key)
        {
            // "Config/game" -> shared/config/game.json, "Maps/outpost" -> shared/maps/outpost.json
            int slash = key.IndexOf('/');
            string folder = key.Substring(0, slash).ToLowerInvariant();
            string path = Path.Combine(SharedDir, folder, key.Substring(slash + 1) + ".json");
            return File.Exists(path) ? File.ReadAllText(path) : null;
        }

        public static string VectorsJson => File.ReadAllText(Path.Combine(SharedDir, "tests", "rules_vectors.json"));
    }
}
