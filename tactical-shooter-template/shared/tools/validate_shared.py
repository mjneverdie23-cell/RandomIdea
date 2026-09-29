#!/usr/bin/env python3
"""Checks shared/config and shared/maps for mistakes both engines would trip over.

    python3 shared/tools/validate_shared.py

Checks cross-references (agents -> abilities, loadout -> weapons, bots -> weapons),
enum-like strings, key names, and that every map is well formed and fully connected.
The engines run the same checks at startup and log them.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import reference_rules as R  # noqa: E402

KEY_NAMES = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ") | set("0123456789") | {f"F{i}" for i in range(1, 13)} | {
    "Space", "Enter", "Escape", "Tab", "Backspace", "LeftShift", "RightShift", "LeftCtrl", "RightCtrl",
    "LeftAlt", "RightAlt", "Up", "Down", "Left", "Right", "Mouse1", "Mouse2", "Mouse3", "Mouse4", "Mouse5",
    "WheelUp", "WheelDown", "CapsLock", "Backquote", "Minus", "Equals", "Comma", "Period", "Slash", "Semicolon",
    "Quote", "LeftBracket", "RightBracket", "Backslash", "Insert", "Delete", "Home", "End", "PageUp", "PageDown"}
ACTIONS = ["MoveForward", "MoveBack", "MoveLeft", "MoveRight", "Jump", "Crouch", "Walk", "Fire", "Aim", "Reload",
           "Interact", "Drop", "Primary", "Secondary", "Melee", "Ability1", "Ability2", "Ability3", "Ultimate",
           "BuyMenu", "Scoreboard", "Pause"]
CATEGORIES = {"melee", "sidearm", "smg", "shotgun", "rifle", "sniper"}
SLOTS = {"primary", "secondary", "melee"}
FIRE_MODES = {"auto", "semi", "melee"}
ABILITY_TYPES = {"flash", "smoke", "frag", "incendiary", "dash", "heal", "wall", "recon", "buff"}
WAVES = {"sine", "square", "saw", "triangle", "noise"}


def main():
    d = R.load_all()
    errors, warnings = [], []
    weapons = {w["id"]: w for w in d["weapons"]["weapons"]}
    abilities = {a["id"]: a for a in d["abilities"]["abilities"]}
    cues = {c["id"] for c in d["audio"]["cues"]}
    game = d["game"]

    def unique(kind, items):
        seen = set()
        for it in items:
            if it["id"] in seen:
                errors.append(f"duplicate {kind} id '{it['id']}'")
            seen.add(it["id"])

    unique("weapon", d["weapons"]["weapons"])
    unique("ability", d["abilities"]["abilities"])
    unique("agent", d["agents"]["agents"])
    unique("equipment", d["equipment"]["equipment"])
    unique("cue", d["audio"]["cues"])

    for w in weapons.values():
        tag = f"weapon '{w['id']}'"
        if w["category"] not in CATEGORIES:
            errors.append(f"{tag}: unknown category '{w['category']}'")
        if w["slot"] not in SLOTS:
            errors.append(f"{tag}: unknown slot '{w['slot']}'")
        if w["fireMode"] not in FIRE_MODES:
            errors.append(f"{tag}: unknown fireMode '{w['fireMode']}'")
        if w["fireRate"] <= 0:
            errors.append(f"{tag}: fireRate must be > 0")
        if w["fireMode"] != "melee" and w["magazineSize"] <= 0:
            errors.append(f"{tag}: guns need magazineSize > 0")
        if w["pellets"] < 1:
            errors.append(f"{tag}: pellets must be >= 1")
        if w["fireSound"] not in cues:
            errors.append(f"{tag}: fireSound '{w['fireSound']}' is not a cue in audio.json")
    for a in abilities.values():
        if a["type"] not in ABILITY_TYPES:
            errors.append(f"ability '{a['id']}': unknown type '{a['type']}'")
    for ag in d["agents"]["agents"]:
        slots = [s["slot"] for s in ag["abilities"]]
        if slots != ["C", "Q", "E", "X"]:
            errors.append(f"agent '{ag['id']}': abilities must be exactly slots C, Q, E, X in order (got {slots})")
        for s in ag["abilities"]:
            if s["abilityId"] not in abilities:
                errors.append(f"agent '{ag['id']}': unknown ability '{s['abilityId']}'")
            if s["ultPoints"] <= 0 and s["price"] <= 0 and s["freeChargesPerRound"] <= 0:
                warnings.append(f"agent '{ag['id']}' slot {s['slot']}: can never be obtained (no price, no free charge, no ult cost)")
    lo = game["loadout"]
    for key, slot in (("defaultMelee", "melee"), ("defaultSecondary", "secondary")):
        w = weapons.get(lo[key])
        if w is None:
            errors.append(f"game.loadout.{key}: unknown weapon '{lo[key]}'")
        elif w["slot"] != slot:
            errors.append(f"game.loadout.{key}: '{lo[key]}' is not a {slot} weapon")
    bots = d["bots"]
    if bots["defaultDifficulty"] not in {x["id"] for x in bots["difficulties"]}:
        errors.append("bots.defaultDifficulty is not one of bots.difficulties")
    for wid in bots["buy"]["preferredRifles"] + bots["buy"]["forceBuyWeapons"]:
        if wid not in weapons:
            errors.append(f"bots.buy references unknown weapon '{wid}'")
    if len(bots["names"]) < 2 * game["match"]["teamSize"]:
        warnings.append("bots.names has fewer names than bots needed; names will repeat")
    bound = set()
    for b in d["input"]["bindings"]:
        if b["action"] not in ACTIONS:
            errors.append(f"input: unknown action '{b['action']}'")
        for k in (b["key"], b.get("altKey", "")):
            if k and k not in KEY_NAMES:
                errors.append(f"input: '{b['action']}' uses unknown key name '{k}'")
        bound.add(b["action"])
    for a in ACTIONS:
        if a not in bound:
            errors.append(f"input: action '{a}' has no binding")
    for c in d["audio"]["cues"]:
        if c["wave"] not in WAVES:
            errors.append(f"audio cue '{c['id']}': unknown wave '{c['wave']}'")
        if c["duration"] <= 0:
            errors.append(f"audio cue '{c['id']}': duration must be > 0")
    m = game["match"]
    if m["roundsToWin"] != m["halftimeAfterRound"] + 1:
        warnings.append("match.roundsToWin is usually halftimeAfterRound + 1")

    team = game["match"]["teamSize"]
    for mid, mdef in d["maps"].items():
        tag = f"map '{mid}'"
        rows = mdef["rows"]
        if len({len(r) for r in rows}) != 1:
            errors.append(f"{tag}: rows have different lengths")
        g = R.MapGrid(mdef)
        for y in range(g.h):
            for x in range(g.w):
                edge = x in (0, g.w - 1) or y in (0, g.h - 1)
                if edge and g.get(x, y) != R.WALL:
                    errors.append(f"{tag}: border cell ({x},{y}) must be a wall")
        for ch in "".join(rows):
            if ch not in R.CHAR_TO_CELL:
                errors.append(f"{tag}: unknown symbol '{ch}'")
                break
        for t, name in ((R.ATT_SPAWN, "attacker spawn (T)"), (R.DEF_SPAWN, "defender spawn (D)")):
            if g.count(t) < team:
                errors.append(f"{tag}: needs at least {team} {name} cells, has {g.count(t)}")
        if g.count(R.SITE_A) == 0 and g.count(R.SITE_B) == 0:
            errors.append(f"{tag}: has no bomb site")
        walk = [(x, y) for y in range(g.h) for x in range(g.w) if g.walkable(x, y)]
        if walk:
            start = walk[0]
            seen, stack = {start}, [start]
            while stack:
                x, y = stack.pop()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    n = (x + dx, y + dy)
                    if n not in seen and g.walkable(*n):
                        seen.add(n)
                        stack.append(n)
            if len(seen) != len(walk):
                errors.append(f"{tag}: {len(walk) - len(seen)} walkable cells cannot be reached from the rest")

    for w in warnings:
        print("warning: " + w)
    for e in errors:
        print("error:   " + e)
    print(f"{len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
