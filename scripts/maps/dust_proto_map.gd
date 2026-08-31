## "DUSTBOWL PROTO" - a primitives-only layout inspired by the three-lane
## structure of Dust II. Gameplay layout only: no art, no detail geometry.
##
## HOW TO EDIT THIS MAP
##   1. Areas are the walkable footprint. Add or resize a rectangle and the walls
##      around it are regenerated automatically by MapCompiler. Two areas connect
##      wherever their rectangles touch or overlap.
##   2. Props are the cover you place inside those areas.
##   3. Spawns, buy zones and bomb sites are plain coordinates.
## Nothing else in the project needs to change when this file changes.
##
## Orientation: +Z north (defenders), -Z south (attackers), +X east (A side),
## -X west (B side). Y is up, floor at y = 0.
class_name DustProtoMap
extends RefCounted

const CRATE := Color("a8792f")
const CONTAINER := Color("40606f")
const PLATFORM := Color("8a8a8a")
const PILLAR := Color("b0a894")
const WALLC := Color("9c8d76")
const RAMPC := Color("7d7d7d")

static func build() -> MapDefinition:
	var map := MapDefinition.new()
	map.id = &"dust_proto"
	map.display_name = "Dustbowl Proto"
	map.cell_size = 2.0
	map.wall_height = 8.0
	map.padding = 6.0
	map.floor_color = Color("b3a377")

	# ------------------------------------------------------------- areas --
	# Lane summary:
	#   West lane : Ramp -> B Tunnels -> B Site
	#   Mid lane  : Ramp -> Mid -> Mid Doors -> Mid Plaza -> (A Short | B Connector | Defender side)
	#   East lane : Ramp -> A Long -> A Site
	map.areas = [
		# attacker side
		MapArea.make(&"T_SPAWN", -30, -72, 30, -58, "Attacker Spawn", [&"spawn", &"attackers"]),
		MapArea.make(&"T_HALL", -52, -58, 52, -48, "Ramp", [&"connector"]),
		# west lane (B)
		MapArea.make(&"B_TUNNEL_LOWER", -52, -48, -40, -6, "Lower Tunnels"),
		MapArea.make(&"B_TUNNEL_UPPER", -56, -6, -36, 24, "Upper Tunnels"),
		MapArea.make(&"B_SITE", -58, 24, -28, 46, "B Site", [&"site", &"site_b"]),
		MapArea.make(&"B_DOORS", -44, 46, -30, 56, "B Doors", [&"connector"]),
		# east lane (A)
		MapArea.make(&"A_LONG_LOWER", 40, -48, 52, -6, "Long Doors"),
		MapArea.make(&"A_LONG_UPPER", 36, -6, 56, 24, "A Long"),
		MapArea.make(&"A_SITE", 28, 24, 58, 46, "A Site", [&"site", &"site_a"]),
		MapArea.make(&"A_CT_ENTRY", 30, 46, 44, 56, "A Entry", [&"connector"]),
		# mid
		MapArea.make(&"MID_LOWER", -8, -48, 8, 6, "Lower Mid"),
		MapArea.make(&"MID_DOORS", -8, 6, 8, 18, "Mid Doors"),
		MapArea.make(&"MID_PLAZA", -16, 18, 16, 34, "Mid"),
		MapArea.make(&"MID_CONNECTOR", -6, 34, 6, 56, "Mid Connector", [&"connector"]),
		MapArea.make(&"A_SHORT", 16, 26, 28, 34, "A Short", [&"connector"]),
		MapArea.make(&"B_CONNECT", -28, 26, -16, 34, "B Connector", [&"connector"]),
		# defender side
		MapArea.make(&"CT_HALL", -44, 56, 44, 66, "Defender Hall", [&"connector"]),
		MapArea.make(&"CT_SPAWN", -14, 56, 14, 72, "Defender Spawn", [&"spawn", &"defenders"]),
	]

	# ------------------------------------------------------------- props --
	# Boxes taller than 1.4 block bot navigation by default; ramps never do.
	map.props = [
		# A site
		MapProp.box(&"a_platform", Vector2(46, 40), Vector3(10, 1.2, 7), 0.0, PLATFORM, GameEnums.PropKind.PLATFORM),
		MapProp.ramp(&"a_platform_ramp", Vector2(46, 34.5), 6.0, 3.0, 1.2, "+z", RAMPC),
		MapProp.box(&"a_crate_big", Vector2(36, 30), Vector3(3, 2.2, 3), 0.0, CRATE),
		MapProp.box(&"a_crate_low", Vector2(40.5, 27.5), Vector3(2.5, 1.0, 2.5), 0.0, CRATE, GameEnums.PropKind.COVER, 0),
		MapProp.box(&"a_short_wall", Vector2(30, 37), Vector3(2, 2.6, 6), 0.0, WALLC),
		MapProp.cylinder(&"a_barrel", Vector2(44, 30), 1.0, 1.8, 0.0, CONTAINER),
		# B site
		MapProp.box(&"b_platform", Vector2(-46, 40), Vector3(10, 1.2, 7), 0.0, PLATFORM, GameEnums.PropKind.PLATFORM),
		MapProp.ramp(&"b_platform_ramp", Vector2(-46, 34.5), 6.0, 3.0, 1.2, "+z", RAMPC),
		MapProp.box(&"b_car", Vector2(-36, 30), Vector3(4, 1.8, 2.5), 0.0, CONTAINER),
		MapProp.box(&"b_crate_big", Vector2(-50, 29), Vector3(2.5, 2.2, 2.5), 0.0, CRATE),
		MapProp.box(&"b_crate_low", Vector2(-40, 27), Vector3(2.5, 1.0, 2.5), 0.0, CRATE, GameEnums.PropKind.COVER, 0),
		MapProp.cylinder(&"b_barrel", Vector2(-32, 42), 1.0, 1.8, 0.0, CONTAINER),
		# mid
		MapProp.box(&"mid_door_west", Vector2(-6.5, 12), Vector3(3, 4, 1.5), 0.0, WALLC),
		MapProp.box(&"mid_door_east", Vector2(6.5, 12), Vector3(3, 4, 1.5), 0.0, WALLC),
		MapProp.box(&"mid_xbox", Vector2(3, -14), Vector3(3, 1.0, 3), 0.0, CRATE, GameEnums.PropKind.COVER, 0),
		MapProp.box(&"mid_nest", Vector2(0, 30), Vector3(8, 1.6, 4), 0.0, PLATFORM, GameEnums.PropKind.PLATFORM),
		MapProp.ramp(&"mid_nest_ramp", Vector2(0, 26.5), 5.0, 3.0, 1.6, "+z", RAMPC),
		MapProp.cylinder(&"mid_pillar_west", Vector2(-12, 22), 1.2, 5.0, 0.0, PILLAR),
		MapProp.cylinder(&"mid_pillar_east", Vector2(12, 22), 1.2, 5.0, 0.0, PILLAR),
		# long
		MapProp.box(&"long_container", Vector2(46, 4), Vector3(6, 2.4, 4), 0.0, CONTAINER),
		MapProp.box(&"long_crate", Vector2(44, -22), Vector3(2.5, 2.2, 2.5), 0.0, CRATE),
		MapProp.box(&"long_pit_cover", Vector2(52, 12), Vector3(3, 1.0, 6), 0.0, CRATE, GameEnums.PropKind.COVER, 0),
		# tunnels
		MapProp.box(&"tunnel_crate_big", Vector2(-46, -30), Vector3(2.5, 2.2, 2.5), 0.0, CRATE),
		MapProp.box(&"tunnel_crate_low", Vector2(-49, 2), Vector3(3, 1.0, 3), 0.0, CRATE, GameEnums.PropKind.COVER, 0),
		MapProp.cylinder(&"tunnel_barrel", Vector2(-42, -14), 1.0, 1.8, 0.0, CONTAINER),
		# connectors and defender side
		MapProp.box(&"a_short_cover", Vector2(22, 27.5), Vector3(2, 2, 2), 0.0, CRATE),
		MapProp.box(&"b_connect_cover", Vector2(-22, 32.5), Vector3(2, 2, 2), 0.0, CRATE),
		MapProp.box(&"ct_barrier_west", Vector2(-24, 61), Vector3(4, 1.8, 2), 0.0, CONTAINER),
		MapProp.box(&"ct_barrier_east", Vector2(24, 61), Vector3(4, 1.8, 2), 0.0, CONTAINER),
		MapProp.box(&"ct_crate", Vector2(0, 62), Vector3(3, 1.0, 3), 0.0, CRATE, GameEnums.PropKind.COVER, 0),
		# attacker spawn
		MapProp.box(&"t_crate_west", Vector2(-20, -64), Vector3(3, 1.0, 3), 0.0, CRATE, GameEnums.PropKind.COVER, 0),
		MapProp.box(&"t_crate_east", Vector2(20, -64), Vector3(3, 1.0, 3), 0.0, CRATE, GameEnums.PropKind.COVER, 0),
	]

	# ------------------------------------------------- spawns and zones --
	map.attacker_spawns = [
		SpawnPointData.make(-16, -66, PI), SpawnPointData.make(-8, -66, PI),
		SpawnPointData.make(0, -66, PI), SpawnPointData.make(8, -66, PI),
		SpawnPointData.make(16, -66, PI),
	]
	map.defender_spawns = [
		SpawnPointData.make(-10, 68, 0.0), SpawnPointData.make(-5, 68, 0.0),
		SpawnPointData.make(0, 68, 0.0), SpawnPointData.make(5, 68, 0.0),
		SpawnPointData.make(10, 68, 0.0),
	]
	map.attacker_buy_zone = Rect2(Vector2(-30, -72), Vector2(60, 16))
	map.defender_buy_zone = Rect2(Vector2(-14, 56), Vector2(28, 16))

	map.bomb_sites = [
		BombSiteData.make(&"A", 34, 28, 52, 42, Vector3(42, 0, 32)),
		BombSiteData.make(&"B", -52, 28, -34, 42, Vector3(-42, 0, 32)),
	]
	return map
