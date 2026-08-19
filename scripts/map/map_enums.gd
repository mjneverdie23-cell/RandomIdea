class_name MapEnums
extends RefCounted

## Shared vocabulary for the map data layer. Kept free of any node/visual
## dependency so gameplay systems and builders can agree on identifiers.

enum Team { A = 0, B = 1 }
enum Lane { TOP = 0, MID = 1, BOT = 2 }
## Turret tiers, ordered from the base outwards.
enum TurretTier { INHIBITOR = 0, INNER = 1, OUTER = 2 }
enum CampSize { SMALL = 0, MEDIUM = 1, LARGE = 2, BUFF = 3 }
## Which side of the map a jungle quadrant or objective belongs to.
enum Side { TOP = 0, BOT = 1 }

const TEAM_NAMES := ["A", "B"]
const LANE_NAMES := ["TOP", "MID", "BOT"]
const TURRET_TIER_NAMES := ["INHIB", "INNER", "OUTER"]
const CAMP_SIZE_NAMES := ["SMALL", "MEDIUM", "LARGE", "BUFF"]
const SIDE_NAMES := ["TOP", "BOT"]


static func team_name(team: int) -> String:
	return TEAM_NAMES[team]


static func lane_name(lane: int) -> String:
	return LANE_NAMES[lane]


static func other_team(team: int) -> int:
	return Team.B if team == Team.A else Team.A


## Stable identifier for a lane turret, e.g. "TOP_OUTER_TURRET_A".
static func turret_id(lane: int, tier: int, team: int) -> String:
	return "%s_%s_TURRET_%s" % [LANE_NAMES[lane], TURRET_TIER_NAMES[tier], TEAM_NAMES[team]]


## Stable identifier for a jungle quadrant, e.g. "JUNGLE_A_TOP".
static func jungle_id(team: int, side: int) -> String:
	return "JUNGLE_%s_%s" % [TEAM_NAMES[team], SIDE_NAMES[side]]


## Stable identifier for a jungle camp, e.g. "JUNGLE_A_TOP_BUFF_CAMP".
static func camp_id(team: int, side: int, size: int) -> String:
	return "%s_%s_CAMP" % [jungle_id(team, side), CAMP_SIZE_NAMES[size]]
