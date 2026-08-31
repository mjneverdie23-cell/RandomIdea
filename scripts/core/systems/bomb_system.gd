## The objective: carrying, dropping, picking up, planting, defusing, detonating.
##
## BombSystem owns the bomb's state machine and emits events; it never decides
## who wins - RoundManager listens and applies the round rules. Timings and radii
## all come from GameConfig.
class_name BombSystem
extends RefCounted

var session
var teams: TeamManager
var combat: CombatSystem
var rng: RandomNumberGenerator

var state: GameEnums.BombState = GameEnums.BombState.CARRIED
var carrier            ## Character or null
var position: Vector3 = Vector3.ZERO
var site_id: StringName = &""
var fuse_remaining: float = 0.0
var planter            ## Character or null

var plant_progress: float = 0.0
var planting            ## Character currently planting
var defuse_progress: float = 0.0
var defusing            ## Character currently defusing
var defuse_duration: float = 10.0

## Visual marker for the dropped/planted bomb. Owned by MatchSession.
var marker: Node3D

var _enabled: bool = false
var _beep_timer: float = 0.0

func _init(p_session, p_teams: TeamManager, p_combat: CombatSystem, p_rng: RandomNumberGenerator) -> void:
	session = p_session
	teams = p_teams
	combat = p_combat
	rng = p_rng
	Events.character_died.connect(_on_character_died)

func dispose() -> void:
	if Events.character_died.is_connected(_on_character_died):
		Events.character_died.disconnect(_on_character_died)

func is_planted() -> bool: return state == GameEnums.BombState.PLANTED
func is_carried() -> bool: return state == GameEnums.BombState.CARRIED
func is_dropped() -> bool: return state == GameEnums.BombState.DROPPED

func set_enabled(enabled: bool) -> void:
	_enabled = enabled

## Round setup: hand the bomb to a random member of the attacking side.
func assign_to_random_attacker() -> void:
	reset()
	var attackers := teams.members_on_side(GameEnums.Side.ATTACKERS, true)
	if attackers.is_empty():
		return
	give_to(attackers[rng.randi_range(0, attackers.size() - 1)])

func give_to(character) -> void:
	carrier = character
	character.inventory.has_bomb = true
	state = GameEnums.BombState.CARRIED
	position = character.global_position
	Events.bomb_picked_up.emit(character)

func drop(from_character) -> void:
	if carrier != from_character:
		return
	carrier.inventory.has_bomb = false
	position = from_character.global_position
	carrier = null
	state = GameEnums.BombState.DROPPED
	cancel_plant()
	Events.bomb_dropped.emit(position, from_character)

func reset() -> void:
	if carrier != null:
		carrier.inventory.has_bomb = false
	carrier = null
	state = GameEnums.BombState.CARRIED
	site_id = &""
	fuse_remaining = 0.0
	planter = null
	planting = null
	defusing = null
	plant_progress = 0.0
	defuse_progress = 0.0
	_beep_timer = 0.0

## Which bomb site, if any, a position is standing in.
func site_at(world_position: Vector3) -> BombSiteData:
	for site in session.map_definition.bomb_sites:
		if site.contains(world_position) \
				and world_position.y <= Config.game.plant_max_height_above_site:
			return site
	return null

func can_plant(character) -> bool:
	if not _enabled or state != GameEnums.BombState.CARRIED:
		return false
	if carrier != character or not character.health.alive:
		return false
	if not character.is_on_floor():
		return false
	return site_at(character.global_position) != null

func can_defuse(character) -> bool:
	if not _enabled or state != GameEnums.BombState.PLANTED:
		return false
	if not character.health.alive:
		return false
	if teams.side_of(character.team_id) != GameEnums.Side.DEFENDERS:
		return false
	var flat := Vector2(character.global_position.x - position.x, character.global_position.z - position.z)
	return flat.length() <= Config.game.bomb_interact_radius \
		and absf(character.global_position.y - position.y) < 2.5

func can_pick_up(character) -> bool:
	if not _enabled or state != GameEnums.BombState.DROPPED:
		return false
	if teams.side_of(character.team_id) != GameEnums.Side.ATTACKERS:
		return false
	return character.global_position.distance_to(position) <= Config.game.bomb_pickup_radius

