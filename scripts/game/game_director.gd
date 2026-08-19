class_name GameDirector
extends Node3D

## Owns the combat sandbox: champions, turret controllers and minion waves.
##
## It is the only place that knows about both the map and the combat systems.
## The map stays free of gameplay code — turret behaviour is attached to the
## map's existing turret nodes here, using their stable identifiers.

signal player_spawned(champion: ChampionController)
signal enemy_champion_spawned(champion: ChampionController)
signal turrets_ready(count: int)

@export var config: MatchConfig
@export var player_team: int = MapEnums.Team.A

var map: MapController
var commands: InputCommands
## Parent for every spawned unit, projectile and effect.
var container: Node3D

var player: ChampionController
var waves: MinionWaveSpawner
var turrets: Array[TurretController] = []
var enemy_champions: Array[ChampionController] = []

var _target_indicator: TargetIndicator


func setup(map_controller: MapController, command_bus: InputCommands, unit_container: Node3D) -> void:
	map = map_controller
	commands = command_bus
	container = unit_container


## Builds the whole sandbox. Safe to call once the map has been built.
func start() -> void:
	if config == null:
		config = MatchConfig.new()

	_target_indicator = TargetIndicator.new()
	_target_indicator.name = "TargetIndicator"
	container.add_child(_target_indicator)

	if config.spawn_turret_controllers:
		_create_turret_controllers()

	player = spawn_player_champion()
	for i in config.starting_enemy_champions:
		spawn_enemy_champion()

	waves = MinionWaveSpawner.new()
	waves.name = "MinionWaves"
	waves.config = config.wave
	add_child(waves)
	waves.setup(map, container)
	if config.wave != null and config.wave.auto_start:
		waves.start()


func enemy_team() -> int:
	return MapEnums.other_team(player_team)


# --- champions ---------------------------------------------------------------

func spawn_player_champion() -> ChampionController:
	var champion := ChampionController.new()
	champion.name = "PlayerChampion"
	champion.loadout = config.player_loadout
	champion.initialize(player_team, config.player_loadout.stats if config.player_loadout != null else null)
	container.add_child(champion)

	var spawn := map.spawn_transform(player_team)
	champion.spawn_point = spawn.origin
	champion.teleport_to(spawn.origin)
	if commands != null:
		champion.bind_commands(commands)
	champion.targeting.target_changed.connect(_on_player_target_changed)
	player_spawned.emit(champion)
	return champion


## AI champion for the opposing team, spawned at its own fountain.
func spawn_enemy_champion() -> ChampionController:
	var team := enemy_team()
	var loadout: ChampionLoadout = config.enemy_loadout if config.enemy_loadout != null else config.player_loadout
	var champion := ChampionController.new()
	champion.name = "EnemyChampion%d" % (enemy_champions.size() + 1)
	champion.loadout = loadout
	champion.ai_enabled = true
	champion.initialize(team, loadout.stats if loadout != null else null)
	container.add_child(champion)

	var spawn := map.spawn_transform(team, 3.0, enemy_champions.size())
	champion.spawn_point = spawn.origin
	champion.teleport_to(spawn.origin)
	var push := map.layout.lane_point(MapEnums.Lane.MID, config.ai_push_target)
	champion.ai_destination = Vector3(push.x, 0.0, push.y)

	enemy_champions.append(champion)
	enemy_champion_spawned.emit(champion)
	return champion


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


func dev_refill_health() -> void:
	if player != null and player.is_alive():
		player.health.heal(player.health.maximum)


func dev_kill_selected_target() -> bool:
	if player == null:
		return false
	var target := player.targeting.current_target
	if target == null or not is_instance_valid(target) or not target.is_alive():
		return false
	target.health.kill(player)
	return true


func dev_kill_all_enemies() -> int:
	var killed := 0
	for unit in Battle.enemies_of(player_team):
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
		"next_wave": waves.time_to_next_wave() if waves != null else -1.0,
	}
