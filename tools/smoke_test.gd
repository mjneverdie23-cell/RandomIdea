extends Node

## Headless/offscreen smoke test for the prototype.
##
##   godot --headless --path . tools/SmokeTest.tscn                 # verify
##   godot --path . tools/SmokeTest.tscn -- --out=/some/dir         # + shots
##
## Boots the real game scene and proves the acceptance criteria that can be
## checked without a human: map identifiers and navigation reachability,
## command-driven movement, wall collision, selection, basic attacks, damage,
## death and respawn, ability cooldowns, minion waves, minion-vs-minion and
## minion-vs-turret combat, both debug views, and a second map configuration.

const MAIN_SCENE := "res://scenes/Main.tscn"
const SETTLE_FRAMES := 20

var _output_dir := ""
var _failures: PackedStringArray = PackedStringArray()
var _root: GameRoot


func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--out="):
			_output_dir = arg.substr(6)
	_run()


func _run() -> void:
	var scene: PackedScene = load(MAIN_SCENE)
	_root = scene.instantiate()
	add_child(_root)
	await _settle(SETTLE_FRAMES)

	_check_map()
	await _check_navigation()
	await _check_movement()
	await _check_wall_collision()
	_check_debug_views()
	_check_sandbox_setup()
	await _isolate_arena()
	await _check_selection_and_attack()
	await _check_abilities()
	await _check_death_and_respawn()
	await _check_minion_waves()
	await _check_minion_combat()
	await _check_turret_combat()
	await _capture_screenshots()
	await _check_alternate_map()

	if _failures.is_empty():
		print("[SmokeTest] PASS")
		get_tree().quit(0)
	else:
		for failure in _failures:
			printerr("[SmokeTest] FAIL: ", failure)
		get_tree().quit(1)


func _fail(message: String) -> void:
	_failures.append(message)


func _expect(condition: bool, message: String) -> void:
	if not condition:
		_fail(message)


func _settle(frames: int) -> void:
	for i in frames:
		await get_tree().process_frame


## Physics frames advance movement deterministically, unlike process frames
## which run as fast as the machine allows in headless mode.
func _settle_physics(frames: int) -> void:
	for i in frames:
		await get_tree().physics_frame


# --- map and navigation (unchanged behaviour from the map milestone) ---------

func _check_map() -> void:
	var map := _root.map
	_expect(map.is_built(), "map did not build")
	var description := map.describe()
	print("[SmokeTest] map: ", description)
	_expect(int(description["lanes"]) == 3, "expected 3 lanes")
	_expect(int(description["jungles"]) == 4, "expected 4 jungle quadrants")
	_expect(int(description["objectives"]) == 2, "expected 2 objectives")
	_expect(int(description["camps"]) == 16, "expected 16 jungle camps")
	_expect(int(description["turrets"]) >= 18, "expected at least 18 turrets")
	_expect(int(description["wall_boxes"]) > 0, "no terrain walls were generated")
	for id in MapProbe.required_ids(map):
		_expect(map.registry.has(id), "missing map identifier %s" % id)


func _check_navigation() -> void:
	await _root.map.navigation.await_synchronization()
	var report := MapProbe.run(_root.map)
	print(MapProbe.format(report))
	_expect(bool(report["ok"]), "navigation reachability check failed")
	_expect(int(report["nav_polygons"]) > 0, "navigation mesh is empty")


## Drives the champion through the command bus exactly like PC input would.
func _check_movement() -> void:
	var champion := _root.champion
	var commands := _root.commands
	# Stand in for the keyboard: the PC controller would overwrite the bus every
	# frame, which is exactly what a mobile joystick would replace.
	_root.pc_input.set_process(false)
	var start := champion.global_position
	commands.set_move_direction(Vector2(1.0, 0.0))
	await _settle_physics(45)
	commands.set_move_direction(Vector2.ZERO)
	await _settle_physics(5)
	var travelled := champion.global_position.distance_to(start)
	print("[SmokeTest] champion travelled %.2f m on a move command" % travelled)
	_expect(travelled > 5.0, "champion did not move on a movement command")
	_expect(_root.map.is_inside_play_field(champion.global_position), "champion left the play field")


## Walks the champion straight at the map border; walls must stop it.
func _check_wall_collision() -> void:
	var champion := _root.champion
	var half := _root.map.layout.play_field_half_size()
	var commands := _root.commands
	commands.set_move_direction(Vector2(-1.0, 1.0).normalized())
	await _settle_physics(180)
	commands.set_move_direction(Vector2.ZERO)
	await _settle_physics(5)
	var pos := champion.global_position
	print("[SmokeTest] champion stopped at x %.1f z %.1f (border %.1f)" % [pos.x, pos.z, half])
	_expect(absf(pos.x) <= half and absf(pos.z) <= half, "champion pushed through the map boundary")


