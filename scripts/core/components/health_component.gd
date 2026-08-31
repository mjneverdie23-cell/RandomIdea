## Health, armour and the armour damage model.
##
## Deliberately independent of Character so a destructible prop or an objective
## could reuse it unchanged.
class_name HealthComponent
extends RefCounted

var max_health: float = 100.0
var health: float = 100.0
var max_armor: float = 100.0
var armor: float = 0.0
var has_helmet: bool = false
var alive: bool = true

## How much of the damage armour absorbs is taken off the armour value.
var armor_damage_fraction: float = 0.5
## Headshot damage reduction while a helmet is worn.
var helmet_headshot_reduction: float = 0.4

func setup(class_data: CharacterClassData, config: GameConfig) -> void:
	max_health = class_data.max_health
	max_armor = class_data.max_armor
	armor_damage_fraction = config.armor_damage_fraction
	helmet_headshot_reduction = config.helmet_headshot_reduction
	reset(class_data)

func reset(class_data: CharacterClassData) -> void:
	max_health = class_data.max_health
	max_armor = class_data.max_armor
	health = max_health
	armor = class_data.starting_armor
	has_helmet = class_data.has_helmet_by_default
	alive = true

## Applies damage through the armour model.
## Returns {"health_damage": float, "armor_damage": float, "died": bool}.
func take_damage(raw_damage: float, armor_penetration: float = 1.0, is_headshot: bool = false) -> Dictionary:
	if not alive:
		return {"health_damage": 0.0, "armor_damage": 0.0, "died": false}

	var damage := raw_damage
	# A helmet blunts headshots specifically, on top of normal armour.
	if is_headshot and has_helmet and armor > 0.0:
		damage *= 1.0 - helmet_headshot_reduction

	var health_damage := damage
	var armor_damage := 0.0
	if armor > 0.0:
		health_damage = damage * armor_penetration
		var absorbed := damage - health_damage
		armor_damage = minf(armor, absorbed * armor_damage_fraction)
		# Armour that runs out mid-hit stops protecting for the remainder.
		var unprotected := maxf(0.0, absorbed * armor_damage_fraction - armor)
		health_damage += unprotected / maxf(0.001, armor_damage_fraction)
		armor = maxf(0.0, armor - armor_damage)

	health_damage = minf(health, health_damage)
	health -= health_damage
	var died := health <= 0.0
	if died:
		health = 0.0
		alive = false
	return {"health_damage": health_damage, "armor_damage": armor_damage, "died": died}

func heal(amount: float) -> float:
	if not alive:
		return 0.0
	var before := health
	health = minf(max_health, health + amount)
	return health - before

func add_armor(amount: float) -> void:
	armor = minf(max_armor, armor + amount)

func kill() -> void:
	health = 0.0
	alive = false

func health_fraction() -> float:
	return health / maxf(1.0, max_health)
