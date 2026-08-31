## Shared enumerations.
##
## Kept in one class so every system spells the same concept the same way, and so
## the inspector can show proper dropdowns on exported properties.
class_name GameEnums
extends RefCounted

## The two sides. Sides swap between the two persistent teams at halftime.
enum Side {
	ATTACKERS, ## must plant and defend the bomb, or eliminate the defenders
	DEFENDERS, ## must defuse the bomb, or eliminate the attackers
}

## The two persistent teams. A team keeps its score across the side switch.
enum Team { TEAM_ONE, TEAM_TWO }

## Round state machine phases.
enum RoundPhase {
	WARMUP,    ## pre-match free roam, no scoring
	BUY,       ## freeze time - players rooted, shop open
	LIVE,      ## the round proper
	ROUND_END, ## post-round pause
	MATCH_END, ## final scoreboard
}

## Why a round ended - drives scoring, rewards, UI text and audio.
enum RoundEndReason {
	BOMB_DETONATED,
	BOMB_DEFUSED,
	ATTACKERS_ELIMINATED,
	DEFENDERS_ELIMINATED,
	TIME_EXPIRED,
}

enum BombState { CARRIED, DROPPED, PLANTED, DEFUSED, EXPLODED }

enum WeaponCategory { PISTOL, SMG, RIFLE, SNIPER, SHOTGUN, LMG, MELEE, EQUIPMENT }

## Inventory slots. One item per slot; buying replaces what is there.
enum WeaponSlot { PRIMARY, SECONDARY, MELEE, GRENADE }

enum FireMode { AUTO, SEMI, BURST, MELEE, THROWN }

enum HitZone { HEAD, CHEST, STOMACH, LEGS }

## Why a purchase was refused. The shop UI shows these to the player.
enum PurchaseResult {
	OK,
	WRONG_PHASE,
	NOT_IN_BUY_ZONE,
	NOT_ENOUGH_MONEY,
	CLASS_RESTRICTED,
	SIDE_RESTRICTED,
	ALREADY_OWNED,
	UNKNOWN_ITEM,
	DEAD,
}

enum PropKind { WALL, COVER, PLATFORM, RAMP, PILLAR, DECOR }

const PURCHASE_RESULT_TEXT := {
	PurchaseResult.OK: "ok",
	PurchaseResult.WRONG_PHASE: "not during this phase",
	PurchaseResult.NOT_IN_BUY_ZONE: "leave the map and you cannot buy",
	PurchaseResult.NOT_ENOUGH_MONEY: "not enough money",
	PurchaseResult.CLASS_RESTRICTED: "your class cannot carry that",
	PurchaseResult.SIDE_RESTRICTED: "wrong side",
	PurchaseResult.ALREADY_OWNED: "already owned",
	PurchaseResult.UNKNOWN_ITEM: "unknown item",
	PurchaseResult.DEAD: "you are dead",
}

static func side_name(side: Side) -> String:
	return "ATTACKERS" if side == Side.ATTACKERS else "DEFENDERS"

static func round_end_text(reason: RoundEndReason) -> String:
	match reason:
		RoundEndReason.BOMB_DETONATED: return "Bomb detonated"
		RoundEndReason.BOMB_DEFUSED: return "Bomb defused"
		RoundEndReason.ATTACKERS_ELIMINATED: return "Attackers eliminated"
		RoundEndReason.DEFENDERS_ELIMINATED: return "Defenders eliminated"
		RoundEndReason.TIME_EXPIRED: return "Time expired"
	return "Round over"
