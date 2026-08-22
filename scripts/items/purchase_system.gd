class_name PurchaseSystem
extends Node

## The only place an item changes hands.
##
## Every purchase is decided here, on the authority: match running, champion
## alive, standing in its own shop zone, enough gold, a free slot. A client can
## ask; it can never grant. The same call serves the offline game, the host and
## a validated client request, so there is one rule set rather than three.

signal purchase_succeeded(champion: ChampionController, item: ItemData)
signal purchase_rejected(champion: ChampionController, item_id: String, reason: String)

@export var catalog: ShopCatalog
## Lets a debug mode or a future map sell from anywhere.
var require_shop_zone: bool = true

var _zones: Array = []


func setup(shop_catalog: ShopCatalog) -> void:
	catalog = shop_catalog


func register_zone(zone: ShopZone) -> void:
	if zone != null and not _zones.has(zone):
		_zones.append(zone)


func zones() -> Array:
	return _zones.duplicate()


## The shop this champion may currently use, or null.
func zone_for(champion: Node3D) -> ShopZone:
	for zone in _zones:
		if is_instance_valid(zone) and zone.accepts(champion):
			return zone
	return null


func can_shop(champion: Node3D) -> bool:
	if champion == null or not is_instance_valid(champion) or not champion.is_alive():
		return false
	return not require_shop_zone or zone_for(champion) != null


## Why a purchase would fail, or an empty string if it would succeed.
func rejection_reason(champion: ChampionController, item: ItemData) -> String:
	if champion == null or not is_instance_valid(champion):
		return "no champion"
	if item == null:
		return "unknown item"
	if not champion.is_alive():
		return "dead"
	if require_shop_zone and zone_for(champion) == null:
		return "not in the shop"
	if champion.inventory == null or not champion.inventory.has_space():
		return "inventory full"
	if champion.wallet == null or not champion.wallet.can_afford(item.cost):
		return "not enough gold"
	return ""


## Authority-side purchase. Returns true only when gold actually moved.
func purchase(champion: ChampionController, item_id: String) -> bool:
	if not Net.is_authority() or catalog == null:
		return false
	var item := catalog.item_by_id(item_id)
	var reason := rejection_reason(champion, item)
	if not reason.is_empty():
		purchase_rejected.emit(champion, item_id, reason)
		return false
	if not champion.wallet.spend(item.cost):
		purchase_rejected.emit(champion, item_id, "not enough gold")
		return false
	if champion.inventory.add_item(item) < 0:
		# Should not happen after the check above, but never silently eat gold.
		champion.wallet.add(item.cost, "refund")
		purchase_rejected.emit(champion, item_id, "inventory full")
		return false
	purchase_succeeded.emit(champion, item)
	return true


## Selling back is out of scope; clearing is a developer convenience.
func clear_inventory(champion: ChampionController) -> int:
	if not Net.is_authority() or champion == null or champion.inventory == null:
		return 0
	var removed := champion.inventory.count()
	champion.inventory.clear()
	return removed
