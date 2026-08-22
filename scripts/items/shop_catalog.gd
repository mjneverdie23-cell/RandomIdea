@tool
class_name ShopCatalog
extends Resource

## What a shop sells, in the order it is shown.

@export var display_name: String = "Shop"
@export var items: Array[ItemData] = []


func item_by_id(id: String) -> ItemData:
	for item in items:
		if item != null and item.id == id:
			return item
	return null


func size() -> int:
	return items.size()
