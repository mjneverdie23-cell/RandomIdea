## The single input contract of the simulation.
##
## A human (PlayerController) and a bot (BotBrain) both do exactly one thing:
## fill in an Intent. Nothing downstream can tell them apart, which is why bots
## can use every mechanic a player can - and why replays or net code could be
## added later by recording just this object.
class_name Intent
extends RefCounted

## Movement in the character's local frame: +1 forward, +1 right.
var move_forward: float = 0.0
var move_right: float = 0.0
var jump: bool = false
var crouch: bool = false
var sprint: bool = false

## Absolute look direction, radians.
var yaw: float = 0.0
var pitch: float = 0.0

var fire: bool = false
var aim: bool = false
var reload: bool = false
## Plant / defuse / pick the bomb up.
var use: bool = false
var drop: bool = false
var throw_grenade: bool = false
## GameEnums.WeaponSlot to switch to, or -1. Consumed once applied.
var switch_to_slot: int = -1
## Ability index (0 = primary, 1 = secondary) or -1. Consumed once used.
var use_ability: int = -1

func clear_actions() -> void:
	move_forward = 0.0
	move_right = 0.0
	jump = false
	crouch = false
	sprint = false
	fire = false
	aim = false
	reload = false
	use = false
	drop = false
	throw_grenade = false
	switch_to_slot = -1
	use_ability = -1
