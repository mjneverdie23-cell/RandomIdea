## One weapon, as data.
##
## Weapons are Resources, not subclasses: `Weapon` (scripts/core/weapons/weapon.gd)
## holds the mutable runtime state (ammo, cooldowns, recoil) and reads every stat
## from here. Adding a gun means adding a .tres in `data/weapons/` - no new code.
##
## Units: damage = hit points, range/falloff = metres, times = seconds,
## fire_rate = rounds per minute, spread/recoil = degrees.
class_name WeaponData
extends Resource

@export_group("Identity")
@export var id: StringName = &""
@export var display_name: String = "Weapon"
@export var category: GameEnums.WeaponCategory = GameEnums.WeaponCategory.RIFLE
@export var slot: GameEnums.WeaponSlot = GameEnums.WeaponSlot.PRIMARY
@export var fire_mode: GameEnums.FireMode = GameEnums.FireMode.AUTO
@export var price: int = 0
## Money paid to the killer. A knife pays far more than a sniper on purpose.
@export var kill_reward: int = 300
## Empty means "any class whose allowed_categories include this weapon's category".
@export var allowed_classes: Array[StringName] = []

@export_group("Damage")
@export var damage: float = 25.0
@export var headshot_multiplier: float = 4.0
## 0..1 - the fraction of damage that ignores armour.
@export var armor_penetration: float = 0.7
## Each pellet is a separate ray (shotguns).
@export var pellets: int = 1

@export_group("Range")
@export var range: float = 90.0
@export var falloff_start: float = 35.0
@export var falloff_end: float = 80.0
@export var falloff_min_multiplier: float = 0.55

@export_group("Handling")
## Rounds per minute.
@export var fire_rate: float = 600.0
@export var burst_count: int = 3
@export var burst_delay: float = 0.32
@export var mag_size: int = 30
@export var reserve_ammo: int = 90
@export var reload_time: float = 2.2
## Draw time. The weapon cannot fire while it is being equipped.
@export var equip_time: float = 0.6
## Multiplies the carrier's class move speed.
@export var move_speed_multiplier: float = 1.0

@export_group("Accuracy")
## Cone half-angle in degrees while standing still and hip firing.
@export var spread_base: float = 0.6
## Added at full running speed.
@export var spread_moving: float = 3.2
## Added while airborne.
@export var spread_jumping: float = 6.0
## Added while crouched - negative values tighten the cone.
@export var spread_crouching: float = -0.25
## Added while aiming down sights - negative values tighten the cone.
@export var spread_ads: float = -0.45

@export_group("Recoil")
## Degrees kicked upwards per shot.
@export var recoil_vertical: float = 0.45
## Maximum degrees kicked sideways per shot.
@export var recoil_horizontal: float = 0.22
## Degrees per second returned to the original aim.
@export var recoil_recovery: float = 7.0
## Recovery only starts this long after the last shot, and never mid-burst.
@export var recoil_recovery_delay: float = 0.22
@export var recoil_max_vertical: float = 9.0

@export_group("Aiming")
## Camera FOV divisor while aiming. 1.0 disables ADS zoom.
@export var ads_zoom: float = 1.25
@export var ads_time: float = 0.22

@export_group("Visuals (render hints only - gameplay never reads these)")
## Key into WeaponModels (scripts/core/weapons/weapon_models.gd). Swap point for real art.
@export var model_key: StringName = &"weapon_generic"
@export var color: Color = Color(0.6, 0.63, 0.65)

func seconds_per_shot() -> float:
	return 60.0 / maxf(1.0, fire_rate)

func is_melee() -> bool:
	return fire_mode == GameEnums.FireMode.MELEE

## Damage multiplier at a given distance.
func falloff_multiplier(distance: float) -> float:
	if distance <= falloff_start:
		return 1.0
	if distance >= falloff_end:
		return falloff_min_multiplier
	var t := (distance - falloff_start) / maxf(0.001, falloff_end - falloff_start)
	return 1.0 + (falloff_min_multiplier - 1.0) * t
