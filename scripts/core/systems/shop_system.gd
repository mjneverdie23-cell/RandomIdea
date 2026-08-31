## The buy menu rules.
##
## Every restriction (phase, buy zone, class, side, money, duplicates) is checked
## in one place and reported with a reason the UI can display. What the shop
## *contains* comes from the data resources, not from here.
class_name ShopSystem
extends RefCounted

## Display order of the buy menu. Categories with no purchasable item are hidden.
const CATEGORY_ORDER := [
	GameEnums.WeaponCategory.PISTOL,
	GameEnums.WeaponCategory.SMG,
	GameEnums.WeaponCategory.RIFLE,
	GameEnums.WeaponCategory.SNIPER,
	GameEnums.WeaponCategory.SHOTGUN,
	GameEnums.WeaponCategory.LMG,
	GameEnums.WeaponCategory.EQUIPMENT,
]
const CATEGORY_NAMES := {
	GameEnums.WeaponCategory.PISTOL: "Sidearms",
	GameEnums.WeaponCategory.SMG: "SMGs",
	GameEnums.WeaponCategory.RIFLE: "Rifles",
	GameEnums.WeaponCategory.SNIPER: "Snipers",
	GameEnums.WeaponCategory.SHOTGUN: "Shotguns",
	GameEnums.WeaponCategory.LMG: "Heavy",
	GameEnums.WeaponCategory.EQUIPMENT: "Gear",
	GameEnums.WeaponCategory.MELEE: "Melee",
}

var session
var teams: TeamManager
var economy: EconomySystem

func _init(p_session, p_teams: TeamManager, p_economy: EconomySystem) -> void:
	session = p_session
	teams = p_teams
	economy = p_economy

func is_buy_phase() -> bool:
	return Config.game.shop_allowed_phases.has(session.round_manager.phase)

func in_buy_zone(character) -> bool:
	if not Config.game.shop_require_spawn_zone:
		return true
	var zone = session.map_definition.buy_zone_for(teams.side_of(character.team_id))
	return zone.has_point(Vector2(character.global_position.x, character.global_position.z))

func can_buy(character, item_id: StringName) -> GameEnums.PurchaseResult:
	var item := Config.item(item_id)
	if item == null:
		return GameEnums.PurchaseResult.UNKNOWN_ITEM
	if not character.health.alive:
		return GameEnums.PurchaseResult.DEAD
	if not is_buy_phase():
		return GameEnums.PurchaseResult.WRONG_PHASE
	if not in_buy_zone(character):
		return GameEnums.PurchaseResult.NOT_IN_BUY_ZONE
	if item is EquipmentData and item.side_restriction >= 0 \
			and teams.side_of(character.team_id) != item.side_restriction:
		return GameEnums.PurchaseResult.SIDE_RESTRICTED
	if not Config.is_item_allowed_for_class(item_id, character.class_id):
		return GameEnums.PurchaseResult.CLASS_RESTRICTED
	if item is EquipmentData and not item.can_buy(character):
		return GameEnums.PurchaseResult.ALREADY_OWNED
	if character.money < item.price:
		return GameEnums.PurchaseResult.NOT_ENOUGH_MONEY
	return GameEnums.PurchaseResult.OK

func buy(character, item_id: StringName) -> GameEnums.PurchaseResult:
	var result := can_buy(character, item_id)
	if result != GameEnums.PurchaseResult.OK:
		Events.purchase_rejected.emit(character, item_id, result)
		return result

	var item := Config.item(item_id)
	economy.spend(character, item.price, StringName("buy:%s" % item_id))
	if item is EquipmentData:
		item.apply(character)
	else:
		character.inventory.give_weapon(item_id, item.slot == GameEnums.WeaponSlot.PRIMARY)
	Events.item_purchased.emit(character, item_id, item.price)
	return GameEnums.PurchaseResult.OK

## Shop contents for one character, ready to render.
## Returns [{category, name, items: [{id, name, price, available, reason, stats}]}]
func list_for(character) -> Array[Dictionary]:
	var by_category := {}
	for item in Config.weapons.values() + Config.equipment.values():
		if not Config.is_item_allowed_for_class(item.id, character.class_id):
			continue
		if item is WeaponData and item.category == GameEnums.WeaponCategory.MELEE:
			continue
		var result := can_buy(character, item.id)
		var entry := {
			"id": item.id,
			"name": item.display_name,
			"price": item.price,
			"available": result == GameEnums.PurchaseResult.OK,
			"reason": result,
			"stats": "",
		}
		if item is WeaponData:
			entry["stats"] = "dmg %d - %d rpm - mag %s - %dm" % [
				int(item.damage), int(item.fire_rate),
				"-" if item.mag_size < 0 else str(item.mag_size), int(item.range)]
		else:
			entry["stats"] = item.description
		if not by_category.has(item.category):
			by_category[item.category] = []
		by_category[item.category].append(entry)

	var out: Array[Dictionary] = []
	for category in CATEGORY_ORDER:
		if not by_category.has(category):
			continue
		var entries: Array = by_category[category]
		entries.sort_custom(func(a, b): return a["price"] < b["price"])
		out.append({
			"category": category,
			"name": CATEGORY_NAMES.get(category, "Other"),
			"items": entries,
		})
	return out

## Used by bots: buy the first affordable item from a wish list.
func buy_from_priority(character, priority: Array) -> bool:
	for item_id in priority:
		if can_buy(character, item_id) == GameEnums.PurchaseResult.OK:
			return buy(character, item_id) == GameEnums.PurchaseResult.OK
	return false
