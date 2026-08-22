class_name BushManager
extends Node3D

## Builds the map's bushes from layout data.
##
## The manager owns the nodes and the registry entries; [VisionManager] owns
## what they mean. Placing a bush is therefore a line of map data, never a
## change to any gameplay script.

var _layout: MapLayout
var _zones: Dictionary = {}


func build(layout: MapLayout, registry: MapRegistry) -> void:
	_layout = layout
	for child in get_children():
		child.queue_free()
	_zones.clear()

	for bush in _layout.bushes:
		var id := String(bush["id"])
		var zone := VisionZone.new()
		zone.setup(id, float(bush["radius"]))
		zone.position = MapShapes.to_world(bush["position"])
		add_child(zone)
		zone.build_visual()
		_zones[id] = zone
		registry.register(id, "bush", bush, zone)


func zone(id: String) -> VisionZone:
	return _zones.get(id, null)


func zone_ids() -> PackedStringArray:
	var out := PackedStringArray()
	for key in _zones.keys():
		out.append(String(key))
	out.sort()
	return out


func count() -> int:
	return _zones.size()
