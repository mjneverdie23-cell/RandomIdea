class_name CombatLayers
extends RefCounted

## Physics layer vocabulary for the combat sandbox.
##
## Units only *collide* with the world; they merely occupy a team layer so
## selection rays and area queries can find them. That keeps a lane full of
## minions from deadlocking into a traffic jam while still letting anything
## query "enemies of team X" through the physics server.

const WORLD := 1 << 0
const TEAM_A := 1 << 1
const TEAM_B := 1 << 2
const PROJECTILE := 1 << 3
const NAVIGATION_SOURCE := 1 << 4

const UNITS := TEAM_A | TEAM_B


static func team_layer(team: int) -> int:
	return TEAM_A if team == MapEnums.Team.A else TEAM_B


static func enemy_layer(team: int) -> int:
	return TEAM_B if team == MapEnums.Team.A else TEAM_A
