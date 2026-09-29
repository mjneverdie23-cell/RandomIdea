#!/usr/bin/env python3
"""Reference implementation of shared/spec/GAME_RULES.md.

This file is the tie-breaker: it implements the rules a third time, independently of
the Unity and Unreal code, and `generate_vectors.py` uses it to produce
`shared/tests/rules_vectors.json`. Both engines replay those vectors in their tests.

Only the Python standard library is used.
"""
from __future__ import annotations

import heapq
import json
import math
import os

SHARED = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_json(rel):
    with open(os.path.join(SHARED, rel), encoding="utf-8") as f:
        return json.load(f)


def load_all():
    data = {name: load_json(f"config/{name}.json") for name in
            ("game", "weapons", "equipment", "abilities", "agents", "bots", "input", "audio", "settings")}
    data["maps"] = {mid: load_json(f"maps/{mid}.json") for mid in data["game"]["mapRotation"]}
    return data


# --------------------------------------------------------------------------- random

MASK32 = 0xFFFFFFFF


class Rng:
    def __init__(self, seed):
        self.state = (seed & MASK32) or 0x9E3779B9

    def next(self):
        s = self.state
        s ^= (s << 13) & MASK32
        s ^= s >> 17
        s ^= (s << 5) & MASK32
        self.state = s & MASK32
        return self.state

    def next_float(self):
        return (self.next() >> 8) / 16777216.0


def fnv1a32(text):
    h = 2166136261
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 16777619) & MASK32
    return h


# --------------------------------------------------------------------------- economy

def loss_bonus(eco, streak):
    if streak <= 0:
        return eco["lossBase"]
    return min(eco["lossBase"] + (streak - 1) * eco["lossStreakIncrement"], eco["lossMax"])


def round_income(eco, won, loss_streak, is_attacker, bomb_planted):
    base = eco["winReward"] if won else loss_bonus(eco, loss_streak)
    return base + (eco["plantRewardTeam"] if is_attacker and bomb_planted else 0)


def kill_reward(eco, weapon):
    if weapon is not None and weapon.get("killReward", -1) >= 0:
        return weapon["killReward"]
    return eco["defaultKillReward"]


def next_loss_streak(streak, won):
    return 0 if won else min(streak + 1, 10)


# --------------------------------------------------------------------------- damage

def hit_zone(combat, hit_height, height):
    frac = hit_height / height if height > 0 else 0.5
    if frac >= combat["headZoneFraction"]:
        return "head"
    if frac < combat["legZoneFraction"]:
        return "legs"
    return "body"


def falloff(w, d):
    start, end, mn = w["falloffStart"], w["falloffEnd"], w["falloffMinMultiplier"]
    if end <= start:
        return 1.0 if d <= start else mn
    if d <= start:
        return 1.0
    if d >= end:
        return mn
    t = (d - start) / (end - start)
    return 1.0 + (mn - 1.0) * t


def zone_mult(w, zone):
    return {"head": w["headMultiplier"], "legs": w["legMultiplier"]}.get(zone, 1.0)


def raw_damage(w, zone, distance):
    return w["damage"] * zone_mult(w, zone) * falloff(w, distance)


def apply_armor(combat, raw, armor, pen, taken_mult=1.0):
    total = int(math.floor(raw * taken_mult + 0.5 + 0.0001))
    absorb = min(1.0, max(0.0, combat["armorAbsorption"] * (1.0 - pen)))
    armor_dmg = min(armor, int(math.floor(total * absorb + 0.0001)))
    return total - armor_dmg, armor_dmg


# --------------------------------------------------------------------------- weapons

def spread(w, mov, speed, airborne, crouched, aiming, shot_index):
    bloom = min(shot_index * w["bloomPerShot"], w["maxBloom"])
    stable = (w["baseSpread"] + bloom)
    if crouched and not airborne:
        stable *= w["crouchSpreadMultiplier"]
    if aiming:
        stable *= w["adsSpreadMultiplier"]
    frac = min(1.0, max(0.0, speed / mov["runSpeed"])) if mov["runSpeed"] > 0 else 0.0
    moving = w["moveSpread"] * frac + (w["airSpread"] if airborne else 0.0)
    return stable + moving


def recoil_kick(w, shot_index):
    pat = w["recoilPattern"]
    if not pat:
        return 0.0, 0.0
    step = pat[min(shot_index, len(pat) - 1)]
    return step["pitch"], step["yaw"]


