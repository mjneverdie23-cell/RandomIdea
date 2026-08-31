## Spatial questions the game systems ask about the world.
##
## One place for "who is near here?", "can A see B?" and "what does this ray
## hit?", so collision masks and exclusion rules are defined once.
class_name WorldQuery
extends RefCounted

const LAYER_WORLD := 1
const LAYER_CHARACTERS := 2

var session  ## MatchSession

func _init(p_session) -> void:
	session = p_session

func characters() -> Array:
	return session.characters

func alive_characters() -> Array:
	return session.characters.filter(func(c): return c.health.alive)

## `filter` accepts: {"enemy_of": Character, "team": int, "alive_only": bool}
func characters_within(origin: Vector3, radius: float, filter: Dictionary = {}) -> Array:
	var alive_only: bool = filter.get("alive_only", true)
	var enemy_of = filter.get("enemy_of")
	var team = filter.get("team")
	var radius_squared := radius * radius
	var out := []
	for character in session.characters:
		if alive_only and not character.health.alive:
			continue
		if team != null and character.team_id != team:
			continue
		if enemy_of != null and character.team_id == enemy_of.team_id:
			continue
		if character.center_position().distance_squared_to(origin) <= radius_squared:
			out.append(character)
	return out

## Line of sight from one character's eyes to another's centre of mass.
func has_line_of_sight(from_character, to_character) -> bool:
	return is_visible_from(from_character.eye_position(), to_character, [from_character])

## True when `target`'s centre is visible from a world point (map geometry only).
func is_visible_from(origin: Vector3, target, exclude: Array = []) -> bool:
	var space = session.get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(origin, target.center_position(), LAYER_WORLD)
	var rids: Array[RID] = []
	for node in exclude:
		rids.append(node.get_rid())
	query.exclude = rids
	return space.intersect_ray(query).is_empty()

## Raycast against world geometry and characters.
## Returns {} on a miss, otherwise {position, normal, collider, character, zone, distance}.
func raycast(origin: Vector3, direction: Vector3, distance: float, exclude: Array = []) -> Dictionary:
	var space = session.get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(
		origin, origin + direction * distance, LAYER_WORLD | LAYER_CHARACTERS)
	var rids: Array[RID] = []
	for node in exclude:
		rids.append(node.get_rid())
	query.exclude = rids
	var hit = space.intersect_ray(query)
	if hit.is_empty():
		return {}
	var collider = hit.get("collider")
	hit["distance"] = origin.distance_to(hit["position"])
	if collider is Character:
		hit["character"] = collider
		hit["zone"] = classify_hit_zone(collider, hit["position"])
	return hit

## Which body part a world-space point corresponds to on a character.
func classify_hit_zone(character, point: Vector3) -> GameEnums.HitZone:
	var config := Config.game
	var relative = (point.y - character.global_position.y) / maxf(0.001, character.current_height)
	if relative >= config.head_zone_fraction:
		return GameEnums.HitZone.HEAD
	if relative >= config.stomach_zone_fraction:
		return GameEnums.HitZone.CHEST
	if relative >= config.legs_zone_fraction:
		return GameEnums.HitZone.STOMACH
	return GameEnums.HitZone.LEGS
