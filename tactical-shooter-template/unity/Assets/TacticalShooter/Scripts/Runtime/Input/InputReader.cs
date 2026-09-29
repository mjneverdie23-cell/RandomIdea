using System.Collections.Generic;
using TacticalShooter.Core;
using UnityEngine;
#if TS_INPUT_SYSTEM && ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;
#endif

namespace TacticalShooter
{
    /// <summary>
    /// Reads keys by their engine-neutral names (shared/config/input.json). Works with the new
    /// Input System package when it is installed and enabled, otherwise with the legacy Input
    /// Manager. This is the only file that touches Unity's input APIs.
    /// </summary>
    public static class InputReader
    {
        public const float MouseCountsToDegrees = 0.07f;

        public static bool ActionDown(string action) => IsDown(Game.Keys.Key(action)) || IsDown(Game.Keys.AltKey(action));
        public static bool ActionPressed(string action) => WasPressed(Game.Keys.Key(action)) || WasPressed(Game.Keys.AltKey(action));

#if TS_INPUT_SYSTEM && ENABLE_INPUT_SYSTEM
        static Dictionary<string, Key> keys;

        static Dictionary<string, Key> Keys
        {
            get
            {
                if (keys != null) return keys;
                keys = new Dictionary<string, Key>();
                for (char c = 'A'; c <= 'Z'; c++) keys[c.ToString()] = (Key)System.Enum.Parse(typeof(Key), c.ToString());
                for (int i = 0; i <= 9; i++) keys[i.ToString()] = (Key)System.Enum.Parse(typeof(Key), "Digit" + i);
                for (int i = 1; i <= 12; i++) keys["F" + i] = (Key)System.Enum.Parse(typeof(Key), "F" + i);
                keys["Space"] = Key.Space; keys["Enter"] = Key.Enter; keys["Escape"] = Key.Escape; keys["Tab"] = Key.Tab;
                keys["Backspace"] = Key.Backspace; keys["LeftShift"] = Key.LeftShift; keys["RightShift"] = Key.RightShift;
                keys["LeftCtrl"] = Key.LeftCtrl; keys["RightCtrl"] = Key.RightCtrl; keys["LeftAlt"] = Key.LeftAlt; keys["RightAlt"] = Key.RightAlt;
                keys["Up"] = Key.UpArrow; keys["Down"] = Key.DownArrow; keys["Left"] = Key.LeftArrow; keys["Right"] = Key.RightArrow;
                keys["CapsLock"] = Key.CapsLock; keys["Backquote"] = Key.Backquote; keys["Minus"] = Key.Minus; keys["Equals"] = Key.Equals;
                keys["Comma"] = Key.Comma; keys["Period"] = Key.Period; keys["Slash"] = Key.Slash; keys["Semicolon"] = Key.Semicolon;
                keys["Quote"] = Key.Quote; keys["LeftBracket"] = Key.LeftBracket; keys["RightBracket"] = Key.RightBracket;
                keys["Backslash"] = Key.Backslash; keys["Insert"] = Key.Insert; keys["Delete"] = Key.Delete; keys["Home"] = Key.Home;
                keys["End"] = Key.End; keys["PageUp"] = Key.PageUp; keys["PageDown"] = Key.PageDown;
                return keys;
            }
        }

        static ButtonControl MouseButton(string name)
        {
            var m = Mouse.current;
            if (m == null) return null;
            switch (name)
            {
                case "Mouse1": return m.leftButton;
                case "Mouse2": return m.rightButton;
                case "Mouse3": return m.middleButton;
                case "Mouse4": return m.backButton;
                case "Mouse5": return m.forwardButton;
                default: return null;
            }
        }

        public static bool IsDown(string name)
        {
            if (string.IsNullOrEmpty(name)) return false;
            var mb = MouseButton(name);
            if (mb != null) return mb.isPressed;
            if (name == "WheelUp") return Scroll() > 0f;
            if (name == "WheelDown") return Scroll() < 0f;
            var kb = Keyboard.current;
            return kb != null && Keys.TryGetValue(name, out Key k) && kb[k].isPressed;
        }

        public static bool WasPressed(string name)
        {
            if (string.IsNullOrEmpty(name)) return false;
            var mb = MouseButton(name);
            if (mb != null) return mb.wasPressedThisFrame;
            if (name == "WheelUp") return Scroll() > 0f;
            if (name == "WheelDown") return Scroll() < 0f;
            var kb = Keyboard.current;
            return kb != null && Keys.TryGetValue(name, out Key k) && kb[k].wasPressedThisFrame;
        }

