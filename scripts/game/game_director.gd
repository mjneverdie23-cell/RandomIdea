class_name GameDirector
extends Node3D

## Owns the combat sandbox: champions, turret controllers and minion waves.
##
## It is the only place that knows about both the map and the combat systems.
## The map stays free of gameplay code — turret behaviour is attached to the
## map's existing turret nodes here, using their stable identifiers.
##
## The same director runs offline, on a host and on a client. Only the
## authority spawns units, runs waves and decides results; a client builds the
## same structures locally so their node paths line up, then renders whatever
## [NetworkStateSync] sends. There is no separate networked gameplay path.

signal player_spawned(champion: ChampionController)
signal enemy_champion_spawned(champion: ChampionController)
signal turrets_ready(count: int)
signal match_ended(outcome: int, winner_team: int)

@export var config: MatchConfig
@export var player_team: int = MapEnums.Team.A

var map: MapController
var commands: InputCommands
## Parent for every spawned unit, projectile and effect.
var container: Node3D
## Who is playing. Offline this holds a single local player.
var session: MatchSession
## Replicates dynamic units. Falls back to a plain add_child when offline.
var spawner: NetworkSpawner

## Net ids for units both peers build locally are drawn from this range, so
## they can never collide with the spawner's incrementing ids.
const STRUCTURE_NET_ID_BASE := 1000000

var player: ChampionController
## Fill empty team seats with AI champions. Offline only: a networked match
## keeps its seats for humans, and the second seat is what it waits for.
var ai_opponents_enabled: bool = true
var match_started: bool = false
var waves: MinionWaveSpawner
var turrets: Array[TurretController] = []
var nexuses: Array[NexusController] = []
var enemy_champions: Array[ChampionController] = []
var match_state := MatchState.new()

var _target_indicator: TargetIndicator


func setup(map_controller: MapController, command_bus: InputCommands, unit_container: Node3D,
		match_session: MatchSession = null, unit_spawner: NetworkSpawner = null) -> void:
	map = map_controller
	commands = command_bus
	container = unit_container
	session = match_session
	spawner = unit_spawner


## Builds everything both peers need: the structures the map placed and the
## wave spawner. Champions wait for [method begin_match], because a networked
## match cannot start until its players are seated.
func start() -> void:
	if config == null:
		config = MatchConfig.new()

	_target_indicator = TargetIndicator.new()
	_target_indicator.name = "TargetIndicator"
	container.add_child(_target_indicator)

	match_state.reset()
	if config.spawn_turret_controllers:
		_create_turret_controllers()
	if config.spawn_nexus_controllers:
		_create_nexus_controllers()

	waves = MinionWaveSpawner.new()
	waves.name = "MinionWaves"
	waves.config = config.wave
	add_child(waves)
	waves.setup(map, container, spawner)


## Seats the players, spawns their champions and starts the waves. Authority
## only; clients receive the champions through the spawner.
func begin_match() -> void:
	if not Net.is_authority() or match_started:
		return
	match_started = true
	if session != null:
		for player_session in session.sessions():
			_spawn_session_champion(player_session)
	for i in ai_opponent_count():
		spawn_enemy_champion()
	if config.wave != null and config.wave.auto_start:
		waves.start()


## How many AI champions this match should add. A networked match never adds
## any: every seat belongs to a human, and an empty one means the match has not
## started yet.
func ai_opponent_count() -> int:
	if not Net.is_offline() or not ai_opponents_enabled:
		return 0
	return config.starting_enemy_champions


## Champion for one seated player, owned by that player's peer.
func _spawn_session_champion(player_session: PlayerSession) -> ChampionController:
	var loadout: ChampionLoadout = config.player_loadout
	var spawn := map.spawn_transform(player_session.team)
	var champion: ChampionController = spawner.spawn_unit({
		"kind": NetworkSpawner.KIND_CHAMPION,
		"team": player_session.team,
		"loadout": loadout.resource_path if loadout != null else "",
		"spawn": spawn.origin,
		"owner_peer": player_session.peer_id,
	})
	if champion == null:
		return null
	champion.spawn_point = spawn.origin
	player_session.set_champion(champion)
	# Remote players get their own server-side bus, filled by CommandRelay.
	if player_session.commands == null:
		var bus := commands if player_session.is_local else InputCommands.new()
		if bus != commands:
			bus.name = "Commands"
		player_session.attach_commands(bus)
	champion.bind_commands(player_session.commands)
	if player_session.is_local:
		player = champion
		champion.targeting.target_changed.connect(_on_player_target_changed)
	player_spawned.emit(champion)
	return champion


func enemy_team() -> int:
	return MapEnums.other_team(player_team)


