extends Node

## Headless/offscreen smoke test for the prototype.
##
##   godot --headless --path . tools/SmokeTest.tscn                 # verify
##   godot --path . tools/SmokeTest.tscn -- --out=/some/dir         # + shots
##
## Boots the real game scene and proves the acceptance criteria that can be
## checked without a human: map identifiers and navigation reachability,
## command-driven movement, wall collision, selection, basic attacks, damage,
## death and respawn, ability locks, ranks and cooldowns, minion waves,
## minion-vs-minion and minion-vs-turret combat, bushes and wards, gold and
## experience rewards, levelling, the shop and item stats, the minimap's vision
## filter, the attack-range visibility rules, both debug views, and a second
## map configuration.

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
	# Skip the multiplayer menu and boot straight into an offline match.
	GameRoot._pending_mode_id = "full_moba"
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
	await _check_vision_and_bushes()
	await _check_rewards()
	await _check_progression()
	await _check_shop_and_items()
	await _check_range_visibility()
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

	var rewards: RewardConfig = director.config.rewards
	# Passive income has already ticked a little by the time this runs, so the
	# check is "started with the configured purse", not "has exactly it".
	var gold: float = director.player.wallet.gold if director.player.wallet != null else -1.0
	_expect(gold >= rewards.starting_gold and gold < rewards.starting_gold + 100.0,
		"champion did not start with the configured gold (has %.0f)" % gold)
	_expect(director.player.level != null and director.player.level.level == 1,
		"champion did not start at level 1")
	_expect(director.shops.size() == 2, "expected one shop zone per team")
	for team in [MapEnums.Team.A, MapEnums.Team.B]:
		_expect(director.shop_for(team) != null,
			"team %s has no shop zone" % MapEnums.team_name(team))
	_expect(_root.map.layout.bushes.size() > 0, "the map placed no bushes")
	_expect(Vision.zones().size() == _root.map.layout.bushes.size(),
		"not every bush registered a vision zone")


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


## Abilities start locked. A point has to be spent before one casts, the
## ultimate refuses a point until its level, and only then do the cooldown
## rules apply.
func _check_abilities() -> void:
	var champion := _root.champion
	var abilities := champion.abilities
	var aim := champion.global_position + champion.facing_direction() * 8.0

	_expect(abilities.rank(0) == 0, "abilities did not start locked")
	_expect(not abilities.try_cast(0, aim), "a locked ability cast anyway")
	_expect(champion.level.skill_points >= 1, "level 1 granted no skill point")

	var ultimate := int(InputCommands.AbilitySlot.R)
	_expect(not champion.spend_skill_point(ultimate),
		"the ultimate accepted a point below its unlock level")

	# Spend it the way a player has to: the HUD's own "+" button, and the
	# Ctrl+key that raises the same command. A point that can only be spent by
	# calling a method is a point nobody can spend.
	_check_upgrade_affordance(ultimate)
	_expect(abilities.rank(0) == 1, "pressing + on the HUD did not raise the rank")
	_expect(abilities.try_cast(0, aim), "an unlocked ability failed to cast")
	abilities.reset_cooldowns()
	print("[SmokeTest] Q unlocked by spending a skill point, ultimate still locked")

	# Take the rest for the cooldown and resource checks.
	while champion.level.level < abilities.unlock_level(ultimate):
		champion.level.level_up()
	_expect(champion.abilities.unlock_all(champion.level.level) > 0,
		"unlocking every ability granted no ranks")
	champion.level.clear_points()
	abilities.reset_cooldowns()
	champion.resource_pool.refill()

	for slot in InputCommands.ABILITY_NAMES.size():
		var name := InputCommands.ability_name(slot)
		_expect(abilities.try_cast(slot, aim), "ability %s failed to cast" % name)
		_expect(abilities.cooldown_remaining(slot) > 0.0, "ability %s started no cooldown" % name)
		_expect(not abilities.try_cast(slot, aim), "ability %s ignored its cooldown" % name)
		await _settle_physics(2)
	_expect(champion.stats.has_modifier("f_bulwark"), "the F self-buff applied no stat modifier")
	_expect(champion.resource_pool.current < champion.resource_pool.maximum,
		"casting four abilities spent no resource")
	print("[SmokeTest] all four abilities cast, spent resource and went on cooldown")
	abilities.reset_cooldowns()
	champion.stats.remove_modifier("f_bulwark")
	champion.resource_pool.refill()


