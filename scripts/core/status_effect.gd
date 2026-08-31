## A timed modifier applied to a character (ability buffs, slows, camouflage).
##
## Effects are additive data. EffectController folds every active effect into one
## multiplier set that movement, combat and the AI read, so a new ability never
## needs a new branch in those systems.
class_name StatusEffect
extends RefCounted

var id: StringName = &""
var duration: float = 0.0
var remaining: float = 0.0
## Any of: speed, damage_taken, damage_dealt, spread, gravity (floats, default 1.0)
## and invisible (bool).
var modifiers: Dictionary = {}
## Optional render hint ("shield", "camo", "charge"...).
var visual: StringName = &""
## Firing cancels the effect (camouflage).
var break_on_fire: bool = false
## Optional per-tick callback: func(character, delta, ctx) -> void
var tick_callback: Callable = Callable()

func _init(p_id: StringName = &"", p_duration: float = 0.0, p_modifiers: Dictionary = {}) -> void:
	id = p_id
	duration = p_duration
	remaining = p_duration
	modifiers = p_modifiers
