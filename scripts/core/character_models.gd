## ===========================================================================
##  THE MODEL SWAP POINT
## ===========================================================================
## Everything visual about a character is created here and nowhere else.
## Gameplay code never touches a mesh, so replacing the capsule placeholders with
## real animated dinosaurs is a change to THIS FILE ONLY.
##
## A factory is `func(class_data: CharacterClassData, team_color: Color) -> Node3D`.
## The returned node may optionally implement any of:
##
##   set_pose(pose: Dictionary)      # {yaw, pitch, speed, crouching, airborne, aiming}
##   play_animation(name: StringName)  # &"idle" | &"run" | &"jump" | &"fire" | &"death"
##   set_team_color(color: Color)
##   set_opacity(value: float)
##
## CharacterVisual calls them only if they exist, so a factory can implement as
## much or as little as it likes.
##
## To use a rigged dinosaur instead of a capsule, register a factory once at
## startup (for example from MatchSession._ready or an autoload):
##
##   CharacterModels.register(&"dino_raptor", func(class_data, team_color):
##       var model := preload("res://assets/models/raptor.glb").instantiate()
##       model.scale = Vector3.ONE * class_data.model_scale
##       model.set_script(preload("res://scripts/render/raptor_model.gd"))
##       return model)
##
## where raptor_model.gd implements set_pose()/play_animation() over an
## AnimationPlayer. The `model_key` comes from the class resource.
class_name CharacterModels
extends RefCounted

## model key -> Callable(class_data, team_color) -> Node3D
static var factories: Dictionary = {}

static func register(model_key: StringName, factory: Callable) -> void:
	factories[model_key] = factory

static func has_model(model_key: StringName) -> bool:
	return factories.has(model_key)

## Builds the visual for a class, falling back to the capsule placeholder.
static func create(class_data: CharacterClassData, team_color: Color) -> Node3D:
	if factories.has(class_data.model_key):
		var node: Node3D = (factories[class_data.model_key] as Callable).call(class_data, team_color)
		if node != null:
			return node
	return create_placeholder_capsule(class_data, team_color)

## PLACEHOLDER: a capsule with a head marker and a snout that shows facing.
## Proportions come from the class hitbox, so the visual matches what bullets hit.
static func create_placeholder_capsule(class_data: CharacterClassData, team_color: Color) -> Node3D:
	var root := Node3D.new()
	root.name = "PlaceholderCapsule"
	root.set_script(load("res://scripts/core/placeholder_capsule.gd"))
	root.build(class_data, team_color)
	return root
