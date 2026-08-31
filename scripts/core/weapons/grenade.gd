## A thrown explosive. Physics comes from RigidBody3D, so bouncing off geometry
## is the engine's job rather than ours.
class_name Grenade
extends RigidBody3D

var data: EquipmentData
var owner_character
var combat
var fuse_remaining: float = 2.5

func setup(p_data: EquipmentData, p_owner, p_combat) -> void:
	data = p_data
	owner_character = p_owner
	combat = p_combat
	fuse_remaining = p_data.fuse_time

	collision_layer = 4
	collision_mask = 1
	gravity_scale = 1.0
	continuous_cd = true

	var shape := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = 0.18
	shape.shape = sphere
	add_child(shape)

	var material := PhysicsMaterial.new()
	material.bounce = p_data.bounce
	material.friction = 0.6
	physics_material_override = material

	var mesh := MeshInstance3D.new()
	var sphere_mesh := SphereMesh.new()
	sphere_mesh.radius = 0.18
	sphere_mesh.height = 0.36
	mesh.mesh = sphere_mesh
	var visual_material := StandardMaterial3D.new()
	visual_material.albedo_color = Color("4a6b3a")
	mesh.material_override = visual_material
	add_child(mesh)

func _physics_process(delta: float) -> void:
	fuse_remaining -= delta
	if fuse_remaining <= 0.0:
		combat.explode_grenade(self)
		queue_free()
