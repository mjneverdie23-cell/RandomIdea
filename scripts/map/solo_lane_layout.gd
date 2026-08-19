class_name SoloLaneLayout
extends MapLayout

## Layout for the compact one-lane arena.
##
## It fills the same [MapLayout] arrays the three-lane map does — lanes, bases,
## turrets, nexuses, spawns, walkable/blocked/structure shapes — so every
## builder, manager, navigation bake, debug overlay and gameplay system reads it
## without knowing which map it is looking at. The jungle, river, camp and
## objective arrays stay empty, and the managers that own them build nothing.

## Lane index reused so [method MapLayout.lane_point] and the wave spawner work
## unchanged. There is only ever one lane in this mode.
const SOLO_LANE := MapEnums.Lane.MID


func solo_config() -> SoloLaneConfig:
	return config as SoloLaneConfig


func rebuild() -> void:
	lanes.clear()
	bases.clear()
	turrets.clear()
	inhibitors.clear()
	nexuses.clear()
	spawn_points.clear()
	lane_entrances.clear()
	jungles.clear()
	camps.clear()
	objectives.clear()
	decor.clear()
	walkable_shapes.clear()
	blocked_shapes.clear()
	structure_shapes.clear()

	_build_solo_lane()
	_build_solo_bases()
	_build_solo_towers()
	_build_side_terrain()


func play_half_extents() -> Vector2:
	var solo := solo_config()
	return Vector2(config.map_half_size, solo.map_half_length if solo != null else config.map_half_size)


# --- lane --------------------------------------------------------------------

func _build_solo_lane() -> void:
	var a := config.base_center(MapEnums.Team.A)
	var b := config.base_center(MapEnums.Team.B)
	var path := PackedVector2Array([a, b])
	lanes.append({
		"id": "SOLO_LANE",
		"lane": SOLO_LANE,
		"path": path,
		"length": MapShapes.polyline_length(path),
		"width": config.lane_width,
		"position": Vector2.ZERO,
	})
	walkable_shapes.append_array(MapShapes.polyline_bands(path, config.lane_half_width()))


# --- bases -------------------------------------------------------------------

func _build_solo_bases() -> void:
	var solo := solo_config()
	var minion_offset: float = solo.minion_spawn_offset if solo != null else 9.0

	for team in [MapEnums.Team.A, MapEnums.Team.B]:
		var suffix := MapEnums.team_name(team)
		var center := config.base_center(team)
		var outward := config.team_corner_dir(team)
		var inward := -outward

		bases.append({
			"id": "TEAM_%s_BASE" % suffix,
			"team": team,
			"position": center,
			"radius": config.base_radius,
			"lane_entrances": {SOLO_LANE: "SOLO_LANE_ENTRANCE_%s" % suffix},
		})
		walkable_shapes.append(MapShapes.disk(center, config.base_radius))

		var nexus_position := center + outward * config.nexus_offset
		nexuses.append({
			"id": "SOLO_NEXUS_%s" % suffix,
			"team": team,
			"position": nexus_position,
		})
		structure_shapes.append(MapShapes.disk(nexus_position, 4.6))

		spawn_points.append({
			"id": "SOLO_SPAWN_%s" % suffix,
			"team": team,
			"role": SpawnPointManager.ROLE_CHAMPION,
			"position": center + outward * config.spawn_offset,
			"facing": inward,
			"radius": config.base_radius * 0.3,
		})
		spawn_points.append({
			"id": "SOLO_MINION_SPAWN_%s" % suffix,
			"team": team,
			"role": SpawnPointManager.ROLE_MINION,
			"position": center + inward * minion_offset,
			"facing": inward,
			"radius": config.lane_half_width(),
		})
		lane_entrances.append({
			"id": "SOLO_LANE_ENTRANCE_%s" % suffix,
			"team": team,
			"lane": SOLO_LANE,
			"position": center + inward * config.base_radius,
		})


# --- towers ------------------------------------------------------------------