## The level-1 skill point must be reachable from the HUD and from the
## keyboard. This exists because the first version offered only a tiny
## unlabelled square and was, in practice, unfindable.
func _check_upgrade_affordance(ultimate: int) -> void:
	var champion := _root.champion
	var bar := _root.hud.ability_bar
	_expect(champion.level.skill_points > 0, "level 1 left no point to spend")
	_expect(bar.can_upgrade(0), "the HUD offers no upgrade for Q at level 1")
	_expect(not bar.can_upgrade(ultimate), "the HUD offers an ultimate upgrade at level 1")
	_expect(bar.upgrade_rect(0).size.x >= bar.slot_rect(0).size.x,
		"the upgrade button is narrower than the ability it upgrades")
	for action in ["upgrade_q", "upgrade_e", "upgrade_r", "upgrade_f"]:
		_expect(InputMap.has_action(action), "no %s binding" % action)

	var click := InputEventMouseButton.new()
	click.button_index = MOUSE_BUTTON_LEFT
	click.pressed = true
	click.position = bar.upgrade_rect(0).get_center()
	bar._gui_input(click)


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


# --- vision, bushes and wards ------------------------------------------------

## The bush rule, end to end: standing in one hides you from an enemy who is
## looking straight at you, but not from an enemy standing in it with you, and
## not from a ward. Hidden means hidden for gameplay too — the same query the
## renderer uses is the one target acquisition and the minimap use.
func _check_vision_and_bushes() -> void:
	await _isolate_arena()
	var champion := _root.champion
	var bush := Vision.zone_by_id("TOP_BUSH_1")
	_expect(bush != null, "TOP_BUSH_1 has no vision zone")
	if bush == null:
		return

	var hider := _spawn_dummy(bush.global_position, MapEnums.Team.B, 4000.0, 910001)
	champion.teleport_to(bush.global_position + Vector3(bush.radius + 5.0, 0.0, 0.0))
	await _settle_physics(4)
	Vision.recompute()
	_expect(hider.is_concealed(), "a unit standing in a bush is not concealed")
	_expect(not Vision.is_visible_to(hider, MapEnums.Team.A),
		"an enemy in a bush was visible from outside it")
	_expect(Battle.find_target(champion.global_position, MapEnums.Team.A, 40.0,
		champion.target_priority) != hider, "target acquisition found a hidden enemy")
	_expect(Battle.pick_enemy_near(hider.global_position, MapEnums.Team.A, 6.0) == null,
		"a click could select a hidden enemy")
	_expect(not _root.hud.minimap.visible_units().has(hider),
		"the minimap listed a hidden enemy")
	print("[SmokeTest] an enemy in a bush is invisible, untargetable and off the minimap")

	# Same bush: you see whoever is in there with you.
	champion.teleport_to(bush.global_position + Vector3(1.0, 0.0, 0.0))
	await _settle_physics(4)
	Vision.recompute()
	_expect(Vision.is_visible_to(hider, MapEnums.Team.A),
		"an enemy in the same bush was still hidden")
	_expect(_root.hud.minimap.visible_units().has(hider),
		"the minimap hid an enemy sharing the bush")

	# Step out, then ward it.
	champion.teleport_to(bush.global_position + Vector3(bush.radius + 5.0, 0.0, 0.0))
	await _settle_physics(4)
	Vision.recompute()
	_expect(not Vision.is_visible_to(hider, MapEnums.Team.A), "leaving the bush kept vision of it")

	var ward := _root.director.place_ward(champion, bush.global_position)
	_expect(ward != null, "no ward was placed")
	await _settle_physics(2)
	Vision.recompute()
	_expect(Vision.is_visible_to(hider, MapEnums.Team.A), "a ward did not reveal the bush")
	print("[SmokeTest] a ward reveals the bush; removing it restores the fog")

	ward.queue_free()
	await _settle_physics(4)
	Vision.recompute()
	_expect(not Vision.is_visible_to(hider, MapEnums.Team.A),
		"the bush stayed revealed after the ward expired")

	# And the developer reveal overrides all of it, for this machine only.
	_root.director.dev_toggle_reveal()
	_expect(Vision.is_visible_to(hider, MapEnums.Team.A), "the developer reveal showed nothing")
	_root.director.dev_toggle_reveal()

	hider.queue_free()
	await _settle_physics(4)


