using System.Collections.Generic;
using TacticalShooter.Core;
using UnityEngine;

namespace TacticalShooter
{
    /// <summary>
    /// The built level: grid, navigation and the scene objects. Converts between grid cells and
    /// Unity world space (x = east, y = up, z = north, metres; GAME_RULES.md section 11).
    /// </summary>
    public sealed class WorldMap
    {
        public readonly MapDef Def;
        public readonly MapGrid Grid;
        public readonly NavGrid Nav;
        public readonly Transform Root;
        readonly Dictionary<CellType, List<Cell>> cellsByType = new Dictionary<CellType, List<Cell>>();

        public WorldMap(MapDef def, MapGrid grid, Transform root)
        {
            Def = def;
            Grid = grid;
            Nav = new NavGrid(grid);
            Root = root;
        }

        public void Destroy()
        {
            if (Root != null) Object.Destroy(Root.gameObject);
        }

        public Vector3 CellToWorld(Cell c, float y = 0f) => new Vector3(Grid.East(c.x), y, Grid.North(c.y));

        public Cell WorldToCell(Vector3 p) => Grid.CellAt(p.x, p.z);

        public Vector3 Center => Vector3.zero;

        public List<Cell> Cells(CellType t)
        {
            if (!cellsByType.TryGetValue(t, out var list)) cellsByType[t] = list = Grid.CellsOf(t);
            return list;
        }

        public List<Cell> SpawnCells(Side side) => Cells(side == Side.Attack ? CellType.AttackSpawn : CellType.DefenseSpawn);

        public bool InSpawnZone(Side side, Vector3 p)
        {
            var c = WorldToCell(p);
            return Grid.IsSpawnOf(side, c.x, c.y);
        }

        /// <summary>0 = A, 1 = B, -1 = not on a site.</summary>
        public int SiteAt(Vector3 p)
        {
            var c = WorldToCell(p);
            return Grid.SiteIndexAt(c.x, c.y);
        }

        public bool HasSite(int site) => Cells(site == 0 ? CellType.SiteA : CellType.SiteB).Count > 0;

        public Vector3 SiteCenter(int site)
        {
            Grid.Centroid(site == 0 ? CellType.SiteA : CellType.SiteB, out float e, out float n);
            return new Vector3(e, 0f, n);
        }

        /// <summary>Continuous grid coordinates (for NavGrid.ClearLine) of a world position.</summary>
        public Vector2 GridPoint(Vector3 p)
        {
            Grid.GridPoint(p.x, p.z, out float gx, out float gy);
            return new Vector2(gx, gy);
        }
    }

    /// <summary>
    /// Builds the level from the ASCII map with basic shapes: one floor slab, merged boxes for
    /// walls and cover, coloured floor tiles for sites and spawns, and a flag pole per site.
    /// This is the swap point for real level art (see HANDBOOK "Replacing the basic shapes").
    /// </summary>
    public static class MapBuilder
    {
        public static WorldMap Build(MapDef def, VisualSettings v, Transform parent)
        {
            var grid = MapGrid.Parse(def, out var errors);
            foreach (string e in errors) Debug.LogWarning($"[TacticalShooter] map '{def?.id}': {e}");
            var root = new GameObject("World_" + def.id).transform;
            root.SetParent(parent, false);
            var world = new WorldMap(def, grid, root);
            float cs = grid.CellSize;

            // Floor slab (top surface at y = 0).
            Prims.SolidBox(root, new Vector3(0f, -0.25f, 0f), new Vector3(grid.WorldWidth, 0.5f, grid.WorldHeight), Prims.ToColor(v.floorColor), "Floor");

            BuildBoxes(world, CellType.Wall, def.wallHeight, Prims.ToColor(v.wallColor), 0f, true);
            BuildBoxes(world, CellType.HighCover, def.highCoverHeight, Prims.ToColor(v.highCoverColor), 0.1f, true);
            BuildBoxes(world, CellType.LowCover, def.lowCoverHeight, Prims.ToColor(v.lowCoverColor), 0.15f, true);
            BuildTiles(world, CellType.SiteA, Prims.ToColor(v.siteColor));
            BuildTiles(world, CellType.SiteB, Prims.ToColor(v.siteColor));
            BuildTiles(world, CellType.AttackSpawn, Prims.ToColor(v.attackSpawnColor));
            BuildTiles(world, CellType.DefenseSpawn, Prims.ToColor(v.defenseSpawnColor));

            for (int site = 0; site < 2; site++)
            {
                if (!world.HasSite(site)) continue;
                Vector3 c = world.SiteCenter(site);
                var pole = Prims.Shape(PrimitiveType.Cylinder, root, c + new Vector3(0f, 2f, 0f), new Vector3(0.12f, 2f, 0.12f), Color.gray, "SitePole");
                pole.name = "Site" + Ids.SiteName(site) + "_Pole";
                Prims.Shape(PrimitiveType.Cube, root, c + new Vector3(0.45f, 3.6f, 0f), new Vector3(0.8f, 0.5f, 0.05f), Prims.ToColor(v.siteColor), "Site" + Ids.SiteName(site) + "_Flag");
            }
            if (Camera.main != null) Camera.main.backgroundColor = Prims.ToColor(v.skyColor);
            return world;
        }

        static void BuildBoxes(WorldMap world, CellType type, float height, Color color, float inset, bool solid)
        {
            var g = world.Grid;
            float cs = g.CellSize;
            foreach (var b in g.Boxes(type))
            {
                float east = (b.x + b.w / 2f - g.Width / 2f) * cs;
                float north = (g.Height / 2f - b.y - b.h / 2f) * cs;
                var size = new Vector3(b.w * cs - inset * 2f, height, b.h * cs - inset * 2f);
                var center = new Vector3(east, height / 2f, north);
                var go = solid ? Prims.SolidBox(world.Root, center, size, color, type.ToString())
                               : Prims.Shape(PrimitiveType.Cube, world.Root, center, size, color, type.ToString());
                go.name = $"{type}_{b.x}_{b.y}";
            }
        }

        static void BuildTiles(WorldMap world, CellType type, Color color)
        {
            var g = world.Grid;
            float cs = g.CellSize;
            foreach (var b in g.Boxes(type))
            {
                float east = (b.x + b.w / 2f - g.Width / 2f) * cs;
                float north = (g.Height / 2f - b.y - b.h / 2f) * cs;
                var tile = Prims.Shape(PrimitiveType.Cube, world.Root, new Vector3(east, 0.01f, north), new Vector3(b.w * cs, 0.02f, b.h * cs), color, type + "_Tile");
                tile.name = $"{type}_Tile_{b.x}_{b.y}";
            }
        }
    }
}