# --------------------------------------------------------------------------- match flow

ATTACK, DEFENSE = "attack", "defense"


def other_side(s):
    return DEFENSE if s == ATTACK else ATTACK


def evaluate_round_end(detonated, defused, planted, alive_att, alive_def, round_time_left):
    """Returns (winning side or None, reason)."""
    if detonated:
        return ATTACK, "BombDetonated"
    if defused:
        return DEFENSE, "BombDefused"
    if not planted and alive_att == 0:
        return DEFENSE, "Elimination"
    if alive_def == 0:
        return ATTACK, "Elimination"
    if not planted and round_time_left <= 0:
        return DEFENSE, "TimeExpired"
    return None, "None"


class MatchFlow:
    """Round/score/side bookkeeping only; time is abstracted to 'a round was won by X'."""

    def __init__(self, match, start_side_a):
        self.m = match
        self.side_a = start_side_a
        self.score = [0, 0]
        self.streak = [0, 0]
        self.round = 1
        self.overtime = False
        self.ot_played = 0
        self.winner = None  # 0, 1, or "draw"
        self.swaps_after = []
        self.resets = ["S"]  # economy reset applied at the start of each round
        self._swapped_before_next = False

    def side_of(self, team):
        return self.side_a if team == 0 else other_side(self.side_a)

    def end_round(self, winning_team):
        m = self.m
        loser = 1 - winning_team
        self.score[winning_team] += 1
        self.streak[winning_team] = next_loss_streak(self.streak[winning_team], True)
        self.streak[loser] = next_loss_streak(self.streak[loser], False)
        played = self.round
        swap = False
        if not self.overtime:
            regulation = 2 * m["halftimeAfterRound"]
            if max(self.score) >= m["roundsToWin"]:
                self.winner = 0 if self.score[0] >= m["roundsToWin"] else 1
            elif m["overtimeEnabled"] and self.score[0] == m["roundsToWin"] - 1 and self.score[1] == m["roundsToWin"] - 1:
                self.overtime = True
            elif played >= regulation:
                self.winner = "draw" if self.score[0] == self.score[1] else (0 if self.score[0] > self.score[1] else 1)
            elif played == m["halftimeAfterRound"]:
                swap = True
        else:
            self.ot_played += 1
            lead = abs(self.score[0] - self.score[1])
            if lead >= m["overtimeWinMargin"]:
                self.winner = 0 if self.score[0] > self.score[1] else 1
            elif self.ot_played >= m["maxOvertimeRounds"]:
                self.winner = "draw" if lead == 0 else (0 if self.score[0] > self.score[1] else 1)
            elif self.ot_played % max(1, m["overtimeSwapEveryRounds"]) == 0:
                swap = True
        if self.winner is not None:
            return
        if swap:
            self.side_a = other_side(self.side_a)
            self.swaps_after.append(played)
        self.round += 1
        if self.overtime:
            self.streak = [0, 0]
            self.resets.append("C" if swap else "O")
        elif swap:
            self.streak = [0, 0]
            self.resets.append("S")
        else:
            self.resets.append(".")


# --------------------------------------------------------------------------- map

WALL, FLOOR, LOW, HIGH, SITE_A, SITE_B, ATT_SPAWN, DEF_SPAWN = range(8)
CHAR_TO_CELL = {"#": WALL, ".": FLOOR, "c": LOW, "h": HIGH, "A": SITE_A, "B": SITE_B, "T": ATT_SPAWN, "D": DEF_SPAWN}
CELL_NAMES = ["wall", "floor", "lowCover", "highCover", "siteA", "siteB", "attackSpawn", "defenseSpawn"]


