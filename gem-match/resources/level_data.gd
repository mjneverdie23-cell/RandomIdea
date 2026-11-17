class_name LevelData
extends Resource
## One level: board size, which gems can appear, the move limit and the goals.
## To win, the player must reach the first star score and complete every collect goal.

@export_range(3, 8) var columns: int = 8
@export_range(3, 9) var rows: int = 8
## At least 3. Fewer types make matches (and cascades) more common.
@export var gem_types: Array[GemType] = []
@export var moves: int = 20
## Scores for 1, 2 and 3 stars, lowest first. The first one is required to win.
@export var star_scores: PackedInt32Array = PackedInt32Array([1000, 2000, 3000])
@export var collect_goals: Array[CollectGoal] = []


func stars_for(score: int) -> int:
	var stars := 0
	for threshold in star_scores:
		if score >= threshold:
			stars += 1
	return stars
