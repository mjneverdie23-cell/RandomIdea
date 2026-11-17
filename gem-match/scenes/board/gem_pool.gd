class_name GemPool
extends Node
## Recycles Gem instances so gameplay never calls instantiate() or queue_free().
## Gems that are not in use are children of this node, hidden and with processing disabled.

@export var gem_scene: PackedScene

var _available: Array[Gem] = []
var _total_created: int = 0


## Creates gems up front, before play starts, so the pool does not grow during a level.
func prewarm(count: int) -> void:
	while _total_created < count:
		_available.push_back(_create_gem())


## Takes a gem from the pool and makes it a visible child of `new_parent`.
func acquire(new_parent: Node) -> Gem:
	var gem: Gem
	if _available.is_empty():
		push_warning("GemPool ran out after %d gems and is growing. Prewarm more." % _total_created)
		gem = _create_gem()
	else:
		gem = _available.pop_back()
	remove_child(gem)
	new_parent.add_child(gem)
	gem.process_mode = Node.PROCESS_MODE_INHERIT
	gem.show()
	return gem


## Resets a gem and returns it to the pool.
func release(gem: Gem) -> void:
	if gem.get_parent() == self:
		push_error("GemPool: gem released twice.")
		return
	gem.reset_for_pool()
	gem.hide()
	gem.process_mode = Node.PROCESS_MODE_DISABLED
	gem.get_parent().remove_child(gem)
	add_child(gem)
	_available.push_back(gem)


func _create_gem() -> Gem:
	assert(gem_scene != null, "GemPool.gem_scene is not set.")
	var gem := gem_scene.instantiate() as Gem
	gem.hide()
	gem.process_mode = Node.PROCESS_MODE_DISABLED
	add_child(gem)
	_total_created += 1
	return gem
