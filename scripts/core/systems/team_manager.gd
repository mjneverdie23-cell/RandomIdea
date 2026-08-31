## Teams and sides.
##
## A *team* is permanent and owns the score; a *side* (attackers/defenders) is a
## role that swaps at halftime. Every other system asks which side a team is on
## rather than assuming it - that is what makes the side switch one operation.
class_name TeamManager
extends RefCounted

class TeamState extends RefCounted:
	var id: int
	var name: String
	var side: GameEnums.Side
	var score: int = 0
	var loss_streak: int = 0
	var members: Array = []

	func _init(p_id: int, p_name: String, p_side: GameEnums.Side) -> void:
		id = p_id
		name = p_name
		side = p_side

var teams: Dictionary = {}

func _init(team_one_name: String = "Raptors", team_two_name: String = "Titans") -> void:
	teams[GameEnums.Team.TEAM_ONE] = TeamState.new(GameEnums.Team.TEAM_ONE, team_one_name, GameEnums.Side.ATTACKERS)
	teams[GameEnums.Team.TEAM_TWO] = TeamState.new(GameEnums.Team.TEAM_TWO, team_two_name, GameEnums.Side.DEFENDERS)

func all() -> Array:
	return [teams[GameEnums.Team.TEAM_ONE], teams[GameEnums.Team.TEAM_TWO]]

func get_team(team_id: int) -> TeamState:
	return teams.get(team_id)

func side_of(team_id: int) -> GameEnums.Side:
	var team := get_team(team_id)
	return team.side if team != null else GameEnums.Side.ATTACKERS

func team_on_side(side: GameEnums.Side) -> TeamState:
	for team in all():
		if team.side == side:
			return team
	return null

func team_id_on_side(side: GameEnums.Side) -> int:
	var team := team_on_side(side)
	return team.id if team != null else GameEnums.Team.TEAM_ONE

func add_member(character, team_id: int) -> void:
	var team := get_team(team_id)
	character.team_id = team_id
	if not team.members.has(character):
		team.members.append(character)

func remove_member(character) -> void:
	for team in all():
		team.members.erase(character)

func members_of(team_id: int, alive_only: bool = false) -> Array:
	var team := get_team(team_id)
	if team == null:
		return []
	if not alive_only:
		return team.members.duplicate()
	return team.members.filter(func(c): return c.health.alive)

func members_on_side(side: GameEnums.Side, alive_only: bool = false) -> Array:
	return members_of(team_id_on_side(side), alive_only)

func alive_count(team_id: int) -> int:
	return members_of(team_id, true).size()

## Swaps attacker/defender roles. Scores are untouched.
func switch_sides(completed_rounds: int = 0) -> void:
	for team in all():
		team.side = GameEnums.Side.DEFENDERS if team.side == GameEnums.Side.ATTACKERS else GameEnums.Side.ATTACKERS
	Events.sides_switched.emit(completed_rounds)

func scores() -> Dictionary:
	return {
		GameEnums.Team.TEAM_ONE: teams[GameEnums.Team.TEAM_ONE].score,
		GameEnums.Team.TEAM_TWO: teams[GameEnums.Team.TEAM_TWO].score,
	}

func describe() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for team in all():
		out.append({
			"id": team.id, "name": team.name, "side": team.side, "score": team.score,
			"loss_streak": team.loss_streak, "alive": alive_count(team.id), "size": team.members.size(),
		})
	return out
