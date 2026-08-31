## Timed status effects (ability buffs, slows, camouflage).
##
## Every active effect is folded into one multiplier set that movement, combat
## and the AI read, so adding an ability never means adding a branch to those
## systems - only a new StatusEffect with the right modifier keys.
class_name EffectComponent
extends RefCounted

const NEUTRAL := {
	"speed": 1.0,
	"damage_taken": 1.0,
	"damage_dealt": 1.0,
	"spread": 1.0,
	"gravity": 1.0,
	"invisible": false,
}

var character
var active: Array[StatusEffect] = []
var modifiers: Dictionary = NEUTRAL.duplicate()

func _init(p_character = null) -> void:
	character = p_character

## Re-applying an effect refreshes it rather than stacking duplicates.
func add(effect: StatusEffect) -> StatusEffect:
	for existing in active:
		if existing.id == effect.id:
			existing.remaining = effect.duration
			existing.modifiers = effect.modifiers
			_recompute()
			return existing
	active.append(effect)
	_recompute()
	return effect

func remove(effect_id: StringName) -> bool:
	for i in range(active.size() - 1, -1, -1):
		if active[i].id == effect_id:
			active.remove_at(i)
			_recompute()
			return true
	return false

func has(effect_id: StringName) -> bool:
	for effect in active:
		if effect.id == effect_id:
			return true
	return false

func clear() -> void:
	active.clear()
	_recompute()

## Called when the owner fires; cancels effects flagged break_on_fire.
func notify_fired() -> void:
	var broken: Array[StringName] = []
	for effect in active:
		if effect.break_on_fire:
			broken.append(effect.id)
	for id in broken:
		remove(id)

func update(delta: float, ctx: AbilityContext) -> void:
	if active.is_empty():
		return
	var dirty := false
	for i in range(active.size() - 1, -1, -1):
		var effect := active[i]
		if effect.tick_callback.is_valid():
			effect.tick_callback.call(character, delta, ctx)
		# duration 0 means "instant": such effects are gone on the next tick.
		effect.remaining -= delta
		if effect.remaining <= 0.0:
			active.remove_at(i)
			dirty = true
	if dirty:
		_recompute()

func speed() -> float: return modifiers["speed"]
func damage_taken() -> float: return modifiers["damage_taken"]
func damage_dealt() -> float: return modifiers["damage_dealt"]
func spread() -> float: return modifiers["spread"]
func gravity() -> float: return modifiers["gravity"]
func is_invisible() -> bool: return modifiers["invisible"]

func _recompute() -> void:
	var result := NEUTRAL.duplicate()
	for effect in active:
		for key in effect.modifiers:
			if key == "invisible":
				if effect.modifiers[key]:
					result["invisible"] = true
			elif result.has(key):
				result[key] *= float(effect.modifiers[key])
	modifiers = result
