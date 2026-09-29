using System;
using System.Collections.Generic;

namespace TacticalShooter.Core
{
    /// <summary>
    /// A* over the map grid (GAME_RULES.md section 12): 8 neighbours, no corner cutting,
    /// octile heuristic, then string-pulling. Temporary obstacles (barrier walls) can block
    /// cells for a while. Engine-agnostic; bots in both engines use this instead of a baked navmesh.
    /// </summary>
    public sealed class NavGrid
    {
        static readonly float Sqrt2 = (float)Math.Sqrt(2.0);
        const float ClearanceCells = 0.25f;

        readonly MapGrid map;
        readonly int w, h;
        readonly int[] dynamicBlocks;
        readonly float[] gScore;
        readonly int[] parent;
        readonly bool[] closed;
        readonly List<int> touched = new List<int>();
        readonly MinHeap open = new MinHeap();

        public float LastPathCost { get; private set; }

        public NavGrid(MapGrid map)
        {
            this.map = map;
            w = map.Width;
            h = map.Height;
            dynamicBlocks = new int[w * h];
            gScore = new float[w * h];
            parent = new int[w * h];
            closed = new bool[w * h];
            for (int i = 0; i < gScore.Length; i++) { gScore[i] = float.PositiveInfinity; parent[i] = -1; }
        }

        public MapGrid Map => map;

        public bool IsWalkable(int x, int y) =>
            x >= 0 && y >= 0 && x < w && y < h && map.IsWalkable(x, y) && dynamicBlocks[y * w + x] == 0;

        public bool IsWalkable(Cell c) => IsWalkable(c.x, c.y);

        /// <summary>Block (delta = +1) or release (delta = -1) a cell. Calls nest.</summary>
        public void AddDynamicBlock(int x, int y, int delta)
        {
            if (x < 0 || y < 0 || x >= w || y >= h) return;
            dynamicBlocks[y * w + x] = Math.Max(0, dynamicBlocks[y * w + x] + delta);
        }

        public void ClearDynamicBlocks() => Array.Clear(dynamicBlocks, 0, dynamicBlocks.Length);

        public Cell NearestWalkable(Cell c, int maxRadius = 8)
        {
            if (IsWalkable(c)) return c;
            for (int r = 1; r <= maxRadius; r++)
                for (int dy = -r; dy <= r; dy++)
                    for (int dx = -r; dx <= r; dx++)
                    {
                        if (Math.Abs(dx) != r && Math.Abs(dy) != r) continue;
                        if (IsWalkable(c.x + dx, c.y + dy)) return new Cell(c.x + dx, c.y + dy);
                    }
            return c;
        }

        /// <summary>Finds a path of cells from start to goal (inclusive). Returns false if none exists.</summary>
        public bool FindPath(Cell start, Cell goal, List<Cell> path)
        {
            path.Clear();
            LastPathCost = -1f;
            if (!IsWalkable(start) || !IsWalkable(goal)) return false;
            ResetSearch();
            int s = start.y * w + start.x, g = goal.y * w + goal.x;
            Touch(s);
            gScore[s] = 0f;
            open.Push(Heuristic(start.x, start.y, goal.x, goal.y), s);
            while (open.Count > 0)
            {
                int cur = open.Pop();
                if (closed[cur]) continue;
                if (cur == g)
                {
                    LastPathCost = gScore[cur];
                    for (int c = cur; c != -1; c = parent[c]) path.Add(new Cell(c % w, c / w));
                    path.Reverse();
                    return true;
                }
                closed[cur] = true;
                int cx = cur % w, cy = cur / w;
                for (int dy = -1; dy <= 1; dy++)
                {
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        if (dx == 0 && dy == 0) continue;
                        int nx = cx + dx, ny = cy + dy;
                        if (!IsWalkable(nx, ny)) continue;
                        bool diagonal = dx != 0 && dy != 0;
                        if (diagonal && (!IsWalkable(cx + dx, cy) || !IsWalkable(cx, cy + dy))) continue;
                        int n = ny * w + nx;
                        if (closed[n]) continue;
                        float cost = gScore[cur] + (diagonal ? Sqrt2 : 1f);
                        Touch(n);
                        if (cost < gScore[n] - 1e-6f)
                        {
                            gScore[n] = cost;
                            parent[n] = cur;
                            open.Push(cost + Heuristic(nx, ny, goal.x, goal.y), n);
                        }
                    }
                }
            }
            return false;
        }

