# Raptor Strike

A playable prototype of a **tactical dinosaur shooter** built in **Godot 4.7**:
Counter-Strike's round and objective structure, hero-shooter character classes, dinosaurs
instead of humans.

Everything is primitives and placeholders on purpose - capsule characters, box geometry,
synthesised sounds - so the *systems* can be judged and extended before any art exists.

```bash
# open the folder in Godot 4.7 and press F5, or:
godot --path .                                              # play
godot --headless --path . res://tests/test_main.tscn         # 83 tests, ~75s
godot --headless --path . res://tools/headless_match.tscn -- --verbose   # simulate a whole match
```

**[HANDBOOK.md](HANDBOOK.md) explains how to change everything** - models, classes, weapons,
prices, the map, round rules, UI, audio, bots - naming the exact file for each change.

## What's implemented

| Area | State |
|---|---|
| **Map** | "Dustbowl Proto": three lanes, mid, two bomb sites, raised platforms, cover. Authored as walkable rectangles; walls **and** the navigation mesh are generated from them |
| **Movement** | `CharacterBody3D` controller: acceleration, sprint, crouch (with headroom check), jump, gravity, ramps, fall damage |
| **Classes** | Tank (Ankylo), Sniper (Ptera), Assassin (Raptor), Ranger (Para), Bruiser (Rex) - each with its own stats, hitbox, ability pair and shop |
| **Abilities** | 10 abilities on cooldowns, driven by a stacking status-effect system (shields, dashes, scans, heals, buffs, camouflage) |
| **Weapons** | 13 weapons + 5 pieces of gear. Hitscan with spread, recoil, falloff, armour penetration, fire modes (auto/semi/burst/melee), reload, switching, shotgun pellets, physics grenades |
| **Teams** | Two persistent teams; attacker/defender sides swap at halftime |
| **Bomb** | Carrier, drop, pickup, plant on either site, interruptible plant and defuse, fuse, defuse kit, blast damage |
| **Rounds** | Warmup, buy (freeze), live, round end. Five win conditions, gear carry-over for survivors |
| **Match** | First to 13 round wins, sides switch after round 12, cap at 24, optional overtime |
| **Economy** | Starting money, per-weapon kill rewards, win/loss income with a consecutive-loss bonus, objective rewards |
| **UI** | HUD (health, armour, ammo, weapon, money, abilities, clock, score, objective, bomb state, killfeed, hitmarkers), buy menu, scoreboard, class picker, match summary |
| **Bots** | Fill both teams, buy per class, `NavigationAgent3D` pathing, vision cones and line of sight, target selection, burst fire, plant and defuse |
| **Audio** | Event-driven cue system; every sound is synthesised at runtime as a placeholder |

## Architecture in one line

`scripts/core` is the simulation, driven by one explicit tick order and talking to
everything else through the global `Events` signal hub; `scripts/ui`, `autoload/audio_manager.gd`
and `PlayerController` are read-only consumers. Players and bots both produce the same
`Intent`, and all tuning lives in inspector-editable resources under `data/`.

See [HANDBOOK.md](HANDBOOK.md) §2-3 for the full map of the codebase.

## Placeholders to replace later

- Capsule characters -> `scripts/core/character_models.gd` (one documented swap point)
- Box/cylinder map props -> `MapBuilder.prop_models` (`scripts/core/world/map_builder.gd`)
- Synthesised sounds -> add a `path` to a cue in `autoload/audio_manager.gd`
- Prototype HUD -> `scenes/ui/hud.tscn`, editable in the Godot editor

## Also in this repository

`web-prototype/` holds the earlier browser/three.js version of the same game. It still runs
(`npm start`), and the Godot port was built from it. It is not the main project.

## Licence

MIT (see `LICENSE`).