# --- gold and experience -----------------------------------------------------

## A minion kill pays the champion that landed the blow, and nobody else.
func _check_rewards() -> void:
	await _isolate_arena()
	var champion := _root.champion
	var rewards: RewardConfig = _root.director.config.rewards
	# Passive income would blur the comparison; it has its own check below.
	var passive := champion.wallet.passive_rate
	champion.wallet.passive_rate = 0.0

	var gold_before := champion.wallet.gold
	var experience_before := champion.experience.total
	var victim := _spawn_dummy(champion.global_position + Vector3(3.0, 0.0, 0.0),
		MapEnums.Team.B, 100.0, 910010)
	await _settle_physics(2)
	victim.health.kill(champion)
	await _settle_physics(2)
	var earned := champion.wallet.gold - gold_before
	print("[SmokeTest] a melee minion kill paid %.0f gold and %.0f XP" % [
		earned, champion.experience.total - experience_before
	])
	_expect(is_equal_approx(earned, rewards.melee_minion_gold),
		"a minion kill did not pay the configured gold")
	_expect(is_equal_approx(champion.experience.total - experience_before, rewards.minion_xp),
		"a minion kill did not pay the configured experience")

	# A minion that dies to nothing pays nobody.
	gold_before = champion.wallet.gold
	var unclaimed := _spawn_dummy(champion.global_position + Vector3(4.0, 0.0, 0.0),
		MapEnums.Team.B, 100.0, 910011)
	await _settle_physics(2)
	unclaimed.health.kill(null)
	await _settle_physics(2)
	_expect(is_equal_approx(champion.wallet.gold, gold_before),
		"an unclaimed minion death still paid gold")

	# Killing your own side pays nothing either.
	gold_before = champion.wallet.gold
	var friendly := _spawn_dummy(champion.global_position + Vector3(5.0, 0.0, 0.0),
		MapEnums.Team.A, 100.0, 910012)
	await _settle_physics(2)
	friendly.health.kill(champion)
	await _settle_physics(2)
	_expect(is_equal_approx(champion.wallet.gold, gold_before), "killing an ally paid gold")

	champion.wallet.passive_rate = passive


# --- levels ------------------------------------------------------------------

## Experience turns into a level, a level turns into stats and a skill point.
func _check_progression() -> void:
	var champion := _root.champion
	var level_before := champion.level.level
	var health_before := champion.stats.value("max_health")
	var needed := champion.experience.needed()
	_expect(needed > 0.0, "the champion is already at the level cap")

	champion.experience.add(needed, "test")
	await _settle_physics(2)
	_expect(champion.level.level == level_before + 1,
		"enough experience did not produce a level")
	_expect(champion.stats.value("max_health") > health_before,
		"levelling up granted no stat growth")
	_expect(champion.level.skill_points > 0, "levelling up granted no skill point")
	print("[SmokeTest] level %d -> %d, max health %.0f -> %.0f" % [
		level_before, champion.level.level, health_before, champion.stats.value("max_health")
	])

	# Growth is one modifier recomputed per level, so it can never stack.
	var health_at_level := champion.stats.value("max_health")
	champion.level.reapply_growth()
	_expect(is_equal_approx(champion.stats.value("max_health"), health_at_level),
		"reapplying level growth stacked it")
	champion.level.clear_points()


# --- shop and items ----------------------------------------------------------

