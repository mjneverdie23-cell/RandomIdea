extends Node

## Client half of the networked Solo Lane integration test.
##
## Launched as a second headless process by [code]tools/NetMatchTest.tscn[/code].
## It joins the host, plays the client side of a scripted match and records what
## it observed, then writes the observations where the host can read them.
##
## The root node is named NetTest in both processes on purpose: Godot routes
## RPCs by node path, so the two scene trees have to agree.

const MAIN_SCENE := "res://scenes/Main.tscn"
const DEFAULT_RESULT_PATH := "user://net_client_result.json"
const TIMEOUT := 45.0

var _root: GameRoot
var _elapsed := 0.0
var _observations := {
	"connected": false,
	"role": "",
	"local_team": -1,
	"roster_size": 0,
	"owned_champions": 0,
	"foreign_champions": 0,
	"remote_champion_moved": 0.0,
	"own_champion_moved": 0.0,
	"own_health_min": -1.0,
	"own_health_max": -1.0,
	"saw_own_death": false,
	"saw_own_respawn": false,
	"minions_seen": 0,
	"turrets_seen": 0,
	"nexuses_seen": 0,
	"nexus_b_min_health": -1.0,
	"outcome": "",
	"simulated_units": 0,
	# Progression and economy arrive from the server; none of it is decided here.
	"client_gold": 0.0,
	"client_level": 0,
	"client_items": [],
	"client_rank_q": 0,
	# Every one of these must come back true: a client that can grant itself
	# gold, items, ranks or wards is not a client.
	"upgrade_call_blocked": false,
	"purchase_call_blocked": false,
	"ward_call_blocked": false,
	"gold_forgery_reverted": false,
	"forged_cast_attempted": false,
	# Range rings never travel: the host turns its own on, and this must not.
	"own_ring_hidden_by_default": false,
	"opponent_ring_visible": false,
	"finished": false,
}

var _result_path := DEFAULT_RESULT_PATH
var _remote_start := Vector3.ZERO
var _saw_dead := false
var _written := false
## Snapshots are unreliable, so give the last few a moment to land after the
## reliable match-end message arrives.
var _ending := false
var _end_grace := 0.0
var _own_start := Vector3.ZERO
## Forgery attempt: run once, a couple of seconds in, then checked a second later.
var _forgery_done := false
var _forged_gold := 0.0
var _forged_at := 0.0
var _debug_view_disabled := false


func _ready() -> void:
	var port := 8700
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--port="):
			port = int(arg.substr(7))
		elif arg.begins_with("--result="):
			_result_path = arg.substr(9)
	GameRoot._pending_launch = {
		"mode_id": "solo_lane",
		"net": "client",
		"address": "127.0.0.1",
		"port": port,
	}
	_root = load(MAIN_SCENE).instantiate()
	_root.name = "Main"
	_root.print_startup_report = false
	add_child(_root)


func _process(delta: float) -> void:
	_elapsed += delta
	if _ending:
		_end_grace -= delta
	_observe()
	if _elapsed > TIMEOUT:
		_finish("timeout")


func _observe() -> void:
	_observations["role"] = NetTypes.role_name(Net.role)
	_observations["connected"] = Net.is_connected_now()
	if _root == null or not _root.started:
		return

	# The developer combat overlay reveals every range by design, which would
	# mask the thing being checked here: that nothing about the host's own ring
	# travels. Turn it off so a ring on screen can only mean replication.
	if not _debug_view_disabled:
		_debug_view_disabled = true
		_root.combat_debug.set_overlay_visible(false)
		_root.range_view.set_own_range_visible(false)

	var session: MatchSession = _root.session
	_observations["roster_size"] = maxi(int(_observations["roster_size"]), session.player_count())
	if Net.is_connected_now():
		_observations["local_team"] = session.local_team()

	# The client must not be simulating anything: every unit is a puppet.
	var simulated := 0
	var minions := 0
	var turrets := 0
	var nexuses := 0
	var owned := 0
	var foreign := 0
	for unit in Battle.all():
		if unit.simulated:
			simulated += 1
		match unit.kind:
			Unit.Kind.MINION:
				minions += 1
			Unit.Kind.CHAMPION:
				if unit.is_locally_owned() and unit.owner_peer_id != 0:
					owned += 1
				else:
					foreign += 1
					_track_remote(unit)
			Unit.Kind.TURRET:
				if unit is NexusController:
					nexuses += 1
					if unit.team == MapEnums.Team.B:
						_track_nexus(unit)
				else:
					turrets += 1
	_observations["simulated_units"] = maxi(int(_observations["simulated_units"]), simulated)
	_observations["minions_seen"] = maxi(int(_observations["minions_seen"]), minions)
	_observations["turrets_seen"] = maxi(int(_observations["turrets_seen"]), turrets)
	_observations["nexuses_seen"] = maxi(int(_observations["nexuses_seen"]), nexuses)
	_observations["owned_champions"] = maxi(int(_observations["owned_champions"]), owned)
	_observations["foreign_champions"] = maxi(int(_observations["foreign_champions"]), foreign)

	_track_own_champion()
	_track_progression()
	_track_range_rings()
	_attempt_forgery()
	_check_forgery_result()
	_drive_input()

	if session.phase == NetTypes.MatchPhase.ENDED:
		_observations["outcome"] = _root.director.match_state.outcome_name()
		if not _ending:
			_ending = true
			_end_grace = 1.5
		elif _end_grace <= 0.0:
			_finish("match ended")