func _check_debug_views() -> void:
	var map := _root.map
	var before := map.is_debug_visible()
	_root.commands.request_debug_toggle()
	_expect(map.is_debug_visible() != before, "map debug view did not toggle")

	var overlay := _root.combat_debug
	var combat_before := overlay.is_overlay_visible()
	overlay.toggle()
	_expect(overlay.is_overlay_visible() != combat_before, "combat debug overlay did not toggle")
	overlay.set_overlay_visible(combat_before)


# --- combat ------------------------------------------------------------------

func _check_sandbox_setup() -> void:
	var director := _root.director
	print("[SmokeTest] sandbox: ", director.describe())
	_expect(director.player != null and director.player.is_alive(), "player champion did not spawn alive")
	_expect(is_equal_approx(director.player.health.current, director.player.health.maximum),
		"player champion did not spawn at full health")
	_expect(director.turrets.size() == _root.map.layout.turrets.size(),
		"expected one turret controller per map turret position")
	_expect(director.turret_for("TOP_OUTER_TURRET_A") != null, "TOP_OUTER_TURRET_A has no controller")
	_expect(director.enemy_champions.size() == director.config.starting_enemy_champions,
		"wrong number of starting enemy champions")
	for slot in InputCommands.ABILITY_NAMES.size():
		_expect(director.player.abilities.ability_for(slot) != null,
			"ability slot %s is empty" % InputCommands.ability_name(slot))


## Spawns a dummy next to the champion, selects it with a click and attacks.
## Runs at the map centre, well clear of every turret's range.
func _check_selection_and_attack() -> void:
	var champion := _root.champion
	champion.teleport_to(_river_point(0.5))
	await _settle_physics(4)

	var dummy := _spawn_dummy(_river_point(0.527), MapEnums.Team.B)
	await _settle_physics(4)

	_root.commands.set_aim_point(dummy.global_position)
	_root.commands.request_basic_attack()
	_expect(champion.targeting.current_target == dummy, "left click did not select the nearby enemy")

	# Long enough for several swings at the champion's attack speed.
	var before := dummy.health.current
	await _settle_physics(150)
	var dealt := before - dummy.health.current
	print("[SmokeTest] dummy health %.0f -> %.0f (%.0f damage in 2.5s)" % [
		before, dummy.health.current, dealt
	])
	_expect(dealt >= champion.stats.value("attack_damage") * 1.5,
		"basic attacks did not repeat on the selected target")

	# Out of range, but on navigable ground: the champion should walk to it.
	dummy.global_position = _river_point(0.619) + Vector3.UP * 0.2
	await _settle_physics(30)
	_expect(champion.movement.is_navigating(), "champion did not move towards an out-of-range target")

	dummy.health.kill(champion)
	_expect(not dummy.is_alive(), "killing a unit left it alive")
	await _settle_physics(4)
	_expect(champion.targeting.current_target == null, "dead target was not dropped")
	dummy.queue_free()
	await _settle_physics(4)


func _check_abilities() -> void:
	var champion := _root.champion
	champion.abilities.reset_cooldowns()
	var aim := champion.global_position + champion.facing_direction() * 8.0
	for slot in InputCommands.ABILITY_NAMES.size():
		var name := InputCommands.ability_name(slot)
		_expect(champion.abilities.try_cast(slot, aim), "ability %s failed to cast" % name)
		_expect(champion.abilities.cooldown_remaining(slot) > 0.0, "ability %s started no cooldown" % name)
		_expect(not champion.abilities.try_cast(slot, aim), "ability %s ignored its cooldown" % name)
		await _settle_physics(2)
	_expect(champion.stats.has_modifier("f_bulwark"), "the F self-buff applied no stat modifier")
	print("[SmokeTest] all four abilities cast and went on cooldown")
	champion.abilities.reset_cooldowns()
	champion.stats.clear_modifiers()


func _check_death_and_respawn() -> void:
	var champion := _root.champion
	# Keep the shared resource untouched; only this champion respawns fast.
	champion.loadout = champion.loadout.duplicate()
	champion.loadout.respawn_time = 0.6

	champion.health.kill(null)
	await _settle_physics(4)
	_expect(not champion.is_alive(), "champion survived a lethal hit")
	_expect(not champion.gameplay_enabled, "dead champion is still enabled")

	var moved_before := champion.global_position
	_root.commands.set_move_direction(Vector2(1.0, 0.0))
	await _settle_physics(20)
	_root.commands.set_move_direction(Vector2.ZERO)
	_expect(champion.global_position.distance_to(moved_before) < 0.5, "dead champion still moved")

	await _settle(90)
	_expect(champion.is_alive(), "champion did not respawn")
	_expect(is_equal_approx(champion.health.current, champion.health.maximum),
		"respawned champion did not get its health back")
	var spawn_gap := champion.global_position.distance_to(champion.spawn_point)
	print("[SmokeTest] respawned %.1f m from the fountain" % spawn_gap)
	_expect(spawn_gap < 3.0, "champion did not respawn at its team spawn point")


