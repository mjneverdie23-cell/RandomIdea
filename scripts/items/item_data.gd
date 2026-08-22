@tool
class_name ItemData
extends Resource

## One shop item.
##
## An item is a price plus a bundle of stat modifiers. It is applied through
## [StatsComponent], the same channel buffs and levels use, so nothing in the
## combat code needs to know items exist.

@export var id: String = "item"
@export var display_name: String = "Item"
@export_range(0.0, 100000.0, 5.0) var cost: float = 500.0
@export_multiline var description: String = ""
## Placeholder icon: a colour and a one or two letter glyph until real art.
@export var icon_color: Color = Color(0.55, 0.62, 0.72)
@export var icon_glyph: String = "?"
@export var category: String = "basic"

@export_group("Stat bonuses")
@export_range(0.0, 5000.0, 5.0) var bonus_health: float = 0.0
@export_range(0.0, 200.0, 0.5) var bonus_health_regen: float = 0.0
@export_range(0.0, 500.0, 1.0) var bonus_attack_damage: float = 0.0
@export_range(0.0, 500.0, 1.0) var bonus_ability_power: float = 0.0
@export_range(0.0, 3.0, 0.01) var bonus_attack_speed: float = 0.0
@export_range(0.0, 40.0, 0.5) var bonus_attack_range: float = 0.0
@export_range(0.0, 20.0, 0.1) var bonus_move_speed: float = 0.0
@export_range(0.0, 40.0, 0.5) var bonus_vision_radius: float = 0.0
## Armour and magic resist both reduce incoming damage; the prototype has no
## damage types yet, so they add together into one reduction fraction.
@export_range(0.0, 0.6, 0.01) var bonus_armor: float = 0.0
@export_range(0.0, 0.6, 0.01) var bonus_magic_resist: float = 0.0

@export_group("Active")
## Above zero, the item exposes a usable active on a cooldown.
@export_range(0.0, 300.0, 0.5) var active_cooldown: float = 0.0
@export var active_description: String = ""


## Stat fields in the shape [StatsComponent] expects.
func modifier_fields() -> Dictionary:
	var fields: Dictionary = {}
	var adds := {
		"max_health": bonus_health,
		"health_regen": bonus_health_regen,
		"attack_damage": bonus_attack_damage,
		"ability_power": bonus_ability_power,
		"attack_range": bonus_attack_range,
		"move_speed": bonus_move_speed,
		"vision_radius": bonus_vision_radius,
		"damage_reduction": bonus_armor + bonus_magic_resist,
	}
	for key in adds:
		if adds[key] != 0.0:
			fields[key] = {"add": adds[key]}
	if bonus_attack_speed != 0.0:
		fields["attack_speed"] = {"mult": 1.0 + bonus_attack_speed}
	return fields


func has_active() -> bool:
	return active_cooldown > 0.0


## Short stat line for the shop and the HUD tooltip.
func summary() -> String:
	var parts := PackedStringArray()
	var labels := {
		"bonus_health": "HP", "bonus_health_regen": "HP/s",
		"bonus_attack_damage": "AD", "bonus_ability_power": "AP",
		"bonus_attack_range": "range", "bonus_move_speed": "MS",
		"bonus_vision_radius": "sight",
	}
	for field in labels:
		var value: float = get(field)
		if value != 0.0:
			parts.append("+%s %s" % [_trim(value), labels[field]])
	if bonus_attack_speed != 0.0:
		parts.append("+%d%% AS" % roundi(bonus_attack_speed * 100.0))
	if bonus_armor != 0.0:
		parts.append("+%d%% armour" % roundi(bonus_armor * 100.0))
	if bonus_magic_resist != 0.0:
		parts.append("+%d%% MR" % roundi(bonus_magic_resist * 100.0))
	return "  ".join(parts)


func _trim(value: float) -> String:
	return str(int(value)) if is_equal_approx(value, roundf(value)) else "%.1f" % value
