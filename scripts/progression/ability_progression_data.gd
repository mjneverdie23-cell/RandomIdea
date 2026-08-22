@tool
class_name AbilityProgressionData
extends Resource

## When each ability slot unlocks and how far it can be upgraded.
##
## Slots are indices matching [enum InputCommands.AbilitySlot] (Q, E, R, F), so
## reordering the HUD or rebinding keys changes nothing here.

## Level at which each slot may first take a point. Index = slot.
@export var unlock_levels: PackedInt32Array = PackedInt32Array([1, 2, 5, 3])
## Highest rank per slot. The ultimate is usually shorter than the rest.
@export var max_ranks: PackedInt32Array = PackedInt32Array([5, 5, 3, 5])
## Skill points granted per level, including level 1.
@export_range(0, 3, 1) var points_per_level: int = 1
## Each rank past the first scales the ability's damage by this much.
@export_range(0.0, 2.0, 0.05) var damage_per_rank: float = 0.35
## And shaves this fraction off its cooldown.
@export_range(0.0, 0.5, 0.01) var cooldown_reduction_per_rank: float = 0.08


func unlock_level(slot: int) -> int:
	return unlock_levels[slot] if slot >= 0 and slot < unlock_levels.size() else 1


func max_rank(slot: int) -> int:
	return max_ranks[slot] if slot >= 0 and slot < max_ranks.size() else 5


## Can a champion at [param level] holding [param rank] spend a point here?
func can_upgrade(slot: int, rank: int, level: int) -> bool:
	return level >= unlock_level(slot) and rank < max_rank(slot)


func damage_scale(rank: int) -> float:
	return 1.0 + damage_per_rank * float(maxi(rank - 1, 0))


func cooldown_scale(rank: int) -> float:
	return maxf(1.0 - cooldown_reduction_per_rank * float(maxi(rank - 1, 0)), 0.35)
