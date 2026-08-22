class_name ExperienceComponent
extends Node

## Accumulates XP against a [ProgressionData] curve.
##
## It knows nothing about levels beyond "this much is enough for the next one";
## [LevelComponent] listens and decides what a level means.

signal experience_gained(amount: float, reason: String)
signal experience_changed(into_level: float, needed: float)
signal threshold_reached()

var data: ProgressionData
## XP earned since the current level began.
var into_level: float = 0.0
var total: float = 0.0

var _level: int = 1


func setup(progression: ProgressionData) -> void:
	data = progression if progression != null else ProgressionData.new()
	into_level = 0.0
	total = 0.0
	_level = 1
	experience_changed.emit(into_level, needed())


## XP still required for the next level; 0 at the cap.
func needed() -> float:
	return data.xp_to_next(_level) if data != null else 0.0


func ratio() -> float:
	var target := needed()
	return 1.0 if target <= 0.0 else clampf(into_level / target, 0.0, 1.0)


func add(amount: float, reason: String = "") -> void:
	if amount <= 0.0 or data == null:
		return
	total += amount
	experience_gained.emit(amount, reason)
	if needed() <= 0.0:
		into_level = 0.0
		experience_changed.emit(into_level, 0.0)
		return
	into_level += amount
	experience_changed.emit(into_level, needed())
	while needed() > 0.0 and into_level >= needed():
		into_level -= needed()
		threshold_reached.emit()
	experience_changed.emit(into_level, needed())


## Told by [LevelComponent] once a level has actually been taken.
func note_level(level: int) -> void:
	_level = level
	experience_changed.emit(into_level, needed())


func apply_replicated(value: float, level: int) -> void:
	_level = level
	if is_equal_approx(value, into_level):
		return
	into_level = value
	experience_changed.emit(into_level, needed())
