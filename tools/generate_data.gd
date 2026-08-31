## Bootstraps the data resources in `data/` from the defaults below.
##
##   godot --headless --script res://tools/generate_data.gd
##
## The generated .tres files are the SOURCE OF TRUTH afterwards - tune them in the
## inspector. Re-running this tool resets them to these defaults, so treat it as
## "restore defaults", not as a build step.
extends SceneTree

const WEAPON_DIR := "res://data/weapons"
const EQUIPMENT_DIR := "res://data/equipment"
const CLASS_DIR := "res://data/classes"
const ABILITY_DIR := "res://data/abilities"
const CONFIG_DIR := "res://data/config"

func _initialize() -> void:
	for dir in [WEAPON_DIR, EQUIPMENT_DIR, CLASS_DIR, ABILITY_DIR, CONFIG_DIR]:
		DirAccess.make_dir_recursive_absolute(dir)
	var written := 0
	written += _write_config()
	written += _write_weapons()
	written += _write_equipment()
	written += _write_abilities()
	written += _write_classes()
	print("generate_data: wrote %d resources" % written)
	quit(0)

func _save(resource: Resource, path: String) -> int:
	var error := ResourceSaver.save(resource, path)
	if error != OK:
		push_error("failed to save %s (error %d)" % [path, error])
		return 0
	return 1

# ------------------------------------------------------------------- config --
func _write_config() -> int:
	var count := _save(GameConfig.new(), "%s/game_config.tres" % CONFIG_DIR)
	count += _save(BotConfig.new(), "%s/bot_config.tres" % CONFIG_DIR)
	return count

# ------------------------------------------------------------------ weapons --
func _weapon(props: Dictionary) -> WeaponData:
	var weapon := WeaponData.new()
	for key in props:
		weapon.set(key, props[key])
	return weapon

