using System;
using System.Collections.Generic;

namespace TacticalShooter.Core
{
    public readonly struct Cell : IEquatable<Cell>
    {
        public readonly int x, y;
        public Cell(int x, int y) { this.x = x; this.y = y; }
        public bool Equals(Cell o) => x == o.x && y == o.y;
        public override bool Equals(object obj) => obj is Cell c && Equals(c);
        public override int GetHashCode() => (x * 73856093) ^ (y * 19349663);
        public override string ToString() => $"({x},{y})";
    }

    /// <summary>A merged rectangle of same-type cells: columns [x, x+w), rows [y, y+h).</summary>
    public struct GridBox
    {
        public int x, y, w, h;
        public CellType type;
    }

    /// <summary>
    /// The ASCII map, parsed (GAME_RULES.md section 11). Both geometry and navigation are
    /// generated from it, so the level can never contain a pocket bots cannot reach.
    /// "Plane" coordinates are metres: east (x) and north (y); each engine maps them to 3D.
    /// </summary>
    public sealed class MapGrid
    {
        public readonly MapDef Def;
        public readonly int Width, Height;
        public readonly float CellSize;
        readonly CellType[] cells;

        MapGrid(MapDef def, int w, int h)
        {
            Def = def;
            Width = w;
            Height = h;
            CellSize = def.cellSize;
            cells = new CellType[w * h];
        }

        public static MapGrid Parse(MapDef def, out List<string> errors)
        {
            errors = new List<string>();
            if (def == null || def.rows == null || def.rows.Length == 0)
            {
                errors.Add("map has no rows");
                return null;
            }
            int w = 0;
            foreach (string r in def.rows) w = Math.Max(w, r.Length);
            var g = new MapGrid(def, w, def.rows.Length);
            for (int y = 0; y < g.Height; y++)
            {
                string row = def.rows[y];
                if (row.Length != w) errors.Add($"row {y} has length {row.Length}, expected {w}");
                for (int x = 0; x < w; x++)
                {
                    char ch = x < row.Length ? row[x] : '#';
                    if (!TryParseSymbol(ch, out CellType t))
                    {
                        errors.Add($"unknown symbol '{ch}' at ({x},{y})");
                        t = CellType.Wall;
                    }
                    g.cells[y * w + x] = t;
                }
            }
            if (def.cellSize <= 0f) errors.Add("cellSize must be > 0");
            return g;
        }

        public static bool TryParseSymbol(char ch, out CellType t)
        {
            switch (ch)
            {
                case '#': t = CellType.Wall; return true;
                case '.': t = CellType.Floor; return true;
                case 'c': t = CellType.LowCover; return true;
                case 'h': t = CellType.HighCover; return true;
                case 'A': t = CellType.SiteA; return true;
                case 'B': t = CellType.SiteB; return true;
                case 'T': t = CellType.AttackSpawn; return true;
                case 'D': t = CellType.DefenseSpawn; return true;
                default: t = CellType.Wall; return false;
            }
        }

        public bool InBounds(int x, int y) => x >= 0 && y >= 0 && x < Width && y < Height;

        public CellType Get(int x, int y) => InBounds(x, y) ? cells[y * Width + x] : CellType.Wall;
        public CellType Get(Cell c) => Get(c.x, c.y);

        /// <summary>Walkable for navigation: floor, sites and spawns. Cover and walls are not.</summary>
        public bool IsWalkable(int x, int y)
        {
            var t = Get(x, y);
            return t != CellType.Wall && t != CellType.LowCover && t != CellType.HighCover;
        }

        public static bool IsSite(CellType t) => t == CellType.SiteA || t == CellType.SiteB;

        /// <summary>0 for site A, 1 for site B, -1 otherwise.</summary>
        public int SiteIndexAt(int x, int y)
        {
            var t = Get(x, y);
            return t == CellType.SiteA ? 0 : t == CellType.SiteB ? 1 : -1;
        }

        public bool IsSpawnOf(Side side, int x, int y) =>
            Get(x, y) == (side == Side.Attack ? CellType.AttackSpawn : CellType.DefenseSpawn);

        public float East(int x) => (x + 0.5f - Width / 2f) * CellSize;
        public float North(int y) => (Height / 2f - y - 0.5f) * CellSize;

        public void CellCenter(int x, int y, out float east, out float north)
        {
            east = East(x);
            north = North(y);
        }

        public Cell CellAt(float east, float north) =>
            new Cell((int)Math.Floor(east / CellSize + Width / 2f), (int)Math.Floor(Height / 2f - north / CellSize));

