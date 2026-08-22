class_name AbilityComponent
extends Node

## Owns a unit's ability slots: cast validation, cooldowns and dispatch.
##
## It never knows what an ability actually does — that lives in the
## [AbilityData] resource, so abilities are data, not code paths here.

signal ability_cast(slot: int, ability: AbilityData)
signal ability_failed(slot: int, reason: String)
signal cooldown_changed(slot: int, remaining: float, total: float)
signal ranks_changed()

var unit: Node3D
## Index is the slot; empty entries are allowed.
var abilities: Array = []
## Rank 0 means locked. Points are spent through [method upgrade].
var ranks: PackedInt32Array = PackedInt32Array()
var progression: AbilityProgressionData

var _cooldowns: PackedFloat32Array = PackedFloat32Array()


func setup(owner_unit: Node3D, ability_list: Array) -> void:
	unit = owner_unit
	abilities = []
	abilities.resize(InputCommands.ABILITY_NAMES.size())
	for ability in ability_list:
		if ability == null:
			continue
		var slot: int = clampi(ability.slot, 0, abilities.size() - 1)
		abilities[slot] = ability
	_cooldowns = PackedFloat32Array()
	_cooldowns.resize(abilities.size())
	ranks = PackedInt32Array()
	ranks.resize(abilities.size())
	reset_cooldowns()


func setup_progression(data: AbilityProgressionData) -> void:
	progression = data
	ranks_changed.emit()


# --- ranks -------------------------------------------------------------------

func rank(slot: int) -> int:
	return ranks[slot] if slot >= 0 and slot < ranks.size() else 0


func is_unlocked(slot: int) -> bool:
	return rank(slot) > 0


func max_rank(slot: int) -> int:
	return progression.max_rank(slot) if progression != null else 5


## The level at which this slot may first take a point.
func unlock_level(slot: int) -> int:
	return progression.unlock_level(slot) if progression != null else 1


## Can a champion at [param level] spend a point here right now?
func can_upgrade(slot: int, level: int) -> bool:
	if ability_for(slot) == null:
		return false
	if progression == null:
		return rank(slot) < 5
	return progression.can_upgrade(slot, rank(slot), level)


## Authority-side rank increase. Callers spend the skill point themselves.
func upgrade(slot: int) -> bool:
	if slot < 0 or slot >= ranks.size() or ability_for(slot) == null:
		return false
	ranks[slot] += 1
	ranks_changed.emit()
	return true


func unlock_all(level: int) -> int:
	var granted := 0
	for slot in ranks.size():
		while can_upgrade(slot, level):
			ranks[slot] += 1
			granted += 1
	if granted > 0:
		ranks_changed.emit()
	return granted


## Rank scaling for the damage an ability deals this cast.
func damage_scale(slot: int) -> float:
	return progression.damage_scale(rank(slot)) if progression != null else 1.0


func cooldown_for(slot: int) -> float:
	var ability := ability_for(slot)
	if ability == null:
		return 0.0
	var scale := progression.cooldown_scale(rank(slot)) if progression != null else 1.0
	return ability.cooldown * scale


func apply_replicated_ranks(values: PackedInt32Array) -> void:
	var changed := false
	for slot in mini(values.size(), ranks.size()):
		if ranks[slot] != values[slot]:
			ranks[slot] = values[slot]
			changed = true
	if changed:
		ranks_changed.emit()


func tick(delta: float) -> void:
	for slot in _cooldowns.size():
		if _cooldowns[slot] <= 0.0:
			continue
		_cooldowns[slot] = maxf(_cooldowns[slot] - delta, 0.0)
		cooldown_changed.emit(slot, _cooldowns[slot], total_cooldown(slot))


func ability_for(slot: int) -> AbilityData:
	if slot < 0 or slot >= abilities.size():
		return null
	return abilities[slot]


func cooldown_remaining(slot: int) -> float:
	return _cooldowns[slot] if slot >= 0 and slot < _cooldowns.size() else 0.0


func total_cooldown(slot: int) -> float:
	return cooldown_for(slot)


func cooldown_ratio(slot: int) -> float:
	var total := total_cooldown(slot)
	return 0.0 if total <= 0.0 else clampf(cooldown_remaining(slot) / total, 0.0, 1.0)


func is_ready(slot: int) -> bool:
	return ability_for(slot) != null and cooldown_remaining(slot) <= 0.0


func try_cast(slot: int, aim_point: Vector3) -> bool:
	var ability := ability_for(slot)
	if ability == null:
		ability_failed.emit(slot, "empty")
		return false
	if not unit.is_alive():
		ability_failed.emit(slot, "dead")
		return false
	if not is_unlocked(slot):
		ability_failed.emit(slot, "locked")
		return false
	if cooldown_remaining(slot) > 0.0:
		ability_failed.emit(slot, "cooldown")
		return false
	if unit.resource_pool != null and not unit.resource_pool.can_pay(ability.resource_cost):
		ability_failed.emit(slot, "no resource")
		return false
	if not ability.can_cast(unit, aim_point):
		ability_failed.emit(slot, "invalid")
		return false
	if not ability.execute(unit, aim_point):
		ability_failed.emit(slot, "failed")
		return false
	if unit.resource_pool != null:
		unit.resource_pool.pay(ability.resource_cost)
	_cooldowns[slot] = cooldown_for(slot)
	cooldown_changed.emit(slot, _cooldowns[slot], cooldown_for(slot))
	ability_cast.emit(slot, ability)
	return true


## Adopts the authority's cooldowns. A client never runs the timers itself, so
## its ability bar always agrees with what the server will actually allow.
func apply_replicated_cooldowns(values: PackedFloat32Array) -> void:
	for slot in mini(values.size(), _cooldowns.size()):
		if is_equal_approx(_cooldowns[slot], values[slot]):
			continue
		_cooldowns[slot] = values[slot]
		cooldown_changed.emit(slot, _cooldowns[slot], total_cooldown(slot))


func snapshot_cooldowns() -> PackedFloat32Array:
	return _cooldowns.duplicate()


func reset_cooldowns() -> void:
	for slot in _cooldowns.size():
		_cooldowns[slot] = 0.0
		cooldown_changed.emit(slot, 0.0, total_cooldown(slot))
