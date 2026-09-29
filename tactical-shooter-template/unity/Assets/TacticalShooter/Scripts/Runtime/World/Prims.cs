using System.Collections.Generic;
using TacticalShooter.Core;
using UnityEngine;

namespace TacticalShooter
{
    /// <summary>Unity layers used by the template. Only built-in layers, so no project setup is needed.</summary>
    public static class Layers
    {
        /// <summary>Map geometry, barriers: blocks movement, bullets and sight.</summary>
        public const int World = 0;
        /// <summary>Characters live on the built-in "Ignore Raycast" layer so sight checks skip them.</summary>
        public const int Characters = 2;
        public const int WorldMask = 1 << World;
        public const int ShotMask = (1 << World) | (1 << Characters);
    }

    /// <summary>
    /// Basic-shape factory: cached primitive meshes and one material per colour, created from the
    /// active render pipeline's default material, so it works in Built-in, URP and HDRP.
    /// Replace calls to these helpers with real prefabs when art arrives.
    /// </summary>
    public static class Prims
    {
        static readonly Dictionary<PrimitiveType, Mesh> meshes = new Dictionary<PrimitiveType, Mesh>();
        static readonly Dictionary<Color32, Material> materials = new Dictionary<Color32, Material>();
        static Material baseMaterial;

        public static Mesh Mesh(PrimitiveType type)
        {
            if (meshes.TryGetValue(type, out var m) && m != null) return m;
            var go = GameObject.CreatePrimitive(type);
            m = go.GetComponent<MeshFilter>().sharedMesh;
            if (baseMaterial == null) baseMaterial = go.GetComponent<MeshRenderer>().sharedMaterial;
            Object.DestroyImmediate(go); // immediate, so its collider never takes part in physics
            meshes[type] = m;
            return m;
        }

        public static Material Mat(Color color)
        {
            Color32 key = color;
            if (materials.TryGetValue(key, out var mat) && mat != null) return mat;
            if (baseMaterial == null) Mesh(PrimitiveType.Cube);
            mat = new Material(baseMaterial) { color = color, name = "TS_" + ColorUtility.ToHtmlStringRGBA(color) };
            materials[key] = mat;
            return mat;
        }

        public static Color ToColor(string hex)
        {
            var c = ColorHex.Parse(hex);
            return new Color(c.r, c.g, c.b, c.a);
        }

        /// <summary>A visual-only shape (no collider) parented under parent.</summary>
        public static GameObject Shape(PrimitiveType type, Transform parent, Vector3 localPos, Vector3 localScale, Color color, string name = null)
        {
            var go = new GameObject(name ?? type.ToString());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.transform.localScale = localScale;
            go.AddComponent<MeshFilter>().sharedMesh = Mesh(type);
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = Mat(color);
            return go;
        }

        /// <summary>A solid box with a collider on the World layer.</summary>
        public static GameObject SolidBox(Transform parent, Vector3 center, Vector3 size, Color color, string name = "Box")
        {
            var go = Shape(PrimitiveType.Cube, parent, center, size, color, name);
            go.layer = Layers.World;
            go.AddComponent<BoxCollider>();
            go.isStatic = false;
            return go;
        }

        public static void SetColor(GameObject go, Color color)
        {
            var r = go != null ? go.GetComponent<Renderer>() : null;
            if (r != null) r.sharedMaterial = Mat(color);
        }
    }
}