## Exactly two towers per team: inner (guarding the base) and outer.
func _build_solo_towers() -> void:
	var solo := solo_config()
	var offsets := solo.tower_offsets() if solo != null else PackedFloat32Array([17.0, 37.0])
	var names := ["INNER", "OUTER"]
	var tiers := [MapEnums.TurretTier.INNER, MapEnums.TurretTier.OUTER]

	for team in [MapEnums.Team.A, MapEnums.Team.B]:
		var center := config.base_center(team)
		var inward := -config.team_corner_dir(team)
		for i in mini(offsets.size(), names.size()):
			var position := center + inward * offsets[i]
			turrets.append({
				"id": "SOLO_%s_TURRET_%s" % [names[i], MapEnums.team_name(team)],
				"kind": "lane",
				"team": team,
				"lane": SOLO_LANE,
				"tier": tiers[i],
				"position": position,
				"range": config.turret_range,
			})
			structure_shapes.append(MapShapes.disk(position, config.turret_radius + 0.4))


# --- side terrain ------------------------------------------------------------

## Small pockets beside the lane with rock cover, plus decorative boulders on
## the solid ground outside them. The pockets overlap the lane edge, so the
## terrain funnels play back into the single lane without sealing anything off.
func _build_side_terrain() -> void:
	var solo := solo_config()
	if solo == null:
		return
	var lane_half := config.lane_half_width()
	var clearing_x := lane_half + solo.side_clearing_radius * 0.55
	var count: int = solo.side_clearing_count

	for side in [-1.0, 1.0]:
		for i in count:
			var t := 0.0 if count <= 1 else (float(i) / float(count - 1)) * 2.0 - 1.0
			var center := Vector2(side * clearing_x, t * solo.side_clearing_span)
			walkable_shapes.append(MapShapes.disk(center, solo.side_clearing_radius))
			decor.append({
				"kind": "floor",
				"position": center,
				"radius": solo.side_clearing_radius,
				"color": PrototypeMeshes.COLOR_JUNGLE.lightened(0.1),
			})
			for r in solo.rock_count:
				var angle := TAU * (float(r) + 0.25) / float(maxi(solo.rock_count, 1))
				var rock := center + Vector2(cos(angle), sin(angle)) * solo.side_clearing_radius * 0.45
				blocked_shapes.append(MapShapes.disk(rock, solo.rock_radius))
				decor.append({
					"kind": "cylinder",
					"position": rock,
					"radius": solo.rock_radius * 1.15,
					"height": config.wall_height * 1.35,
				})

	_build_boulders(solo)


## Cylinders and blocks standing on the solid ground either side of the lane,
## so the out-of-play terrain reads as terrain rather than a flat slab.
func _build_boulders(solo: SoloLaneConfig) -> void:
	var outer_x := config.map_half_size * 0.62
	var steps := 5
	for side in [-1.0, 1.0]:
		for i in steps:
			var z: float = lerpf(-solo.map_half_length * 0.72, solo.map_half_length * 0.72,
				float(i) / float(steps - 1))
			decor.append({
				"kind": "box" if i % 2 == 0 else "cylinder",
				"position": Vector2(side * outer_x, z),
				"radius": 2.6 + float(i % 3) * 0.6,
				"height": config.wall_height * (1.4 + float(i % 2) * 0.5),
			})


# --- probe contract ----------------------------------------------------------

func required_ids() -> PackedStringArray:
	var ids := super.required_ids()
	ids.append_array(PackedStringArray(["SOLO_LANE_ENTRANCE_A", "SOLO_LANE_ENTRANCE_B"]))
	return ids


## Minion waves use the dedicated spawn markers rather than a lane fraction.
func minion_spawn_point(team: int, lane: int, fallback_fraction: float) -> Vector2:
	for spawn in spawn_points:
		if int(spawn["team"]) == team and String(spawn.get("role", "")) == SpawnPointManager.ROLE_MINION:
			return spawn["position"]
	return super.minion_spawn_point(team, lane, fallback_fraction)
