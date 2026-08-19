class_name AbilityComponent
extends Node

## Owns a unit's ability slots: cast validation, cooldowns and dispatch.
##
## It never knows what an ability actually does — that lives in the
## [AbilityData] resource, so abilities are data, not code paths here.

signal ability_cast(slot: int, ability: AbilityData)
signal ability_failed(slot: int, reason: String)
signal cooldown_changed(slot: int, remaining: float, total: float)

var unit: Node3D
## Index is the slot; empty entries are allowed.
var abilities: Array = []

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
	reset_cooldowns()


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
	var ability := ability_for(slot)
	return ability.cooldown if ability != null else 0.0


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
	if cooldown_remaining(slot) > 0.0:
		ability_failed.emit(slot, "cooldown")
		return false
	if not ability.can_cast(unit, aim_point):
		ability_failed.emit(slot, "invalid")
		return false
	if not ability.execute(unit, aim_point):
		ability_failed.emit(slot, "failed")
		return false
	_cooldowns[slot] = ability.cooldown
	cooldown_changed.emit(slot, _cooldowns[slot], ability.cooldown)
	ability_cast.emit(slot, ability)
	return true


func reset_cooldowns() -> void:
	for slot in _cooldowns.size():
		_cooldowns[slot] = 0.0
		cooldown_changed.emit(slot, 0.0, total_cooldown(slot))
