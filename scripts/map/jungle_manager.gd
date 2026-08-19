class_name JungleManager
extends Node3D

## Owns the four jungle quadrants: their walkable footprint, the corridors that
## connect them to lanes/river/base, and the placeholder camps.
##
## Camp monsters are markers only. They are deliberately collision-free so the
## navigation mesh stays identical whether or not a camp is alive; the future
## camp system can add bodies and behaviour without changing the map.

## How many placeholder monsters each camp size spawns, and how big they are.
const CAMP_PROFILES := {
	MapEnums.CampSize.SMALL: {"count": 3, "size": 0.55},
	MapEnums.CampSize.MEDIUM: {"count": 2, "size": 0.85},
	MapEnums.CampSize.LARGE: {"count": 1, "size": 1.5},
	MapEnums.CampSize.BUFF: {"count": 1, "size": 2.1},
}

var _layout: MapLayout
var _camp_nodes: Dictionary = {}


func build(layout: MapLayout, registry: MapRegistry) -> void:
	_layout = layout
	for child in get_children():
		child.queue_free()
	_camp_nodes.clear()

	for jungle in _layout.jungles:
		var holder := Node3D.new()
		holder.name = String(jungle["id"])
		add_child(holder)

		var floor_decal := PrototypeMeshes.polygon_decal(
			jungle["polygon"], PrototypeMeshes.COLOR_JUNGLE, PrototypeMeshes.DECAL_Y_JUNGLE
		)
		floor_decal.name = "Floor"
		holder.add_child(floor_decal)

		for entrance in jungle["entrances"]:
			var strip := PrototypeMeshes.band_decal(
				entrance["from"], entrance["to"], _layout.config.jungle_entrance_width,
				PrototypeMeshes.COLOR_ENTRANCE, PrototypeMeshes.DECAL_Y_ENTRANCE
			)
			strip.name = String(entrance["id"])
			holder.add_child(strip)
			registry.register(String(entrance["id"]), "jungle_entrance", entrance, strip)

		var marker := Node3D.new()
		marker.name = "Centre"
		marker.position = MapShapes.to_world(jungle["position"])
		holder.add_child(marker)
		registry.register(String(jungle["id"]), "jungle", jungle, marker)

	for camp in _layout.camps:
		var node := _build_camp(camp)
		add_child(node)
		_camp_nodes[String(camp["id"])] = node
		registry.register(String(camp["id"]), "camp", camp, node)


func camp_node(camp_id: String) -> Node3D:
	return _camp_nodes.get(camp_id, null)


func camp_ids() -> PackedStringArray:
	var out := PackedStringArray()
	for camp in _layout.camps:
		out.append(String(camp["id"]))
	return out


func _build_camp(camp: Dictionary) -> Node3D:
	var size: int = camp["size"]
	var profile: Dictionary = CAMP_PROFILES[size]
	var count: int = profile["count"]
	var monster_size: float = profile["size"]
	var is_buff := size == MapEnums.CampSize.BUFF
	var color := PrototypeMeshes.COLOR_OBJECTIVE if is_buff else PrototypeMeshes.COLOR_MONSTER

	var root := Node3D.new()
	root.name = String(camp["id"])
	root.position = MapShapes.to_world(camp["position"])
	root.add_to_group("jungle_camps")
	root.set_meta("map_id", camp["id"])
	root.set_meta("camp_size", size)

	var clearing := PrototypeMeshes.disk_decal(
		Vector2.ZERO, camp["radius"], PrototypeMeshes.COLOR_CAMP, PrototypeMeshes.DECAL_Y_CAMP
	)
	clearing.name = "Clearing"
	root.add_child(clearing)

	var spawn := Marker3D.new()
	spawn.name = "SpawnPoint"
	root.add_child(spawn)

	for i in count:
		var angle := TAU * float(i) / float(count)
		var spread: float = 0.0 if count == 1 else float(camp["radius"]) * 0.45
		var offset := Vector2(cos(angle), sin(angle)) * spread
		var monster: MeshInstance3D
		if is_buff:
			monster = PrototypeMeshes.capsule(monster_size * 0.6, monster_size * 2.0, color)
		elif size == MapEnums.CampSize.LARGE:
			monster = PrototypeMeshes.box(Vector3.ONE * monster_size * 1.6, color)
		else:
			monster = PrototypeMeshes.sphere(monster_size, color)
		monster.name = "Monster%d" % i
		var aabb := monster.mesh.get_aabb()
		monster.position = Vector3(offset.x, -aabb.position.y, offset.y)
		root.add_child(monster)

	return root
