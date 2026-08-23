class_name AbilityAimIndicator
extends Node3D

## Shows where an ability would land, while the player is holding it aimed.
##
## Two pieces, both local presentation: a ring at the ability's own cast range,
## so "further than my auto attack" is something you can see rather than
## something you have to remember, and an arrow from the champion towards the
## cursor, clamped to that range so it always points at the shot that would
## actually go out.
##
## It draws only; the decision to aim, and the cast that follows, belong to
## [InputCommands] and the champion. Nothing here is replicated — an opponent
## never sees what you are lining up.

var config: RangeDisplayConfig
var champion: ChampionController
## Slot being aimed, or -1 for none.
var slot: int = -1

var _ring: MeshInstance3D
var _arrow: Node3D
var _shaft: MeshInstance3D
var _head: MeshInstance3D
## Cast range the ring was last built for, so it is rebuilt only on a change.
var _ring_range: float = -1.0


func setup(display_config: RangeDisplayConfig, aiming_champion: ChampionController = null) -> void:
	config = display_config if display_config != null else RangeDisplayConfig.new()
	champion = aiming_champion
	_build()
	visible = false


func set_champion(unit: ChampionController) -> void:
	champion = unit
	if slot >= 0:
		aim(slot)


## Start aiming [param new_slot], or stop with -1.
func aim(new_slot: int) -> void:
	slot = new_slot
	var ability := _ability()
	if ability == null or champion == null or not is_instance_valid(champion):
		slot = -1
		visible = false
		return
	_fit_ring(ability.cast_range)
	visible = true
	_follow(champion.commands.aim_point if champion.commands != null else Vector3.ZERO)


func is_aiming() -> bool:
	return visible and slot >= 0


## The point the shot would be aimed at right now, clamped to the ability's
## range — the same clamp [AbilityData] applies when it actually fires.
func aim_point() -> Vector3:
	var ability := _ability()
	if ability == null or champion == null:
		return Vector3.ZERO
	return ability.clamp_aim(champion, champion.commands.aim_point)


func _ability() -> AbilityData:
	if champion == null or not is_instance_valid(champion) or champion.abilities == null:
		return null
	return champion.abilities.ability_for(slot)


func _process(_delta: float) -> void:
	if not is_aiming():
		return
	if champion == null or not is_instance_valid(champion) or not champion.is_alive():
		aim(-1)
		return
	_follow(champion.commands.aim_point if champion.commands != null else Vector3.ZERO)


func _follow(_raw_aim: Vector3) -> void:
	global_position = Vector3(champion.global_position.x, config.height, champion.global_position.z)
	var target := aim_point()
	var offset := Vector3(target.x - global_position.x, 0.0, target.z - global_position.z)
	var length := offset.length()
	if length < 0.05:
		_arrow.visible = false
		return
	_arrow.visible = true
	_arrow.rotation.y = atan2(offset.x, offset.z)
	# The arrow is built pointing at +Z and stretched to the aimed distance.
	var head := minf(config.aim_arrow_head, length * 0.5)
	var shaft := maxf(length - head, 0.01)
	_shaft.position.z = shaft * 0.5
	_shaft.scale.z = shaft
	_head.position.z = shaft + head * 0.5
	_head.scale.z = head / maxf(config.aim_arrow_head, 0.01)


# --- geometry ----------------------------------------------------------------

func _build() -> void:
	_arrow = Node3D.new()
	_arrow.name = "Arrow"
	add_child(_arrow)

	_shaft = PrototypeMeshes.box(Vector3(config.aim_arrow_width, 0.02, 1.0), config.aim_color)
	_arrow.add_child(_shaft)

	_head = PrototypeMeshes.cone(config.aim_arrow_width * 1.5, config.aim_arrow_head,
		config.aim_color, 4)
	# The cone is built pointing up; lay it down so it points along +Z.
	_head.rotation = Vector3(PI * 0.5, 0.0, 0.0)
	_arrow.add_child(_head)


## Rebuilt only when the aimed ability's range differs from the last one.
func _fit_ring(cast_range: float) -> void:
	var radius := maxf(cast_range, 0.5)
	if _ring != null and is_equal_approx(_ring_range, radius):
		return
	if _ring != null:
		_ring.queue_free()
	_ring = PrototypeMeshes.ring(radius, config.aim_ring_thickness, config.aim_color)
	_ring_range = radius
	add_child(_ring)
