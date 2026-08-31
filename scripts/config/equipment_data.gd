## Non-shooting purchases: armour, defuse kits, grenades, consumables.
##
## `effect` decides what buying it does, so a new kind of gear needs a new enum
## value here and one branch in `apply()` - never a change in ShopSystem.
class_name EquipmentData
extends Resource

enum Effect {
	ARMOR,        ## refill armour
	ARMOR_HELMET, ## refill armour and add a helmet
	DEFUSE_KIT,
	GRENADE,
	HEAL,
}

@export var id: StringName = &""
@export var display_name: String = "Equipment"
## Always EQUIPMENT - kept so the shop can treat weapons and gear uniformly.
@export var category: GameEnums.WeaponCategory = GameEnums.WeaponCategory.EQUIPMENT
@export var description: String = ""
@export var price: int = 0
@export var effect: Effect = Effect.ARMOR
## Restrict to one side (used by the defuse kit). -1 means "either side".
@export var side_restriction: int = -1
## Maximum carried (grenades).
@export var max_count: int = 1
@export var heal_amount: float = 50.0
@export var allowed_classes: Array[StringName] = []

@export_group("Grenade (only used when effect is GRENADE)")
@export var fuse_time: float = 2.4
@export var grenade_damage: float = 105.0
@export var grenade_radius: float = 8.5
@export var grenade_min_damage_fraction: float = 0.15
@export var throw_speed: float = 22.0
@export var bounce: float = 0.35
@export var kill_reward: int = 300

## Applies the purchase. `character` is a Character node.
func apply(character) -> void:
	match effect:
		Effect.ARMOR:
			character.health.armor = character.health.max_armor
		Effect.ARMOR_HELMET:
			character.health.armor = character.health.max_armor
			character.health.has_helmet = true
		Effect.DEFUSE_KIT:
			character.inventory.has_defuse_kit = true
		Effect.GRENADE:
			character.inventory.add_grenade(id)
		Effect.HEAL:
			character.health.heal(heal_amount)

## Whether buying it would do anything for this character.
func can_buy(character) -> bool:
	match effect:
		Effect.ARMOR:
			return character.health.armor < character.health.max_armor
		Effect.ARMOR_HELMET:
			return not character.health.has_helmet or character.health.armor < character.health.max_armor
		Effect.DEFUSE_KIT:
			return not character.inventory.has_defuse_kit
		Effect.GRENADE:
			return character.inventory.grenade_count(id) < max_count
		Effect.HEAL:
			return character.health.health < character.health.max_health
	return true
