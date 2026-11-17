"""Python mirror of scenes/board/match_finder.gd, used by the level simulator."""
NO_COLOR = -1
LINE_3, LINE_4, LINE_5, CROSS = "LINE_3", "LINE_4", "LINE_5", "CROSS"


class Run:
    def __init__(self):
        self.cells = []
        self.horizontal = True


class MatchGroup:
    def __init__(self):
        self.cells = []
        self.color = NO_COLOR
        self.shape = LINE_3
        self.pivot = (0, 0)
        self.horizontal = True


def find_matches(colors):
    columns = len(colors)
    rows = len(colors[0]) if columns > 0 else 0
    runs = []
    for y in range(rows):
        x = 0
        while x < columns:
            end = x + 1
            while end < columns and colors[end][y] == colors[x][y]:
                end += 1
            if colors[x][y] != NO_COLOR and end - x >= 3:
                runs.append(make_run((x, y), (1, 0), end - x))
            x = end
    for x in range(columns):
        y = 0
        while y < rows:
            end = y + 1
            while end < rows and colors[x][end] == colors[x][y]:
                end += 1
            if colors[x][y] != NO_COLOR and end - y >= 3:
                runs.append(make_run((x, y), (0, 1), end - y))
            y = end
    return group_runs(runs, colors)


def make_run(start, step, length):
    run = Run()
    run.horizontal = step == (1, 0)
    for i in range(length):
        run.cells.append((start[0] + step[0] * i, start[1] + step[1] * i))
    return run


def root(parent, i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i


def group_runs(runs, colors):
    parent = list(range(len(runs)))
    first_run_at = {}
    for i in range(len(runs)):
        for cell in runs[i].cells:
            if cell in first_run_at:
                parent[root(parent, i)] = root(parent, first_run_at[cell])
            else:
                first_run_at[cell] = i
    runs_by_root = {}
    for i in range(len(runs)):
        r = root(parent, i)
        runs_by_root.setdefault(r, []).append(runs[i])
    return [build_group(rs, colors) for rs in runs_by_root.values()]


def build_group(group_runs, colors):
    group = MatchGroup()
    longest = group_runs[0]
    horizontal_cells = {}
    has_vertical = False
    seen = {}
    for run in group_runs:
        if len(run.cells) > len(longest.cells):
            longest = run
        if run.horizontal:
            for cell in run.cells:
                horizontal_cells[cell] = True
        else:
            has_vertical = True
        for cell in run.cells:
            if cell not in seen:
                seen[cell] = True
                group.cells.append(cell)
    first = longest.cells[0]
    group.color = colors[first[0]][first[1]]
    group.horizontal = longest.horizontal
    group.pivot = longest.cells[int(len(longest.cells) / 2.0)]
    if len(longest.cells) >= 5:
        group.shape = LINE_5
    elif has_vertical and horizontal_cells:
        group.shape = CROSS
        for run in group_runs:
            if run.horizontal:
                continue
            for cell in run.cells:
                if cell in horizontal_cells:
                    group.pivot = cell
    elif len(longest.cells) == 4:
        group.shape = LINE_4
    return group


def find_possible_move(colors):
    columns = len(colors)
    rows = len(colors[0]) if columns > 0 else 0
    for x in range(columns):
        for y in range(rows):
            for step in ((1, 0), (0, 1)):
                a = (x, y)
                b = (x + step[0], y + step[1])
                if b[0] >= columns or b[1] >= rows:
                    continue
                ca, cb = colors[a[0]][a[1]], colors[b[0]][b[1]]
                if ca == cb:
                    continue
                if makes_line(colors, a, cb, b) or makes_line(colors, b, ca, a):
                    return [a, b]
    return []


def makes_line(colors, cell, color, vacated):
    if color == NO_COLOR:
        return False
    columns, rows = len(colors), len(colors[0])
    for axis in ((1, 0), (0, 1)):
        count = 1
        for d in (axis, (-axis[0], -axis[1])):
            c = (cell[0] + d[0], cell[1] + d[1])
            while 0 <= c[0] < columns and 0 <= c[1] < rows and c != vacated and colors[c[0]][c[1]] == color:
                count += 1
                c = (c[0] + d[0], c[1] + d[1])
        if count >= 3:
            return True
    return False
