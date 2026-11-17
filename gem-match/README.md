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
- A swap must make a line of 3 or more, otherwise the gems slide back.
- Reach the level's score and collect goals before the moves run out. Chain reactions
  multiply points (x2, x3, ...), and moves left over at the end are worth bonus points.
- Escape (or the Android back button) goes back one screen.

| Match | Makes | Looks like | When it goes off |
|---|---|---|---|
| 4 in a line | Striped | white bar | clears its row (horizontal match) or column (vertical match) |
| L, T or + shape | Wrapped | white square | clears the 3x3 area around it |
| 5 in a line | Prism | white gem, dark centre | swap it with a gem to clear every gem of that colour |

Swapping two specials sets both off; two prisms clear the whole board. Any special caught
in a blast goes off too. If no move is possible, the board shuffles itself. After a few
seconds without input, a possible move wiggles as a hint.

## Changing things

| To change | Edit |
|---|---|
| A gem's colour, shape, points or art | `resources/gems/*.tres` (`GemType`). Set `texture` to replace the polygon |
| Levels (size, gems, moves, star scores, goals) | `levels/level_XX.tres` (`LevelData`); order in `levels/catalog.tres` |
| Animation timings, swipe distance, hint delay | Inspector on the Board node, `scenes/board/board.tscn` |
| Scoring (cascade multiplier, move bonus) | `scenes/main/main.gd` |
| Sounds and music | `autoload/audio_manager.gd` (`_build_sounds`, `_build_music`) |
| Volumes | `default_bus_layout.tres` (Music and SFX buses) |

## Architecture

```
autoload/game_state.gd          Autoload: current level, progress + settings saved as JSON in user://, scene changes, back navigation
autoload/audio_manager.gd       Autoload: Music/SFX buses, synthesised sounds, button clicks
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
scenes/ui/                      HUD and the start/win/lose popup
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