## Records how far the opponent's champion travelled, which only replication
## can produce: a client never simulates it.
func _track_remote(unit: Unit) -> void:
	if _remote_start == Vector3.ZERO:
		_remote_start = unit.global_position
		return
	_observations["remote_champion_moved"] = maxf(
		float(_observations["remote_champion_moved"]), _remote_start.distance_to(unit.global_position)
	)


func _track_nexus(nexus: Unit) -> void:
	var current: float = float(_observations["nexus_b_min_health"])
	if current < 0.0:
		_observations["nexus_b_min_health"] = nexus.health.current
	else:
		_observations["nexus_b_min_health"] = minf(current, nexus.health.current)


func _track_own_champion() -> void:
	var champion: ChampionController = _root.champion
	if champion == null or not is_instance_valid(champion):
		return
	if _own_start == Vector3.ZERO:
		_own_start = champion.global_position
	_observations["own_champion_moved"] = maxf(
		float(_observations["own_champion_moved"]), _own_start.distance_to(champion.global_position)
	)
	var health := champion.health.current
	if float(_observations["own_health_max"]) < 0.0:
		_observations["own_health_max"] = health
		_observations["own_health_min"] = health
	_observations["own_health_max"] = maxf(float(_observations["own_health_max"]), health)
	_observations["own_health_min"] = minf(float(_observations["own_health_min"]), health)
	if not champion.is_alive():
		_saw_dead = true
		_observations["saw_own_death"] = true
	elif _saw_dead:
		_observations["saw_own_respawn"] = true


## Gold, level and items are replicated state on a client. The last value seen
## is the one the host is asserted against.
func _track_progression() -> void:
	var champion: ChampionController = _root.champion
	if champion == null or not is_instance_valid(champion):
		return
	if champion.wallet != null and not _forgery_pending():
		_observations["client_gold"] = champion.wallet.gold
	if champion.level != null:
		_observations["client_level"] = champion.level.level
	if champion.abilities != null:
		_observations["client_rank_q"] = champion.abilities.rank(0)
	if champion.inventory != null and champion.inventory.count() > 0:
		_observations["client_items"] = Array(champion.inventory.item_ids())


## The host has its own ring on. Nothing about that may reach this process.
func _track_range_rings() -> void:
	var view: RangeVisualizer = _root.range_view
	for unit in Battle.all():
		if unit.kind != Unit.Kind.CHAMPION or unit == _root.champion:
			continue
		if view.is_ring_visible_for(unit):
			_observations["opponent_ring_visible"] = true


func _forgery_pending() -> bool:
	return _forgery_done and not bool(_observations["gold_forgery_reverted"])


## Tries every way a client could cheat, and records that each one failed.
##
## The three calls below are the real authority gates: [PurchaseSystem],
## [GameDirector.place_ward] and [ChampionController.spend_skill_point] all
## refuse outright when this process is not the authority. Writing the numbers
## into the local components instead is the other half of the attempt — the
## next snapshot from the host simply overwrites them.
func _attempt_forgery() -> void:
	var champion: ChampionController = _root.champion
	if champion == null or not is_instance_valid(champion) or _forgery_done or _elapsed < 2.5:
		return
	_forgery_done = true
	_observations["own_ring_hidden_by_default"] = not _root.range_view.is_own_range_visible()
	_observations["upgrade_call_blocked"] = not champion.spend_skill_point(0)
	_observations["purchase_call_blocked"] = \
		not _root.director.purchases.purchase(champion, "longblade")
	_observations["ward_call_blocked"] = \
		_root.director.place_ward(champion, champion.global_position) == null

	_forged_gold = 999999.0
	champion.wallet.gold = _forged_gold
	champion.abilities.ranks[0] = 5
	# A locally "unlocked" ability still has to pass the server's own check.
	_root.commands.request_ability(0)
	_observations["forged_cast_attempted"] = true
	_forged_at = _elapsed


func _check_forgery_result() -> void:
	if not _forgery_done or _elapsed < _forged_at + 1.0:
		return
	var champion: ChampionController = _root.champion
	if champion == null or not is_instance_valid(champion) or champion.wallet == null:
		return
	if champion.wallet.gold < _forged_gold:
		_observations["gold_forgery_reverted"] = true


## Holds a movement command so the host has something to validate and apply.
func _drive_input() -> void:
	if _root.champion == null:
		return
	_root.pc_input.set_process(false)
	# Push down the lane towards the enemy: team A starts at +Z, team B at -Z.
	var forward := 1.0 if _root.champion.team == MapEnums.Team.B else -1.0
	_root.commands.set_move_direction(Vector2(0.0, forward))


func _finish(reason: String) -> void:
	if _written:
		return
	_written = true
	_observations["finished"] = true
	_observations["reason"] = reason
	var file := FileAccess.open(_result_path, FileAccess.WRITE)
	if file != null:
		file.store_string(JSON.stringify(_observations))
		file.close()
	print("[NetClient] ", JSON.stringify(_observations))
	get_tree().quit(0)
