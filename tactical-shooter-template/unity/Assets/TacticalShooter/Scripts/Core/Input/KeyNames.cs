using System.Collections.Generic;

namespace TacticalShooter.Core
{
    /// <summary>
    /// Engine-neutral key names used by shared/config/input.json and saved key overrides.
    /// Each engine maps these to its own key type (Unity: KeyCode / InputSystem Key,
    /// Unreal: FKey) in one table.
    /// </summary>
    public static class KeyNames
    {
        public static readonly string[] All = BuildAll();

        public static readonly string[] Actions =
        {
            "MoveForward", "MoveBack", "MoveLeft", "MoveRight", "Jump", "Crouch", "Walk", "Fire", "Aim", "Reload",
            "Interact", "Drop", "Primary", "Secondary", "Melee", "Ability1", "Ability2", "Ability3", "Ultimate",
            "BuyMenu", "Scoreboard", "Pause",
        };

        static HashSet<string> set;

        static string[] BuildAll()
        {
            var list = new List<string>();
            for (char c = 'A'; c <= 'Z'; c++) list.Add(c.ToString());
            for (char c = '0'; c <= '9'; c++) list.Add(c.ToString());
            for (int i = 1; i <= 12; i++) list.Add("F" + i);
            list.AddRange(new[]
            {
                "Space", "Enter", "Escape", "Tab", "Backspace", "LeftShift", "RightShift", "LeftCtrl", "RightCtrl",
                "LeftAlt", "RightAlt", "Up", "Down", "Left", "Right", "Mouse1", "Mouse2", "Mouse3", "Mouse4", "Mouse5",
                "WheelUp", "WheelDown", "CapsLock", "Backquote", "Minus", "Equals", "Comma", "Period", "Slash",
                "Semicolon", "Quote", "LeftBracket", "RightBracket", "Backslash", "Insert", "Delete", "Home", "End",
                "PageUp", "PageDown",
            });
            return list.ToArray();
        }

        public static bool IsValid(string name)
        {
            if (set == null) set = new HashSet<string>(All);
            return name != null && set.Contains(name);
        }

        /// <summary>Human-readable label for the settings screen.</summary>
        public static string Label(string name)
        {
            switch (name)
            {
                case "Mouse1": return "LMB";
                case "Mouse2": return "RMB";
                case "Mouse3": return "MMB";
                case "LeftCtrl": return "L-Ctrl";
                case "RightCtrl": return "R-Ctrl";
                case "LeftShift": return "L-Shift";
                case "RightShift": return "R-Shift";
                case "LeftAlt": return "L-Alt";
                case "RightAlt": return "R-Alt";
                case "Escape": return "Esc";
                case null: case "": return "-";
                default: return name;
            }
        }

        public static string ActionLabel(string action)
        {
            switch (action)
            {
                case "MoveForward": return "Move forward";
                case "MoveBack": return "Move back";
                case "MoveLeft": return "Move left";
                case "MoveRight": return "Move right";
                case "Walk": return "Walk (quiet, accurate)";
                case "Fire": return "Fire";
                case "Aim": return "Aim / scope";
                case "Interact": return "Plant / defuse / pick up";
                case "Drop": return "Drop weapon / bomb";
                case "Primary": return "Primary weapon";
                case "Secondary": return "Sidearm";
                case "Melee": return "Knife";
                case "Ability1": return "Ability 1 (C)";
                case "Ability2": return "Ability 2 (Q)";
                case "Ability3": return "Signature (E)";
                case "Ultimate": return "Ultimate (X)";
                case "BuyMenu": return "Buy menu";
                case "Scoreboard": return "Scoreboard (hold)";
                case "Pause": return "Pause menu";
                default: return action;
            }
        }
    }

    /// <summary>
    /// Action -> key lookup with the player's overrides applied on top of input.json. An override
    /// entry carries both keys; an empty altKey means "no alternative key".
    /// </summary>
    public sealed class KeyMap
    {
        readonly Dictionary<string, KeyBinding> bindings = new Dictionary<string, KeyBinding>();

        public KeyMap(InputConfig defaults, KeyBinding[] overrides)
        {
            foreach (var b in defaults.bindings)
                bindings[b.action] = new KeyBinding { action = b.action, key = b.key, altKey = b.altKey };
            if (overrides == null) return;
            foreach (var o in overrides)
            {
                if (o == null || !bindings.TryGetValue(o.action, out var b)) continue;
                if (!string.IsNullOrEmpty(o.key)) b.key = o.key;
                if (o.altKey != null) b.altKey = o.altKey;
            }
        }

        public string Key(string action) => bindings.TryGetValue(action, out var b) ? b.key : "";
        public string AltKey(string action) => bindings.TryGetValue(action, out var b) ? b.altKey : "";

        public IEnumerable<KeyBinding> All => bindings.Values;
    }
}
