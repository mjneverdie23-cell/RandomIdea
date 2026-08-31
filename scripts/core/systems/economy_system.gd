## Money: kill rewards, objective rewards, round income and the loss bonus.
##
## Event-driven - it listens for kills, plants and defuses rather than being
## called by combat or bomb code, so those systems never learn the economy exists.
class_name EconomySystem
extends RefCounted

var teams: TeamManager

func _init(p_teams: TeamManager) -> void:
	teams = p_teams
	Events.character_died.connect(_on_character_died)
	Events.bomb_planted.connect(_on_bomb_planted)
	Events.bomb_defused.connect(_on_bomb_defused)

func dispose() -> void:
	if Events.character_died.is_connected(_on_character_died):
		Events.character_died.disconnect(_on_character_died)
	if Events.bomb_planted.is_connected(_on_bomb_planted):
		Events.bomb_planted.disconnect(_on_bomb_planted)
	if Events.bomb_defused.is_connected(_on_bomb_defused):
		Events.bomb_defused.disconnect(_on_bomb_defused)

func add_money(character, amount: int, reason: StringName = &"unknown") -> int:
	if character == null or amount == 0:
		return 0 if character == null else character.money
	var before: int = character.money
	character.money = clampi(character.money + amount, 0, Config.game.max_money)
	var delta: int = character.money - before
	if delta != 0:
		Events.money_changed.emit(character, character.money, delta, reason)
	return character.money

func spend(character, amount: int, reason: StringName = &"purchase") -> bool:
	if character.money < amount:
		return false
	add_money(character, -amount, reason)
	return true

## Sets everyone to the configured starting money (match start / side switch).
func grant_starting_money(characters: Array, amount: int = -1) -> void:
	var value := Config.game.starting_money if amount < 0 else amount
	for character in characters:
		character.money = 0
		add_money(character, value, &"reset")

func _on_character_died(victim, attacker, source: StringName, _headshot: bool) -> void:
	var config := Config.game
	if attacker == null or attacker == victim:
		add_money(victim, config.suicide_penalty, &"suicide")
		return
	if attacker.team_id == victim.team_id:
		add_money(attacker, config.team_kill_penalty, &"teamkill")
		return
	var reward := 300
	var weapon := Config.weapon(source)
	if weapon != null:
		reward = weapon.kill_reward
	else:
		var equipment := Config.equipment_item(source)
		if equipment != null:
			reward = equipment.kill_reward
	add_money(attacker, reward, &"kill")

func _on_bomb_planted(character, _site_id: StringName, _position: Vector3) -> void:
	add_money(character, Config.game.plant_reward, &"plant")

func _on_bomb_defused(character) -> void:
	add_money(character, Config.game.defuse_reward, &"defuse")

## End-of-round income for both teams.
func award_round_end(winning_team_id: int, bomb_planted: bool, planting_team_id: int) -> void:
	var config := Config.game
	for team in teams.all():
		var amount := 0
		if team.id == winning_team_id:
			amount = config.round_win_reward
		else:
			# loss_streak was already incremented by MatchManager.
			var streak := maxi(1, team.loss_streak)
			amount = mini(config.loss_bonus_max,
				config.loss_bonus_base + config.loss_bonus_increment * (streak - 1))
			if bomb_planted and team.id == planting_team_id:
				amount += config.loss_with_plant_bonus
		for member in team.members:
			add_money(member, amount, &"roundWin" if team.id == winning_team_id else &"roundLoss")

## Extra payout for the objective, on top of the win reward.
func award_objective_bonus(team_id: int, reason: GameEnums.RoundEndReason) -> void:
	var config := Config.game
	var bonus := 0
	if reason == GameEnums.RoundEndReason.BOMB_DETONATED:
		bonus = config.bomb_detonated_bonus
	elif reason == GameEnums.RoundEndReason.BOMB_DEFUSED:
		bonus = config.bomb_defused_bonus
	if bonus == 0:
		return
	for member in teams.members_of(team_id):
		add_money(member, bonus, &"objective")
