class_name ChampionController
extends Unit

## Player- or AI-driven champion.
##
## The player variant reads intent from an [InputCommands] bus only, so a
## mobile joystick and button bar drive it exactly like the keyboard does. The
## AI variant reuses the same components with a very small chase-and-shoot
## brain, which is all the sandbox needs.

signal recall_started(duration: float)
signal recall_finished()
signal recall_interrupted()
signal respawn_started(duration: float)
signal respawn_finished()
signal target_selected(target: Node3D)

@export var loadout: ChampionLoadout
## When true the champion picks its own targets and walks itself.
@export var ai_enabled: bool = false

var abilities: AbilityComponent
## Set for AI champions; player champions leave it null and read the bus.
var ai: ChampionAi
var commands: InputCommands
## Fountain position used by recall and respawn.
var spawn_point: Vector3 = Vector3.ZERO
## Where an AI champion walks when it has nothing to shoot.
var ai_destination: Vector3 = Vector3.ZERO

var _recall_left: float = 0.0
var _respawn_left: float = 0.0
var _recalling: bool = false


func _init() -> void:
	kind = Kind.CHAMPION
	mobile = true
	uses_navigation = true
	target_priority = [Kind.CHAMPION, Kind.MINION, Kind.TURRET]


func _ready() -> void:
	if loadout != null and stats_resource == null:
		stats_resource = loadout.stats
	super._ready()

	abilities = AbilityComponent.new()
	abilities.name = "Abilities"
	add_child(abilities)
	abilities.setup(self, loadout.abilities if loadout != null else [])

	targeting.auto_acquire = ai_enabled
	_build_selection_ring()


## Connects a champion to the device-independent command bus.
func bind_commands(bus: InputCommands) -> void:
	commands = bus
	ai_enabled = false
	targeting.auto_acquire = false
	bus.ability_requested.connect(_on_ability_requested)
	bus.basic_attack_requested.connect(_on_basic_attack_requested)
	bus.recall_requested.connect(_on_recall_requested)
	bus.recall_cancelled.connect(cancel_recall)


func _build_visual() -> void:
	var color := PrototypeMeshes.team_color(team)
	var body := PrototypeMeshes.capsule(body_radius(), body_height(), color)
	body.position = Vector3(0.0, body_height() * 0.5, 0.0)
	visual.add_child(body)

	# Nose block so facing is readable without animation.
	var nose := PrototypeMeshes.box(Vector3(0.5, 0.5, 1.0), color.lightened(0.45))
	nose.position = Vector3(0.0, body_height() * 0.62, -body_radius() - 0.4)
	visual.add_child(nose)

	var crest := PrototypeMeshes.sphere(0.35, Color(1.0, 1.0, 1.0))
	crest.position = Vector3(0.0, body_height() + 0.35, 0.0)
	visual.add_child(crest)


## Ground ring so the champion stays findable among same-coloured units.
func _build_selection_ring() -> void:
	var ring := PrototypeMeshes.ring(body_radius() * 2.1, 0.28, PrototypeMeshes.team_color(team).lightened(0.45))
	ring.name = "OwnRing"
	ring.position.y = 0.2
	visual.add_child(ring)


func _think(delta: float) -> void:
	abilities.tick(delta)
	# Drops dead or invalid targets. Acquisition belongs to the brain (AI) or to
	# the click handler (player), so nothing re-targets behind their back.
	targeting.tick(delta, loadout.ai_aggro_range if loadout != null else 16.0)
	if ai_enabled:
		_think_ai(delta)
	else:
		_think_player(delta)
	_auto_attack()


func _think_player(delta: float) -> void:
	_tick_recall(delta)
	if commands == null:
		return
	var wants_move: bool = commands.move_direction.length_squared() > 0.0001
	if wants_move:
		if _recalling:
			cancel_recall()
		movement.set_direction(commands.move_direction)
		return
	if _recalling:
		movement.stop()
		return
	_chase_selected_target()


## Walks towards a selected enemy that is out of attack range, but only while
## the player is not steering and only within a leash distance.
func _chase_selected_target() -> void:
	if loadout == null or not loadout.chase_selected_target:
		movement.set_direction(Vector2.ZERO)
		return
	if not targeting.is_target_valid(INF):
		movement.set_direction(Vector2.ZERO)
		return
	var target := targeting.current_target
	var gap := targeting.distance_to_target()
	if gap <= attack_range() or gap > loadout.max_chase_distance:
		movement.stop()
		movement.face_towards(target.global_position)
		return
	movement.move_to(target.global_position)


