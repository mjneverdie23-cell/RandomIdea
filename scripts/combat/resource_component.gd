class_name ResourceComponent
extends Node

## A champion's spendable ability resource — mana, energy, fury, whatever the
## final game calls it.
##
## Entirely optional and entirely data-driven: a unit whose [UnitStats] has
## [code]max_resource[/code] at zero never gets one, which is why minions and
## turrets have none and the HUD hides the bar for them. Ability costs live in
## [AbilityData], so making a champion resourceless is editing a .tres.

signal resource_changed(current: float, maximum: float)
signal spend_failed()

var current: float = 0.0
var maximum: float = 0.0
var regen: float = 0.0

var _stats: StatsComponent


func setup(stats: StatsComponent) -> void:
	_stats = stats
	maximum = stats.value("max_resource")
	regen = stats.value("resource_regen")
	current = maximum
	stats.stats_changed.connect(_on_stats_changed)
	resource_changed.emit(current, maximum)


func is_enabled() -> bool:
	return maximum > 0.0


func ratio() -> float:
	return 1.0 if maximum <= 0.0 else clampf(current / maximum, 0.0, 1.0)


func can_pay(cost: float) -> bool:
	return not is_enabled() or cost <= 0.0 or current >= cost


## Returns false and changes nothing when the champion cannot afford the cast.
func pay(cost: float) -> bool:
	if not is_enabled() or cost <= 0.0:
		return true
	if current < cost:
		spend_failed.emit()
		return false
	current -= cost
	resource_changed.emit(current, maximum)
	return true


func refill() -> void:
	current = maximum
	resource_changed.emit(current, maximum)


func regenerate(delta: float) -> void:
	if not is_enabled() or current >= maximum:
		return
	current = minf(current + regen * delta, maximum)
	resource_changed.emit(current, maximum)


## Levels and items change the pool; the fill keeps its proportion so a
## level-up never feels like a punishment.
func _on_stats_changed() -> void:
	var new_max := _stats.value("max_resource")
	regen = _stats.value("resource_regen")
	if is_equal_approx(new_max, maximum):
		return
	var proportion := ratio()
	maximum = new_max
	current = maximum * proportion
	resource_changed.emit(current, maximum)


func apply_replicated(value: float, cap: float) -> void:
	if is_equal_approx(value, current) and is_equal_approx(cap, maximum):
		return
	current = value
	maximum = cap
	resource_changed.emit(current, maximum)
