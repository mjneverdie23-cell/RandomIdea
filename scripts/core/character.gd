## A playing character - player or bot, any dinosaur class.
##
## A composition of components (health, inventory, effects, abilities) plus a
## kinematic body. It has no input handling, no rendering decisions and no
## knowledge of rounds: PlayerController/BotBrain write `intent`, CharacterVisual
## reads the transform, and the round systems call the reset helpers.
##
## MatchSession ticks characters explicitly, in a fixed order, so the simulation
## stays deterministic and testable.
class_name Character
extends CharacterBody3D

const LAYER_WORLD := 1
const LAYER_CHARACTERS := 2

@onready var collision: CollisionShape3D = $Collision
@onready var visual: CharacterVisual = $Visual
@onready var head: Node3D = $Head
@onready var name_tag: Label3D = $NameTag

# --- identity -----------------------------------------------------------------
var character_name: String = "Dino"
var team_id: int = GameEnums.Team.TEAM_ONE
var class_id: StringName = &"RANGER"
var class_data: CharacterClassData
var is_bot: bool = false

# --- components ---------------------------------------------------------------
var health := HealthComponent.new()
var inventory := InventoryComponent.new()
var effects: EffectComponent
var abilities: AbilityComponent
var intent := Intent.new()

# --- state ---------------------------------------------------------------------
var yaw: float = 0.0
var pitch: float = 0.0
var is_crouching: bool = false
var current_height: float = 1.85
## Rooted during freeze time.
var frozen: bool = false
var money: int = 0
var score := {"kills": 0, "deaths": 0, "assists": 0, "damage": 0.0, "plants": 0, "defuses": 0}
## Damage taken per attacker this round, for assist attribution.
var damage_taken_from: Dictionary = {}
var revealed_until_time: float = 0.0
var last_damage_time: float = -1000.0
var survived_last_round: bool = false
var respawn_timer: float = 0.0

var _fall_speed: float = 0.0
var _was_on_floor: bool = true
## Set by MatchSession so fall damage flows through the normal damage pipeline.
var damage_sink: Callable = Callable()

func _ready() -> void:
	collision_layer = LAYER_CHARACTERS
	collision_mask = LAYER_WORLD | LAYER_CHARACTERS
	effects = EffectComponent.new(self)
	abilities = AbilityComponent.new(self)
	# MatchSession drives the tick order explicitly.
	set_physics_process(false)
	set_process(false)

func setup(p_name: String, p_team: int, p_class_id: StringName, p_is_bot: bool = false) -> void:
	character_name = p_name
	team_id = p_team
	is_bot = p_is_bot
	# Callers add the node to the tree first, so @onready references are valid here.
	apply_class(p_class_id)
	_refresh_name_tag()

## Applies (or swaps) the dinosaur class: stats, hitbox, abilities, visuals.
func apply_class(p_class_id: StringName) -> void:
	class_data = Config.character_class(p_class_id)
	class_id = class_data.id
	current_height = class_data.hitbox_height

	var capsule := CapsuleShape3D.new()
	capsule.radius = class_data.hitbox_radius
	capsule.height = maxf(class_data.hitbox_height, class_data.hitbox_radius * 2.0 + 0.01)
	collision.shape = capsule
	collision.position.y = class_data.hitbox_height * 0.5
	head.position.y = class_data.eye_height(current_height)

	health.setup(class_data, Config.game)
	abilities.setup(class_data.abilities)
	inventory.reset_for_round(false, class_data)
	visual.apply_class(class_data, team_color())
	_refresh_name_tag()

func team_color() -> Color:
	return Color("d8763a") if team_id == GameEnums.Team.TEAM_ONE else Color("3a86d8")

# ------------------------------------------------------------------ geometry --
func eye_position() -> Vector3:
	return global_position + Vector3(0, class_data.eye_height(current_height), 0)

func center_position() -> Vector3:
	return global_position + Vector3(0, current_height * 0.5, 0)

func look_direction() -> Vector3:
	var cp := cos(pitch)
	return Vector3(-sin(yaw) * cp, sin(pitch), -cos(yaw) * cp)

func horizontal_speed() -> float:
	return Vector2(velocity.x, velocity.z).length()

## 0..1 - speed relative to the class walk speed, used for accuracy.
func movement_fraction() -> float:
	return minf(1.0, horizontal_speed() / maxf(0.001, class_data.move_speed))

func radius() -> float:
	return class_data.hitbox_radius

# -------------------------------------------------------------------- status --
func is_alive() -> bool:
	return health.alive

func reveal_until(time: float) -> void:
	revealed_until_time = maxf(revealed_until_time, time)

func is_revealed(time: float) -> bool:
	return time < revealed_until_time

func is_invisible() -> bool:
	return effects.is_invisible()

# ------------------------------------------------------------------ movement --
## The speed this character is allowed to reach right now.
func target_speed() -> float:
	var config := Config.game
	var speed := class_data.move_speed
	var weapon := inventory.active_weapon()
	if weapon != null:
		speed *= weapon.data.move_speed_multiplier
	speed *= effects.speed()
	if is_crouching:
		speed *= config.crouch_multiplier
	elif intent.sprint and intent.move_forward > 0.0 and not intent.aim:
		speed *= config.sprint_multiplier
	if intent.aim and not is_crouching:
		speed *= config.ads_multiplier
	return speed