func _check_minion_waves() -> void:
	var director := _root.director
	var spawned := director.dev_spawn_wave()
	print("[SmokeTest] manual wave spawned %d minions" % spawned)
	_expect(spawned > 0, "the wave spawner produced no minions")

	var minions := _living_minions()
	_expect(minions.size() >= spawned, "spawned minions are not registered")
	var sample: MinionController = minions[0]
	var start := sample.global_position
	await _settle_physics(120)
	var travelled := sample.global_position.distance_to(start)
	print("[SmokeTest] sample minion walked %.1f m in two seconds (state %s)" % [travelled, sample.state_name()])
	_expect(travelled > 1.5, "minions did not navigate away from their spawn")
	_expect(_root.map.is_inside_play_field(sample.global_position), "a minion left the play field")


## Two opposing minions placed face to face must fight without any help.
func _check_minion_combat() -> void:
	var mid := _root.map.layout.lane_point(MapEnums.Lane.MID, 0.5)
	var center := Vector3(mid.x, 0.2, mid.y)
	var ally := _spawn_dummy(center + Vector3(-1.2, 0.0, 0.0), MapEnums.Team.A)
	var enemy := _spawn_dummy(center + Vector3(1.2, 0.0, 0.0), MapEnums.Team.B)
	await _settle_physics(200)
	print("[SmokeTest] duel: A %.0f HP, B %.0f HP" % [ally.health.current, enemy.health.current])
	_expect(ally.health.current < ally.health.maximum, "the team A minion took no damage in a duel")
	_expect(enemy.health.current < enemy.health.maximum, "the team B minion took no damage in a duel")
	for minion in [ally, enemy]:
		if is_instance_valid(minion):
			minion.queue_free()
	await _settle_physics(4)


## A minion parked next to an enemy turret must damage it and be shot back.
## The lane is cleared first so the dummy cannot prefer a passing minion, and
## the top outer turret is used because its neighbours are out of range - on
## mid, the inner turret also covers the outer one's position.
func _check_turret_combat() -> void:
	var turret := _root.director.turret_for("TOP_OUTER_TURRET_B")
	_expect(turret != null, "no controller for TOP_OUTER_TURRET_B")
	if turret == null:
		return
	await _isolate_arena()
	var turret_before := turret.health.current
	# Offset towards team A, away from the next turret up the lane.
	var attacker := _spawn_dummy(turret.global_position + Vector3(-3.0, 0.0, 0.0), MapEnums.Team.A, 1400.0)
	await _settle_physics(260)
	_expect(attacker.targeting.current_target == turret, "the minion did not target the enemy turret")
	print("[SmokeTest] turret %.0f -> %.0f HP, attacker %.0f HP" % [
		turret_before, turret.health.current, attacker.health.current if is_instance_valid(attacker) else 0.0
	])
	_expect(turret.health.current < turret_before, "minions did not damage the enemy turret")
	_expect(not is_instance_valid(attacker) or attacker.health.current < attacker.health.maximum,
		"the turret did not shoot back")

	# Destroying it must stop it firing without disturbing the map.
	var structure_before: Vector3 = _root.map.registry.get_node_for("TOP_OUTER_TURRET_B").global_position
	turret.health.kill(null)
	# Long enough for any shot already in flight to land: a projectile that was
	# fired before the turret died is not the turret "still firing".
	await _settle_physics(30)
	_expect(not turret.is_alive(), "turret survived a lethal hit")
	_expect(not turret.gameplay_enabled, "destroyed turret is still enabled")
	var attacker_health := attacker.health.current
	await _settle_physics(150)
	print("[SmokeTest] attacker after destruction: %.1f -> %.1f (target %s)" % [
		attacker_health, attacker.health.current,
		"none" if attacker.targeting.current_target == null else str(attacker.targeting.current_target)
	])
	_expect(is_equal_approx(attacker.health.current, attacker_health), "a destroyed turret kept firing")
	var structure_after: Vector3 = _root.map.registry.get_node_for("TOP_OUTER_TURRET_B").global_position
	_expect(structure_after.y < structure_before.y, "destroyed turret structure did not change")
	print("[SmokeTest] destroyed turret stopped firing and sank %.1f m" % (structure_before.y - structure_after.y))

	if is_instance_valid(attacker):
		attacker.queue_free()
	await _settle_physics(4)


