class_name LevelComponent
extends Node

## Turns XP thresholds into levels, stat growth and skill points.
##
## Stat growth is applied as one [StatsComponent] modifier that is replaced on
## every level, so nothing accumulates twice and a respawn cannot double it.

signal level_changed(level: int)
signal levelled_up(level: int, skill_points: int)
signal skill_points_changed(points: int)

const GROWTH_MODIFIER := "level_growth"

var data: ProgressionData
var level: int = 1
var skill_points: int = 0

var _unit: Unit
var _experience: ExperienceComponent
var _ability_progression: AbilityProgressionData


func setup(unit: Unit, experience: ExperienceComponent, progression: ProgressionData,
		abilities: AbilityProgressionData) -> void:
	_unit = unit
	_experience = experience
	data = progression if progression != null else ProgressionData.new()
	_ability_progression = abilities
	level = 1
	skill_points = _points_per_level()
	experience.threshold_reached.connect(_on_threshold_reached)
	experience.note_level(level)
	_apply_growth()
	level_changed.emit(level)
	skill_points_changed.emit(skill_points)


func _points_per_level() -> int:
	return _ability_progression.points_per_level if _ability_progression != null else 1


func is_max_level() -> bool:
	return level >= data.max_level


func spend_point() -> bool:
	if skill_points <= 0:
		return false
	skill_points -= 1
	skill_points_changed.emit(skill_points)
	return true


## Developer convenience: after unlocking everything for free there is nothing
## left to spend, so the counter should not claim otherwise.
func clear_points() -> void:
	if skill_points == 0:
		return
	skill_points = 0
	skill_points_changed.emit(skill_points)


func refund_point() -> void:
	skill_points += 1
	skill_points_changed.emit(skill_points)


## Authority-side level up, also used by the developer key.
func level_up() -> bool:
	if is_max_level():
		return false
	level += 1
	skill_points += _points_per_level()
	_experience.note_level(level)
	_apply_growth()
	level_changed.emit(level)
	skill_points_changed.emit(skill_points)
	levelled_up.emit(level, skill_points)
	return true


func _on_threshold_reached() -> void:
	level_up()


## Re-registers the growth modifier after something wiped the stat stack (a
## respawn clears buffs, and would otherwise take the champion's levels with
## them).
func reapply_growth() -> void:
	_apply_growth()


## One modifier, recomputed from the level, so it can never stack.
func _apply_growth() -> void:
	if _unit == null or _unit.stats == null:
		return
	var before := _unit.stats.value("max_health")
	_unit.stats.add_modifier(GROWTH_MODIFIER, data.growth_fields(level))
	# A level should feel like a level: hand over the health it just granted.
	var gained := _unit.stats.value("max_health") - before
	if gained > 0.0 and _unit.health != null and _unit.health.is_alive():
		_unit.health.heal(gained)


func apply_replicated(new_level: int, points: int) -> void:
	var changed := new_level != level
	level = new_level
	if changed:
		_experience.note_level(level)
		_apply_growth()
		level_changed.emit(level)
	if points != skill_points:
		skill_points = points
		skill_points_changed.emit(skill_points)