func tick_movement(delta: float) -> void:
	var config := Config.game
	if not health.alive:
		velocity = Vector3.ZERO
		move_and_slide()
		return

	_update_crouch(config)

	# --- desired horizontal velocity ----------------------------------------
	var wish := Vector3.ZERO
	if not frozen:
		var forward := Vector3(-sin(yaw), 0.0, -cos(yaw))
		var right := Vector3(-forward.z, 0.0, forward.x)
		wish = forward * intent.move_forward + right * intent.move_right
		if wish.length_squared() > 1.0:
			wish = wish.normalized()

	var speed := target_speed()
	var on_floor := is_on_floor()
	var acceleration := (config.ground_acceleration if on_floor else config.air_acceleration) * delta

	if wish.length_squared() > 0.0001:
		velocity.x = move_toward(velocity.x, wish.x * speed, acceleration)
		velocity.z = move_toward(velocity.z, wish.z * speed, acceleration)
	elif on_floor:
		var friction := config.ground_friction * delta * maxf(1.0, horizontal_speed())
		velocity.x = move_toward(velocity.x, 0.0, friction)
		velocity.z = move_toward(velocity.z, 0.0, friction)

	# --- jump and gravity -----------------------------------------------------
	if intent.jump and on_floor and not frozen:
		velocity.y = class_data.jump_velocity
	velocity.y -= config.gravity * effects.gravity() * delta
	velocity.y = maxf(velocity.y, -60.0)

	_was_on_floor = on_floor
	if not on_floor:
		_fall_speed = maxf(_fall_speed, -velocity.y)

	move_and_slide()

	# --- landing / fall damage -------------------------------------------------
	if is_on_floor():
		if not _was_on_floor and _fall_speed > config.fall_damage_min_speed:
			var damage := (_fall_speed - config.fall_damage_min_speed) * config.fall_damage_per_unit_speed
			if damage_sink.is_valid():
				damage_sink.call(self, damage)
		_fall_speed = 0.0

func _update_crouch(config: GameConfig) -> void:
	var wants_crouch := intent.crouch and not frozen
	if wants_crouch == is_crouching:
		return
	if wants_crouch:
		is_crouching = true
	else:
		# Standing up needs headroom.
		var space := get_world_3d().direct_space_state
		var query := PhysicsRayQueryParameters3D.create(
			global_position + Vector3(0, current_height, 0),
			global_position + Vector3(0, class_data.hitbox_height + 0.1, 0))
		query.exclude = [get_rid()]
		query.collision_mask = LAYER_WORLD
		if space.intersect_ray(query).is_empty():
			is_crouching = false
	var target_height: float = class_data.hitbox_height * (config.crouch_height_fraction if is_crouching else 1.0)
	current_height = target_height
	var capsule := collision.shape as CapsuleShape3D
	capsule.height = maxf(target_height, class_data.hitbox_radius * 2.0 + 0.01)
	collision.position.y = target_height * 0.5
	head.position.y = class_data.eye_height(target_height)

# ------------------------------------------------------------- round helpers --
func spawn_at(position: Vector3, spawn_yaw: float) -> void:
	global_position = position
	velocity = Vector3.ZERO
	yaw = spawn_yaw
	pitch = 0.0
	intent.yaw = spawn_yaw
	intent.pitch = 0.0
	is_crouching = false
	_fall_speed = 0.0

func reset_for_round(keep_weapons: bool) -> void:
	health.reset(class_data)
	inventory.reset_for_round(keep_weapons, class_data)
	abilities.reset_for_round()
	effects.clear()
	damage_taken_from.clear()
	revealed_until_time = 0.0
	frozen = false
	respawn_timer = 0.0
	current_height = class_data.hitbox_height
	visual.visible = true
	_refresh_name_tag()

## `viewer_team` is the team whose eyes we are rendering for (-1 = nobody).
## Name tags are shown for teammates only, the way a competitive shooter does it.
func sync_visual(viewer_team: int = -1) -> void:
	visual.sync(self)
	if name_tag != null:
		var is_ally := viewer_team >= 0 and viewer_team == team_id
		name_tag.visible = health.alive and is_ally
		if name_tag.visible:
			name_tag.text = "%s\n%d" % [character_name, int(ceil(health.health))]
			name_tag.position.y = current_height + 0.45

func _refresh_name_tag() -> void:
	if name_tag == null:
		return
	name_tag.text = "%s\n%d" % [character_name, int(ceil(health.health))]
	name_tag.modulate = team_color()

## Compact snapshot for the HUD, scoreboard and bots.
func describe() -> Dictionary:
	var weapon := inventory.active_weapon()
	return {
		"name": character_name,
		"team": team_id,
		"class_id": class_id,
		"class_name": class_data.display_name,
		"role": class_data.role,
		"is_bot": is_bot,
		"alive": health.alive,
		"health": int(ceil(health.health)),
		"max_health": int(health.max_health),
		"armor": int(ceil(health.armor)),
		"has_helmet": health.has_helmet,
		"money": money,
		"score": score.duplicate(),
		"weapon": {
			"id": weapon.id(),
			"name": weapon.display_name(),
			"ammo": weapon.ammo_in_mag,
			"reserve": weapon.reserve_ammo,
			"reloading": weapon.reloading,
			"infinite": weapon.has_infinite_ammo(),
		} if weapon != null else {},
	}
