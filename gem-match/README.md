# Gem Match

A 2D gem-themed match-3 puzzle game in **Godot 4** (GDScript), built in five phases.
This folder is its own Godot project and is separate from Raptor Strike at the repository root.

```bash
# Open gem-match/project.godot in the Godot 4.4+ editor once (this registers the class_names), then press F5.
godot --editor --path gem-match
# Headless tests (exit code 0 = all passed):
godot --headless --path gem-match -s res://tests/test_runner.gd
```

## Build status

| Phase | Scope | State |
|---|---|---|
| 1 | Gem resource and scene, grid array, state machine, tap/swipe input, swapping | **Done** |
| 2 | Match detection, clearing, gravity, refill, cascades | **Done** |
| 3 | Special gems, screen shake, particles | Planned |
| 4 | HUD, levels, menus, save/load | Planned |
| 5 | Shuffle when no moves are left, audio, final polish | Planned |

## Controls

- **Swipe** a gem towards a neighbour, or **tap** a gem and then tap one of its neighbours.
- Tap the selected gem again, tap outside the board, or right-click to deselect.

## Layout

```
resources/gem_type.gd          GemType Resource (id, colour, texture, points, placeholder shape)
resources/gems/*.tres          Ruby, Sapphire, Emerald, Topaz, Amethyst, Diamond
scenes/gem/gem.gd|.tscn        Gem: visuals and tweens only; reports finished animations with signals
scenes/board/board.gd|.tscn    Board: grid array, state machine, input, swap logic
scenes/board/gem_pool.gd       Object pool: gems are recycled, never freed during play
scenes/board/match_finder.gd   Pure match detection on a grid of colour ids (lines of 3/4/5, L/T/+ shapes)
scenes/board/board_top_mask.gd Hides refill gems until they drop into the grid
tests/                         Headless test runner and suites
scenes/board/board_background.gd  Static checkerboard behind the gems
scenes/main/main.tscn          Main scene: Background, Board, UI_Layer, AudioManager
scenes/ui/state_label.gd       Debug label showing the Board state
```

## Rules the code follows

- Gems are pooled `Node2D` scenes. TileMaps are for static background art only.
- All movement uses `create_tween()` with easing.
- The Board is an `enum` state machine (`IDLE, SWAPPING, MATCHING, FALLING, REFILLING`).
  Every legal transition is listed in `Board.TRANSITIONS`, and input is accepted only in `IDLE`.
- The Board calls methods on gems; gems never touch the Board and only emit signals back.
- Gem data comes from `GemType` resources, not from constants in code.