        /// <summary>True if a straight line between two cell centres stays on walkable cells with some clearance.</summary>
        public bool ClearLine(Cell a, Cell b) => ClearLine(a.x + 0.5f, a.y + 0.5f, b.x + 0.5f, b.y + 0.5f);

        /// <summary>Same, for continuous grid coordinates (cell units).</summary>
        public bool ClearLine(float x0, float y0, float x1, float y1)
        {
            float dx = x1 - x0, dy = y1 - y0;
            float len = (float)Math.Sqrt(dx * dx + dy * dy);
            if (len < 1e-4f) return IsWalkable((int)Math.Floor(x0), (int)Math.Floor(y0));
            float px = -dy / len * ClearanceCells, py = dx / len * ClearanceCells;
            int steps = (int)Math.Ceiling(len / 0.25f);
            for (int i = 0; i <= steps; i++)
            {
                float t = (float)i / steps;
                float x = x0 + dx * t, y = y0 + dy * t;
                if (!IsWalkable((int)Math.Floor(x), (int)Math.Floor(y))) return false;
                if (!IsWalkable((int)Math.Floor(x + px), (int)Math.Floor(y + py))) return false;
                if (!IsWalkable((int)Math.Floor(x - px), (int)Math.Floor(y - py))) return false;
            }
            return true;
        }

        /// <summary>String-pulling: keeps only the corners needed to follow the path.</summary>
        public List<Cell> Smooth(List<Cell> path)
        {
            var result = new List<Cell>();
            if (path.Count == 0) return result;
            int i = 0;
            result.Add(path[0]);
            while (i < path.Count - 1)
            {
                int next = i + 1;
                for (int j = path.Count - 1; j > i + 1; j--)
                {
                    if (ClearLine(path[i], path[j])) { next = j; break; }
                }
                result.Add(path[next]);
                i = next;
            }
            return result;
        }

        static float Heuristic(int x, int y, int gx, int gy)
        {
            int dx = Math.Abs(x - gx), dy = Math.Abs(y - gy);
            return (dx + dy) + (Sqrt2 - 2f) * Math.Min(dx, dy);
        }

        void Touch(int i)
        {
            if (gScore[i] == float.PositiveInfinity && parent[i] == -1 && !closed[i]) touched.Add(i);
        }

        void ResetSearch()
        {
            foreach (int i in touched)
            {
                gScore[i] = float.PositiveInfinity;
                parent[i] = -1;
                closed[i] = false;
            }
            touched.Clear();
            open.Clear();
        }

        /// <summary>Binary min-heap of (priority, index) with lazy deletion.</summary>
        sealed class MinHeap
        {
            readonly List<float> keys = new List<float>();
            readonly List<int> values = new List<int>();

            public int Count => keys.Count;

            public void Clear() { keys.Clear(); values.Clear(); }

            public void Push(float key, int value)
            {
                keys.Add(key);
                values.Add(value);
                int i = keys.Count - 1;
                while (i > 0)
                {
                    int p = (i - 1) / 2;
                    if (keys[p] <= keys[i]) break;
                    Swap(i, p);
                    i = p;
                }
            }

            public int Pop()
            {
                int top = values[0];
                int last = keys.Count - 1;
                keys[0] = keys[last];
                values[0] = values[last];
                keys.RemoveAt(last);
                values.RemoveAt(last);
                int i = 0;
                while (true)
                {
                    int l = 2 * i + 1, r = l + 1, m = i;
                    if (l < keys.Count && keys[l] < keys[m]) m = l;
                    if (r < keys.Count && keys[r] < keys[m]) m = r;
                    if (m == i) break;
                    Swap(i, m);
                    i = m;
                }
                return top;
            }

            void Swap(int a, int b)
            {
                (keys[a], keys[b]) = (keys[b], keys[a]);
                (values[a], values[b]) = (values[b], values[a]);
            }
        }
    }
}
