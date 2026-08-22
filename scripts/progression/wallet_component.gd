class_name WalletComponent
extends Node

## A champion's gold. Server-authoritative: only the authority ever calls
## [method add] or [method spend], and clients adopt the replicated number.

signal gold_changed(current: float)
signal gold_earned(amount: float, reason: String)
signal purchase_failed(reason: String)

var gold: float = 0.0
## Gold per second while alive. Set from [RewardConfig].
var passive_rate: float = 0.0

var _fraction: float = 0.0


func setup(starting_gold: float, passive_gold_per_second: float) -> void:
	gold = starting_gold
	passive_rate = passive_gold_per_second
	gold_changed.emit(gold)


func add(amount: float, reason: String = "") -> void:
	if amount <= 0.0:
		return
	gold += amount
	gold_earned.emit(amount, reason)
	gold_changed.emit(gold)


func can_afford(cost: float) -> bool:
	return gold >= cost


## Returns false and changes nothing when the champion cannot pay.
func spend(cost: float) -> bool:
	if cost < 0.0 or not can_afford(cost):
		purchase_failed.emit("not enough gold")
		return false
	gold -= cost
	gold_changed.emit(gold)
	return true


## Trickle income. Only the authority ticks this.
func tick(delta: float) -> void:
	if passive_rate <= 0.0:
		return
	_fraction += passive_rate * delta
	if _fraction >= 1.0:
		var whole := floorf(_fraction)
		_fraction -= whole
		add(whole, "passive")


## Adopts the authority's number without re-emitting an earn event.
func apply_replicated(value: float) -> void:
	if is_equal_approx(value, gold):
		return
	gold = value
	gold_changed.emit(gold)
