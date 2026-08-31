## PLACEHOLDER dinosaur: a coloured capsule with a team band, a head marker and a
## snout for facing. Implements the optional model interface, so replacing it
## with a real model changes nothing outside CharacterModels.
extends Node3D

var _body_material: StandardMaterial3D
var _band_material: StandardMaterial3D
var _base_scale: Vector3 = Vector3.ONE

func build(class_data: CharacterClassData, team_color: Color) -> void:
	var radius := class_data.hitbox_radius
	var height := class_data.hitbox_height

	_body_material = StandardMaterial3D.new()
	_body_material.albedo_color = class_data.color
	_body_material.roughness = 0.9

	var body := MeshInstance3D.new()
	var capsule := CapsuleMesh.new()
	capsule.radius = radius
	capsule.height = maxf(height, radius * 2.0 + 0.01)
	body.mesh = capsule
	body.material_override = _body_material
	body.position.y = height * 0.5
	add_child(body)

	# Team band - readable at a distance and from any angle.
	_band_material = StandardMaterial3D.new()
	_band_material.albedo_color = team_color
	var band := MeshInstance3D.new()
	var band_mesh := CylinderMesh.new()
	band_mesh.top_radius = radius * 1.06
	band_mesh.bottom_radius = radius * 1.06
	band_mesh.height = 0.24
	band.mesh = band_mesh
	band.material_override = _band_material
	band.position.y = height * 0.55
	add_child(band)

	# Head marker: shows where the headshot hitbox actually is.
	var head := MeshInstance3D.new()
	var head_mesh := SphereMesh.new()
	head_mesh.radius = radius * 0.42
	head_mesh.height = radius * 0.84
	head.mesh = head_mesh
	var head_material := StandardMaterial3D.new()
	head_material.albedo_color = Color("f2e2c4")
	head.material_override = head_material
	head.position.y = height * 0.92
	add_child(head)

	# Snout: a facing indicator, and a stand-in for a dinosaur head.
	var snout := MeshInstance3D.new()
	var snout_mesh := CylinderMesh.new()
	snout_mesh.top_radius = 0.02
	snout_mesh.bottom_radius = radius * 0.3
	snout_mesh.height = 0.55
	snout.mesh = snout_mesh
	snout.material_override = head_material
	snout.rotation_degrees.x = -90.0
	snout.position = Vector3(0, height * 0.92, -radius - 0.2)
	add_child(snout)

	_base_scale = Vector3(class_data.model_scale, 1.0, class_data.model_scale)
	scale = _base_scale

# --- optional model interface -------------------------------------------------
func set_pose(pose: Dictionary) -> void:
	rotation.y = pose.get("yaw", 0.0)
	# Crouching squashes the placeholder instead of animating it.
	var target_y: float = 0.62 if pose.get("crouching", false) else 1.0
	scale.y = lerpf(scale.y, target_y, 0.35)
	scale.x = _base_scale.x
	scale.z = _base_scale.z

func play_animation(animation: StringName) -> void:
	# PLACEHOLDER: capsules have no animation, so death just tips them over.
	rotation.z = PI / 2.2 if animation == &"death" else 0.0

func set_team_color(color: Color) -> void:
	if _band_material != null:
		_band_material.albedo_color = color

func set_opacity(value: float) -> void:
	for material in [_body_material, _band_material]:
		if material == null:
			continue
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA if value < 1.0 else BaseMaterial3D.TRANSPARENCY_DISABLED
		material.albedo_color.a = value
