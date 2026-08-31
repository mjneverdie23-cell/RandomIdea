## A dinosaur class: stats, allowed gear, abilities and a visual key.
##
## The visual key is all the render layer needs to pick a model, which is why
## swapping capsule placeholders for rigged dinosaurs never touches gameplay
## code (see scripts/core/character_models.gd).
class_name CharacterClassData
extends Resource

@export_group("Identity")
@export var id: StringName = &""
@export var display_name: String = "Dino"
@export var species: String = ""
@export var role: String = ""
@export_multiline var description: String = ""

@export_group("Stats")
@export var max_health: float = 100.0
@export var max_armor: float = 100.0
## Free armour granted at the start of every round.
@export var starting_armor: float = 0.0
@export var has_helmet_by_default: bool = false
## Base walking speed in metres per second.
@export var move_speed: float = 5.5
@export var jump_velocity: float = 7.0
## Below 1.0 makes the class tanky.
@export var damage_taken_multiplier: float = 1.0
## Above 1.0 makes the class hit harder.
@export var damage_dealt_multiplier: float = 1.0

@export_group("Hitbox (bullets use these, NOT the model)")
@export var hitbox_radius: float = 0.52
@export var hitbox_height: float = 1.85
## Camera/eye height as a fraction of hitbox height.
@export var eye_height_fraction: float = 0.88

@export_group("Loadout")
## GameEnums.WeaponCategory values this class may buy.
@export var allowed_categories: Array[int] = []
@export var default_primary: StringName = &""
@export var default_secondary: StringName = &"pistol_scav"
@export var default_melee: StringName = &"melee_claws"
## Ability resource ids, in slot order: first = Q, second = F.
@export var abilities: Array[StringName] = []
## What bots try to buy, best first.
@export var bot_buy_priority: Array[StringName] = []

@export_group("Visuals (render hints only)")
## Key into CharacterModels - the single swap point for real dinosaur models.
@export var model_key: StringName = &"capsule"
@export var color: Color = Color(0.6, 0.6, 0.6)
@export var model_scale: float = 1.0

func allows_category(cat: GameEnums.WeaponCategory) -> bool:
	return allowed_categories.has(cat)

func eye_height(current_height: float) -> float:
	return current_height * eye_height_fraction
