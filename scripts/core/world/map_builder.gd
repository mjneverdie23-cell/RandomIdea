## Turns a CompiledMap into scene nodes: collision, meshes, navigation region,
## bomb-site markers and spawn markers.
##
## This is the only place map geometry becomes visible. Replacing the primitives
## with real art means changing `_create_solid_mesh()` or registering a prop model
## (see `prop_models`), and never touching the layout data.
class_name MapBuilder
extends Node3D

const WORLD_LAYER := 1

var compiled: CompiledMap
## prop id or PropKind -> Callable(prop: MapProp) -> Node3D. Register real models here.
var prop_models: Dictionary = {}

var _materials: Dictionary = {}
var _solid_body: StaticBody3D
var _navigation_region: NavigationRegion3D

## Builds everything and returns the compiled map for other systems to query.
func build(definition: MapDefinition) -> CompiledMap:
	compiled = CompiledMap.compile(definition)
	_build_ground(definition)
	_build_solids(definition)
	_build_navigation()
	_build_site_markers(definition)
	_build_spawn_markers(definition)
	return compiled

func _material_for(color: Color) -> StandardMaterial3D:
	var key := color.to_html()
	if not _materials.has(key):
		var material := StandardMaterial3D.new()
		material.albedo_color = color
		material.roughness = 0.95
		_materials[key] = material
	return _materials[key]

func _build_ground(definition: MapDefinition) -> void:
	# One slab under the whole map: every area rests on it, so no area can be
	# authored without a floor underneath it.
	var body := StaticBody3D.new()
	body.name = "Ground"
	body.collision_layer = WORLD_LAYER
	body.collision_mask = 0
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(compiled.bounds.size.x + 40.0, 2.0, compiled.bounds.size.z + 40.0)
	shape.shape = box
	shape.position = Vector3(compiled.bounds.get_center().x, -1.0, compiled.bounds.get_center().z)
	body.add_child(shape)
	add_child(body)

	var base := MeshInstance3D.new()
	base.name = "GroundMesh"
	var base_mesh := PlaneMesh.new()
	base_mesh.size = Vector2(box.size.x, box.size.z)
	base.mesh = base_mesh
	base.material_override = _material_for(Color("6d6350"))
	base.position = Vector3(compiled.bounds.get_center().x, 0.0, compiled.bounds.get_center().z)
	add_child(base)

	# A brighter quad per walkable area, so the layout reads from above.
	var floors := Node3D.new()
	floors.name = "AreaFloors"
	add_child(floors)
	for area in definition.areas:
		var mesh_instance := MeshInstance3D.new()
		mesh_instance.name = "floor_%s" % area.id
		var plane := PlaneMesh.new()
		plane.size = area.rect.size
		mesh_instance.mesh = plane
		mesh_instance.material_override = _material_for(definition.floor_color)
		var center := area.rect.get_center()
		mesh_instance.position = Vector3(center.x, 0.01, center.y)
		floors.add_child(mesh_instance)

func _build_solids(definition: MapDefinition) -> void:
	_solid_body = StaticBody3D.new()
	_solid_body.name = "Solids"
	_solid_body.collision_layer = WORLD_LAYER
	_solid_body.collision_mask = 0
	add_child(_solid_body)

	for prop in compiled.solids:
		var basis_rotation := Basis.from_euler(Vector3(
			deg_to_rad(prop.rotation_degrees_axis.x),
			deg_to_rad(prop.rotation_degrees_axis.y),
			deg_to_rad(prop.rotation_degrees_axis.z)))

		if prop.collidable:
			var collision := CollisionShape3D.new()
			collision.name = "col_%s" % prop.id
			if prop.shape == MapProp.Shape.CYLINDER:
				var cylinder := CylinderShape3D.new()
				cylinder.radius = prop.size.x * 0.5
				cylinder.height = prop.size.y
				collision.shape = cylinder
			else:
				var box := BoxShape3D.new()
				box.size = prop.size
				collision.shape = box
			collision.transform = Transform3D(basis_rotation, prop.position)
			_solid_body.add_child(collision)

		var visual := _create_solid_mesh(prop)
		if visual != null:
			visual.transform = Transform3D(basis_rotation, prop.position)
			visual.name = String(prop.id)
			_solid_body.add_child(visual)

## PLACEHOLDER geometry: boxes and cylinders. Swap in real art here, or register
## a factory in `prop_models` keyed by prop id or PropKind.
func _create_solid_mesh(prop: MapProp) -> Node3D:
	if prop_models.has(prop.id):
		return (prop_models[prop.id] as Callable).call(prop)
	if prop_models.has(prop.kind):
		return (prop_models[prop.kind] as Callable).call(prop)

	var mesh_instance := MeshInstance3D.new()
	if prop.shape == MapProp.Shape.CYLINDER:
		var cylinder := CylinderMesh.new()
		cylinder.top_radius = prop.size.x * 0.5
		cylinder.bottom_radius = prop.size.x * 0.5
		cylinder.height = prop.size.y
		cylinder.radial_segments = 12
		mesh_instance.mesh = cylinder
	else:
		var box := BoxMesh.new()
		box.size = prop.size
		mesh_instance.mesh = box
	mesh_instance.material_override = _material_for(prop.color)
	return mesh_instance

func _build_navigation() -> void:
	_navigation_region = NavigationRegion3D.new()
	_navigation_region.name = "Navigation"
	_navigation_region.navigation_mesh = compiled.build_navigation_mesh()
	add_child(_navigation_region)

func _build_site_markers(definition: MapDefinition) -> void:
	var markers := Node3D.new()
	markers.name = "BombSites"
	add_child(markers)
	for site in definition.bomb_sites:
		var quad := MeshInstance3D.new()
		var plane := PlaneMesh.new()
		plane.size = site.rect.size
		quad.mesh = plane
		var material := StandardMaterial3D.new()
		material.albedo_color = Color(site.color.r, site.color.g, site.color.b, 0.18)
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		quad.material_override = material
		var center := site.rect.get_center()
		quad.position = Vector3(center.x, 0.06, center.y)
		quad.name = "site_%s" % site.id
		markers.add_child(quad)

		var label := Label3D.new()
		label.text = String(site.id)
		label.font_size = 256
		label.pixel_size = 0.02
		label.modulate = Color(site.color, 0.75)
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.no_depth_test = false
		label.position = Vector3(center.x, 4.0, center.y)
		markers.add_child(label)

func _build_spawn_markers(definition: MapDefinition) -> void:
	var markers := Node3D.new()
	markers.name = "SpawnMarkers"
	add_child(markers)
	for side in [GameEnums.Side.ATTACKERS, GameEnums.Side.DEFENDERS]:
		var color := Color("e0a54a") if side == GameEnums.Side.ATTACKERS else Color("59a5e0")
		for point in definition.spawns_for(side):
			var ring := MeshInstance3D.new()
			var torus := TorusMesh.new()
			torus.inner_radius = 0.5
			torus.outer_radius = 0.7
			ring.mesh = torus
			var material := StandardMaterial3D.new()
			material.albedo_color = Color(color, 0.5)
			material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			ring.material_override = material
			ring.position = point.position + Vector3(0, 0.05, 0)
			markers.add_child(ring)