func _write_weapons() -> int:
	var C := GameEnums.WeaponCategory
	var S := GameEnums.WeaponSlot
	var F := GameEnums.FireMode
	var weapons: Array[WeaponData] = [
		# ------------------------------------------------------------ melee --
		_weapon({
			"id": &"melee_claws", "display_name": "Claws", "category": C.MELEE, "slot": S.MELEE,
			"fire_mode": F.MELEE, "price": 0, "damage": 55.0, "headshot_multiplier": 2.0,
			"armor_penetration": 0.85, "fire_rate": 90.0, "mag_size": -1, "reserve_ammo": -1,
			"reload_time": 0.0, "range": 2.4, "falloff_start": 2.4, "falloff_end": 2.4,
			"equip_time": 0.35, "move_speed_multiplier": 1.1, "kill_reward": 1200,
			"model_key": &"weapon_claws", "color": Color("d9c9a3"),
		}),
		# ---------------------------------------------------------- pistols --
		_weapon({
			"id": &"pistol_scav", "display_name": "Scavenger P9", "category": C.PISTOL, "slot": S.SECONDARY,
			"fire_mode": F.SEMI, "price": 0, "damage": 26.0, "fire_rate": 400.0, "mag_size": 15,
			"reserve_ammo": 60, "reload_time": 1.9, "range": 55.0, "falloff_start": 18.0,
			"falloff_end": 45.0, "armor_penetration": 0.55, "move_speed_multiplier": 1.05,
			"kill_reward": 450, "recoil_vertical": 0.5, "recoil_horizontal": 0.2, "recoil_max_vertical": 4.0,
			"model_key": &"weapon_pistol", "color": Color("8e9296"),
		}),
		_weapon({
			"id": &"pistol_talon", "display_name": "Talon .50", "category": C.PISTOL, "slot": S.SECONDARY,
			"fire_mode": F.SEMI, "price": 700, "damage": 52.0, "headshot_multiplier": 3.6,
			"fire_rate": 230.0, "mag_size": 7, "reserve_ammo": 35, "reload_time": 2.3, "range": 70.0,
			"falloff_start": 25.0, "falloff_end": 60.0, "armor_penetration": 0.82, "kill_reward": 350,
			"spread_base": 1.1, "spread_moving": 5.0, "recoil_vertical": 1.4, "recoil_horizontal": 0.5,
			"recoil_max_vertical": 7.0, "model_key": &"weapon_pistol_heavy", "color": Color("6f7477"),
		}),
		_weapon({
			"id": &"pistol_dart", "display_name": "Dart Repeater", "category": C.PISTOL, "slot": S.SECONDARY,
			"fire_mode": F.AUTO, "price": 450, "damage": 17.0, "fire_rate": 850.0, "mag_size": 24,
			"reserve_ammo": 96, "reload_time": 1.8, "range": 45.0, "falloff_start": 14.0,
			"falloff_end": 38.0, "armor_penetration": 0.5, "move_speed_multiplier": 1.08,
			"kill_reward": 500, "spread_base": 1.0, "spread_moving": 3.4, "recoil_vertical": 0.35,
			"recoil_horizontal": 0.3, "recoil_max_vertical": 5.0,
			"model_key": &"weapon_pistol_auto", "color": Color("93856b"),
		}),
		# -------------------------------------------------------------- smg --
		_weapon({
			"id": &"smg_swarm", "display_name": "Swarm SMG", "category": C.SMG, "price": 1250,
			"damage": 22.0, "fire_rate": 900.0, "mag_size": 30, "reserve_ammo": 120, "reload_time": 2.0,
			"range": 55.0, "falloff_start": 16.0, "falloff_end": 45.0, "armor_penetration": 0.6,
			"falloff_min_multiplier": 0.45, "move_speed_multiplier": 1.06, "kill_reward": 600,
			"spread_base": 1.0, "spread_moving": 2.4, "recoil_vertical": 0.34, "recoil_horizontal": 0.28,
			"recoil_max_vertical": 7.0, "model_key": &"weapon_smg", "color": Color("7d8a92"),
		}),
		_weapon({
			"id": &"smg_needler", "display_name": "Needler PDW", "category": C.SMG, "price": 1600,
			"damage": 27.0, "fire_rate": 750.0, "mag_size": 25, "reserve_ammo": 100, "reload_time": 2.2,
			"range": 62.0, "falloff_start": 20.0, "falloff_end": 50.0, "armor_penetration": 0.72,
			"move_speed_multiplier": 1.03, "kill_reward": 450, "spread_base": 0.9, "spread_moving": 2.8,
			"recoil_vertical": 0.42, "recoil_horizontal": 0.24, "recoil_max_vertical": 7.5,
			"model_key": &"weapon_smg", "color": Color("6d7d85"),
		}),
		# ----------------------------------------------------------- rifles --
		_weapon({
			"id": &"rifle_ranger", "display_name": "Ranger AR", "category": C.RIFLE, "price": 2700,
			"damage": 33.0, "fire_rate": 660.0, "mag_size": 30, "reserve_ammo": 90, "reload_time": 2.4,
			"range": 100.0, "falloff_start": 45.0, "falloff_end": 90.0, "armor_penetration": 0.78,
			"move_speed_multiplier": 0.96, "kill_reward": 300, "spread_base": 0.55, "spread_moving": 3.4,
			"recoil_vertical": 0.5, "recoil_horizontal": 0.26, "recoil_max_vertical": 9.0,
			"model_key": &"weapon_rifle", "color": Color("59636b"),
		}),
		_weapon({
			"id": &"rifle_apex", "display_name": "Apex Carbine", "category": C.RIFLE, "price": 2250,
			"damage": 28.0, "fire_rate": 780.0, "mag_size": 30, "reserve_ammo": 90, "reload_time": 2.1,
			"range": 85.0, "falloff_start": 35.0, "falloff_end": 75.0, "armor_penetration": 0.7,
			"move_speed_multiplier": 0.99, "kill_reward": 300, "spread_base": 0.7, "spread_moving": 3.0,
			"recoil_vertical": 0.4, "recoil_horizontal": 0.3, "recoil_max_vertical": 8.0,
			"model_key": &"weapon_rifle", "color": Color("63706b"),
		}),
		_weapon({
			"id": &"rifle_bulwark", "display_name": "Bulwark BR", "category": C.RIFLE, "fire_mode": F.BURST,
			"price": 2100, "damage": 30.0, "fire_rate": 900.0, "burst_count": 3, "burst_delay": 0.34,
			"mag_size": 24, "reserve_ammo": 72, "reload_time": 2.3, "range": 95.0, "falloff_start": 40.0,
			"falloff_end": 85.0, "armor_penetration": 0.75, "move_speed_multiplier": 0.97,
			"kill_reward": 350, "spread_base": 0.45, "spread_moving": 3.6, "recoil_vertical": 0.55,
			"recoil_horizontal": 0.18, "recoil_max_vertical": 8.0,
			"model_key": &"weapon_rifle", "color": Color("6b6355"),
		}),
		# ---------------------------------------------------------- snipers --
		_weapon({
			"id": &"sniper_longneck", "display_name": "Longneck Bolt", "category": C.SNIPER,
			"fire_mode": F.SEMI, "price": 4750, "damage": 115.0, "headshot_multiplier": 2.4,
			"fire_rate": 41.0, "mag_size": 5, "reserve_ammo": 25, "reload_time": 3.4, "range": 200.0,
			"falloff_start": 120.0, "falloff_end": 200.0, "falloff_min_multiplier": 0.85,
			"armor_penetration": 0.95, "equip_time": 1.0, "ads_zoom": 4.0, "ads_time": 0.35,
			"move_speed_multiplier": 0.82, "kill_reward": 100,
			# useless from the hip, exact when scoped
			"spread_base": 3.5, "spread_moving": 9.0, "spread_ads": -3.45,
			"recoil_vertical": 3.0, "recoil_horizontal": 0.6, "recoil_recovery": 12.0,
			"recoil_max_vertical": 6.0, "model_key": &"weapon_sniper", "color": Color("4d5560"),
		}),
		_weapon({
			"id": &"sniper_horizon", "display_name": "Horizon DMR", "category": C.SNIPER,
			"fire_mode": F.SEMI, "price": 3200, "damage": 68.0, "headshot_multiplier": 2.8,
			"fire_rate": 180.0, "mag_size": 10, "reserve_ammo": 40, "reload_time": 2.8, "range": 160.0,
			"falloff_start": 80.0, "falloff_end": 150.0, "falloff_min_multiplier": 0.7,
			"armor_penetration": 0.85, "ads_zoom": 2.5, "ads_time": 0.28, "move_speed_multiplier": 0.9,
			"kill_reward": 300, "spread_base": 2.2, "spread_moving": 7.0, "spread_ads": -2.0,
			"recoil_vertical": 1.6, "recoil_horizontal": 0.4, "recoil_recovery": 10.0,
			"recoil_max_vertical": 7.0, "model_key": &"weapon_sniper", "color": Color("566070"),
		}),
		# --------------------------------------------------------- shotguns --
		_weapon({
			"id": &"shotgun_maw", "display_name": "Maw Breaker", "category": C.SHOTGUN,
			"fire_mode": F.SEMI, "price": 1900, "damage": 17.0, "headshot_multiplier": 1.8,
			"pellets": 8, "fire_rate": 120.0, "mag_size": 7, "reserve_ammo": 28, "reload_time": 3.0,
			"range": 28.0, "falloff_start": 8.0, "falloff_end": 24.0, "falloff_min_multiplier": 0.25,
			"armor_penetration": 0.55, "move_speed_multiplier": 0.95, "kill_reward": 900,
			"spread_base": 5.5, "spread_moving": 2.0, "spread_ads": -1.5, "recoil_vertical": 2.2,
			"recoil_horizontal": 0.5, "recoil_recovery": 9.0, "recoil_max_vertical": 6.0,
			"model_key": &"weapon_shotgun", "color": Color("7a5b46"),
		}),
		# -------------------------------------------------------------- lmg --
		_weapon({
			"id": &"lmg_thunder", "display_name": "Thunderfoot LMG", "category": C.LMG, "price": 4200,
			"damage": 30.0, "fire_rate": 700.0, "mag_size": 100, "reserve_ammo": 200, "reload_time": 5.2,
			"range": 110.0, "falloff_start": 50.0, "falloff_end": 95.0, "armor_penetration": 0.8,
			"equip_time": 1.1, "move_speed_multiplier": 0.82, "kill_reward": 300, "spread_base": 1.4,
			"spread_moving": 5.0, "spread_crouching": -0.8, "recoil_vertical": 0.42,
			"recoil_horizontal": 0.4, "recoil_recovery": 5.5, "recoil_max_vertical": 11.0,
			"model_key": &"weapon_lmg", "color": Color("4f5a4f"),
		}),
	]
	var count := 0
	for weapon in weapons:
		count += _save(weapon, "%s/%s.tres" % [WEAPON_DIR, weapon.id])
	return count

