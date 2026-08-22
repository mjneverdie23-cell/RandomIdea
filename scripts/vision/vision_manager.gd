class_name VisionManager
extends Node

## Autoloaded vision authority, registered as "Vision".
##
## Every tick the authority asks one question per unit per team — "can team T
## see this?" — and stores the answer in a [VisibilityState]. Everything that
## needs to know (target acquisition, the minimap, the HUD, unit rendering)
## reads that one answer, so gameplay and presentation can never disagree about
## who is hidden.
##
## The rule, in full: a unit is visible to an enemy team when some source of
## that team has it in range, and either the unit is not standing in a bush, or
## the source is in the same bush, or the source reveals bushes (a ward).
## Structures are subject to the same rule as anything else, which is what
## makes "you are inside an enemy tower's range but cannot see it" a real state
## the range visualizer has to respect. The minimap still draws every tower,
## because where a building stands is map knowledge rather than vision.

signal visibility_changed()

## How often the authority recomputes. Vision does not need a physics tick.
const UPDATE_INTERVAL := 0.12

var state := VisibilityState.new()

var _sources: Array = []
var _zones: Array = []
var _timer: float = 0.0
var _enabled: bool = true


func _ready() -> void:
	process_priority = -10


# --- registration ------------------------------------------------------------

func register_source(source: VisionSource) -> void:
	if source != null and not _sources.has(source):
		_sources.append(source)


func unregister_source(source: VisionSource) -> void:
	_sources.erase(source)


func register_zone(zone: VisionZone) -> void:
	if zone != null and not _zones.has(zone):
		_zones.append(zone)


func unregister_zone(zone: VisionZone) -> void:
	_zones.erase(zone)


## Dropped between matches so a reloaded scene starts clean.
func reset() -> void:
	_sources.clear()
	_zones.clear()
	state.clear()
	state.set_revealed(MapEnums.Team.A, false)
	state.set_revealed(MapEnums.Team.B, false)


func zones() -> Array:
	return _zones.duplicate()


func zone_by_id(id: String) -> VisionZone:
	for zone in _zones:
		if is_instance_valid(zone) and zone.zone_id == id:
			return zone
	return null


func source_count() -> int:
	return _sources.size()


# --- queries -----------------------------------------------------------------

## The bush a world point is standing in, or null.
func zone_at(point: Vector3) -> VisionZone:
	for zone in _zones:
		if is_instance_valid(zone) and zone.contains(point):
			return zone
	return null


func is_in_bush(unit: Node3D) -> bool:
	return zone_at(unit.global_position) != null


## The single question the rest of the game asks.
func is_visible_to(unit: Node3D, team: int) -> bool:
	return state.is_visible_to(unit, team)


## Enemies of [param team] that it can actually see. Target acquisition, the
## minimap and the HUD all go through this rather than [method BattleRegistry.enemies_of].
func visible_enemies_of(team: int) -> Array:
	var out: Array = []
	for unit in Battle.enemies_of(team):
		if is_visible_to(unit, team):
			out.append(unit)
	return out


func reveal_for(team: int, revealed: bool) -> void:
	state.set_revealed(team, revealed)
	visibility_changed.emit()


func describe() -> Dictionary:
	return {
		"sources": _sources.size(),
		"bushes": _zones.size(),
		"tracked": state.tracked_count(),
		"revealed_a": state.is_revealed(MapEnums.Team.A),
		"revealed_b": state.is_revealed(MapEnums.Team.B),
	}


# --- authority pass ----------------------------------------------------------

func _process(delta: float) -> void:
	if not _enabled or not Net.is_authority():
		return
	_timer -= delta
	if _timer > 0.0:
		return
	_timer = UPDATE_INTERVAL
	recompute()


## Recomputes every mask. Cheap enough at a 1v1 scale to do outright rather
## than incrementally, and far easier to reason about.
func recompute() -> void:
	_prune()
	var changed := false
	for unit in Battle.all():
		if unit.net_id <= 0:
			continue
		var mask := 0
		for team in [MapEnums.Team.A, MapEnums.Team.B]:
			if unit.team == team or _team_can_see(unit, team):
				mask |= VisionTypes.team_bit(team)
		if state.mask_for(unit.net_id) != mask:
			changed = true
		state.set_mask(unit.net_id, mask)
	if changed:
		visibility_changed.emit()


func _team_can_see(unit: Node3D, team: int) -> bool:
	var unit_zone := zone_at(unit.global_position)
	var unit_position := Vector2(unit.global_position.x, unit.global_position.z)
	for source in _sources:
		if not is_instance_valid(source) or not source.active or source.team != team:
			continue
		if source.ground_position().distance_to(unit_position) > source.radius:
			continue
		if unit_zone == null or source.reveals_bushes:
			return true
		# Standing in the same bush is the classic exception: you see whoever
		# is in there with you.
		if zone_at(source.global_position) == unit_zone:
			return true
	return false


## Applies a mask that arrived from the authority.
func apply_replicated_mask(unit_id: int, mask: int) -> void:
	state.set_mask(unit_id, mask)


func _prune() -> void:
	_sources = _sources.filter(func(s: Variant) -> bool: return is_instance_valid(s))
	_zones = _zones.filter(func(z: Variant) -> bool: return is_instance_valid(z))
