"""Headless Python model of a Gem Match level, for balancing and for the DDA data table.

It mirrors the game's rules: matches of 3/4/5 and L/T/+ shapes, special gems and their
chain reactions, gravity, refill, cascades, scoring (10 points per gem x (cascade + 1),
30 per prism) and the "no moves -> shuffle" rule. Levels are read straight from the
project's levels/*.tres files, so this never drifts from the game's level data.
"""
import os
import random
import re

from match_finder import CROSS, LINE_4, LINE_5, NO_COLOR, find_matches

NONE, SH, SV, WR, PR = "NONE", "STRIPED_H", "STRIPED_V", "WRAPPED", "PRISM"
ALL_COLORS = -2


# --- Level files ------------------------------------------------------------------------


def load_levels(project_dir):
    """Levels in catalog order, as dicts: columns, rows, moves, gems (names), star_scores,
    goals [(gem name, amount)]."""
    levels_dir = os.path.join(project_dir, "levels")
    catalog = open(os.path.join(levels_dir, "catalog.tres")).read()
    paths = dict(re.findall(r'path="res://levels/([^"]+)" id="([^"]+)"', catalog))
    by_id = {v: k for k, v in paths.items()}
    order = re.findall(r'ExtResource\("([^"]+)"\)', catalog.split("levels = ")[1])
    # The first ExtResource in a typed array is the element type (the LevelData script).
    return [_parse_level(os.path.join(levels_dir, by_id[i])) for i in order if i in by_id]


def _parse_level(path):
    text = open(path).read()
    ext = {i: os.path.splitext(os.path.basename(p))[0]
           for p, i in re.findall(r'path="res://resources/gems/([^"]+)" id="([^"]+)"', text)}
    number = lambda key: int(re.search(rf"^{key} = (\d+)", text, re.M).group(1))
    gem_ids = re.findall(r'ExtResource\("([^"]+)"\)',
                         re.search(r"^gem_types = (.*)$", text, re.M).group(1))
    stars = [int(s) for s in re.search(r"star_scores = PackedInt32Array\(([^)]*)\)", text)
             .group(1).split(",")]
    goals = []
    for block in re.findall(r'\[sub_resource[^\]]*\]\n(.*?)(?=\n\n|\Z)', text, re.S):
        gem = re.search(r'gem_type = ExtResource\("([^"]+)"\)', block).group(1)
        goals.append((ext[gem], int(re.search(r"amount = (\d+)", block).group(1))))
    return {
        "columns": number("columns"), "rows": number("rows"), "moves": number("moves"),
        "gems": [ext[i] for i in gem_ids[1:]],  # gem_ids[0] is the GemType script itself
        "star_scores": stars, "goals": goals,
    }


def progress_of(level, score, collected):
    """Goal completion in [0, 1]: the mean of each goal's capped completion, where the goals
    are the 1-star score and every collect goal. MUST match DDAManager.progress_of()."""
    parts = [min(1.0, score / level["star_scores"][0])]
    for gem, amount in level["goals"]:
        parts.append(min(1.0, collected[level["gems"].index(gem)] / amount))
    return sum(parts) / len(parts)


# --- Board model ------------------------------------------------------------------------


class Gem:
    __slots__ = ("color", "special", "pos")

    def __init__(self, color, special=NONE):
        self.color, self.special, self.pos = color, special, None


