class_name PrototypeMeshes
extends RefCounted

## The one and only place where prototype geometry and colours are created.
##
## Every builder asks this factory for its visuals, so replacing the low-poly
## placeholders with real art means rewriting this file (or swapping the calls
## for scene instances) without touching map, navigation or gameplay logic.

const COLOR_GROUND := Color(0.15, 0.22, 0.16)
const COLOR_WALL := Color(0.21, 0.24, 0.27)
const COLOR_LANE := Color(0.68, 0.60, 0.42)
const COLOR_RIVER := Color(0.22, 0.52, 0.74)
const COLOR_JUNGLE := Color(0.20, 0.40, 0.24)
const COLOR_ENTRANCE := Color(0.50, 0.46, 0.36)
const COLOR_TEAM_A := Color(0.25, 0.55, 0.95)
const COLOR_TEAM_B := Color(0.92, 0.34, 0.28)
const COLOR_NEUTRAL := Color(0.75, 0.66, 0.28)
const COLOR_CAMP := Color(0.45, 0.40, 0.18)
const COLOR_OBJECTIVE := Color(0.55, 0.28, 0.62)
const COLOR_MONSTER := Color(0.62, 0.52, 0.24)

## Y offsets used to keep the flat area decals from z-fighting each other.
const DECAL_Y_BASE := 0.04
const DECAL_Y_JUNGLE := 0.06
const DECAL_Y_LANE := 0.08
const DECAL_Y_ENTRANCE := 0.10
const DECAL_Y_RIVER := 0.12
const DECAL_Y_OBJECTIVE := 0.14
const DECAL_Y_CAMP := 0.16

static var _materials: Dictionary = {}


static func team_color(team: int) -> Color:
	return COLOR_TEAM_A if team == MapEnums.Team.A else COLOR_TEAM_B


## Shared, cached material. Cheap for a prototype and keeps draw calls sane.
static func material(color: Color, unshaded: bool = false, emission: float = 0.0) -> StandardMaterial3D:
	var key := "%s|%s|%s" % [color, unshaded, emission]
	if _materials.has(key):
		return _materials[key]
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = 0.95
	mat.metallic = 0.0
	if color.a < 1.0:
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	if unshaded:
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	if emission > 0.0:
		mat.emission_enabled = true
		mat.emission = color
		mat.emission_energy_multiplier = emission
	_materials[key] = mat
	return mat


static func box(size: Vector3, color: Color) -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	return _instance(mesh, color)


static func cylinder(radius: float, height: float, color: Color, sides: int = 12) -> MeshInstance3D:
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = sides
	mesh.rings = 1
	return _instance(mesh, color)


static func cone(radius: float, height: float, color: Color, sides: int = 10) -> MeshInstance3D:
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.0
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = sides
	mesh.rings = 1
	return _instance(mesh, color)


static func sphere(radius: float, color: Color) -> MeshInstance3D:
	var mesh := SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	mesh.radial_segments = 12
	mesh.rings = 6
	return _instance(mesh, color)


static func capsule(radius: float, height: float, color: Color) -> MeshInstance3D:
	var mesh := CapsuleMesh.new()
	mesh.radius = radius
	mesh.height = maxf(height, radius * 2.0 + 0.01)
	mesh.radial_segments = 12
	mesh.rings = 4
	return _instance(mesh, color)


## Flat rectangle laid on the ground between two XZ points. Used for lanes,
## the river and jungle corridors.
static func band_decal(a: Vector2, b: Vector2, width: float, color: Color, y: float) -> MeshInstance3D:
	var length := a.distance_to(b)
	var node := box(Vector3(width, 0.02, maxf(length, 0.01)), color)
	var mid := (a + b) * 0.5
	node.position = Vector3(mid.x, y, mid.y)
	var dir := b - a
	if dir.length_squared() > 0.0001:
		node.rotation.y = atan2(dir.x, dir.y)
	return node


static func disk_decal(center: Vector2, radius: float, color: Color, y: float, sides: int = 20) -> MeshInstance3D:
	var node := cylinder(radius, 0.02, color, sides)
	node.position = Vector3(center.x, y, center.y)
	return node


## Flat convex polygon laid on the ground, used for jungle quadrants.
static func polygon_decal(points: PackedVector2Array, color: Color, y: float) -> MeshInstance3D:
	var mesh := ArrayMesh.new()
	var vertices := PackedVector3Array()
	var indices := PackedInt32Array()
	var normals := PackedVector3Array()
	for p in points:
		vertices.append(Vector3(p.x, 0.0, p.y))
		normals.append(Vector3.UP)
	var triangulated := Geometry2D.triangulate_polygon(points)
	if triangulated.is_empty():
		return _instance(mesh, color)
	# triangulate_polygon returns clockwise triangles for our winding; flip so
	# the surface faces up.
	for i in range(0, triangulated.size(), 3):
		indices.append(triangulated[i])
		indices.append(triangulated[i + 2])
		indices.append(triangulated[i + 1])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_INDEX] = indices
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var node := _instance(mesh, color)
	node.position.y = y
	return node


## Hollow ring drawn with an unshaded torus-like flat mesh, for turret ranges.
static func ring(radius: float, thickness: float, color: Color, segments: int = 32) -> MeshInstance3D:
	var mesh := ArrayMesh.new()
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var indices := PackedInt32Array()
	var inner := maxf(radius - thickness, 0.01)
	for i in segments:
		var angle := TAU * float(i) / float(segments)
		var dir := Vector3(cos(angle), 0.0, sin(angle))
		vertices.append(dir * inner)
		vertices.append(dir * radius)
		normals.append(Vector3.UP)
		normals.append(Vector3.UP)
	for i in segments:
		var i0 := i * 2
		var i1 := i * 2 + 1
		var i2 := ((i + 1) % segments) * 2
		var i3 := ((i + 1) % segments) * 2 + 1
		indices.append_array([i0, i1, i3, i0, i3, i2])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_INDEX] = indices
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var node := _instance(mesh, color, true)
	return node


## Simple line strip on the XZ plane, used by the debug renderer.
static func polyline(points: PackedVector2Array, color: Color, y: float) -> MeshInstance3D:
	var mesh := ImmediateMesh.new()
	var mat := material(color, true)
	mesh.surface_begin(Mesh.PRIMITIVE_LINE_STRIP, mat)
	for p in points:
		mesh.surface_add_vertex(Vector3(p.x, y, p.y))
	mesh.surface_end()
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = mat
	return node


static func _instance(mesh: Mesh, color: Color, unshaded: bool = false) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.material_override = material(color, unshaded)
	return node