## Buying is a base activity: the same request is refused in the lane and
## granted at the fountain, and the item it grants actually changes the stats.
func _check_shop_and_items() -> void:
	var champion := _root.champion
	var director := _root.director
	var catalog: ShopCatalog = director.config.shop_catalog
	var item: ItemData = catalog.item_by_id("longblade")
	_expect(item != null, "the prototype shop has no longblade")
	if item == null:
		return

	var mid := _root.map.layout.lane_point(MapEnums.Lane.MID, 0.5)
	champion.teleport_to(Vector3(mid.x, 0.0, mid.y))
	await _settle_physics(2)
	champion.wallet.add(5000.0, "test")
	_expect(director.purchases.zone_for(champion) == null, "the lane counts as a shop zone")
	_expect(not director.purchases.purchase(champion, item.id), "an item was sold in the lane")
	_expect(director.purchases.rejection_reason(champion, item) == "not in the shop",
		"the wrong reason was given for a purchase outside the shop")

	champion.teleport_to(champion.spawn_point)
	await _settle_physics(2)
	_expect(director.purchases.zone_for(champion) != null, "the fountain is not a shop zone")

	var gold_before := champion.wallet.gold
	var damage_before := champion.stats.value("attack_damage")
	_expect(director.purchases.purchase(champion, item.id), "buying at the fountain failed")
	_expect(is_equal_approx(champion.wallet.gold, gold_before - item.cost),
		"a purchase did not deduct the item's cost")
	_expect(champion.inventory.count() == 1, "a bought item did not enter the inventory")
	_expect(is_equal_approx(champion.stats.value("attack_damage"),
		damage_before + item.bonus_attack_damage), "a bought item applied no stat bonus")
	print("[SmokeTest] bought %s for %.0f gold: attack damage %.0f -> %.0f" % [
		item.display_name, item.cost, damage_before, champion.stats.value("attack_damage")
	])

	# Items survive a death; buffs do not.
	champion.health.kill(null)
	await _settle_physics(2)
	champion.respawn()
	await _settle_physics(2)
	_expect(champion.inventory.count() == 1, "respawning dropped the champion's items")
	_expect(is_equal_approx(champion.stats.value("attack_damage"),
		damage_before + item.bonus_attack_damage), "respawning dropped the item's stat bonus")

	# No gold, no item.
	champion.wallet.gold = 0.0
	var expensive: ItemData = catalog.item_by_id("arcane_ember")
	_expect(director.purchases.rejection_reason(champion, expensive) == "not enough gold",
		"a broke champion was not told it is broke")
	_expect(not director.purchases.purchase(champion, expensive.id),
		"an item was sold without enough gold")
	_expect(champion.inventory.count() == 1, "a refused purchase still filled a slot")

	_expect(director.dev_clear_inventory() == 1, "clearing the inventory removed nothing")
	_expect(is_equal_approx(champion.stats.value("attack_damage"), damage_before),
		"removing an item left its stat bonus behind")
	champion.wallet.add(1000.0, "test")


# --- attack-range visibility -------------------------------------------------

