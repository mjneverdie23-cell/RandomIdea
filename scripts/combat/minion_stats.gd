@tool
class_name MinionStats
extends UnitStats

## Minion-specific tuning on top of the shared [UnitStats] fields.

enum BodyShape { BOX, SPHERE, CAPSULE }
## Decides which bounty [RewardConfig] pays for this minion.
enum MinionClass { MELEE, RANGED, SIEGE }

@export var body_shape: BodyShape = BodyShape.BOX
@export var minion_class: MinionClass = MinionClass.MELEE
## How far a minion looks for something to fight while marching.
@export_range(1.0, 40.0, 0.5) var aggro_range: float = 9.0
## How far it will stray from where it picked a fight before disengaging.
@export_range(1.0, 60.0, 0.5) var leash_distance: float = 12.0
## How long the body stays before being freed.
@export_range(0.0, 20.0, 0.1) var corpse_seconds: float = 1.2
## Distance at which a lane waypoint counts as reached.
@export_range(0.5, 20.0, 0.5) var waypoint_tolerance: float = 3.0