class MapGrid:
    def __init__(self, mdef):
        rows = mdef["rows"]
        self.h = len(rows)
        self.w = max(len(r) for r in rows) if rows else 0
        self.cs = mdef["cellSize"]
        self.cells = []
        for r in rows:
            for x in range(self.w):
                ch = r[x] if x < len(r) else "#"
                self.cells.append(CHAR_TO_CELL.get(ch, WALL))

    def get(self, x, y):
        if x < 0 or y < 0 or x >= self.w or y >= self.h:
            return WALL
        return self.cells[y * self.w + x]

    def walkable(self, x, y):
        return self.get(x, y) not in (WALL, LOW, HIGH)

    def center(self, x, y):
        return ((x + 0.5 - self.w / 2.0) * self.cs, (self.h / 2.0 - y - 0.5) * self.cs)

    def cell_at(self, east, north):
        return int(math.floor(east / self.cs + self.w / 2.0)), int(math.floor(self.h / 2.0 - north / self.cs))

    def count(self, t):
        return sum(1 for c in self.cells if c == t)

    def boxes(self, t):
        used = [False] * len(self.cells)
        out = []
        for y in range(self.h):
            for x in range(self.w):
                i = y * self.w + x
                if used[i] or self.cells[i] != t:
                    continue
                w = 1
                while x + w < self.w and not used[i + w] and self.cells[i + w] == t:
                    w += 1
                h = 1
                while y + h < self.h and all(
                        not used[(y + h) * self.w + xx] and self.cells[(y + h) * self.w + xx] == t
                        for xx in range(x, x + w)):
                    h += 1
                for yy in range(y, y + h):
                    for xx in range(x, x + w):
                        used[yy * self.w + xx] = True
                out.append((x, y, w, h))
        return out


def astar(grid, sx, sy, gx, gy):
    """Returns path cost or None. 8-neighbour, no corner cutting, octile heuristic."""
    if not grid.walkable(sx, sy) or not grid.walkable(gx, gy):
        return None
    d2 = math.sqrt(2.0)

    def heur(x, y):
        dx, dy = abs(x - gx), abs(y - gy)
        return (dx + dy) + (d2 - 2.0) * min(dx, dy)

    g = {(sx, sy): 0.0}
    openq = [(heur(sx, sy), 0.0, sx, sy)]
    closed = set()
    while openq:
        _, cost, x, y = heapq.heappop(openq)
        if (x, y) in closed:
            continue
        if (x, y) == (gx, gy):
            return cost
        closed.add((x, y))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                nx, ny = x + dx, y + dy
                if not grid.walkable(nx, ny):
                    continue
                if dx != 0 and dy != 0 and (not grid.walkable(x + dx, y) or not grid.walkable(x, y + dy)):
                    continue
                nc = cost + (d2 if dx and dy else 1.0)
                if nc < g.get((nx, ny), float("inf")) - 1e-9:
                    g[(nx, ny)] = nc
                    heapq.heappush(openq, (nc + heur(nx, ny), nc, nx, ny))
    return None


# --------------------------------------------------------------------------- audio synth

def synth(cue, sample_rate):
    n = int(math.floor(cue["duration"] * sample_rate + 0.5))
    rng = Rng(fnv1a32(cue["id"]))
    f0, f1 = cue["frequency"], cue.get("frequencyEnd", 0)
    wave = cue["wave"]
    mix = 1.0 if wave == "noise" else cue.get("noise", 0.0)
    attack = max(cue.get("attack", 0.003), 1e-4)
    decay = cue.get("decay", 2.0)
    vol = cue["volume"]
    phase = 0.0
    out = []
    for i in range(n):
        t = i / sample_rate
        u = t / cue["duration"]
        f = f0 * math.pow(f1 / f0, u) if (f1 > 0 and f0 > 0) else f0
        phase += f / sample_rate
        phase -= math.floor(phase)
        if wave == "sine":
            osc = math.sin(2.0 * math.pi * phase)
        elif wave == "square":
            osc = 1.0 if phase < 0.5 else -1.0
        elif wave == "saw":
            osc = 2.0 * phase - 1.0
        elif wave == "triangle":
            osc = 1.0 - 4.0 * abs(phase - 0.5)
        else:
            osc = 0.0
        noise = rng.next_float() * 2.0 - 1.0
        env = min(1.0, t / attack) * math.pow(max(0.0, 1.0 - u), decay)
        out.append((osc * (1.0 - mix) + noise * mix) * env * vol)
    return out


# --------------------------------------------------------------------------- shop

class Loadout:
    def __init__(self, default_secondary):
        self.primary = None
        self.secondary = default_secondary
        self.armor = 0
        self.kit = False
        self.charges = [0, 0, 0, 0]
        self.purchases = []  # dicts: kind, id, price, slot, previousId, previousArmor


def catalog_entry(data, agent, item_id):
    """Returns (kind, definition, slotIndex) for a shop item id, or (None, None, -1)."""
    for w in data["weapons"]["weapons"]:
        if w["id"] == item_id:
            return "weapon", w, -1
    for e in data["equipment"]["equipment"]:
        if e["id"] == item_id:
            return e["type"], e, -1
    for i, s in enumerate(agent["abilities"]):
        if s["abilityId"] == item_id:
            return "ability", s, i
    return None, None, -1