        /// <summary>Mouse movement this frame in device counts (pixels).</summary>
        public static Vector2 MouseDelta() => Mouse.current != null ? Mouse.current.delta.ReadValue() : Vector2.zero;

        public static float Scroll() => Mouse.current != null ? Mouse.current.scroll.ReadValue().y : 0f;
#else
        static Dictionary<string, KeyCode> keys;

        static Dictionary<string, KeyCode> Keys
        {
            get
            {
                if (keys != null) return keys;
                keys = new Dictionary<string, KeyCode>();
                for (char c = 'A'; c <= 'Z'; c++) keys[c.ToString()] = (KeyCode)System.Enum.Parse(typeof(KeyCode), c.ToString());
                for (int i = 0; i <= 9; i++) keys[i.ToString()] = (KeyCode)System.Enum.Parse(typeof(KeyCode), "Alpha" + i);
                for (int i = 1; i <= 12; i++) keys["F" + i] = (KeyCode)System.Enum.Parse(typeof(KeyCode), "F" + i);
                keys["Space"] = KeyCode.Space; keys["Enter"] = KeyCode.Return; keys["Escape"] = KeyCode.Escape; keys["Tab"] = KeyCode.Tab;
                keys["Backspace"] = KeyCode.Backspace; keys["LeftShift"] = KeyCode.LeftShift; keys["RightShift"] = KeyCode.RightShift;
                keys["LeftCtrl"] = KeyCode.LeftControl; keys["RightCtrl"] = KeyCode.RightControl; keys["LeftAlt"] = KeyCode.LeftAlt;
                keys["RightAlt"] = KeyCode.RightAlt; keys["Up"] = KeyCode.UpArrow; keys["Down"] = KeyCode.DownArrow;
                keys["Left"] = KeyCode.LeftArrow; keys["Right"] = KeyCode.RightArrow; keys["CapsLock"] = KeyCode.CapsLock;
                keys["Backquote"] = KeyCode.BackQuote; keys["Minus"] = KeyCode.Minus; keys["Equals"] = KeyCode.Equals;
                keys["Comma"] = KeyCode.Comma; keys["Period"] = KeyCode.Period; keys["Slash"] = KeyCode.Slash;
                keys["Semicolon"] = KeyCode.Semicolon; keys["Quote"] = KeyCode.Quote; keys["LeftBracket"] = KeyCode.LeftBracket;
                keys["RightBracket"] = KeyCode.RightBracket; keys["Backslash"] = KeyCode.Backslash; keys["Insert"] = KeyCode.Insert;
                keys["Delete"] = KeyCode.Delete; keys["Home"] = KeyCode.Home; keys["End"] = KeyCode.End;
                keys["PageUp"] = KeyCode.PageUp; keys["PageDown"] = KeyCode.PageDown;
                keys["Mouse1"] = KeyCode.Mouse0; keys["Mouse2"] = KeyCode.Mouse1; keys["Mouse3"] = KeyCode.Mouse2;
                keys["Mouse4"] = KeyCode.Mouse3; keys["Mouse5"] = KeyCode.Mouse4;
                return keys;
            }
        }

        public static bool IsDown(string name)
        {
            if (string.IsNullOrEmpty(name)) return false;
            if (name == "WheelUp") return Scroll() > 0f;
            if (name == "WheelDown") return Scroll() < 0f;
            return Keys.TryGetValue(name, out KeyCode k) && Input.GetKey(k);
        }

        public static bool WasPressed(string name)
        {
            if (string.IsNullOrEmpty(name)) return false;
            if (name == "WheelUp") return Scroll() > 0f;
            if (name == "WheelDown") return Scroll() < 0f;
            return Keys.TryGetValue(name, out KeyCode k) && Input.GetKeyDown(k);
        }

        /// <summary>
        /// Mouse movement this frame in device counts. The legacy "Mouse X/Y" axes are pixels
        /// scaled by the Input Manager's default sensitivity of 0.1, so this undoes that.
        /// </summary>
        public static Vector2 MouseDelta() => new Vector2(Input.GetAxisRaw("Mouse X"), Input.GetAxisRaw("Mouse Y")) * 10f;

        public static float Scroll() => Input.mouseScrollDelta.y;
#endif

        /// <summary>The first key (engine-neutral name) pressed this frame, or null. Used for rebinding.</summary>
        public static string AnyKeyPressed()
        {
            foreach (string name in KeyNames.All)
                if (WasPressed(name)) return name;
            return null;
        }
    }
}
