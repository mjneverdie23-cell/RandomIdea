@tool
class_name NameplateConfig
extends Resource

## What the world-space unit plates show, and what they look like.
##
## These are the two things a player reads mid-fight — how hurt something is,
## and who it is — so they are normal presentation, not developer output. The
## developer overlay still draws internal identifiers and state machines on top
## when it is on.

@export_group("What shows")
@export var champion_health: bool = true
@export var champion_name: bool = true
@export var minion_health: bool = true
## Turrets and the nexus are units you shoot at, so they read like ones.
@export var structure_health: bool = true

@export_group("Geometry")
@export_range(0.4, 8.0, 0.1) var champion_bar_width: float = 2.6
@export_range(0.4, 8.0, 0.1) var minion_bar_width: float = 1.5
@export_range(0.4, 8.0, 0.1) var structure_bar_width: float = 3.4
@export_range(0.05, 1.0, 0.01) var bar_height: float = 0.24
## Clearance between the top of the unit's body and its bar.
@export_range(0.0, 6.0, 0.1) var height_above_unit: float = 0.9
@export_range(8, 96, 1) var name_font_size: int = 30
@export_range(0.001, 0.05, 0.001) var name_pixel_size: float = 0.009

@export_group("Colours")
@export var ally_fill: Color = Color(0.36, 0.82, 0.42)
@export var enemy_fill: Color = Color(0.90, 0.34, 0.30)
@export var low_fill: Color = Color(0.95, 0.72, 0.20)
@export var background: Color = Color(0.05, 0.06, 0.08, 1.0)
@export var ally_name: Color = Color(0.70, 0.88, 1.0)
@export var enemy_name: Color = Color(1.0, 0.72, 0.66)
## Below this health fraction the bar switches to [member low_fill].
@export_range(0.0, 1.0, 0.05) var low_health_ratio: float = 0.3

@export_group("Culling")
## Plates further than this from the camera are hidden; a full lane of them at
## map-overview zoom is noise, not information. Zero disables the cull.
@export_range(0.0, 400.0, 5.0) var max_distance: float = 70.0
## Health does not need a per-frame redraw.
@export_range(0.02, 1.0, 0.01) var refresh: float = 0.08