def weapon_price(data, wid):
    if wid is None:
        return 0
    for w in data["weapons"]["weapons"]:
        if w["id"] == wid:
            return w["price"]
    return 0


def shop_buy(data, agent, side, lo, money, item_id):
    """Returns (result, newMoney, droppedWeaponId)."""
    kind, d, slot_index = catalog_entry(data, agent, item_id)
    if kind is None:
        return "unknownItem", money, None
    if kind == "weapon":
        if d["slot"] == "melee":
            return "notForSale", money, None
        slot = d["slot"]
        current = lo.primary if slot == "primary" else lo.secondary
        if current == item_id:
            return "alreadyOwned", money, None
        refund_rec = next((p for p in lo.purchases if p["kind"] == "weapon" and p["id"] == current and p["slot"] == slot), None)
        refund = refund_rec["price"] if refund_rec else 0
        if money + refund < d["price"]:
            return "notEnoughMoney", money, None
        dropped = None
        previous = current
        if refund_rec:
            lo.purchases.remove(refund_rec)
            previous = refund_rec["previousId"]
        elif current is not None and weapon_price(data, current) > 0:
            dropped = current
            previous = None
        money = money + refund - d["price"]
        if slot == "primary":
            lo.primary = item_id
        else:
            lo.secondary = item_id
        lo.purchases.append({"kind": "weapon", "id": item_id, "price": d["price"], "slot": slot,
                             "previousId": previous, "previousArmor": 0})
        return "ok", money, dropped
    if kind == "armor":
        if lo.armor >= d["amount"]:
            return "alreadyOwned", money, None
        refund_rec = next((p for p in lo.purchases if p["kind"] == "armor"), None)
        refund = refund_rec["price"] if refund_rec else 0
        if money + refund < d["price"]:
            return "notEnoughMoney", money, None
        previous_armor = lo.armor
        if refund_rec:
            lo.purchases.remove(refund_rec)
            previous_armor = refund_rec["previousArmor"]
        money = money + refund - d["price"]
        lo.armor = d["amount"]
        lo.purchases.append({"kind": "armor", "id": item_id, "price": d["price"], "slot": "",
                             "previousId": None, "previousArmor": previous_armor})
        return "ok", money, None
    if kind == "defuseKit":
        if side != DEFENSE:
            return "wrongSide", money, None
        if lo.kit:
            return "alreadyOwned", money, None
        if money < d["price"]:
            return "notEnoughMoney", money, None
        lo.kit = True
        money -= d["price"]
        lo.purchases.append({"kind": "defuseKit", "id": item_id, "price": d["price"], "slot": "",
                             "previousId": None, "previousArmor": 0})
        return "ok", money, None
    # ability
    if d["ultPoints"] > 0 or d["price"] <= 0:
        return "notForSale", money, None
    if lo.charges[slot_index] >= d["maxCharges"]:
        return "maxCharges", money, None
    if money < d["price"]:
        return "notEnoughMoney", money, None
    lo.charges[slot_index] += 1
    money -= d["price"]
    lo.purchases.append({"kind": "ability", "id": item_id, "price": d["price"], "slot": str(slot_index),
                         "previousId": None, "previousArmor": 0})
    return "ok", money, None


def shop_sell(data, agent, lo, money, item_id):
    rec = None
    for p in reversed(lo.purchases):
        if p["id"] == item_id:
            rec = p
            break
    if rec is None:
        return "notSellable", money
    if rec["kind"] == "weapon":
        current = lo.primary if rec["slot"] == "primary" else lo.secondary
        if current != item_id:
            return "notSellable", money
        restored = rec["previousId"]
        if rec["slot"] == "primary":
            lo.primary = restored
        else:
            lo.secondary = restored if restored is not None else data["game"]["loadout"]["defaultSecondary"]
    elif rec["kind"] == "armor":
        lo.armor = rec["previousArmor"]
    elif rec["kind"] == "defuseKit":
        lo.kit = False
    else:
        idx = int(rec["slot"])
        if lo.charges[idx] <= 0:
            return "notSellable", money
        lo.charges[idx] -= 1
    lo.purchases.remove(rec)
    return "ok", money + rec["price"]
