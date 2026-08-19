class_name BattleRegistry
extends Node

## Autoloaded directory of every live combat unit, registered as "Battle".
##
## Target acquisition, area abilities and the debug overlay all ask this
## registry instead of scanning the scene tree, so units never need a reference
## to each other, to the game director or to the map.

signal unit_registered(unit: Node3D)
signal unit_unregistered(unit: Node3D)
signal unit_died(unit: Node3D, source: Node)

var _units: Array = []


func register(unit: Node3D) -> void:
	if unit == null or _units.has(unit):
		return
	_units.append(unit)
	unit_registered.emit(unit)


func unregister(unit: Node3D) -> void:
	if not _units.has(unit):
		return
	_units.erase(unit)
	unit_unregistered.emit(unit)


func report_death(unit: Node3D, source: Node) -> void:
	unit_died.emit(unit, source)


func all() -> Array:
	_prune()
	return _units.duplicate()


func of_team(team: int) -> Array:
	var out: Array = []
	for unit in all():
		if unit.team == team and unit.is_alive():
			out.append(unit)
	return out


func enemies_of(team: int) -> Array:
	var out: Array = []
	for unit in all():
		if unit.team != team and unit.is_alive():
			out.append(unit)
	return out


func count_of(team: int, kind: int) -> int:
	var total := 0
	for unit in all():
		if unit.team == team and unit.kind == kind and unit.is_alive():
			total += 1
	return total


## Nearest living enemy within [param max_range]. When [param kind_priority] is
## given, a unit of an earlier kind always beats a closer unit of a later kind,
## which is how turrets prefer minions over champions.
func find_target(from: Vector3, team: int, max_range: float, kind_priority: Array = []) -> Node3D:
	var best: Node3D = null
	var best_rank := 1 << 30
	var best_distance := INF
	for unit in enemies_of(team):
		var distance := from.distance_to(unit.global_position)
		if distance > max_range:
			continue
		var rank: int = kind_priority.find(unit.kind) if not kind_priority.is_empty() else 0
		if rank < 0:
			rank = kind_priority.size()
		if rank < best_rank or (rank == best_rank and distance < best_distance):
			best = unit
			best_rank = rank
			best_distance = distance
	return best


## Closest enemy to a world point, used to turn a click/tap into a selection.
func pick_enemy_near(point: Vector3, team: int, radius: float) -> Node3D:
	var best: Node3D = null
	var best_distance := radius
	for unit in enemies_of(team):
		var offset: Vector3 = unit.global_position - point
		offset.y = 0.0
		var distance: float = offset.length() - unit.select_radius()
		if distance <= best_distance:
			best = unit
			best_distance = distance
	return best


## Every living enemy inside a sphere, used by area abilities.
func enemies_in_radius(center: Vector3, team: int, radius: float) -> Array:
	var out: Array = []
	for unit in enemies_of(team):
		if center.distance_to(unit.global_position) <= radius + unit.select_radius():
			out.append(unit)
	return out


func _prune() -> void:
	var filtered: Array = []
	for unit in _units:
		if is_instance_valid(unit):
			filtered.append(unit)
	_units = filtered
