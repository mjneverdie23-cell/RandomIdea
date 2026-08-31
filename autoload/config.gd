## Loads every data resource once and hands it out by id.
##
## Nothing else in the project loads a .tres directly, so where the data lives is
## a decision made in exactly one file. Everything here is read-only at runtime -
## tune the .tres files in the inspector, or edit them at import time.
extends Node

const CONFIG_DIR := "res://data/config"
const WEAPON_DIR := "res://data/weapons"
const EQUIPMENT_DIR := "res://data/equipment"
const CLASS_DIR := "res://data/classes"
const ABILITY_DIR := "res://data/abilities"

## Tuning for match, round, bomb, economy, combat and movement.
var game: GameConfig
## Bot difficulty and behaviour.
var bots: BotConfig

var weapons: Dictionary = {}      ## StringName -> WeaponData
var equipment: Dictionary = {}    ## StringName -> EquipmentData
var classes: Dictionary = {}      ## StringName -> CharacterClassData
var abilities: Dictionary = {}    ## StringName -> AbilityData
## Class ids in a stable order - used by the class picker and bot rotation.
var class_ids: Array[StringName] = []

func _ready() -> void:
	reload()

func reload() -> void:
	game = load("%s/game_config.tres" % CONFIG_DIR) as GameConfig
	bots = load("%s/bot_config.tres" % CONFIG_DIR) as BotConfig
	if game == null:
		push_error("Config: data/config/game_config.tres is missing. Run tools/generate_data.gd.")
		game = GameConfig.new()
	if bots == null:
		bots = BotConfig.new()

	weapons = _load_directory(WEAPON_DIR)
	equipment = _load_directory(EQUIPMENT_DIR)
	classes = _load_directory(CLASS_DIR)
	abilities = _load_directory(ABILITY_DIR)

	class_ids.clear()
	var keys := classes.keys()
	keys.sort()
	for key in keys:
		class_ids.append(key)

func _load_directory(path: String) -> Dictionary:
	var out := {}
	var dir := DirAccess.open(path)
	if dir == null:
		push_error("Config: cannot open %s" % path)
		return out
	for file_name in dir.get_files():
		# Exported projects rename .tres to .remap; strip either suffix.
		var clean := file_name.trim_suffix(".remap")
		if not clean.ends_with(".tres"):
			continue
		var resource: Resource = load("%s/%s" % [path, clean])
		if resource == null or not ("id" in resource):
			continue
		out[resource.id] = resource
	return out

# ------------------------------------------------------------------ lookups --
func weapon(id: StringName) -> WeaponData:
	return weapons.get(id)

func equipment_item(id: StringName) -> EquipmentData:
	return equipment.get(id)

## Either a weapon or a piece of equipment - the shop treats both as "items".
func item(id: StringName) -> Resource:
	if weapons.has(id):
		return weapons[id]
	return equipment.get(id)

func character_class(id: StringName) -> CharacterClassData:
	if classes.has(id):
		return classes[id]
	return classes.get(default_class_id())

func ability(id: StringName) -> AbilityData:
	return abilities.get(id)

func default_class_id() -> StringName:
	return &"RANGER" if classes.has(&"RANGER") else (class_ids[0] if class_ids.size() > 0 else &"")

## Whether a class is allowed to carry an item, by category and by explicit list.
func is_item_allowed_for_class(item_id: StringName, class_id: StringName) -> bool:
	var data := item(item_id)
	if data == null:
		return false
	var class_data := character_class(class_id)
	if class_data == null:
		return false
	if "allowed_classes" in data and not data.allowed_classes.is_empty():
		if not data.allowed_classes.has(class_id):
			return false
	var category: int = data.category if "category" in data else GameEnums.WeaponCategory.EQUIPMENT
	return class_data.allowed_categories.has(category)

# --------------------------------------------------------------------- maps --
## TO ADD A MAP: write `scripts/maps/<name>_map.gd` with a static `build()` that
## returns a MapDefinition, then add a branch here.
func get_map(map_id: StringName = &"dust_proto") -> MapDefinition:
	match map_id:
		&"dust_proto":
			return DustProtoMap.build()
	push_warning("Config: unknown map '%s', falling back to dust_proto" % map_id)
	return DustProtoMap.build()

func map_ids() -> Array[StringName]:
	return [&"dust_proto"]
