using System;
using System.Collections.Generic;
using TacticalShooter.Core.Json;

namespace TacticalShooter.Core
{
    /// <summary>
    /// Every piece of tuning data, loaded once. The engine layer supplies a function that returns
    /// the text of "Config/&lt;name&gt;" or "Maps/&lt;id&gt;" (without extension), so the same loader
    /// works from Unity Resources, from disk in tests, or from anywhere else.
    /// </summary>
    public sealed class GameData
    {
        public GameConfig Game = new GameConfig();
        public WeaponDef[] Weapons = new WeaponDef[0];
        public EquipmentDef[] Equipment = new EquipmentDef[0];
        public AbilityDef[] Abilities = new AbilityDef[0];
        public AgentDef[] Agents = new AgentDef[0];
        public BotConfig Bots = new BotConfig();
        public InputConfig Input = new InputConfig();
        public AudioConfig Audio = new AudioConfig();
        public UserSettings DefaultSettings = new UserSettings();
        public readonly Dictionary<string, MapDef> Maps = new Dictionary<string, MapDef>();
        public readonly List<string> LoadErrors = new List<string>();

        readonly Dictionary<string, WeaponDef> weaponById = new Dictionary<string, WeaponDef>();
        readonly Dictionary<string, EquipmentDef> equipmentById = new Dictionary<string, EquipmentDef>();
        readonly Dictionary<string, AbilityDef> abilityById = new Dictionary<string, AbilityDef>();
        readonly Dictionary<string, AgentDef> agentById = new Dictionary<string, AgentDef>();
        readonly Dictionary<string, AudioCue> cueById = new Dictionary<string, AudioCue>();

        public static GameData Load(Func<string, string> readText)
        {
            var d = new GameData();
            d.Game = d.Read(readText, "Config/game", d.Game);
            d.Weapons = d.Read(readText, "Config/weapons", new WeaponList()).weapons;
            d.Equipment = d.Read(readText, "Config/equipment", new EquipmentList()).equipment;
            d.Abilities = d.Read(readText, "Config/abilities", new AbilityList()).abilities;
            d.Agents = d.Read(readText, "Config/agents", new AgentList()).agents;
            d.Bots = d.Read(readText, "Config/bots", d.Bots);
            d.Input = d.Read(readText, "Config/input", d.Input);
            d.Audio = d.Read(readText, "Config/audio", d.Audio);
            d.DefaultSettings = d.Read(readText, "Config/settings", d.DefaultSettings);
            foreach (string mapId in d.Game.mapRotation ?? new string[0])
            {
                var map = d.Read<MapDef>(readText, "Maps/" + mapId, null);
                if (map != null) d.Maps[mapId] = map;
            }
            d.Index();
            return d;
        }

        T Read<T>(Func<string, string> readText, string path, T fallback) where T : class
        {
            string text;
            try { text = readText(path); }
            catch (Exception e) { LoadErrors.Add($"{path}: {e.Message}"); return fallback; }
            if (string.IsNullOrEmpty(text)) { LoadErrors.Add($"{path}: file not found or empty"); return fallback; }
            try { return JsonMapper.FromJson<T>(text); }
            catch (Exception e) { LoadErrors.Add($"{path}: {e.Message}"); return fallback; }
        }

        void Index()
        {
            foreach (var w in Weapons) weaponById[w.id] = w;
            foreach (var e in Equipment) equipmentById[e.id] = e;
            foreach (var a in Abilities) abilityById[a.id] = a;
            foreach (var a in Agents) agentById[a.id] = a;
            foreach (var c in Audio.cues) cueById[c.id] = c;
        }

        public WeaponDef Weapon(string id) => id != null && weaponById.TryGetValue(id, out var w) ? w : null;
        public EquipmentDef EquipmentItem(string id) => id != null && equipmentById.TryGetValue(id, out var e) ? e : null;
        public AbilityDef Ability(string id) => id != null && abilityById.TryGetValue(id, out var a) ? a : null;
        public AgentDef Agent(string id) => id != null && agentById.TryGetValue(id, out var a) ? a : (Agents.Length > 0 ? Agents[0] : null);
        public AudioCue Cue(string id) => id != null && cueById.TryGetValue(id, out var c) ? c : null;
        public MapDef Map(string id)
        {
            if (id != null && Maps.TryGetValue(id, out var m)) return m;
            foreach (var kv in Maps) return kv.Value;
            return null;
        }

        public BotDifficulty Difficulty(string id)
        {
            foreach (var d in Bots.difficulties) if (d.id == id) return d;
            foreach (var d in Bots.difficulties) if (d.id == Bots.defaultDifficulty) return d;
            return Bots.difficulties.Length > 0 ? Bots.difficulties[0] : new BotDifficulty();
        }

        public WeaponDef DefaultSecondary => Weapon(Game.loadout.defaultSecondary);
        public WeaponDef DefaultMelee => Weapon(Game.loadout.defaultMelee);

        /// <summary>
        /// Cross-reference checks (a subset of shared/tools/validate_shared.py). Engines log the
        /// result at startup; nothing here throws.
        /// </summary>
        public List<string> Validate()
        {
            var errors = new List<string>(LoadErrors);
            if (Weapons.Length == 0) errors.Add("no weapons loaded");
            if (Agents.Length == 0) errors.Add("no agents loaded");
            if (Maps.Count == 0) errors.Add("no maps loaded");
            foreach (var w in Weapons)
            {
                if (w.fireRate <= 0) errors.Add($"weapon '{w.id}': fireRate must be > 0");
                if (w.Mode != FireMode.Melee && w.magazineSize <= 0) errors.Add($"weapon '{w.id}': guns need magazineSize > 0");
                if (Cue(w.fireSound) == null) errors.Add($"weapon '{w.id}': unknown fireSound '{w.fireSound}'");
            }
            foreach (var a in Abilities)
                if (!Ids.TryParseAbilityType(a.type, out _)) errors.Add($"ability '{a.id}': unknown type '{a.type}'");
            foreach (var ag in Agents)
            {
                if (ag.abilities.Length != 4) errors.Add($"agent '{ag.id}': needs exactly 4 ability slots (C, Q, E, X)");
                foreach (var s in ag.abilities)
                    if (Ability(s.abilityId) == null) errors.Add($"agent '{ag.id}': unknown ability '{s.abilityId}'");
            }
            if (DefaultSecondary == null) errors.Add($"loadout.defaultSecondary '{Game.loadout.defaultSecondary}' is not a weapon");
            if (DefaultMelee == null) errors.Add($"loadout.defaultMelee '{Game.loadout.defaultMelee}' is not a weapon");
            foreach (var b in Input.bindings)
            {
                if (!string.IsNullOrEmpty(b.key) && !KeyNames.IsValid(b.key)) errors.Add($"input '{b.action}': unknown key '{b.key}'");
                if (!string.IsNullOrEmpty(b.altKey) && !KeyNames.IsValid(b.altKey)) errors.Add($"input '{b.action}': unknown key '{b.altKey}'");
            }
            foreach (var kv in Maps)
            {
                var grid = MapGrid.Parse(kv.Value, out var mapErrors);
                foreach (var e in mapErrors) errors.Add($"map '{kv.Key}': {e}");
                if (grid != null)
                    foreach (var e in grid.Validate(Game.match.teamSize)) errors.Add($"map '{kv.Key}': {e}");
            }
            return errors;
        }
    }
}
