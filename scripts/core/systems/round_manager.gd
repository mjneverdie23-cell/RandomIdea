## The round state machine: WARMUP -> BUY -> LIVE -> ROUND_END -> (BUY | MATCH_END).
##
## The only place that knows *how a round is won*. It listens for bomb events,
## watches team elimination and the clock, asks MatchManager to record the result
## and tells EconomySystem to pay out. Characters, weapons and the bomb know
## nothing about rounds.
class_name RoundManager
extends RefCounted

var session
var teams: TeamManager
var match_manager: MatchManager
var economy: EconomySystem
var bomb: BombSystem
var spawn: SpawnSystem
var combat: CombatSystem

var phase: GameEnums.RoundPhase = GameEnums.RoundPhase.WARMUP
var phase_time_remaining: float = 0.0
var round_time_remaining: float = 0.0
var last_round_result: Dictionary = {}
## Freezes the clock and phase transitions (debugging, tests).
var paused: bool = false

var _resolving: bool = false
var _pending_side_switch: bool = false

func _init(p_session, p_teams: TeamManager, p_match: MatchManager, p_economy: EconomySystem,
		p_bomb: BombSystem, p_spawn: SpawnSystem, p_combat: CombatSystem) -> void:
	session = p_session
	teams = p_teams
	match_manager = p_match
	economy = p_economy
	bomb = p_bomb
	spawn = p_spawn
	combat = p_combat
	Events.bomb_defused.connect(_on_bomb_defused)
	Events.bomb_exploded.connect(_on_bomb_exploded)
	Events.character_died.connect(_on_character_died)

func dispose() -> void:
	if Events.bomb_defused.is_connected(_on_bomb_defused):
		Events.bomb_defused.disconnect(_on_bomb_defused)
	if Events.bomb_exploded.is_connected(_on_bomb_exploded):
		Events.bomb_exploded.disconnect(_on_bomb_exploded)
	if Events.character_died.is_connected(_on_character_died):
		Events.character_died.disconnect(_on_character_died)

# ---------------------------------------------------------------- lifecycle --
func start() -> void:
	match_manager.begin_match()
	economy.grant_starting_money(session.characters)
	_enter_phase(GameEnums.RoundPhase.WARMUP)

## Skips the rest of the current phase (a "ready up" button, or tests).
func skip_phase() -> void:
	phase_time_remaining = 0.0

func update(delta: float) -> void:
	if paused:
		return
	match phase:
		GameEnums.RoundPhase.WARMUP:
			_update_warmup(delta)
		GameEnums.RoundPhase.BUY:
			phase_time_remaining -= delta
			if phase_time_remaining <= 0.0:
				_enter_phase(GameEnums.RoundPhase.LIVE)
		GameEnums.RoundPhase.LIVE:
			_update_live(delta)
		GameEnums.RoundPhase.ROUND_END:
			phase_time_remaining -= delta
			if phase_time_remaining <= 0.0:
				_start_next_round()
		_:
			pass

func _update_warmup(delta: float) -> void:
	phase_time_remaining -= delta
	if Config.game.respawn_during_warmup:
		for character in session.characters:
			if character.health.alive:
				continue
			character.respawn_timer -= delta
			if character.respawn_timer <= 0.0:
				spawn.respawn(character)
	if phase_time_remaining <= 0.0:
		_enter_phase(GameEnums.RoundPhase.BUY)

func _update_live(delta: float) -> void:
	round_time_remaining -= delta
	bomb.update(delta)
	if _resolving:
		return
	# The clock only matters until the bomb is planted; after that the fuse rules.
	if not bomb.is_planted() and round_time_remaining <= 0.0:
		_end_round(teams.team_id_on_side(GameEnums.Side.DEFENDERS), GameEnums.RoundEndReason.TIME_EXPIRED)
		return
	_check_elimination()

# -------------------------------------------------------------------- phases --
func _enter_phase(new_phase: GameEnums.RoundPhase) -> void:
	var previous := phase
	phase = new_phase
	var config := Config.game

	match new_phase:
		GameEnums.RoundPhase.WARMUP:
			phase_time_remaining = config.warmup_duration
			combat.combat_enabled = true
			bomb.set_enabled(false)
			spawn.spawn_all(func(_c): return false)
			for character in session.characters:
				character.frozen = false
		GameEnums.RoundPhase.BUY:
			phase_time_remaining = config.buy_duration
			round_time_remaining = config.round_duration
			match_manager.begin_round()
			_prepare_round()
			combat.combat_enabled = false
			bomb.set_enabled(false)
			for character in session.characters:
				character.frozen = true
			Events.round_started.emit(match_manager.round_number)
		GameEnums.RoundPhase.LIVE:
			phase_time_remaining = 0.0
			combat.combat_enabled = true
			bomb.set_enabled(true)
			for character in session.characters:
				character.frozen = false
		GameEnums.RoundPhase.ROUND_END:
			phase_time_remaining = config.round_end_duration
			combat.combat_enabled = false
			bomb.set_enabled(false)
		GameEnums.RoundPhase.MATCH_END:
			phase_time_remaining = INF
			combat.combat_enabled = false
			bomb.set_enabled(false)
			for character in session.characters:
				character.frozen = true

	Events.round_phase_changed.emit(new_phase, previous, match_manager.round_number)