        /// <summary>Continuous grid coordinates (cell units, cell centres at +0.5) from plane metres.</summary>
        public void GridPoint(float east, float north, out float gx, out float gy)
        {
            gx = east / CellSize + Width / 2f;
            gy = Height / 2f - north / CellSize;
        }

        public float WorldWidth => Width * CellSize;
        public float WorldHeight => Height * CellSize;

        public List<Cell> CellsOf(CellType t)
        {
            var list = new List<Cell>();
            for (int y = 0; y < Height; y++)
                for (int x = 0; x < Width; x++)
                    if (cells[y * Width + x] == t) list.Add(new Cell(x, y));
            return list;
        }

        public int Count(CellType t)
        {
            int n = 0;
            foreach (var c in cells) if (c == t) n++;
            return n;
        }

        /// <summary>Greedy merge of same-type cells into rectangles: extend right first, then down.</summary>
        public List<GridBox> Boxes(CellType t)
        {
            var used = new bool[cells.Length];
            var list = new List<GridBox>();
            for (int y = 0; y < Height; y++)
            {
                for (int x = 0; x < Width; x++)
                {
                    int i = y * Width + x;
                    if (used[i] || cells[i] != t) continue;
                    int w = 1;
                    while (x + w < Width && !used[i + w] && cells[i + w] == t) w++;
                    int h = 1;
                    while (y + h < Height)
                    {
                        bool rowOk = true;
                        for (int xx = x; xx < x + w; xx++)
                        {
                            int j = (y + h) * Width + xx;
                            if (used[j] || cells[j] != t) { rowOk = false; break; }
                        }
                        if (!rowOk) break;
                        h++;
                    }
                    for (int yy = y; yy < y + h; yy++)
                        for (int xx = x; xx < x + w; xx++)
                            used[yy * Width + xx] = true;
                    list.Add(new GridBox { x = x, y = y, w = w, h = h, type = t });
                }
            }
            return list;
        }

        /// <summary>Centre of all cells of a type in plane metres (used for site markers and bot goals).</summary>
        public bool Centroid(CellType t, out float east, out float north)
        {
            double sx = 0, sy = 0;
            int n = 0;
            for (int y = 0; y < Height; y++)
                for (int x = 0; x < Width; x++)
                    if (cells[y * Width + x] == t) { sx += East(x); sy += North(y); n++; }
            east = n > 0 ? (float)(sx / n) : 0f;
            north = n > 0 ? (float)(sy / n) : 0f;
            return n > 0;
        }

        public List<string> Validate(int teamSize)
        {
            var errors = new List<string>();
            for (int y = 0; y < Height; y++)
                for (int x = 0; x < Width; x++)
                    if ((x == 0 || y == 0 || x == Width - 1 || y == Height - 1) && Get(x, y) != CellType.Wall)
                    {
                        errors.Add($"border cell ({x},{y}) must be a wall");
                        return errors;
                    }
            if (Count(CellType.AttackSpawn) < teamSize) errors.Add($"needs at least {teamSize} attacker spawn (T) cells");
            if (Count(CellType.DefenseSpawn) < teamSize) errors.Add($"needs at least {teamSize} defender spawn (D) cells");
            if (Count(CellType.SiteA) + Count(CellType.SiteB) == 0) errors.Add("has no bomb site");

            // Every walkable cell must be reachable from every other (4-connectivity).
            int total = 0;
            Cell start = default;
            bool found = false;
            for (int y = 0; y < Height; y++)
                for (int x = 0; x < Width; x++)
                    if (IsWalkable(x, y)) { total++; if (!found) { start = new Cell(x, y); found = true; } }
            if (!found) { errors.Add("has no walkable cells"); return errors; }
            var seen = new bool[cells.Length];
            var stack = new Stack<Cell>();
            stack.Push(start);
            seen[start.y * Width + start.x] = true;
            int reached = 0;
            while (stack.Count > 0)
            {
                var c = stack.Pop();
                reached++;
                Visit(c.x + 1, c.y); Visit(c.x - 1, c.y); Visit(c.x, c.y + 1); Visit(c.x, c.y - 1);
            }
            if (reached != total) errors.Add($"{total - reached} walkable cells cannot be reached from the rest");
            return errors;

            void Visit(int x, int y)
            {
                if (!IsWalkable(x, y) || seen[y * Width + x]) return;
                seen[y * Width + x] = true;
                stack.Push(new Cell(x, y));
            }
        }
    }
}