## Called every tick with the character's `use` intent.
func handle_use(character, held: bool) -> void:
	if not _enabled:
		return

	if state == GameEnums.BombState.DROPPED and held and can_pick_up(character):
		give_to(character)
		return

	if state == GameEnums.BombState.CARRIED and carrier == character:
		if held and can_plant(character):
			if planting != character:
				planting = character
				plant_progress = 0.0
				var site := site_at(character.global_position)
				Events.bomb_plant_started.emit(character, site.id if site != null else &"")
		elif planting == character:
			cancel_plant()
		return

	if state == GameEnums.BombState.PLANTED:
		if held and can_defuse(character):
			if defusing != character:
				defusing = character
				defuse_progress = 0.0
				defuse_duration = Config.game.defuse_duration_with_kit if character.inventory.has_defuse_kit \
					else Config.game.defuse_duration
				Events.bomb_defuse_started.emit(character, defuse_duration)
		elif defusing == character:
			cancel_defuse()

func cancel_plant() -> void:
	if planting != null:
		Events.bomb_plant_aborted.emit(planting)
	planting = null
	plant_progress = 0.0

func cancel_defuse() -> void:
	if defusing != null:
		Events.bomb_defuse_aborted.emit(defusing)
	defusing = null
	defuse_progress = 0.0

func update(delta: float) -> void:
	if not _enabled:
		return
	var config := Config.game

	if state == GameEnums.BombState.CARRIED and carrier != null:
		position = carrier.global_position

	# --- planting -------------------------------------------------------------
	if planting != null:
		if not can_plant(planting) or not planting.intent.use:
			cancel_plant()
		else:
			plant_progress += delta / config.plant_duration
			if plant_progress >= 1.0:
				_complete_plant(planting)

	# --- ticking --------------------------------------------------------------
	if state == GameEnums.BombState.PLANTED:
		fuse_remaining -= delta
		# Beeps accelerate as the fuse runs down; the audio layer uses this.
		var interval := maxf(0.12, (fuse_remaining / config.bomb_fuse_duration) * 1.4)
		_beep_timer += delta
		if _beep_timer >= interval:
			_beep_timer = 0.0
			Events.bomb_beep.emit(fuse_remaining, position)

		if defusing != null:
			if not can_defuse(defusing) or not defusing.intent.use:
				cancel_defuse()
			else:
				defuse_progress += delta / defuse_duration
				if defuse_progress >= 1.0:
					_complete_defuse(defusing)

		if state == GameEnums.BombState.PLANTED and fuse_remaining <= 0.0:
			_detonate()

	_update_marker()

func _complete_plant(character) -> void:
	var site := site_at(character.global_position)
	state = GameEnums.BombState.PLANTED
	site_id = site.id if site != null else &""
	position = character.global_position
	fuse_remaining = Config.game.bomb_fuse_duration
	planter = character
	planting = null
	plant_progress = 0.0
	character.inventory.has_bomb = false
	character.score["plants"] += 1
	carrier = null
	Events.bomb_planted.emit(character, site_id, position)

func _complete_defuse(character) -> void:
	state = GameEnums.BombState.DEFUSED
	defusing = null
	defuse_progress = 0.0
	character.score["defuses"] += 1
	Events.bomb_defused.emit(character)

func _detonate() -> void:
	state = GameEnums.BombState.EXPLODED
	var config := Config.game
	for character in session.characters:
		if not character.health.alive:
			continue
		var distance: float = character.center_position().distance_to(position)
		if distance > config.explosion_radius:
			continue
		var falloff := maxf(config.explosion_min_damage_fraction, 1.0 - distance / config.explosion_radius)
		combat.apply_damage(character, planter, config.explosion_damage * falloff, &"bomb",
			GameEnums.HitZone.CHEST, false, 0.9)
	Events.bomb_exploded.emit(position)

func _on_character_died(victim, _attacker, _source: StringName, _headshot: bool) -> void:
	if carrier == victim:
		drop(victim)
	if planting == victim:
		cancel_plant()
	if defusing == victim:
		cancel_defuse()

func _update_marker() -> void:
	if marker == null:
		return
	var visible_now := state == GameEnums.BombState.DROPPED or state == GameEnums.BombState.PLANTED
	marker.visible = visible_now
	if visible_now:
		marker.global_position = position + Vector3(0, 0.2, 0)

## Snapshot for the HUD and for bots.
func describe() -> Dictionary:
	return {
		"state": state,
		"site_id": site_id,
		"carrier": carrier.character_name if carrier != null else "",
		"position": position,
		"fuse_remaining": maxf(0.0, fuse_remaining),
		"plant_progress": plant_progress,
		"defuse_progress": defuse_progress,
		"defuse_duration": defuse_duration,
	}
