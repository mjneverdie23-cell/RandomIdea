using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace TacticalShooter.UI
{
    /// <summary>
    /// Builds uGUI widgets from code, so the template needs no prefabs or scenes. Every screen
    /// uses these helpers; restyle the whole UI by changing the colours and fonts here.
    /// </summary>
    public static class UIFactory
    {
        public static Font Font;

        public static readonly Color PanelColor = new Color(0.05f, 0.07f, 0.09f, 0.9f);
        public static readonly Color PanelLight = new Color(0.11f, 0.14f, 0.17f, 0.95f);
        public static readonly Color Accent = new Color(1f, 0.28f, 0.34f, 1f);
        public static readonly Color TextColor = new Color(0.94f, 0.95f, 0.97f, 1f);
        public static readonly Color TextDim = new Color(0.62f, 0.67f, 0.72f, 1f);
        public static readonly Color ButtonColor = new Color(0.2f, 0.24f, 0.29f, 1f);
        public static readonly Color Good = new Color(0.35f, 0.85f, 0.55f, 1f);
        public static readonly Color Warn = new Color(1f, 0.8f, 0.3f, 1f);

        public static void Init()
        {
            if (Font != null) return;
            Font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (Font == null) Font = Resources.GetBuiltinResource<Font>("Arial.ttf");
        }

        public static RectTransform Rect(string name, Transform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            return (RectTransform)go.transform;
        }

        public static RectTransform Stretch(RectTransform rt, float left = 0f, float bottom = 0f, float right = 0f, float top = 0f)
        {
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.offsetMin = new Vector2(left, bottom);
            rt.offsetMax = new Vector2(-right, -top);
            return rt;
        }

        /// <summary>Anchors to one point of the parent (0..1), positioned relative to it.</summary>
        public static RectTransform Place(RectTransform rt, Vector2 anchor, Vector2 position, Vector2 size, Vector2? pivot = null)
        {
            rt.anchorMin = rt.anchorMax = anchor;
            rt.pivot = pivot ?? anchor;
            rt.anchoredPosition = position;
            rt.sizeDelta = size;
            return rt;
        }

        public static Image Image(Transform parent, string name, Color color, bool raycast = false)
        {
            var rt = Rect(name, parent);
            var img = rt.gameObject.AddComponent<Image>();
            img.color = color;
            img.raycastTarget = raycast;
            return img;
        }

        public static Text Label(Transform parent, string text, int size, TextAnchor align = TextAnchor.MiddleLeft, Color? color = null, FontStyle style = FontStyle.Normal)
        {
            var rt = Rect("Text", parent);
            var t = rt.gameObject.AddComponent<Text>();
            t.font = Font;
            t.text = text;
            t.fontSize = size;
            t.alignment = align;
            t.color = color ?? TextColor;
            t.fontStyle = style;
            t.horizontalOverflow = HorizontalWrapMode.Wrap;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            t.raycastTarget = false;
            return t;
        }

        public static Button Button(Transform parent, string label, Action onClick, int fontSize = 22, Color? color = null)
        {
            var img = Image(parent, "Button", color ?? ButtonColor, true);
            var b = img.gameObject.AddComponent<Button>();
            b.targetGraphic = img;
            var colors = b.colors;
            colors.normalColor = new Color(0.9f, 0.9f, 0.9f, 1f);
            colors.highlightedColor = Color.white;
            colors.pressedColor = new Color(0.7f, 0.7f, 0.7f, 1f);
            colors.selectedColor = new Color(0.9f, 0.9f, 0.9f, 1f);
            colors.disabledColor = new Color(0.45f, 0.45f, 0.45f, 0.6f);
            colors.fadeDuration = 0.05f;
            b.colors = colors;
            var t = Label(img.transform, label, fontSize, TextAnchor.MiddleCenter);
            Stretch(t.rectTransform, 8f, 2f, 8f, 2f);
            if (onClick != null)
                b.onClick.AddListener(() =>
                {
                    Game.Audio?.Play2D("ui_click");
                    onClick();
                });
            return b;
        }

        public static void SetLabel(Button b, string text)
        {
            var t = b.GetComponentInChildren<Text>();
            if (t != null) t.text = text;
        }

        public static void SetColor(Button b, Color c) => ((Image)b.targetGraphic).color = c;

        public static Slider Slider(Transform parent, float min, float max, float value, bool whole, Action<float> onChange)
        {
            var root = Rect("Slider", parent);
            var slider = root.gameObject.AddComponent<Slider>();
            var bg = Image(root, "Background", new Color(0.16f, 0.19f, 0.22f, 1f), true);
            Stretch(bg.rectTransform, 0f, 12f, 0f, 12f);
            var fillArea = Rect("Fill Area", root);
            Stretch(fillArea, 0f, 12f, 12f, 12f);
            var fill = Image(fillArea, "Fill", Accent);
            fill.rectTransform.sizeDelta = Vector2.zero;
            var handleArea = Rect("Handle Area", root);
            Stretch(handleArea, 8f, 0f, 8f, 0f);
            var handle = Image(handleArea, "Handle", Color.white, true);
            handle.rectTransform.sizeDelta = new Vector2(16f, 0f);
            slider.fillRect = fill.rectTransform;
            slider.handleRect = handle.rectTransform;
            slider.targetGraphic = handle;
            slider.direction = UnityEngine.UI.Slider.Direction.LeftToRight;
            slider.minValue = min;
            slider.maxValue = max;
            slider.wholeNumbers = whole;
            slider.value = value;
            if (onChange != null) slider.onValueChanged.AddListener(v => onChange(v));
            return slider;
        }

        public static Toggle Toggle(Transform parent, bool value, Action<bool> onChange)
        {
            var root = Rect("Toggle", parent);
            var toggle = root.gameObject.AddComponent<Toggle>();
            var bg = Image(root, "Box", new Color(0.16f, 0.19f, 0.22f, 1f), true);
            Place(bg.rectTransform, new Vector2(0f, 0.5f), Vector2.zero, new Vector2(34f, 34f));
            var check = Image(bg.transform, "Check", Accent);
            Stretch(check.rectTransform, 6f, 6f, 6f, 6f);
            toggle.targetGraphic = bg;
            toggle.graphic = check;
            toggle.isOn = value;
            if (onChange != null) toggle.onValueChanged.AddListener(v => onChange(v));
            return toggle;
        }

        public static VerticalLayoutGroup VBox(Component target, float spacing, int padding = 0, TextAnchor align = TextAnchor.UpperLeft)
        {
            var v = target.gameObject.AddComponent<VerticalLayoutGroup>();
            v.spacing = spacing;
            v.padding = new RectOffset(padding, padding, padding, padding);
            v.childAlignment = align;
            v.childControlWidth = true;
            v.childControlHeight = true;
            v.childForceExpandWidth = true;
            v.childForceExpandHeight = false;
            return v;
        }

        public static HorizontalLayoutGroup HBox(Component target, float spacing, int padding = 0, TextAnchor align = TextAnchor.MiddleLeft)
        {
            var h = target.gameObject.AddComponent<HorizontalLayoutGroup>();
            h.spacing = spacing;
            h.padding = new RectOffset(padding, padding, padding, padding);
            h.childAlignment = align;
            h.childControlWidth = true;
            h.childControlHeight = true;
            h.childForceExpandWidth = false;
            h.childForceExpandHeight = true;
            return h;
        }

        public static LayoutElement Size(Component c, float width = -1f, float height = -1f, float flexWidth = -1f, float flexHeight = -1f)
        {
            var le = c.GetComponent<LayoutElement>();
            if (le == null) le = c.gameObject.AddComponent<LayoutElement>();
            if (width >= 0f) { le.preferredWidth = width; le.minWidth = width; }
            if (height >= 0f) { le.preferredHeight = height; le.minHeight = height; }
            if (flexWidth >= 0f) le.flexibleWidth = flexWidth;
            if (flexHeight >= 0f) le.flexibleHeight = flexHeight;
            return le;
        }

        /// <summary>A horizontal row of fixed height inside a vertical layout.</summary>
        public static RectTransform Row(Transform parent, float height, float spacing = 10f)
        {
            var rt = Rect("Row", parent);
            HBox(rt, spacing);
            Size(rt, -1f, height);
            return rt;
        }

        /// <summary>A labelled row: fixed-width caption on the left, content on the right.</summary>
        public static RectTransform LabeledRow(Transform parent, string caption, float height = 46f, float captionWidth = 340f)
        {
            var row = Row(parent, height, 16f);
            var t = Label(row, caption, 22, TextAnchor.MiddleLeft, TextDim);
            Size(t, captionWidth, height);
            return row;
        }

        public static void Clear(Transform t)
        {
            for (int i = t.childCount - 1; i >= 0; i--) UnityEngine.Object.Destroy(t.GetChild(i).gameObject);
        }

        /// <summary>A group of mutually exclusive option buttons. Returns the buttons.</summary>
        public static List<Button> Options(Transform parent, string[] labels, int selected, Action<int> onSelect, float width = 180f, int fontSize = 20)
        {
            var buttons = new List<Button>();
            for (int i = 0; i < labels.Length; i++)
            {
                int index = i;
                var b = Button(parent, labels[i], () =>
                {
                    for (int k = 0; k < buttons.Count; k++) SetColor(buttons[k], k == index ? Accent : ButtonColor);
                    onSelect(index);
                }, fontSize);
                Size(b, width, -1f);
                SetColor(b, i == selected ? Accent : ButtonColor);
                buttons.Add(b);
            }
            return buttons;
        }
    }

    /// <summary>Right-click support for buttons (the buy menu sells on right click).</summary>
    public sealed class ClickRelay : MonoBehaviour, IPointerClickHandler
    {
        public Action OnRightClick;

        public void OnPointerClick(PointerEventData e)
        {
            if (e.button == PointerEventData.InputButton.Right) OnRightClick?.Invoke();
        }
    }

    /// <summary>Base class for code-built screens.</summary>
    public abstract class UIScreen
    {
        public RectTransform Root { get; protected set; }
        public bool Visible => Root != null && Root.gameObject.activeSelf;

        public virtual void Show()
        {
            Root.gameObject.SetActive(true);
            Refresh();
        }

        public virtual void Hide() => Root.gameObject.SetActive(false);

        /// <summary>Rebuild dynamic content when shown.</summary>
        public virtual void Refresh() { }

        /// <summary>Per-frame update while visible.</summary>
        public virtual void Tick() { }

        protected RectTransform FullScreen(RectTransform canvas, string name, Color? dim = null)
        {
            var rt = UIFactory.Rect(name, canvas);
            UIFactory.Stretch(rt);
            if (dim.HasValue)
            {
                var img = rt.gameObject.AddComponent<Image>();
                img.color = dim.Value;
                img.raycastTarget = true;
            }
            rt.gameObject.SetActive(false);
            return rt;
        }
    }
}