## Everything that has to happen between two rounds.
func _prepare_round() -> void:
	_resolving = false
	combat.clear_projectiles()
	bomb.reset()
	# Survivors of the previous round keep their gear; the dead start over.
	spawn.spawn_all(func(character): return character.survived_last_round)
	bomb.assign_to_random_attacker()
	for character in session.characters:
		character.survived_last_round = true

func _start_next_round() -> void:
	if match_manager.is_over:
		_enter_phase(GameEnums.RoundPhase.MATCH_END)
		return
	if _pending_side_switch:
		_pending_side_switch = false
		teams.switch_sides(match_manager.completed_rounds)
		if Config.game.reset_money_on_side_switch:
			var starting := Config.game.overtime_starting_money if match_manager.in_overtime \
				else Config.game.starting_money
			economy.grant_starting_money(session.characters, starting)
			# A fresh half means a fresh pistol round: gear is wiped.
			for character in session.characters:
				character.survived_last_round = false
				character.inventory.clear_weapons()
		for team in teams.all():
			team.loss_streak = 0
	_enter_phase(GameEnums.RoundPhase.BUY)

# ------------------------------------------------------- win conditions ----
func _check_elimination() -> void:
	var attacker_team := teams.team_id_on_side(GameEnums.Side.ATTACKERS)
	var defender_team := teams.team_id_on_side(GameEnums.Side.DEFENDERS)
	if teams.alive_count(defender_team) == 0:
		_end_round(attacker_team, GameEnums.RoundEndReason.DEFENDERS_ELIMINATED)
		return
	# Wiping the attackers only wins the round while the bomb is not ticking.
	if teams.alive_count(attacker_team) == 0 and not bomb.is_planted():
		_end_round(defender_team, GameEnums.RoundEndReason.ATTACKERS_ELIMINATED)

func _on_character_died(_victim, _attacker, _source: StringName, _headshot: bool) -> void:
	if phase == GameEnums.RoundPhase.LIVE and not _resolving:
		_check_elimination()

func _on_bomb_defused(_character) -> void:
	if phase != GameEnums.RoundPhase.LIVE:
		return
	_end_round(teams.team_id_on_side(GameEnums.Side.DEFENDERS), GameEnums.RoundEndReason.BOMB_DEFUSED)

func _on_bomb_exploded(_position: Vector3) -> void:
	if phase != GameEnums.RoundPhase.LIVE:
		return
	_end_round(teams.team_id_on_side(GameEnums.Side.ATTACKERS), GameEnums.RoundEndReason.BOMB_DETONATED)

## Single exit point for a round: score, money, events, next phase.
func _end_round(winning_team_id: int, reason: GameEnums.RoundEndReason) -> void:
	if _resolving or phase == GameEnums.RoundPhase.ROUND_END or phase == GameEnums.RoundPhase.MATCH_END:
		return
	_resolving = true

	for character in session.characters:
		character.survived_last_round = character.health.alive

	var bomb_planted := bomb.state == GameEnums.BombState.PLANTED \
		or bomb.state == GameEnums.BombState.EXPLODED or bomb.state == GameEnums.BombState.DEFUSED
	var planting_team: int = bomb.planter.team_id if bomb.planter != null else -1

	var result := match_manager.record_round_result(winning_team_id, reason)
	economy.award_round_end(winning_team_id, bomb_planted, planting_team)
	economy.award_objective_bonus(winning_team_id, reason)

	last_round_result = {
		"round": match_manager.round_number,
		"winner": winning_team_id,
		"winner_name": teams.get_team(winning_team_id).name if teams.get_team(winning_team_id) != null else "Nobody",
		"reason": reason,
		"scores": teams.scores(),
	}
	_pending_side_switch = result["switch_sides"]

	Events.round_ended.emit(match_manager.round_number, winning_team_id, reason, teams.scores())
	match_manager.flush_match_end()
	# MATCH_END is entered after the post-round pause, in _start_next_round().
	_enter_phase(GameEnums.RoundPhase.ROUND_END)

# ----------------------------------------------------------------- snapshot --
func time_remaining() -> float:
	if phase == GameEnums.RoundPhase.LIVE:
		return bomb.fuse_remaining if bomb.is_planted() else maxf(0.0, round_time_remaining)
	return maxf(0.0, phase_time_remaining)

func describe() -> Dictionary:
	return {
		"phase": phase,
		"time_remaining": time_remaining(),
		"round_number": match_manager.round_number,
		"last_result": last_round_result,
		"buy_phase": phase == GameEnums.RoundPhase.BUY or phase == GameEnums.RoundPhase.WARMUP,
	}
