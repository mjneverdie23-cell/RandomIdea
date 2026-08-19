@tool
class_name ChampionLoadout
extends Resource

## Everything that defines a prototype champion: its stats and its four
## abilities. Swapping this resource swaps the champion — no code changes.

@export var display_name: String = "Prototype Champion"
@export var stats: UnitStats
## One [AbilityData] per slot (Q, E, R, F). Order does not matter; each
## resource carries its own slot index.
@export var abilities: Array[AbilityData] = []

@export_group("Respawn")
@export_range(0.5, 120.0, 0.5) var respawn_time: float = 8.0
## Health fraction restored on respawn.
@export_range(0.05, 1.0, 0.05) var respawn_health_ratio: float = 1.0

@export_group("Controls")
## How close a click has to land to an enemy to select it.
@export_range(0.5, 12.0, 0.1) var selection_radius: float = 3.5
## Walk towards a selected enemy that is out of attack range.
@export var chase_selected_target: bool = true
@export_range(0.0, 60.0, 0.5) var max_chase_distance: float = 26.0
@export_range(0.1, 10.0, 0.1) var recall_duration: float = 1.6

@export_group("AI")
## Acquisition range used when this loadout drives an AI champion.
@export_range(1.0, 60.0, 0.5) var ai_aggro_range: float = 16.0
