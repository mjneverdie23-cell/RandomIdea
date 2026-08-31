## Places characters at their side's spawn points at the start of every round.
##
## Spawn points come from the map, so a new map needs no code change. Extra team
## members beyond the authored points are scattered nearby.
class_name SpawnSystem
extends RefCounted

var session
var teams: TeamManager
var rng: RandomNumberGenerator

func _init(p_session, p_teams: TeamManager, p_rng: RandomNumberGenerator) -> void:
	session = p_session
	teams = p_teams
	rng = p_rng

## Spawns every member of both teams and resets their round state.
## `keep_weapons_for` is `func(character) -> bool` so survivors can keep their gear.
func spawn_all(keep_weapons_for: Callable = Callable()) -> void:
	for side in [GameEnums.Side.ATTACKERS, GameEnums.Side.DEFENDERS]:
		var members := teams.members_on_side(side)
		var points: Array[SpawnPointData] = session.map_definition.spawns_for(side)
		if points.is_empty():
			continue
		for index in members.size():
			var character = members[index]
			var point: SpawnPointData = points[index % points.size()]
			var keep := true
			if keep_weapons_for.is_valid():
				keep = keep_weapons_for.call(character)
			spawn_character(character, point, keep, index / points.size())

func spawn_character(character, point: SpawnPointData, keep_weapons: bool, spread_index: int = 0) -> void:
	character.reset_for_round(keep_weapons)
	var jitter := 1.6 * spread_index
	var position := point.position + Vector3(0, 0.15, 0)
	if jitter > 0.0:
		position += Vector3(rng.randf_range(-jitter, jitter), 0.0, rng.randf_range(-jitter, jitter))
	character.spawn_at(position, point.yaw)
	Events.character_spawned.emit(character)

## Used by the warmup phase, where death is not permanent.
func respawn(character) -> void:
	var points: Array[SpawnPointData] = session.map_definition.spawns_for(teams.side_of(character.team_id))
	if points.is_empty():
		return
	spawn_character(character, points[rng.randi_range(0, points.size() - 1)], true)
