## Per-character ability slots: cooldowns, charges and activation.
##
## The abilities themselves are Resources (data/abilities/*.tres); this component
## only decides *whether* one may run and builds the context it runs with.
class_name AbilityComponent
extends RefCounted

class Slot extends RefCounted:
	var ability: AbilityData
	var cooldown_remaining: float = 0.0
	var charges_left: int = -1
	var active_remaining: float = 0.0

	func _init(p_ability: AbilityData) -> void:
		ability = p_ability
		charges_left = p_ability.charges_per_round

var character
var slots: Array[Slot] = []

func _init(p_character = null) -> void:
	character = p_character

## Rebuilds the slots from a class definition.
func setup(ability_ids: Array[StringName]) -> void:
	slots.clear()
	for id in ability_ids:
		var ability := Config.ability(id)
		if ability == null:
			push_warning("AbilityComponent: unknown ability '%s'" % id)
			continue
		slots.append(Slot.new(ability))

func count() -> int:
	return slots.size()

func get_slot(index: int) -> Slot:
	return slots[index] if index >= 0 and index < slots.size() else null

func is_ready(index: int) -> bool:
	var slot := get_slot(index)
	if slot == null:
		return false
	return slot.cooldown_remaining <= 0.0 and slot.charges_left != 0 and character.health.alive

func activate(index: int, ctx: AbilityContext) -> bool:
	if not is_ready(index):
		return false
	var slot := get_slot(index)
	slot.cooldown_remaining = slot.ability.cooldown
	if slot.charges_left > 0:
		slot.charges_left -= 1
	slot.active_remaining = slot.ability.duration
	slot.ability.activate(ctx)
	Events.ability_used.emit(character, slot.ability.id)
	return true

func update(delta: float, ctx: AbilityContext) -> void:
	for slot in slots:
		if slot.cooldown_remaining > 0.0:
			slot.cooldown_remaining = maxf(0.0, slot.cooldown_remaining - delta)
		if slot.active_remaining > 0.0:
			slot.active_remaining -= delta
			if slot.active_remaining <= 0.0:
				slot.ability.on_end(ctx)
				Events.ability_ended.emit(character, slot.ability.id)

func reset_for_round() -> void:
	for slot in slots:
		slot.cooldown_remaining = 0.0
		slot.active_remaining = 0.0
		slot.charges_left = slot.ability.charges_per_round

## Snapshot for the HUD.
func describe() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for i in slots.size():
		var slot := slots[i]
		out.append({
			"index": i,
			"id": slot.ability.id,
			"name": slot.ability.display_name,
			"description": slot.ability.description,
			"cooldown": slot.ability.cooldown,
			"cooldown_remaining": slot.cooldown_remaining,
			"ready": is_ready(i),
			"charges": slot.charges_left,
		})
	return out