# ---------------------------------------------------------------- equipment --
func _write_equipment() -> int:
	var items: Array[EquipmentData] = []

	var armor := EquipmentData.new()
	armor.id = &"eq_armor"
	armor.display_name = "Hide Plating"
	armor.description = "Restores armour to full."
	armor.price = 650
	armor.effect = EquipmentData.Effect.ARMOR
	items.append(armor)

	var helmet := EquipmentData.new()
	helmet.id = &"eq_helmet"
	helmet.display_name = "Crested Helm"
	helmet.description = "Full armour plus head protection."
	helmet.price = 1000
	helmet.effect = EquipmentData.Effect.ARMOR_HELMET
	items.append(helmet)

	var defuser := EquipmentData.new()
	defuser.id = &"eq_defuser"
	defuser.display_name = "Defuse Kit"
	defuser.description = "Halves bomb defuse time. Defenders only."
	defuser.price = 400
	defuser.effect = EquipmentData.Effect.DEFUSE_KIT
	defuser.side_restriction = GameEnums.Side.DEFENDERS
	items.append(defuser)

	var frag := EquipmentData.new()
	frag.id = &"eq_frag"
	frag.display_name = "Frag Egg"
	frag.description = "Thrown explosive. Two carried at most."
	frag.price = 300
	frag.effect = EquipmentData.Effect.GRENADE
	frag.max_count = 2
	frag.fuse_time = 2.4
	frag.grenade_damage = 105.0
	frag.grenade_radius = 8.5
	frag.throw_speed = 22.0
	items.append(frag)

	var medkit := EquipmentData.new()
	medkit.id = &"eq_medkit"
	medkit.display_name = "Regen Gland"
	medkit.description = "Heals 50 health instantly."
	medkit.price = 800
	medkit.effect = EquipmentData.Effect.HEAL
	medkit.heal_amount = 50.0
	items.append(medkit)

	var count := 0
	for item in items:
		count += _save(item, "%s/%s.tres" % [EQUIPMENT_DIR, item.id])
	return count

