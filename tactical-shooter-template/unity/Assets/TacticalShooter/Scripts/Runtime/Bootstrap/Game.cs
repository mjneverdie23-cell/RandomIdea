using TacticalShooter.Core;
using TacticalShooter.UI;

namespace TacticalShooter
{
    /// <summary>
    /// Global access points, filled in by GameBootstrap. Everything here lives for the whole
    /// session; the match itself is created and torn down by MatchController.
    /// </summary>
    public static class Game
    {
        public static GameBootstrap Root;
        public static GameData Data;
        public static UserSettings Settings;
        public static KeyMap Keys;
        public static GameEvents Events;
        public static AudioManager Audio;
        public static UIManager UI;
        public static MatchController Match;
        public static WorldMap World;
        public static CameraRig Camera;

        /// <summary>True while the pause menu (or settings opened from it) is up.</summary>
        public static bool Paused;

        public static bool InMatch => Match != null && Match.Running;

        public static void RebuildKeyMap() => Keys = new KeyMap(Data.Input, Settings.keyOverrides);
    }

    /// <summary>Choices made on the match setup screen.</summary>
    public sealed class MatchOptions
    {
        public string mapId = "outpost";
        public string agentId = "vanguard";
        public Side playerSide = Side.Attack;
        public string difficulty = "normal";
        public int teamSize = 5;
        public int roundsToWin = 13;
        public string playerName = "You";
        public uint seed;

        public static MatchOptions FromSettings(UserSettings s) => new MatchOptions
        {
            mapId = s.mapId,
            agentId = s.agentId,
            playerSide = Ids.ParseSide(s.playerSide),
            difficulty = s.botDifficulty,
            teamSize = s.teamSize,
            roundsToWin = s.roundsToWin,
            playerName = string.IsNullOrEmpty(s.playerName) ? "You" : s.playerName,
        };
    }
}
