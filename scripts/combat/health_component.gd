class_name HealthComponent
extends Node

## Reusable health behaviour: damage, healing, clamping, death and revival.
##
## Anything that can be hurt owns one of these. It has no idea what a champion,
## a minion or a turret is.

signal health_changed(current: float, maximum: float)
signal damaged(amount: float, source: Node)
signal healed(amount: float)
signal died(source: Node)
signal revived()

var maximum: float = 100.0
var current: float = 100.0
## Fraction of incoming damage ignored, 0..0.95. Abilities may raise this.
var damage_reduction: float = 0.0
var invulnerable: bool = false

var _alive: bool = true


## Sets the health pool. [param keep_ratio] preserves the current percentage,
## which is what a temporary max-health buff wants.
func configure(new_maximum: float, keep_ratio: bool = false) -> void:
	var ratio_before := health_ratio()
	maximum = maxf(new_maximum, 1.0)
	current = maximum * ratio_before if keep_ratio else maximum
	current = clampf(current, 0.0, maximum)
	_alive = current > 0.0
	health_changed.emit(current, maximum)


## Returns the damage actually applied after reduction and clamping.
func apply_damage(amount: float, source: Node = null) -> float:
	if not _alive or invulnerable or amount <= 0.0:
		return 0.0
	var applied := amount * (1.0 - clampf(damage_reduction, 0.0, 0.95))
	applied = minf(applied, current)
	current = clampf(current - applied, 0.0, maximum)
	damaged.emit(applied, source)
	health_changed.emit(current, maximum)
	if current <= 0.0:
		_alive = false
		died.emit(source)
	return applied


func heal(amount: float) -> float:
	if not _alive or amount <= 0.0:
		return 0.0
	var before := current
	current = clampf(current + amount, 0.0, maximum)
	var restored := current - before
	if restored > 0.0:
		healed.emit(restored)
		health_changed.emit(current, maximum)
	return restored


## Instantly removes the remaining health. Unlike [method apply_damage] this
## ignores damage reduction and invulnerability, because the developer kill
## commands and scripted deaths must always land.
func kill(source: Node = null) -> void:
	if not _alive:
		return
	var lethal := current
	current = 0.0
	_alive = false
	damaged.emit(lethal, source)
	health_changed.emit(current, maximum)
	died.emit(source)


func revive(ratio: float = 1.0) -> void:
	current = clampf(maximum * ratio, 1.0, maximum)
	_alive = true
	revived.emit()
	health_changed.emit(current, maximum)


func regenerate(rate: float, delta: float) -> void:
	if _alive and rate > 0.0 and current < maximum:
		heal(rate * delta)


func is_alive() -> bool:
	return _alive


func health_ratio() -> float:
	return 0.0 if maximum <= 0.0 else clampf(current / maximum, 0.0, 1.0)