# ---------------------------------------------------------------- abilities --
func _ability(ability: AbilityData, props: Dictionary) -> AbilityData:
	for key in props:
		ability.set(key, props[key])
	return ability

func _write_abilities() -> int:
	var abilities: Array[AbilityData] = [
		_ability(AbilityBulwark.new(), {
			"id": &"ability_bulwark", "display_name": "Bulwark", "cooldown": 30.0, "duration": 8.0,
			"description": "Brace behind armoured plates: 50% damage reduction, slower movement.",
		}),
		_ability(AbilityTailSlam.new(), {
			"id": &"ability_tail_slam", "display_name": "Tail Slam", "cooldown": 22.0, "duration": 0.0,
			"radius": 6.5, "damage": 45.0,
			"description": "Ground slam damaging and slowing every enemy nearby.",
		}),
		_ability(AbilityHawkEye.new(), {
			"id": &"ability_hawk_eye", "display_name": "Hawk Eye", "cooldown": 35.0, "duration": 6.0,
			"radius": 120.0,
			"description": "Steady the shot and reveal enemies in line of sight for 6 seconds.",
		}),
		_ability(AbilityGlide.new(), {
			"id": &"ability_glide", "display_name": "Glide", "cooldown": 20.0, "duration": 4.0,
			"description": "Catch the air: reduced gravity and a boost upwards.",
		}),
		_ability(AbilityPounce.new(), {
			"id": &"ability_pounce", "display_name": "Pounce", "cooldown": 12.0, "duration": 0.0,
			"strength": 16.0, "description": "Explosive leap in the direction you are looking.",
		}),
		_ability(AbilityCamouflage.new(), {
			"id": &"ability_camouflage", "display_name": "Camouflage", "cooldown": 30.0, "duration": 5.0,
			"description": "Blend into the environment for 5 seconds. Firing breaks it.",
		}),
		_ability(AbilityEchoCall.new(), {
			"id": &"ability_echo_call", "display_name": "Echo Call", "cooldown": 30.0, "duration": 4.0,
			"radius": 45.0,
			"description": "Sonic pulse revealing every enemy in a wide radius for 4 seconds.",
		}),
		_ability(AbilityFieldDressing.new(), {
			"id": &"ability_field_dressing", "display_name": "Field Dressing", "cooldown": 35.0,
			"duration": 0.0, "radius": 10.0, "heal_amount": 45.0,
			"description": "Heal yourself for 45 and nearby allies for 25.",
		}),
		_ability(AbilityRoar.new(), {
			"id": &"ability_roar", "display_name": "Terror Roar", "cooldown": 40.0, "duration": 6.0,
			"radius": 14.0,
			"description": "Allies nearby deal +20% damage; enemies nearby are slowed.",
		}),
		_ability(AbilityCharge.new(), {
			"id": &"ability_charge", "display_name": "Charge", "cooldown": 25.0, "duration": 1.4,
			"strength": 1.9, "damage": 35.0,
			"description": "Barrel forwards, trampling anything in the way.",
		}),
	]
	var count := 0
	for ability in abilities:
		count += _save(ability, "%s/%s.tres" % [ABILITY_DIR, ability.id])
	return count