## The champion this machine's input drives, if any. A dedicated server has
## none, and a client finds its own once the spawner has delivered it.
func adopt_local_champion() -> ChampionController:
	for unit in Battle.all():
		if unit.kind == Unit.Kind.CHAMPION and unit.is_locally_owned() and unit.owner_peer_id != 0:
			player = unit
			return player
	return player


func _process(delta: float) -> void:
	if match_state.is_running():
		match_state.elapsed += delta


# --- champions ---------------------------------------------------------------

## AI champion for the opposing team, spawned at its own fountain.
func spawn_enemy_champion() -> ChampionController:
	var team := enemy_team()
	var loadout: ChampionLoadout = config.enemy_loadout if config.enemy_loadout != null else config.player_loadout
	if not Net.is_authority():
		return null
	var spawn := map.spawn_transform(team, 3.0, enemy_champions.size())
	var champion: ChampionController = spawner.spawn_unit({
		"kind": NetworkSpawner.KIND_CHAMPION,
		"team": team,
		"loadout": loadout.resource_path if loadout != null else "",
		"spawn": spawn.origin,
		"owner_peer": 0,
	})
	if champion == null:
		return null
	champion.ai_enabled = true
	champion.spawn_point = spawn.origin
	var push_lane: int = int(map.layout.lanes[0]["lane"]) if not map.layout.lanes.is_empty() else MapEnums.Lane.MID
	var push := map.layout.lane_point(push_lane, config.ai_push_target)
	champion.ai_destination = Vector3(push.x, 0.0, push.y)
	if config.enemy_champion_ai:
		var brain := ChampionAi.new()
		brain.name = "Brain"
		champion.attach_ai(brain)
		brain.setup(champion, champion.ai_destination, _friendly_structure_points(team))

	enemy_champions.append(champion)
	enemy_champion_spawned.emit(champion)
	return champion


## Positions an AI champion will fall back to defend: its own turrets and nexus.
func _friendly_structure_points(team: int) -> Array[Vector3]:
	var points: Array[Vector3] = []
	for turret in turrets:
		if turret.team == team:
			points.append(turret.global_position)
	for nexus in nexuses:
		if nexus.team == team:
			points.append(nexus.global_position)
	return points


func _on_player_target_changed(target: Node3D) -> void:
	if _target_indicator != null:
		_target_indicator.follow(target)


# --- turrets -----------------------------------------------------------------

## Attaches a [TurretController] to every turret the map already placed.
func _create_turret_controllers() -> void:
	for turret_data in map.layout.turrets:
		var id := String(turret_data["id"])
		var structure := map.registry.get_node_for(id)
		if structure == null:
			push_warning("GameDirector: no map node for turret '%s'." % id)
			continue
		var controller := TurretController.new()
		controller.initialize(int(turret_data["team"]), _turret_stats_for(turret_data))
		controller.bind_structure(structure, turret_data)
		controller.net_id = STRUCTURE_NET_ID_BASE + turrets.size()
		container.add_child(controller)
		controller.global_position = structure.global_position
		turrets.append(controller)
	turrets_ready.emit(turrets.size())


## Per-turret stats: the map owns the attack range (so the debug rings stay
## honest), the resource owns everything else.
func _turret_stats_for(turret_data: Dictionary) -> UnitStats:
	var is_nexus := String(turret_data.get("kind", "lane")) == "nexus"
	var base: UnitStats = config.nexus_turret_stats if is_nexus else config.lane_turret_stats
	if base == null:
		base = UnitStats.new()
	var stats: UnitStats = base.duplicate()
	stats.attack_range = float(turret_data.get("range", stats.attack_range))
	var tier := int(turret_data.get("tier", -1))
	if not is_nexus and tier >= 0 and tier < config.turret_tier_health.size():
		stats.max_health *= config.turret_tier_health[tier]
	# Match the collider to the structure the map drew.
	if map.config != null:
		stats.body_radius = map.config.turret_radius
		stats.body_height = map.config.turret_height
	return stats


# --- nexuses -----------------------------------------------------------------

## Attaches a [NexusController] to every nexus the map already placed.
func _create_nexus_controllers() -> void:
	for nexus_data in map.layout.nexuses:
		var id := String(nexus_data["id"])
		var structure := map.registry.get_node_for(id)
		if structure == null:
			push_warning("GameDirector: no map node for nexus '%s'." % id)
			continue
		var controller := NexusController.new()
		controller.initialize(int(nexus_data["team"]), _nexus_stats())
		controller.bind_structure(structure, nexus_data)
		controller.net_id = STRUCTURE_NET_ID_BASE + 500 + nexuses.size()
		container.add_child(controller)
		controller.global_position = structure.global_position
		controller.destroyed.connect(_on_nexus_destroyed)
		nexuses.append(controller)


