@tool
class_name ProgressionData
extends Resource

## The XP curve and what a level is worth.
##
## Levelling is entirely described here: no behaviour script knows how much XP
## a level costs or what it grants. Retuning progression is editing one .tres.

@export_range(2, 30, 1) var max_level: int = 12
## XP needed to reach level 2.
@export_range(10.0, 5000.0, 5.0) var base_xp: float = 180.0
## Each level costs this much more than the last.
@export_range(1.0, 2.0, 0.01) var xp_growth: float = 1.18

@export_group("Per-level growth")
@export_range(0.0, 500.0, 1.0) var health_per_level: float = 90.0
@export_range(0.0, 100.0, 0.5) var attack_damage_per_level: float = 6.0
## Multiplicative: 0.04 is +4% attack speed per level.
@export_range(0.0, 0.5, 0.005) var attack_speed_per_level: float = 0.035
@export_range(0.0, 200.0, 1.0) var ability_power_per_level: float = 8.0
@export_range(0.0, 20.0, 0.1) var health_regen_per_level: float = 0.4
@export_range(0.0, 200.0, 1.0) var resource_per_level: float = 20.0


## XP required to go from [param level] to the next one.
func xp_to_next(level: int) -> float:
	if level >= max_level:
		return 0.0
	return roundf(base_xp * pow(xp_growth, float(level - 1)))


## Total XP a champion has earned by the time it reaches [param level].
func total_xp_for_level(level: int) -> float:
	var total := 0.0
	for l in range(1, mini(level, max_level)):
		total += xp_to_next(l)
	return total


## Stat modifier fields for a champion that has reached [param level].
func growth_fields(level: int) -> Dictionary:
	var steps := float(maxi(level - 1, 0))
	return {
		"max_health": {"add": health_per_level * steps},
		"health_regen": {"add": health_regen_per_level * steps},
		"attack_damage": {"add": attack_damage_per_level * steps},
		"attack_speed": {"mult": 1.0 + attack_speed_per_level * steps},
		"ability_power": {"add": ability_power_per_level * steps},
		"max_resource": {"add": resource_per_level * steps},
	}
