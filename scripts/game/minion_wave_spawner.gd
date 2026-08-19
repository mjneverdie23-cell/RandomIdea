class_name MinionWaveSpawner
extends Node

## Spawns minion waves for both teams from the map's existing lane data.
##
## Routes are sampled from [MapLayout] lane paths, so the spawner works on any
## map the layout can describe and never hardcodes a position.

signal wave_spawned(index: int, team: int, lane: int, count: int)

@export var config: WaveConfig

var map: MapController
## Where spawned minions are parented.
var container: Node3D
## Replicates each minion to the clients. Offline this just adds a child.
var spawner: NetworkSpawner
var running: bool = false
var wave_index: int = 0

var _timer: float = 0.0
var _spawn_counter: int = 0


func setup(map_controller: MapController, unit_container: Node3D,
		unit_spawner: NetworkSpawner = null) -> void:
	map = map_controller
	container = unit_container
	spawner = unit_spawner


func start() -> void:
	if not Net.is_authority():
		return  # minions are simulated by the authority alone
	if config == null:
		push_warning("MinionWaveSpawner has no WaveConfig; not starting.")
		return
	running = true
	_timer = config.first_wave_delay


func stop() -> void:
	running = false


func time_to_next_wave() -> float:
	return maxf(_timer, 0.0) if running else -1.0


func _process(delta: float) -> void:
	if not running or config == null:
		return
	_timer -= delta
	if _timer > 0.0:
		return
	_timer = config.interval
	spawn_wave()


## Spawns one wave per configured lane. [param team] of -1 spawns for both.
func spawn_wave(team: int = -1) -> int:
	if config == null or map == null or container == null or not Net.is_authority():
		return 0
	wave_index += 1
	var spawned := 0
	var teams := [MapEnums.Team.A, MapEnums.Team.B] if team < 0 else [team]
	for t in teams:
		if Battle.count_of(t, Unit.Kind.MINION) >= config.max_alive_per_team:
			continue
		for lane in config.lanes:
			var count := _spawn_lane_wave(t, lane)
			spawned += count
			wave_spawned.emit(wave_index, t, lane, count)
	return spawned


func _spawn_lane_wave(team: int, lane: int) -> int:
	var route := lane_route(team, lane)
	if route.is_empty():
		return 0
	var origin := route[0]
	var forward := (route[1] - origin).normalized() if route.size() > 1 else Vector3.FORWARD
	var side := Vector3(-forward.z, 0.0, forward.x)

	var roster: Array = []
	for i in config.melee_per_wave:
		roster.append(config.melee_stats)
	for i in config.ranged_per_wave:
		roster.append(config.ranged_stats)

	var spawned := 0
	for i in roster.size():
		var stats_resource: MinionStats = roster[i]
		if stats_resource == null:
			continue
		var column := i % 3
		var row := i / 3
		var offset := side * (float(column) - 1.0) * config.formation_width \
			- forward * float(row) * config.formation_spacing
		_spawn_minion(team, lane, stats_resource, origin + offset, route)
		spawned += 1
	return spawned


func _spawn_minion(team: int, lane: int, stats_resource: MinionStats, at: Vector3,
		route: PackedVector3Array) -> MinionController:
	_spawn_counter += 1
	# The route stays on the authority: a client never navigates a minion, so
	# there is no reason to put a dozen waypoints on the wire.
	var minion: MinionController = spawner.spawn_unit({
		"kind": NetworkSpawner.KIND_MINION,
		"team": team,
		"stats": stats_resource.resource_path,
		"lane": lane,
		"spawn": at + Vector3.UP * 0.2,
	})
	if minion == null:
		return null
	# The spawner already parented it; only the route is left to hand over.
	minion.set_lane_route(lane, route)
	return minion


## Waypoints from [param team]'s base towards the enemy base along a lane.
func lane_route(team: int, lane: int) -> PackedVector3Array:
	var out := PackedVector3Array()
	if map == null or map.layout == null:
		return out
	# The first waypoint is where the layout says minions enter the world; the
	# rest are sampled along the lane towards the enemy base.
	var entry := map.layout.minion_spawn_point(team, lane, config.route_start)
	out.append(Vector3(entry.x, 0.0, entry.y))
	var samples: int = maxi(config.route_samples, 2)
	for i in range(1, samples):
		var progress := float(i) / float(samples - 1)
		var fraction: float = lerpf(config.route_start, config.route_end, progress)
		if team == MapEnums.Team.B:
			fraction = 1.0 - fraction
		var point := map.layout.lane_point(lane, fraction)
		out.append(Vector3(point.x, 0.0, point.y))
	return out
