@tool
class_name UnitStats
extends Resource

## Every tunable number a combat unit needs, kept out of behaviour scripts.
##
## Champions, minions and turrets all read the same shape, so a designer can
## retune the sandbox by editing .tres files instead of code.

@export var display_name: String = "Unit"

@export_group("Survivability")
@export_range(1.0, 20000.0, 1.0) var max_health: float = 600.0
## Health restored per second while alive.
@export_range(0.0, 200.0, 0.5) var health_regen: float = 0.0
## Fraction of incoming damage ignored, 0..0.9.
@export_range(0.0, 0.9, 0.01) var damage_reduction: float = 0.0

@export_group("Offence")
@export_range(0.0, 2000.0, 1.0) var attack_damage: float = 55.0
@export_range(0.0, 60.0, 0.5) var attack_range: float = 6.0
## Attacks per second.
@export_range(0.05, 10.0, 0.05) var attack_speed: float = 0.8
## 0 makes the hit instant; anything higher spawns a travelling projectile.
@export_range(0.0, 200.0, 1.0) var projectile_speed: float = 0.0
## Flat bonus added to ability damage. Items and levels raise it.
@export_range(0.0, 2000.0, 1.0) var ability_power: float = 0.0

@export_group("Ability resource")
## Spendable pool for ability costs. Zero means this unit has none, and the
## HUD hides the bar — minions and turrets leave it at zero.
@export_range(0.0, 5000.0, 5.0) var max_resource: float = 0.0
@export_range(0.0, 200.0, 0.5) var resource_regen: float = 0.0

@export_group("Vision")
## How far this unit sees. Bushes still hide whoever stands in them.
@export_range(0.0, 120.0, 0.5) var vision_radius: float = 18.0

@export_group("Movement")
@export_range(0.0, 40.0, 0.5) var move_speed: float = 11.0

@export_group("Body")
@export_range(0.2, 4.0, 0.05) var body_radius: float = 0.95
@export_range(0.4, 8.0, 0.05) var body_height: float = 2.8


func attack_interval() -> float:
	return 1.0 / maxf(attack_speed, 0.01)
