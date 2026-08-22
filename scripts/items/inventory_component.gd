class_name InventoryComponent
extends Node

## A champion's item slots.
##
## Adding an item registers one [StatsComponent] modifier keyed by slot, so
## removing it is exact and two copies of the same item stack correctly.

signal inventory_changed()
signal item_added(item: ItemData, slot: int)
signal item_removed(item: ItemData, slot: int)

const MODIFIER_PREFIX := "item_slot_"

var slots: int = 6

var _items: Array = []
var _unit: Unit
var _cooldowns: PackedFloat32Array = PackedFloat32Array()


func setup(unit: Unit, slot_count: int) -> void:
	_unit = unit
	slots = maxi(slot_count, 1)
	_items = []
	_items.resize(slots)
	_cooldowns = PackedFloat32Array()
	_cooldowns.resize(slots)
	inventory_changed.emit()


func item_at(slot: int) -> ItemData:
	if slot < 0 or slot >= _items.size():
		return null
	return _items[slot]


func items() -> Array:
	return _items.duplicate()


func item_ids() -> PackedStringArray:
	var out := PackedStringArray()
	for item in _items:
		out.append(item.id if item != null else "")
	return out


func first_free_slot() -> int:
	for i in _items.size():
		if _items[i] == null:
			return -1 if false else i
	return -1


func has_space() -> bool:
	return first_free_slot() >= 0


func count() -> int:
	var total := 0
	for item in _items:
		if item != null:
			total += 1
	return total


## Authority-side insert. Returns the slot used, or -1 when full.
func add_item(item: ItemData) -> int:
	var slot := first_free_slot()
	if item == null or slot < 0:
		return -1
	_items[slot] = item
	_apply(slot, item)
	item_added.emit(item, slot)
	inventory_changed.emit()
	return slot


func remove_slot(slot: int) -> ItemData:
	var item := item_at(slot)
	if item == null:
		return null
	_items[slot] = null
	_cooldowns[slot] = 0.0
	if _unit != null and _unit.stats != null:
		_unit.stats.remove_modifier(MODIFIER_PREFIX + str(slot))
	item_removed.emit(item, slot)
	inventory_changed.emit()
	return item


func clear() -> void:
	for i in _items.size():
		remove_slot(i)


func _apply(slot: int, item: ItemData) -> void:
	if _unit == null or _unit.stats == null:
		return
	_unit.stats.add_modifier(MODIFIER_PREFIX + str(slot), item.modifier_fields())


## Re-registers every item's stat modifier. Used after a respawn clears the
## stat stack: items are permanent, buffs are not.
func reapply_all() -> void:
	for i in _items.size():
		if _items[i] != null:
			_apply(i, _items[i])


func tick(delta: float) -> void:
	for i in _cooldowns.size():
		_cooldowns[i] = maxf(_cooldowns[i] - delta, 0.0)


func active_cooldown(slot: int) -> float:
	return _cooldowns[slot] if slot >= 0 and slot < _cooldowns.size() else 0.0


func start_active(slot: int) -> bool:
	var item := item_at(slot)
	if item == null or not item.has_active() or active_cooldown(slot) > 0.0:
		return false
	_cooldowns[slot] = item.active_cooldown
	return true


## Rebuilds the inventory from replicated ids. Clients call only this.
func apply_replicated(ids: PackedStringArray, catalog: ShopCatalog) -> void:
	if catalog == null:
		return
	var changed := false
	for i in mini(ids.size(), _items.size()):
		var wanted: ItemData = catalog.item_by_id(ids[i]) if not ids[i].is_empty() else null
		var current: ItemData = _items[i]
		if wanted == current:
			continue
		changed = true
		_items[i] = wanted
		if wanted == null:
			if _unit != null and _unit.stats != null:
				_unit.stats.remove_modifier(MODIFIER_PREFIX + str(i))
		else:
			_apply(i, wanted)
	if changed:
		inventory_changed.emit()
