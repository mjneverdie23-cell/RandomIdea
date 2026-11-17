extends Node2D
## Main game scene. Turns Board signals into feedback: particles and screen shake.
## The Board never knows these exist.

const SHAKE_BY_SPECIAL := {
	Gem.Special.STRIPED_H: 0.3,
	Gem.Special.STRIPED_V: 0.3,
	Gem.Special.WRAPPED: 0.45,
	Gem.Special.PRISM: 0.6,
}

@onready var _board: Board = $Board
@onready var _camera: ShakeCamera = $Camera
@onready var _effects: BurstEffects = $Effects


func _ready() -> void:
	_board.gem_cleared.connect(_on_gem_cleared)
	_board.special_activated.connect(_on_special_activated)
	_board.wave_cleared.connect(_on_wave_cleared)


func _on_gem_cleared(gem_type: GemType, at: Vector2, _cascade: int) -> void:
	_effects.burst(at, gem_type.color if gem_type else Gem.PRISM_COLOR)


func _on_special_activated(kind: Gem.Special, _at: Vector2) -> void:
	_camera.add_trauma(SHAKE_BY_SPECIAL.get(kind, 0.0))


func _on_wave_cleared(cascade: int, _gem_count: int) -> void:
	if cascade >= 2:
		_camera.add_trauma(0.1 * mini(cascade, 4))
