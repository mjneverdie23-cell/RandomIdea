## First-person weapon view model: the gun you see in your own hands.
##
## Purely cosmetic - recoil kick, sway, ADS offset and a reload tilt, all driven
## from weapon state the simulation already tracks.
##
## PLACEHOLDER geometry. To use a real weapon model, register a factory in
## WEAPON_MODELS keyed by WeaponData.model_key.
class_name ViewModel
extends Node3D

const HIP_POSITION := Vector3(0.22, -0.2, -0.42)
const ADS_POSITION := Vector3(0.0, -0.12, -0.32)

## model key -> Callable(weapon_data) -> Node3D
static var WEAPON_MODELS: Dictionary = {}

static func register_weapon_model(model_key: StringName, factory: Callable) -> void:
	WEAPON_MODELS[model_key] = factory

var _current_weapon_id: StringName = &""
var _model: Node3D
var _kick: float = 0.0
var _ads_blend: float = 0.0

func _ready() -> void:
	Events.weapon_fired.connect(func(character, _w, _o, _d):
		if character == Game.local_player():
			add_kick(1.0))

func add_kick(amount: float) -> void:
	_kick = minf(1.4, _kick + amount * 0.35)

func update(delta: float, character: Character) -> void:
	var weapon := character.inventory.active_weapon()
	_set_weapon(weapon)
	visible = weapon != null and character.health.alive
	if _model == null or weapon == null:
		return

	var aiming: bool = character.intent.aim and weapon.data.ads_zoom > 1.0
	var target_blend := 1.0 if aiming else 0.0
	_ads_blend = lerpf(_ads_blend, target_blend, minf(1.0, delta / maxf(0.01, weapon.data.ads_time)))

	var target := HIP_POSITION.lerp(ADS_POSITION, _ads_blend)
	# Bobbing sells the walk without an animation.
	var bob := sin(Time.get_ticks_msec() / 1000.0 * 9.0) * 0.012 \
		* minf(1.0, character.horizontal_speed() / 5.0) * (1.0 - _ads_blend)
	_kick = maxf(0.0, _kick - delta * 6.0)

	position = Vector3(target.x, target.y + bob, target.z + _kick * 0.09)
	var reload_tilt := 0.0
	var reload_roll := 0.0
	if weapon.reloading:
		reload_tilt = sin(Time.get_ticks_msec() / 200.0) * 0.25 - 0.35
		reload_roll = 0.4
	rotation = Vector3(-_kick * 0.25 + reload_tilt, _ads_blend * 0.02, reload_roll)

func _set_weapon(weapon: Weapon) -> void:
	var id: StringName = weapon.data.id if weapon != null else &""
	if id == _current_weapon_id:
		return
	_current_weapon_id = id
	if _model != null:
		_model.queue_free()
		_model = null
	if weapon == null:
		return
	if WEAPON_MODELS.has(weapon.data.model_key):
		_model = (WEAPON_MODELS[weapon.data.model_key] as Callable).call(weapon.data)
	else:
		_model = _build_placeholder(weapon.data)
	add_child(_model)

## PLACEHOLDER weapon: a receiver, a grip and (for scoped guns) a scope.
func _build_placeholder(data: WeaponData) -> Node3D:
	var root := Node3D.new()
	var material := StandardMaterial3D.new()
	material.albedo_color = data.color
	material.roughness = 0.7

	# Length scales with range, so different guns read differently in hand.
	var length := minf(1.3, 0.45 + data.range / 220.0)
	var receiver := MeshInstance3D.new()
	var receiver_mesh := BoxMesh.new()
	receiver_mesh.size = Vector3(0.09, 0.13, length)
	receiver.mesh = receiver_mesh
	receiver.material_override = material
	receiver.position.z = -length * 0.5
	root.add_child(receiver)

	var grip := MeshInstance3D.new()
	var grip_mesh := BoxMesh.new()
	grip_mesh.size = Vector3(0.07, 0.2, 0.09)
	grip.mesh = grip_mesh
	grip.material_override = material
	grip.position = Vector3(0, -0.14, -0.12)
	root.add_child(grip)

	if data.ads_zoom >= 2.0:
		var scope := MeshInstance3D.new()
		var scope_mesh := CylinderMesh.new()
		scope_mesh.top_radius = 0.035
		scope_mesh.bottom_radius = 0.035
		scope_mesh.height = 0.28
		scope.mesh = scope_mesh
		scope.material_override = material
		scope.rotation_degrees.x = 90.0
		scope.position = Vector3(0, 0.11, -length * 0.45)
		root.add_child(scope)
	return root
