class_name ScoreComponent
extends Node

## A champion's kills, deaths and assists.
##
## Nothing here decides anything: [RewardSystem] already works out who landed
## the killing blow and who was close enough to have helped, so the scoreboard
## reads the same verdict the gold and experience payouts do. Only champion
## kills count — a minion or a turret is worth gold, not a notch.
##
## Server-authoritative like the rest of the economy: the authority increments,
## clients adopt the replicated triple.

signal score_changed(kills: int, deaths: int, assists: int)

var kills: int = 0
var deaths: int = 0
var assists: int = 0


func add_kill() -> void:
	kills += 1
	score_changed.emit(kills, deaths, assists)


func add_death() -> void:
	deaths += 1
	score_changed.emit(kills, deaths, assists)


func add_assist() -> void:
	assists += 1
	score_changed.emit(kills, deaths, assists)


## The compact HUD form: "3 / 1 / 5".
func summary() -> String:
	return "%d / %d / %d" % [kills, deaths, assists]


func as_array() -> PackedInt32Array:
	return PackedInt32Array([kills, deaths, assists])


func apply_replicated(values: PackedInt32Array) -> void:
	if values.size() < 3:
		return
	if values[0] == kills and values[1] == deaths and values[2] == assists:
		return
	kills = values[0]
	deaths = values[1]
	assists = values[2]
	score_changed.emit(kills, deaths, assists)
