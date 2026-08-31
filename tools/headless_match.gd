## Runs a complete bot-vs-bot match with no renderer, no HUD and no player.
##
##   godot --headless --path . res://tools/headless_match.tscn -- --seed 7 --verbose
##
## The fastest way to check that a gameplay change did not break the round loop:
## it exercises buy phases, combat, planting, defusing, side switching and the
## match win condition end to end.
extends Node

## Game seconds simulated per wall-clock second. Physics still steps at 1/64 s.
const SPEEDUP := 12

var session: MatchSession
var verbose := false
var rounds: Array[Dictionary] = []
var side_switches := 0
var started_at := 0

func _ready() -> void:
	var arguments := _parse_arguments()
	verbose = arguments.has("verbose")
	var seed_value := int(arguments.get("seed", Config.game.seed))
	var round_limit := int(arguments.get("rounds", Config.game.max_rounds + 4))

	# Keep the effective physics delta at 1/64 s while running many ticks per
	# wall second: physics rate and time scale are raised together.
	Engine.physics_ticks_per_second = 64 * SPEEDUP
	Engine.max_physics_steps_per_frame = 64 * SPEEDUP
	Engine.time_scale = SPEEDUP
	Engine.max_fps = 0

	session = MatchSession.new()
	session.name = "MatchSession"
	add_child(session)
	session.configure({"with_local_player": false, "seed": seed_value})

	Events.round_ended.connect(_on_round_ended)
	Events.sides_switched.connect(_on_sides_switched)
	Events.match_ended.connect(_on_match_ended)
	if verbose:
		Events.bomb_planted.connect(func(c, site, _p): print("   bomb planted at %s by %s" % [site, c.character_name]))
		Events.bomb_defused.connect(func(c): print("   bomb defused by %s" % c.character_name))
		Events.kill_feed.connect(func(a, _at, v, _vt, source, hs):
			print("   %s [%s%s] %s" % [a, source, " HS" if hs else "", v]))

	started_at = Time.get_ticks_msec()
	session.start()
	print("simulating a match (seed %d, speedup x%d)..." % [seed_value, SPEEDUP])
	_watch(round_limit)

func _watch(round_limit: int) -> void:
	while session.round_manager.phase != GameEnums.RoundPhase.MATCH_END \
			and session.match_manager.completed_rounds < round_limit:
		await get_tree().physics_frame
	_report()

func _on_round_ended(round_number: int, winner: int, reason: GameEnums.RoundEndReason, scores: Dictionary) -> void:
	rounds.append({"round": round_number, "winner": winner, "reason": reason})
	var sides := "T1 attacking" if session.teams.side_of(GameEnums.Team.TEAM_ONE) == GameEnums.Side.ATTACKERS else "T2 attacking"
	print("round %2d | winner %-8s | %-22s | T1:%d T2:%d | %s" % [
		round_number, _team_name(winner), GameEnums.RoundEndReason.keys()[reason],
		scores[GameEnums.Team.TEAM_ONE], scores[GameEnums.Team.TEAM_TWO], sides])

func _on_sides_switched(completed_rounds: int) -> void:
	side_switches += 1
	print("--- sides switched after %d completed rounds ---" % completed_rounds)

func _on_match_ended(winning_team: int, reason: String, scores: Dictionary) -> void:
	print("\nMATCH OVER: %s (%s)  final score T1:%d T2:%d" % [
		_team_name(winning_team), reason,
		scores[GameEnums.Team.TEAM_ONE], scores[GameEnums.Team.TEAM_TWO]])

func _report() -> void:
	var wall := (Time.get_ticks_msec() - started_at) / 1000.0
	print("\nsimulated %d rounds in %.1f in-game minutes (%.1fs wall clock)" % [
		rounds.size(), session.elapsed / 60.0, wall])
	print("side switches: %d" % side_switches)

	var reasons := {}
	for entry in rounds:
		var key: String = GameEnums.RoundEndReason.keys()[entry["reason"]]
		reasons[key] = reasons.get(key, 0) + 1
	print("round end reasons: %s" % reasons)

	var scoreboard: Array = session.characters.duplicate()
	scoreboard.sort_custom(func(a, b): return a.score["kills"] > b.score["kills"])
	print("\n%-10s %-9s %-9s %3s %3s %3s %6s %7s %6s" % ["name", "team", "class", "K", "D", "A", "plants", "defuses", "money"])
	for character in scoreboard:
		print("%-10s %-9s %-9s %3d %3d %3d %6d %7d %6d" % [
			character.character_name, _team_name(character.team_id), character.class_id,
			character.score["kills"], character.score["deaths"], character.score["assists"],
			character.score["plants"], character.score["defuses"], character.money])

	var ok := session.round_manager.phase == GameEnums.RoundPhase.MATCH_END
	if not ok:
		printerr("WARNING: the match did not reach MATCH_END within the round limit")
	get_tree().quit(0 if ok else 1)

func _team_name(team_id: int) -> String:
	if team_id < 0:
		return "DRAW"
	return "TEAM_ONE" if team_id == GameEnums.Team.TEAM_ONE else "TEAM_TWO"

func _parse_arguments() -> Dictionary:
	var out := {}
	var args := OS.get_cmdline_user_args()
	var index := 0
	while index < args.size():
		var argument: String = args[index]
		if argument.begins_with("--"):
			var key := argument.substr(2)
			if index + 1 < args.size() and not args[index + 1].begins_with("--"):
				out[key] = args[index + 1]
				index += 1
			else:
				out[key] = true
		index += 1
	return out
