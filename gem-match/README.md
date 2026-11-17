# Gem Match

A 2D gem-themed match-3 puzzle game in **Godot 4** (GDScript). Visuals are deliberately
minimal: each gem is one coloured polygon, with a different shape per colour, and every
sound is synthesised at runtime, so the project has no art or audio files.

This folder is its own Godot project, separate from Raptor Strike at the repository root.

```bash
# Open gem-match/project.godot in the Godot 4.4+ editor once (this registers the class_names), then press F5.
godot --editor --path gem-match
# Headless tests (exit code 0 = all passed):
godot --headless --path gem-match -s res://tests/test_runner.gd
```

## How to play

- **Swipe** a gem towards a neighbour, or **tap** a gem and then one of its neighbours.
- A swap must make a line of 3 or more, otherwise the gems slide back (no move is used).
- Reach the level's score and collect goals before the moves run out. Chain reactions
  multiply points (x2, x3, ...), and moves left over at the end are worth bonus points.
- Escape (or the Android back button) goes back one screen.
- **Lives:** 5 at most, and one comes back every 3 hours, even while the game is closed.
  Losing a level, or quitting one after your first move, costs a life. With 0 lives the
  level buttons lock until one regenerates.
- **Out of moves?** Once per attempt you are offered a revival for watching an ad or buying
  one (the amounts depend on the situation, see below). Saying "No thanks" starts a 15-second wait before Exit unlocks and the
  game-over screen appears. The game is paused throughout, and Back/Escape does nothing.

| Match | Makes | Looks like | When it goes off |
|---|---|---|---|
| 4 in a line | Striped | white bar | clears its row (horizontal match) or column (vertical match) |
| L, T or + shape | Wrapped | white square | clears the 3x3 area around it |
| 5 in a line | Prism | white gem, dark centre | swap it with a gem to clear every gem of that colour |

Swapping two specials sets both off; two prisms clear the whole board. Any special caught
in a blast goes off too. If no move is possible, the board shuffles itself. After a few
seconds without input, a possible move wiggles as a hint.

## Difficulty adjustment and revival offers

All of this runs quietly in the background:

- **Pass Proximity** is the chance of winning from the current state: level, moves left, and
  goal progress in 20 steps. It is read from `data/pass_proximity.csv`, which is loaded once
  at startup, so each move costs one array lookup.
- **Every accepted move** (`DDAManager.pass_proximity_treatment`): if the chance is below
  40%, 10% of the new gems dropped in after the move are forced to complete a match
  (preferring colours a goal needs). On the last move, if the player is at least 60% of the
  way there, every new gem is forced to make a match (the "rescue").
- **Difficulty tier** (`difficulty_actions_component`), on a smoothed chance: below 30% the
  refills skip one non-goal colour (fewer colours means more matches); above 85%, 10% of
  refills avoid making a match. The game has no blockers or ice yet, so those are the levers.
- **Revival offer** (`legacy_pass_proximity_treatment` + `systems/monetization_model.gd`):
  the ad gives 3-5 moves, fewer the closer the player already was. The purchase gives
  5 x a multiplier of 1.0-2.0 (5-10 moves). The multiplier grows with the losing streak,
  fails on this level, missing lives, weekly-race standing and how far behind the player is.
  The exact formulas are at the top of `monetization_model.gd`.
- **Weekly race:** stars won this week, ranked against 29 bots until there is a server.
  Weeks start Monday 00:00 UTC.

**Seeing it work:** run the game from the editor and watch the Output panel. Every DDA
function prints a line tagged with its name, for example
`[DDA] pass_proximity_treatment: moves left 3, progress 72%, proximity 0.31 -> ASSIST: ...`.
Lives, results and race changes print `[Meta] ...` lines. Gem spawns print only when one is
forced or steered away from a match; the rest are summed up once per move. Logging is on in
debug builds and off in release exports; set `debug_log = false` on `DDAManager` or
`MetaProgression` to silence one of them.

The CSV comes from simulation, not real players: bots play every level 800 times. After
changing levels, regenerate it (it takes about 5 minutes):

```bash
python3 gem-match/tools/sim/make_proximity_csv.py
```

When real telemetry exists, write the same columns from it
(`level,moves_left,progress_bucket,win_probability,samples`). `tools/` holds Python only
and is ignored by Godot.

## Changing things