## Attaches a brain. Without one an AI champion just holds its ground.
func attach_ai(brain: ChampionAi) -> void:
	ai = brain
	ai_enabled = true
	targeting.auto_acquire = false  # the brain decides what to shoot
	add_child(brain)


func ai_state_name() -> String:
	return ai.state_name() if ai != null else ""


func _think_ai(delta: float) -> void:
	if ai != null:
		ai.think(delta)
		return
	# No brain attached: hold position and shoot whatever wanders into range.
	targeting.tick(delta, attack_range())
	if targeting.is_target_valid(attack_range()):
		movement.stop()
		movement.face_towards(targeting.current_target.global_position)
	elif ai_destination != Vector3.ZERO:
		movement.move_to(ai_destination)
	else:
		movement.stop()


func _auto_attack() -> void:
	if targeting.is_target_valid(attack_range()):
		combat.try_attack(targeting.current_target)


# --- input handlers ----------------------------------------------------------

func _on_ability_requested(slot: int, aim_point: Vector3) -> void:
	if not is_alive():
		return
	cancel_recall()
	if abilities.try_cast(slot, aim_point):
		movement.face_towards(aim_point)


## A click both selects and attacks: an enemy near the aim point becomes the
## target, otherwise the nearest enemy already in range is used.
func _on_basic_attack_requested(aim_point: Vector3) -> void:
	if not is_alive():
		return
	cancel_recall()
	var picked := Battle.pick_enemy_near(aim_point, team, selection_pick_radius())
	if picked != null:
		targeting.set_target(picked)
		target_selected.emit(picked)
	elif not targeting.is_target_valid(INF):
		var nearest := Battle.find_target(global_position, team, attack_range(), target_priority)
		if nearest != null:
			targeting.set_target(nearest)
			target_selected.emit(nearest)
	movement.face_towards(aim_point)
	if targeting.is_target_valid(attack_range()):
		combat.try_attack(targeting.current_target)


func selection_pick_radius() -> float:
	return loadout.selection_radius if loadout != null else 3.5


func select_target(target: Node3D) -> void:
	targeting.set_target(target)
	target_selected.emit(target)


# --- recall ------------------------------------------------------------------

func _on_recall_requested() -> void:
	if not is_alive():
		return
	if _recalling:
		cancel_recall()
		return
	_recalling = true
	_recall_left = loadout.recall_duration if loadout != null else 1.6
	recall_started.emit(_recall_left)


func cancel_recall() -> void:
	if not _recalling:
		return
	_recalling = false
	_recall_left = 0.0
	recall_interrupted.emit()


func is_recalling() -> bool:
	return _recalling


func recall_progress() -> float:
	var total: float = loadout.recall_duration if loadout != null else 1.6
	return 0.0 if not _recalling or total <= 0.0 else clampf(1.0 - _recall_left / total, 0.0, 1.0)


func _tick_recall(delta: float) -> void:
	if not _recalling:
		return
	_recall_left -= delta
	if _recall_left > 0.0:
		return
	_recalling = false
	teleport_to(spawn_point)
	health.heal(health.maximum)
	AbilityPulse.spawn(projectile_parent(), global_position, 3.0, PrototypeMeshes.team_color(team), 0.5)
	recall_finished.emit()


# --- death and respawn -------------------------------------------------------

func _handle_death(_source: Node) -> void:
	_recalling = false
	visual.visible = false
	var wait: float = loadout.respawn_time if loadout != null else 8.0
	_respawn_left = wait
	respawn_started.emit(wait)


func respawn_remaining() -> float:
	return maxf(_respawn_left, 0.0)


func respawn_total() -> float:
	return loadout.respawn_time if loadout != null else 8.0


func _process(delta: float) -> void:
	if is_alive() or _respawn_left <= 0.0:
		return
	_respawn_left -= delta
	if _respawn_left <= 0.0:
		respawn()


## Puts the champion back at its fountain with full health and no cooldowns.
func respawn() -> void:
	_respawn_left = 0.0
	teleport_to(spawn_point)
	var ratio: float = loadout.respawn_health_ratio if loadout != null else 1.0
	health.revive(ratio)
	stats.clear_modifiers()
	abilities.reset_cooldowns()
	targeting.clear_target()
	respawn_finished.emit()


func teleport_to(point: Vector3) -> void:
	velocity = Vector3.ZERO
	if movement != null:
		movement.stop()
	global_position = point + Vector3.UP * 0.2


## Full reset used by the developer controls.
func reset_champion() -> void:
	cancel_recall()
	if not is_alive():
		respawn()
		return
	teleport_to(spawn_point)
	health.revive(1.0)
	stats.clear_modifiers()
	abilities.reset_cooldowns()
	targeting.clear_target()
