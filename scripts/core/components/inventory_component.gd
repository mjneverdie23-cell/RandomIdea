## What a character carries: a weapon per slot, grenades, the defuse kit and the
## bomb. Slot rules live here so the shop, the round reset and pickup code all
## agree on what "having a primary" means.
class_name InventoryComponent
extends RefCounted

const SLOT_ORDER := [
	GameEnums.WeaponSlot.PRIMARY,
	GameEnums.WeaponSlot.SECONDARY,
	GameEnums.WeaponSlot.MELEE,
]

## WeaponSlot -> Weapon (or null)
var slots: Dictionary = {}
var active_slot: int = GameEnums.WeaponSlot.MELEE
## equipment id -> count
var grenades: Dictionary = {}
var has_defuse_kit: bool = false
var has_bomb: bool = false

func _init() -> void:
	for slot in SLOT_ORDER:
		slots[slot] = null

func active_weapon() -> Weapon:
	return slots.get(active_slot)

func weapon_in(slot: int) -> Weapon:
	return slots.get(slot)

## Adds a weapon to its own slot, replacing whatever was there.
func give_weapon(weapon_id: StringName, equip: bool = true) -> Weapon:
	var data := Config.weapon(weapon_id)
	if data == null:
		push_error("InventoryComponent: unknown weapon '%s'" % weapon_id)
		return null
	var weapon := Weapon.new(data)
	slots[data.slot] = weapon
	if equip or active_weapon() == null:
		equip_slot(data.slot)
	return weapon

func remove_slot(slot: int) -> void:
	slots[slot] = null
	if active_slot == slot:
		equip_best_available()

func equip_slot(slot: int) -> bool:
	if slots.get(slot) == null or active_slot == slot:
		return false
	var current: Weapon = slots.get(active_slot)
	if current != null:
		current.cancel_reload()
	active_slot = slot
	slots[slot].equip()
	return true

## Primary, then secondary, then melee.
func equip_best_available() -> void:
	for slot in SLOT_ORDER:
		if slots.get(slot) != null:
			active_slot = slot
			slots[slot].equip()
			return
	active_slot = GameEnums.WeaponSlot.MELEE

func add_grenade(item_id: StringName, count: int = 1) -> void:
	grenades[item_id] = grenade_count(item_id) + count

func grenade_count(item_id: StringName) -> int:
	return grenades.get(item_id, 0)

func total_grenades() -> int:
	var total := 0
	for count in grenades.values():
		total += count
	return total

## Removes one grenade and returns its id, or an empty StringName when out.
func take_grenade() -> StringName:
	for id in grenades:
		if grenades[id] > 0:
			grenades[id] -= 1
			if grenades[id] <= 0:
				grenades.erase(id)
			return id
	return &""

func refill_all_ammo() -> void:
	for weapon in slots.values():
		if weapon != null:
			weapon.refill_ammo()

## Round reset. Weapons carry over between rounds (CS convention); consumables
## and the bomb do not. The defuse kit is consumed on use, not on round end.
func reset_for_round(keep_weapons: bool, class_data: CharacterClassData) -> void:
	if not keep_weapons:
		slots[GameEnums.WeaponSlot.PRIMARY] = null
		slots[GameEnums.WeaponSlot.SECONDARY] = null
	grenades.clear()
	has_bomb = false

	if class_data.default_melee != &"" and slots.get(GameEnums.WeaponSlot.MELEE) == null:
		give_weapon(class_data.default_melee, false)
	if class_data.default_secondary != &"" and slots.get(GameEnums.WeaponSlot.SECONDARY) == null:
		give_weapon(class_data.default_secondary, false)
	if class_data.default_primary != &"" and slots.get(GameEnums.WeaponSlot.PRIMARY) == null:
		give_weapon(class_data.default_primary, false)

	refill_all_ammo()
	active_slot = GameEnums.WeaponSlot.MELEE
	equip_best_available()

func clear_weapons() -> void:
	for slot in SLOT_ORDER:
		slots[slot] = null