## Test helper. [param health] overrides the resource value without touching
## the shared .tres, so a dummy can survive long enough to be observed.
func _spawn_dummy(at: Vector3, team: int, health: float = 0.0) -> MinionController:
	var stats: MinionStats = _root.director.config.wave.melee_stats
	if health > 0.0:
		stats = stats.duplicate()
		stats.max_health = health
	var minion := MinionController.new()
	minion.initialize(team, stats)
	minion.name = "TestDummy%s%d" % [MapEnums.team_name(team), randi() % 1000]
	_root.units.add_child(minion)
	minion.global_position = at + Vector3.UP * 0.2
	return minion


## Clears the lanes and sends the AI champions home, so a check observes one
## interaction instead of whatever the sandbox happens to be doing.
func _isolate_arena() -> void:
	if _root.director.waves != null:
		_root.director.waves.stop()
	for unit in Battle.all():
		if unit.kind == Unit.Kind.MINION:
			unit.queue_free()
	for enemy in _root.director.enemy_champions:
		if not is_instance_valid(enemy):
			continue
		if enemy.ai != null:
			enemy.ai.enabled = false
		enemy.targeting.clear_target()
		enemy.teleport_to(enemy.spawn_point)
		enemy.ai_destination = enemy.spawn_point
	await _settle_physics(4)


func _river_point(fraction: float) -> Vector3:
	var point := _root.map.layout.river_point(fraction)
	return Vector3(point.x, 0.0, point.y)


func _living_minions() -> Array:
	var out: Array = []
	for unit in Battle.all():
		if unit.kind == Unit.Kind.MINION and unit.is_alive():
			out.append(unit)
	return out


# --- map reusability ---------------------------------------------------------

## Rebuilds the same systems from a differently sized [MapConfig]. This is the
## real test of the "reusable map architecture" requirement: nothing but the
## data resource changes. The combat sandbox is torn down first, because its
## units hold positions from the old map.
func _check_alternate_map() -> void:
	var director := _root.director
	if director.waves != null:
		director.waves.stop()
	for child in _root.units.get_children():
		child.queue_free()
	await _settle(4)

	var alternate: MapConfig = load("res://resources/maps/compact_map.tres")
	if alternate == null:
		_fail("could not load the alternate map configuration")
		return
	var map := _root.map
	map.config = alternate
	map.build()
	await map.navigation.await_synchronization()
	print("[SmokeTest] alternate map: ", map.describe())
	var report := MapProbe.run(map)
	print(MapProbe.format(report))
	_expect(bool(report["ok"]), "alternate map failed the reachability check")


# --- screenshots -------------------------------------------------------------

func _capture_screenshots() -> void:
	if _output_dir.is_empty():
		return
	var camera := _root.camera
	var champion := _root.champion

	camera.locked_to_target = false
	camera.max_distance = 260.0
	camera.pitch_degrees = -68.0
	camera.set_distance(200.0)
	camera.set_focus(Vector3.ZERO)
	await _save_frame("overview_debug.png")

	_root.map.set_debug_visible(false)
	await _save_frame("overview.png")

	# A lane fight, with the combat overlay on.
	_root.combat_debug.set_overlay_visible(true)
	var mid := _root.map.layout.lane_point(MapEnums.Lane.MID, 0.42)
	champion.teleport_to(Vector3(mid.x, 0.0, mid.y))
	if _root.director.waves != null:
		_root.director.waves.start()
	_root.director.dev_spawn_wave()
	await _settle_physics(420)
	camera.pitch_degrees = -52.0
	camera.set_distance(36.0)
	camera.locked_to_target = true
	camera.set_follow_target(champion)
	await _settle(20)
	await _save_frame("champion_view.png")

	camera.locked_to_target = false
	camera.set_focus(Vector3(-24.0, 0.0, -6.0))
	camera.set_distance(40.0)
	await _save_frame("jungle_closeup.png")

	camera.pitch_degrees = -16.0
	camera.set_focus(Vector3(-30.0, 0.0, 6.0))
	camera.set_distance(38.0)
	await _save_frame("low_angle.png")


func _save_frame(file_name: String) -> void:
	await _settle(4)
	await RenderingServer.frame_post_draw
	var image := get_viewport().get_texture().get_image()
	if image == null:
		_fail("could not capture %s" % file_name)
		return
	var path := _output_dir.path_join(file_name)
	var error := image.save_png(path)
	if error != OK:
		_fail("could not write %s (error %d)" % [path, error])
	else:
		print("[SmokeTest] wrote ", path)
