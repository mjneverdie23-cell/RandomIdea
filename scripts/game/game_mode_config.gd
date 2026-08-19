@tool
class_name GameModeConfig
extends Resource

## One playable mode: which map to build, which layout builds it, and which
## match rules apply.
##
## Adding a mode means adding a resource, not a code path. [GameRoot] applies
## the config to the map controller and the game director before anything is
## built, so every gameplay system downstream is unchanged.

enum Kind { FULL_MOBA, SOLO_LANE }

const KIND_NAMES := ["FULL_MOBA", "SOLO_LANE"]

@export var id: String = "full_moba"
@export var display_name: String = "Full MOBA"
@export var kind: Kind = Kind.FULL_MOBA

## Map dimensions and terrain. Passed straight to [MapController].
@export var map_config: MapConfig
## [MapLayout] subclass that turns [member map_config] into geometry. Empty
## means the three-lane default.
@export var layout_script: Script
## Champions, minions, turrets and win conditions.
@export var match_config: MatchConfig


func kind_name() -> String:
	return KIND_NAMES[kind]
