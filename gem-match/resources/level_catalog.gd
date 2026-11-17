class_name LevelCatalog
extends Resource
## The ordered list of levels. Add a level by creating a LevelData .tres in res://levels/
## and appending it here.

@export var levels: Array[LevelData] = []