func _nexus_stats() -> UnitStats:
	var base: UnitStats = config.nexus_stats
	if base == null:
		base = UnitStats.new()
		base.max_health = 4000.0
	return base.duplicate()


func nexus_for(map_id: String) -> NexusController:
	for nexus in nexuses:
		if nexus.map_id == map_id:
			return nexus
	return null


func _on_nexus_destroyed(nexus: NexusController) -> void:
	if not Net.is_authority() or not config.nexus_destruction_ends_match:
		return
	if not match_state.is_running():
		return
	var winner := MapEnums.other_team(nexus.team)
	if session != null:
		# Everyone hears the result from the authority; each peer then scores it
		# from its own team's point of view.
		session.finish(MatchState.Outcome.VICTORY, winner)
	report_match_result(winner)


## Applies a result that the authority decided. Called locally on the host and
## through the session RPC on clients.
func report_match_result(winner_team: int) -> void:
	if not match_state.is_running():
		return
	match_state.finish(winner_team, local_team())
	_end_match()


## The team this machine plays. Networked matches read it from the session.
func local_team() -> int:
	if session != null and Net.is_networked():
		return session.local_team()
	return player_team


## Stops the sandbox so the result is stable while the banner is up.
func _end_match() -> void:
	if waves != null:
		waves.stop()
	for unit in Battle.all():
		unit.set_gameplay_enabled(false)
	match_ended.emit(match_state.outcome, match_state.winner)


func turret_for(map_id: String) -> TurretController:
	for turret in turrets:
		if turret.map_id == map_id:
			return turret
	return null


func living_turret_count(team: int) -> int:
	var total := 0
	for turret in turrets:
		if turret.team == team and turret.is_alive():
			total += 1
	return total


# --- developer commands ------------------------------------------------------
# Called only by DevInputController, never by gameplay.

func dev_spawn_enemy_champion() -> void:
	spawn_enemy_champion()


func dev_spawn_wave() -> int:
	return waves.spawn_wave() if waves != null else 0


func dev_reset_champion() -> void:
	if player != null:
		player.reset_champion()


func dev_teleport_player(destination_id: String) -> void:
	if player == null:
		return
	var point := map.position_of(destination_id, player.global_position)
	player.teleport_to(point)


## Identifier-free teleports, so the developer keys work on any map.
func dev_teleport_to_own_spawn() -> void:
	if player != null:
		player.teleport_to(map.spawn_transform(player_team).origin)


func dev_teleport_to_enemy_base() -> void:
	if player == null:
		return
	var base := map.layout.base_data(enemy_team())
	if base.is_empty():
		return
	var position: Vector2 = base["position"]
	player.teleport_to(Vector3(position.x, 0.0, position.y))


## Developer shortcut for the win condition.
func dev_destroy_enemy_nexus() -> bool:
	# Cheats act on behalf of the local player, and a dedicated server has none.
	if not Net.is_authority() or not Net.has_local_player():
		return false
	for nexus in nexuses:
		if nexus.team != local_team() and nexus.is_alive():
			nexus.health.kill(player)
			return true
	return false


func dev_refill_health() -> void:
	if player != null and player.is_alive():
		player.health.heal(player.health.maximum)


func dev_kill_selected_target() -> bool:
	if player == null or not Net.is_authority():
		return false
	var target := player.targeting.current_target
	if target == null or not is_instance_valid(target) or not target.is_alive():
		return false
	target.health.kill(player)
	return true


func dev_kill_all_enemies() -> int:
	if not Net.is_authority() or not Net.has_local_player():
		return 0
	var killed := 0
	for unit in Battle.enemies_of(local_team()):
		unit.health.kill(player)
		killed += 1
	return killed


## Compact snapshot used by the HUD and the headless smoke test.
func describe() -> Dictionary:
	return {
		"player_alive": player != null and player.is_alive(),
		"enemy_champions": enemy_champions.size(),
		"turrets": turrets.size(),
		"minions_a": Battle.count_of(MapEnums.Team.A, Unit.Kind.MINION),
		"minions_b": Battle.count_of(MapEnums.Team.B, Unit.Kind.MINION),
		"units": Battle.all().size(),
		"nexuses": nexuses.size(),
		"outcome": match_state.outcome_name(),
		"role": NetTypes.role_name(Net.role),
		"phase": session.phase_name() if session != null else "-",
		"next_wave": waves.time_to_next_wave() if waves != null else -1.0,
	}
