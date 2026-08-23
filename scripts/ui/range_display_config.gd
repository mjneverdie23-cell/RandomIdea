@tool
class_name RangeDisplayConfig
extends Resource

## Tuning for [RangeVisualizer]: who gets a ring, and what it looks like.
##
## The rules themselves live in the visualizer; the colours, thickness and the
## two opt-outs below are data so a designer can retune the readability of the
## map without touching gameplay code.

@export_group("Appearance")
@export_range(0.02, 2.0, 0.01) var thickness: float = 0.22
@export_range(0.0, 2.0, 0.01) var height: float = 0.22
@export var own_color: Color = Color(0.45, 0.78, 1.0, 0.9)
## Threatening enemy tower: the one ring the player never asked for.
@export var threat_color: Color = Color(0.95, 0.36, 0.30, 0.95)
@export var debug_ally_color: Color = Color(0.40, 0.70, 0.95, 0.55)
@export var debug_enemy_color: Color = Color(0.90, 0.50, 0.45, 0.55)

@export_group("Rules")
## An enemy tower reveals its ring once the local champion is inside it. Vision
## of the tower is required as well, so fog of war still hides a threat.
@export var show_threatening_enemy_towers: bool = true
## Slack added to the tower's real attack range before the ring appears, so a
## ring does not flicker while a champion walks the edge.
@export_range(0.0, 10.0, 0.1) var threat_hysteresis: float = 1.5
## Minions never get a ring outside the developer overlay: thirty rings hide
## the map they are meant to explain.
@export var show_minions_in_debug_only: bool = true