# ------------------------------------------------------------------ classes --
func _class(props: Dictionary) -> CharacterClassData:
	var data := CharacterClassData.new()
	for key in props:
		data.set(key, props[key])
	return data

func _write_classes() -> int:
	var C := GameEnums.WeaponCategory
	var classes: Array[CharacterClassData] = [
		_class({
			"id": &"TANK", "display_name": "Ankylo", "species": "Ankylosaurus", "role": "Tank",
			"description": "Armoured wall. Soaks damage, holds chokes, breaks sites open.",
			"max_health": 150.0, "max_armor": 100.0, "starting_armor": 25.0,
			"move_speed": 4.6, "jump_velocity": 6.4, "damage_taken_multiplier": 0.85,
			"hitbox_radius": 0.62, "hitbox_height": 1.95, "eye_height_fraction": 0.86,
			"allowed_categories": [C.PISTOL, C.SHOTGUN, C.LMG, C.RIFLE, C.MELEE, C.EQUIPMENT] as Array[int],
			"abilities": [&"ability_bulwark", &"ability_tail_slam"] as Array[StringName],
			"bot_buy_priority": [&"lmg_thunder", &"shotgun_maw", &"rifle_apex"] as Array[StringName],
			"model_key": &"dino_ankylo", "color": Color("5a7d5a"), "model_scale": 1.15,
		}),
		_class({
			"id": &"SNIPER", "display_name": "Ptera", "species": "Pteranodon", "role": "Sniper",
			"description": "Long-range specialist. Fragile, deadly at distance, terrible up close.",
			"max_health": 90.0, "max_armor": 100.0, "starting_armor": 0.0,
			"move_speed": 5.2, "jump_velocity": 7.4, "damage_taken_multiplier": 1.1,
			"hitbox_radius": 0.5, "hitbox_height": 1.8, "eye_height_fraction": 0.88,
			"allowed_categories": [C.PISTOL, C.SNIPER, C.RIFLE, C.MELEE, C.EQUIPMENT] as Array[int],
			"abilities": [&"ability_hawk_eye", &"ability_glide"] as Array[StringName],
			"bot_buy_priority": [&"sniper_longneck", &"sniper_horizon", &"rifle_ranger"] as Array[StringName],
			"model_key": &"dino_ptera", "color": Color("7a6fb0"), "model_scale": 1.0,
		}),
		_class({
			"id": &"ASSASSIN", "display_name": "Raptor", "species": "Velociraptor", "role": "Assassin",
			"description": "Fast flanker. Wins the duels it starts, loses the ones it does not.",
			"max_health": 85.0, "max_armor": 75.0, "starting_armor": 0.0,
			"move_speed": 6.6, "jump_velocity": 7.8, "damage_taken_multiplier": 1.12,
			"damage_dealt_multiplier": 1.08,
			"hitbox_radius": 0.46, "hitbox_height": 1.65, "eye_height_fraction": 0.9,
			"allowed_categories": [C.PISTOL, C.SMG, C.SHOTGUN, C.MELEE, C.EQUIPMENT] as Array[int],
			"default_secondary": &"pistol_dart",
			"abilities": [&"ability_pounce", &"ability_camouflage"] as Array[StringName],
			"bot_buy_priority": [&"smg_swarm", &"shotgun_maw", &"smg_needler"] as Array[StringName],
			"model_key": &"dino_raptor", "color": Color("c08a3e"), "model_scale": 0.92,
		}),
		_class({
			"id": &"RANGER", "display_name": "Para", "species": "Parasaurolophus", "role": "Ranger",
			"description": "All-rounder with map awareness. Scans, supports, holds angles.",
			"max_health": 110.0, "max_armor": 100.0, "starting_armor": 0.0,
			"move_speed": 5.6, "jump_velocity": 7.0,
			"hitbox_radius": 0.52, "hitbox_height": 1.85, "eye_height_fraction": 0.88,
			"allowed_categories": [C.PISTOL, C.RIFLE, C.SMG, C.SNIPER, C.MELEE, C.EQUIPMENT] as Array[int],
			"abilities": [&"ability_echo_call", &"ability_field_dressing"] as Array[StringName],
			"bot_buy_priority": [&"rifle_ranger", &"rifle_apex", &"smg_swarm"] as Array[StringName],
			"model_key": &"dino_para", "color": Color("3f8fb5"), "model_scale": 1.0,
		}),
		_class({
			"id": &"BRUISER", "display_name": "Rex", "species": "Tyrannosaurus", "role": "Bruiser",
			"description": "Mid-range brawler. Trades hard, buffs allies, terrifies sites.",
			"max_health": 125.0, "max_armor": 100.0, "starting_armor": 0.0,
			"move_speed": 5.1, "jump_velocity": 6.8, "damage_taken_multiplier": 0.95,
			"damage_dealt_multiplier": 1.05,
			"hitbox_radius": 0.58, "hitbox_height": 1.9, "eye_height_fraction": 0.87,
			"allowed_categories": [C.PISTOL, C.RIFLE, C.SHOTGUN, C.LMG, C.MELEE, C.EQUIPMENT] as Array[int],
			"default_secondary": &"pistol_talon",
			"abilities": [&"ability_roar", &"ability_charge"] as Array[StringName],
			"bot_buy_priority": [&"rifle_bulwark", &"shotgun_maw", &"rifle_ranger"] as Array[StringName],
			"model_key": &"dino_rex", "color": Color("b0503f"), "model_scale": 1.08,
		}),
	]
	var count := 0
	for data in classes:
		count += _save(data, "%s/%s.tres" % [CLASS_DIR, data.id])
	return count