## The whole point of the range system: almost nothing has a ring, almost all
## of the time. Each rule gets its own assertion.
func _check_range_visibility() -> void:
	await _isolate_arena()
	var champion := _root.champion
	var view := _root.range_view
	_root.combat_debug.set_overlay_visible(false)
	view.set_own_range_visible(false)
	champion.teleport_to(champion.spawn_point)
	await _settle_physics(2)
	Vision.recompute()
	view.refresh()

	_expect(not view.is_ring_visible_for(champion), "the player's range ring is on at spawn")
	_expect(view.visible_ring_count() == 0, "something drew a range ring at spawn")

	# C — or a touch button — toggles the local champion's own ring, and only it.
	_root.commands.request_range_toggle()
	view.refresh()
	_expect(view.is_own_range_visible(), "the range toggle did not turn the ring on")
	_expect(view.is_ring_visible_for(champion), "the player's own ring did not appear")
	for enemy in _root.director.enemy_champions:
		_expect(not view.is_ring_visible_for(enemy), "an enemy champion's range was visible")
	_root.commands.request_range_toggle()
	view.refresh()
	_expect(not view.is_ring_visible_for(champion), "the range toggle did not turn the ring off")
	print("[SmokeTest] the range toggle shows only the local champion's own ring")

	# An enemy tower earns a ring only while it is actually threatening.
	# Mid, not top: the turret-combat check destroys the top outer tower, and a
	# dead tower threatens nobody.
	var tower := _root.director.turret_for("MID_OUTER_TURRET_B")
	var friendly := _root.director.turret_for("MID_OUTER_TURRET_A")
	_expect(tower != null and friendly != null, "the mid outer towers have no controllers")
	if tower == null or friendly == null:
		return
	_expect(tower.is_alive() and friendly.is_alive(), "the mid outer towers are not standing")
	view.refresh()
	_expect(not view.is_ring_visible_for(tower), "a distant enemy tower showed its range")

	champion.teleport_to(tower.global_position + Vector3(tower.attack_range() * 0.6, 0.0, 0.0))
	await _settle_physics(2)
	Vision.recompute()
	view.refresh()
	_expect(view.is_ring_visible_for(tower), "a tower the champion stands inside showed no range")
	_expect(not view.is_ring_visible_for(friendly), "an allied tower showed its range")
	print("[SmokeTest] only the enemy tower the champion is standing inside shows a ring")

	# Fog of war hides the threat as well as the tower.
	var sight := champion.vision.radius
	champion.vision.radius = 1.0
	Vision.recompute()
	view.refresh()
	_expect(not view.is_ring_visible_for(tower), "a tower the champion cannot see showed its range")
	champion.vision.radius = sight
	Vision.recompute()
	view.refresh()
	_expect(view.is_ring_visible_for(tower), "restoring vision did not restore the ring")

	# Walk out: the ring goes away with the threat.
	champion.teleport_to(champion.spawn_point)
	await _settle_physics(2)
	Vision.recompute()
	view.refresh()
	_expect(not view.is_ring_visible_for(tower), "leaving a tower's range left its ring up")

	# Minions never get one outside the developer view, which shows everything.
	var minion := _spawn_dummy(champion.global_position + Vector3(4.0, 0.0, 0.0),
		MapEnums.Team.B, 200.0, 910020)
	await _settle_physics(2)
	view.refresh()
	_expect(not view.is_ring_visible_for(minion), "a minion drew a range ring")
	_root.combat_debug.set_overlay_visible(true)
	view.refresh()
	_expect(view.is_ring_visible_for(tower) and view.is_ring_visible_for(friendly),
		"the combat debug view did not reveal every range")
	_root.combat_debug.set_overlay_visible(false)
	view.refresh()
	minion.queue_free()
	await _settle_physics(4)


## Test helper. [param health] overrides the resource value without touching
## the shared .tres, so a dummy can survive long enough to be observed.
## A [param net_id] above zero opts the dummy into the vision system, which
## tracks units by net id; leave it at zero for checks that do not care.
func _spawn_dummy(at: Vector3, team: int, health: float = 0.0, net_id: int = 0) -> MinionController:
	var stats: MinionStats = _root.director.config.wave.melee_stats
	if health > 0.0:
		stats = stats.duplicate()
		stats.max_health = health
	var minion := MinionController.new()
	minion.net_id = net_id
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

	# The full HUD at the fountain, with the shop open and a bought item in a
	# slot: the picture the acceptance loop ends on.
	_root.combat_debug.set_overlay_visible(false)
	champion.teleport_to(champion.spawn_point)
	champion.wallet.add(3000.0, "screenshot")
	await _settle_physics(6)
	_root.director.purchases.purchase(champion, "vital_stone")
	_root.director.purchases.purchase(champion, "traveller_boots")
	_root.hud.open_shop()
	camera.locked_to_target = true
	camera.set_follow_target(champion)
	camera.pitch_degrees = -52.0
	camera.set_distance(34.0)
	await _settle(20)
	await _save_frame("base_shop.png")
	_root.hud.close_shop()


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
