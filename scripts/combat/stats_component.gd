class_name StatsComponent
extends Node

## Reads a [UnitStats] resource and layers timed modifiers on top of it.
##
## Behaviour scripts always ask this component for a value rather than reading
## the resource directly, so a buff, a debuff or a level-up can change the
## number without any behaviour script knowing about it.

signal stats_changed()
signal modifier_expired(id: String)

## Field name -> {"add": float, "mult": float}
const FIELDS := [
	"max_health", "health_regen", "damage_reduction",
	"attack_damage", "attack_range", "attack_speed", "projectile_speed", "projectile_size",
	"ability_power", "max_resource", "resource_regen", "move_speed", "vision_radius",
]

var base: UnitStats

## id -> {"fields": Dictionary, "remaining": float}
var _modifiers: Dictionary = {}


func setup(stats: UnitStats) -> void:
	base = stats if stats != null else UnitStats.new()
	stats_changed.emit()


func base_value(field: String) -> float:
	return float(base.get(field)) if base != null and field in base else 0.0


## Base value with every active modifier applied: (base + adds) * mults.
func value(field: String) -> float:
	var result := base_value(field)
	var multiplier := 1.0
	for id in _modifiers:
		var fields: Dictionary = _modifiers[id]["fields"]
		if not fields.has(field):
			continue
		var entry: Dictionary = fields[field]
		result += float(entry.get("add", 0.0))
		multiplier *= float(entry.get("mult", 1.0))
	return result * multiplier


## [param fields] maps a stat name to {"add": x} and/or {"mult": y}.
## A duration of 0 makes the modifier permanent until removed by id.
func add_modifier(id: String, fields: Dictionary, duration: float = 0.0) -> void:
	_modifiers[id] = {"fields": fields, "remaining": duration}
	set_process(true)
	stats_changed.emit()


func remove_modifier(id: String) -> void:
	if _modifiers.erase(id):
		stats_changed.emit()


func clear_modifiers() -> void:
	if not _modifiers.is_empty():
		_modifiers.clear()
		stats_changed.emit()


func has_modifier(id: String) -> bool:
	return _modifiers.has(id)


func modifier_remaining(id: String) -> float:
	return float(_modifiers[id]["remaining"]) if _modifiers.has(id) else 0.0


func active_modifier_ids() -> PackedStringArray:
	var out := PackedStringArray()
	for id in _modifiers:
		out.append(String(id))
	return out


func attack_interval() -> float:
	return 1.0 / maxf(value("attack_speed"), 0.01)


func _process(delta: float) -> void:
	if _modifiers.is_empty():
		set_process(false)
		return
	var expired: PackedStringArray = PackedStringArray()
	for id in _modifiers:
		var entry: Dictionary = _modifiers[id]
		if float(entry["remaining"]) <= 0.0:
			continue  # permanent
		entry["remaining"] = float(entry["remaining"]) - delta
		if float(entry["remaining"]) <= 0.0:
			expired.append(String(id))
	for id in expired:
		_modifiers.erase(id)
		modifier_expired.emit(id)
	if not expired.is_empty():
		stats_changed.emit()