class Board:
    def __init__(self, columns, rows, colors, rng):
        self.cols, self.rows, self.n, self.rng = columns, rows, colors, rng
        self.grid = [[None] * rows for _ in range(columns)]
        self.score = 0
        self.collected = [0] * colors
        self.prism_targets = {}
        for y in range(rows):
            for x in range(columns):
                self._put((x, y), Gem(self._spawn_color(x, y)))
        while not self.moves():
            self._recolour()

    def _spawn_color(self, x, y):
        def at(cx, cy):
            if cx < 0 or cy < 0:
                return None
            g = self.grid[cx][cy]
            return g.color if g and g.special != PR else None
        options = list(range(self.n))
        left = at(x - 1, y)
        if left is not None and left == at(x - 2, y):
            options.remove(left)
        up = at(x, y - 1)
        if up is not None and up == at(x, y - 2) and up in options:
            options.remove(up)
        return self.rng.choice(options)

    def _recolour(self):
        for y in range(self.rows):
            for x in range(self.cols):
                if self.grid[x][y].special == NONE:
                    self.grid[x][y].color = self._spawn_color(x, y)

    def _put(self, cell, gem):
        self.grid[cell[0]][cell[1]] = gem
        if gem:
            gem.pos = cell

    def _get(self, cell):
        x, y = cell
        return self.grid[x][y] if 0 <= x < self.cols and 0 <= y < self.rows else None

    def _color_of(self, gem):
        return NO_COLOR if gem is None or gem.special == PR else gem.color

    def colors(self):
        return [[self._color_of(self.grid[x][y]) for y in range(self.rows)]
                for x in range(self.cols)]

    def moves(self):
        found = []
        colors = self.colors()
        for x in range(self.cols):
            for y in range(self.rows):
                for dx, dy in ((1, 0), (0, 1)):
                    b = (x + dx, y + dy)
                    if b[0] >= self.cols or b[1] >= self.rows:
                        continue
                    ga, gb = self._get((x, y)), self._get(b)
                    if PR in (ga.special, gb.special) or (ga.special != NONE and gb.special != NONE):
                        found.append(((x, y), b))
                        continue
                    colors[x][y], colors[b[0]][b[1]] = colors[b[0]][b[1]], colors[x][y]
                    if find_matches(colors):
                        found.append(((x, y), b))
                    colors[x][y], colors[b[0]][b[1]] = colors[b[0]][b[1]], colors[x][y]
        return found

    def immediate_clear(self, move):
        colors = self.colors()
        (ax, ay), (bx, by) = move
        colors[ax][ay], colors[bx][by] = colors[bx][by], colors[ax][ay]
        bonus = 20 if (self._get(move[0]).special != NONE or self._get(move[1]).special != NONE) else 0
        return sum(len(g.cells) for g in find_matches(colors)) + bonus

    def play(self, frm, to):
        a, b = self._get(frm), self._get(to)
        self._put(to, a)
        self._put(frm, b)
        cascade = 0
        triggered = self._triggers(frm, to)
        while True:
            groups = find_matches(self.colors())
            if not groups and not triggered:
                break
            self._wave(groups, triggered, cascade, frm, to)
            triggered = []
            self._gravity_and_refill()
            cascade += 1
        while not self.moves() or find_matches(self.colors()):
            self._recolour()

    def _triggers(self, frm, to):
        moved, other = self._get(to), self._get(frm)
        if moved.special == PR and other.special == PR:
            self.prism_targets = {moved: ALL_COLORS, other: ALL_COLORS}
            return [moved, other]
        if PR in (moved.special, other.special):
            prism = moved if moved.special == PR else other
            partner = other if prism is moved else moved
            self.prism_targets = {prism: self._color_of(partner)}
            return [prism] + ([partner] if partner.special != NONE else [])
        if moved.special != NONE and other.special != NONE:
            return [moved, other]
        return []

    def _area(self, source):
        ox, oy = source.pos
        if source.special == SH:
            return [(x, oy) for x in range(self.cols)]
        if source.special == SV:
            return [(ox, y) for y in range(self.rows)]
        if source.special == WR:
            return [(ox + dx, oy + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                    if self._get((ox + dx, oy + dy))]
        target = self.prism_targets.get(source)
        if target is None:
            counts = {}
            for column in self.colors():
                for c in column:
                    if c != NO_COLOR:
                        counts[c] = counts.get(c, 0) + 1
            target = max(counts, key=counts.get) if counts else NO_COLOR
        return [source.pos] + [(x, y) for x in range(self.cols) for y in range(self.rows)
                               if target == ALL_COLORS or self._color_of(self._get((x, y))) == target]

    def _wave(self, groups, triggered, cascade, frm, to):
        clear, keep = set(), {}
        for group in groups:
            kind = {LINE_4: SH if group.horizontal else SV, CROSS: WR, LINE_5: PR}.get(group.shape, NONE)
            if kind != NONE:
                for cell in ([to, frm] if cascade == 0 else []) + [group.pivot] + group.cells:
                    if cell in group.cells and self._get(cell).special == NONE:
                        keep[cell] = kind
                        break
            clear |= {c for c in group.cells if c not in keep}
        queue = list(triggered) + [self._get(c) for c in clear if self._get(c).special != NONE]
        clear |= {g.pos for g in triggered}
        done = set()
        while queue:
            source = queue.pop(0)
            if source in done:
                continue
            done.add(source)
            for cell in self._area(source):
                if cell in keep:
                    continue
                clear.add(cell)
                hit = self._get(cell)
                if hit.special != NONE and hit not in done:
                    queue.append(hit)
        for cell, kind in keep.items():
            self._get(cell).special = kind
        for cell in clear:
            gem = self._get(cell)
            if gem.special == PR:
                self.score += 30 * (cascade + 1)
            else:
                self.score += 10 * (cascade + 1)
                self.collected[gem.color] += 1
            self._put(cell, None)
        self.prism_targets = {}

    def _gravity_and_refill(self):
        for x in range(self.cols):
            land = self.rows - 1
            for y in range(self.rows - 1, -1, -1):
                gem = self.grid[x][y]
                if gem is None:
                    continue
                if y != land:
                    self.grid[x][y] = None
                    self._put((x, land), gem)
                land -= 1
            for y in range(land + 1):
                self._put((x, y), Gem(self.rng.randrange(self.n)))


def choose_move(board, policy, rng):
    """'casual' picks any valid swap; 'sensible' picks the one that clears most right now."""
    options = board.moves()
    if policy == "casual":
        return rng.choice(options)
    return max(options, key=board.immediate_clear)


def new_board(level, rng):
    return Board(level["columns"], level["rows"], len(level["gems"]), rng)


def is_won(level, board):
    return progress_of(level, board.score, board.collected) >= 1.0
