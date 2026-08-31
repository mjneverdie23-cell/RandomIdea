## Bot behaviour tuning.
##
## Difficulty is a set of multipliers, not a separate code path: bots drive the
## exact same Intent a player produces.
class_name BotConfig
extends Resource

@export var enabled: bool = true
## Fill both teams up to GameConfig.team_size with bots.
@export var fill_teams: bool = true
@export var default_difficulty: StringName = &"NORMAL"

@export_group("Difficulty: aim")
## Radians per second the bot can turn while tracking a target.
@export var aim_turn_rate: float = 4.5
## Random aim error in degrees.
@export var aim_error: float = 2.2
## Delay before a bot reacts to a newly spotted enemy.
@export var reaction_time: float = 0.3
@export var fire_burst_min: float = 0.2
@export var fire_burst_max: float = 0.6
## How far a bot can notice an enemy.
@export var view_distance: float = 75.0
## How well it leads a moving target (0..1).
@export var accuracy_moving: float = 0.7

@export_group("Behaviour")
## Vision cone in radians.
@export var field_of_view: float = 2.35
## Seconds a bot remembers a target after losing sight of it.
@export var target_memory: float = 2.5
## Chance an attacking bot picks site B on a two-site map.
@export var site_b_preference: float = 0.5
## Money a bot keeps in reserve rather than spending.
@export var save_threshold: int = 1500
@export var think_interval: float = 0.25
## Strafe amount while fighting. 0 disables strafing.
@export var combat_strafe: float = 0.8

## Returns a copy with the named difficulty applied. Add tiers here.
func with_difficulty(difficulty: StringName) -> BotConfig:
	var copy: BotConfig = duplicate()
	match difficulty:
		&"EASY":
			copy.aim_turn_rate = 2.2
			copy.aim_error = 4.5
			copy.reaction_time = 0.55
			copy.fire_burst_min = 0.15
			copy.fire_burst_max = 0.4
			copy.view_distance = 55.0
			copy.accuracy_moving = 0.5
		&"HARD":
			copy.aim_turn_rate = 7.5
			copy.aim_error = 1.1
			copy.reaction_time = 0.16
			copy.fire_burst_min = 0.3
			copy.fire_burst_max = 0.9
			copy.view_distance = 95.0
			copy.accuracy_moving = 0.85
		_:
			pass # NORMAL - the exported defaults
	return copy