| To change | Edit |
|---|---|
| A gem's colour, shape, points or art | `resources/gems/*.tres` (`GemType`). Set `texture` to replace the polygon |
| Levels (size, gems, moves, star scores, goals) | `levels/level_XX.tres` (`LevelData`); order in `levels/catalog.tres` |
| Animation timings, swipe distance, hint delay | Inspector on the Board node, `scenes/board/board.tscn` |
| Scoring (cascade multiplier, move bonus) | `scenes/main/main.gd` |
| Sounds and music | `autoload/audio_manager.gd` (`_build_sounds`, `_build_music`) |
| Volumes | `default_bus_layout.tres` (Music and SFX buses) |
| Revival amounts and the purchase multiplier | constants in `systems/monetization_model.gd` |
| DDA thresholds and help rates | constants at the top of `autoload/dda_manager.gd` |
| Lives, regeneration time, race size | constants at the top of `autoload/meta_progression.gd` |
| Revival: lockout length | `lockout_seconds` on `scenes/ui/revival_popup.tscn` |
| Fake vs real ads / purchases | `USE_MOCK_DATA` in `autoload/ad_manager.gd` and `autoload/iap_manager.gd`; plug the SDK into `_show_real_ad()` / `_start_real_purchase()` |

## Architecture

```
autoload/game_state.gd          Autoload: current level, progress + settings saved as JSON in user://, scene changes, back navigation
autoload/audio_manager.gd       Autoload: Music/SFX buses, synthesised sounds, button clicks
autoload/ad_manager.gd          Autoload: rewarded ads (mock: 2 s delay, then success)
autoload/iap_manager.gd         Autoload: in-app purchase of a revival (mock: 2 s delay, then success)
autoload/meta_progression.gd    Autoload: lives (timestamp regen), losing streak, fails per level, weekly race; user://meta.json
autoload/dda_manager.gd         Autoload: Pass Proximity table, per-move help and difficulty tier, gem colour source, revival pricing
systems/monetization_model.gd   Pure formulas for the revival offer
data/pass_proximity.csv         Win chance by level, moves left and progress (2,500 rows)
tools/sim/                      Python level simulator that builds the CSV (ignored by Godot)
resources/                      GemType, LevelData, CollectGoal, LevelCatalog resources and the six gem .tres files
levels/                         Eight levels and the catalog
scenes/board/board.gd|.tscn     Board: grid array, state machine, input, swapping, matching, specials, gravity, refill, shuffle, hints
scenes/board/match_finder.gd    Pure logic on a grid of colour ids: match groups (3/4/5, L/T/+) and possible-move search
scenes/board/gem_pool.gd        Object pool: gems are recycled, never created or freed during play
scenes/board/board_background.gd  Static checkerboard behind the gems
scenes/board/board_top_mask.gd  Hides refill gems until they drop into the grid
scenes/gem/gem.gd|.tscn         Gem: visuals and tweens only; reports finished animations with signals
scenes/effects/                 Shake camera (trauma based) and pooled particle bursts
scenes/main/main.gd|.tscn       Level scene and controller: score, moves, goals, popups, feedback
scenes/ui/                      HUD, the start/win/lose popup and the revival popup
scenes/menus/                   Main menu and level select
tests/                          Headless test runner and suites
```

Board states and every legal transition (anything else is refused and logged):

```
IDLE -> SWAPPING -> MATCHING -> FALLING -> REFILLING -> MATCHING -> ... -> IDLE
                    MATCHING -> SWAPPING (no match: slide back) -> IDLE
                    MATCHING -> SHUFFLING (no move left) -> IDLE
```

Rules the code follows:

- Gems are pooled `Node2D` scenes; TileMaps are not used for anything that moves.
- All gem movement uses `create_tween()` with easing: `TRANS_BACK` swaps, `TRANS_BOUNCE`
  falls, `TRANS_ELASTIC` special pops.
- Input is accepted only in `IDLE` (and not while a popup is open).
- The Board calls methods on gems; gems never touch the Board and only emit signals back.
  The Board in turn only emits signals; the level controller turns them into score,
  particles, shake and sound.
- Before starting a gem animation the Board adds 1 to a counter, and each gem's
  finished signal takes 1 away. When the counter reaches 0 the state machine moves on.
- Gem and level data live in Resources, not in code.

Where this departs from the original spec, and why:

- **Input is read by the Board**, which works out the cell from the pointer position. Gems
  have no per-gem `gem_clicked` signal, because a swipe starts on one gem and ends over
  another, and `Area2D` picking runs on the physics tick, so press, drag and release can
  arrive out of order.
- **There is a sixth state, `SHUFFLING`**, for the "no moves left" shuffle.
- **AudioManager is an autoload**, not a node inside the level scene, so music keeps
  playing across the menu, level select and level scenes.
- **The background is drawn with `_draw()`** rather than a TileMap, since there is no
  tile art. Swap it for a `TileMapLayer` once there is.
