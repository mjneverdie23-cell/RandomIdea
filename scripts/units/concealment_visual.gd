class_name ConcealmentVisual
extends Node

## Fades a champion's prototype meshes while it stands in a bush.
##
## Presentation only, and deliberately mild: at the default 25% the champion
## reads as "in cover" while staying clearly legible, and the foliage stays
## clearly visible around it. Who can actually *see* the champion is not
## decided here at all — that is [VisionManager]'s single answer, which
## targeting, the minimap and the HUD all read. Turning this effect off would
## change nothing about the game's rules.
##
## Because it is presentation, it runs on every peer from local geometry rather
## than waiting on a snapshot, and it restores the shared cached material on
## the way out so nothing is left translucent outside a bush.

signal concealment_changed(concealed: bool)

## 0 is opaque, 1 is invisible. Comes from [MatchConfig.bush_concealment_fade].
var fade: float = 0.25

var _unit: Unit
var _meshes: Array[MeshInstance3D] = []
## Per mesh: the material it was built with, and the translucent duplicate.
var _original: Array = []
var _faded: Array = []
var _concealed: bool = false


func setup(unit: Unit, fade_amount: float) -> void:
	_unit = unit
	fade = clampf(fade_amount, 0.0, 0.9)
	_collect(unit.visual)


func is_concealed() -> bool:
	return _concealed


func _collect(node: Node) -> void:
	for child in node.get_children():
		if child is MeshInstance3D:
			_meshes.append(child)
			_original.append(child.material_override)
			_faded.append(null)
		_collect(child)


func _process(_delta: float) -> void:
	refresh()


## One point-in-circle test per bush for one champion — cheap enough to do
## every frame, and a coarser tick left the fade stale after a teleport.
func refresh() -> void:
	if _unit == null or not is_instance_valid(_unit) or fade <= 0.0:
		return
	set_concealed(_unit.is_alive() and Vision.is_in_bush(_unit))


func set_concealed(value: bool) -> void:
	if value == _concealed:
		return
	_concealed = value
	for i in _meshes.size():
		var mesh: MeshInstance3D = _meshes[i]
		if not is_instance_valid(mesh):
			continue
		mesh.material_override = _faded_material(i) if value else _original[i]
	concealment_changed.emit(value)


## Built once per mesh and kept. The originals are shared and cached by
## [PrototypeMeshes], so they are never mutated — only swapped away from.
func _faded_material(index: int) -> Material:
	if _faded[index] != null:
		return _faded[index]
	var source: Material = _original[index]
	var copy: StandardMaterial3D = source.duplicate() if source is StandardMaterial3D \
		else StandardMaterial3D.new()
	copy.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	copy.albedo_color.a = 1.0 - fade
	_faded[index] = copy
	return copy
