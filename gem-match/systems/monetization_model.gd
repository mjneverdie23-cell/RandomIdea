class_name MonetizationModel
extends RefCounted
## Pure maths for the revival offer: no nodes, no state, so every formula is unit-testable.
## DDAManager.legacy_pass_proximity_treatment() gathers the inputs and calls make_offer().
##
## Inputs
##   P  pass proximity at the moment of losing, in [0, 1]: the chance (from the data table)
##      of winning if the player were given REVIVAL_REFERENCE_MOVES more moves.
##   S  gameRoundLosingStreak: levels lost or quit in a row.
##   F  currentLevelFailAndQuits: times this level was lost or quit since it was last won.
##   L  lives left (0..MAX_LIVES).
##   R  rank in the weekly race (1 = first) out of N players.
##
## Ad revival (inversely proportional to proximity):
##   t        = clamp((P - 0.2) / (0.9 - 0.2), 0, 1)
##   ad_moves = round(5 + (3 - 5) * t)            -> 5 moves at P <= 20%, 3 moves at P >= 90%
##
## IAP reward multiplier (each term in [0, 1]; the weights add up to 1):
##   streak    = 1 - e^(-S / 3)                   diminishing returns on long streaks
##   fails     = 1 - e^(-F / 4)
##   low_life  = (5 - L) / 5                      1 when out of lives
##   standing  = 1 - (R - 1) / (N - 1)            1 in first place: more to protect
##   struggle  = 1 - P
##   raw       = 0.25 streak + 0.20 fails + 0.20 low_life + 0.10 standing + 0.25 struggle
##   multiplier = 1 + (2 - 1) * raw               always in [1, 2]
##   iap_moves  = min(10, round(5 * multiplier))  5..10 moves
##
## The multiplier never goes below 1, so a purchase always delivers at least the advertised
## base reward. Once the game has a currency or boosters, scale those bundles by it too.


## What one revival offer gives.
class RevivalOffer:
	var ad_moves: int = 5
	var iap_moves: int = 5
	var reward_multiplier: float = 1.0
	var proximity: float = 0.0

	func _to_string() -> String:
		return (
			"RevivalOffer(ad %d, iap %d, x%.2f, proximity %.2f)"
			% [ad_moves, iap_moves, reward_multiplier, proximity]
		)


const AD_MOVES_MAX := 5
const AD_MOVES_MIN := 3
const AD_PROXIMITY_LOW := 0.2
const AD_PROXIMITY_HIGH := 0.9

const IAP_BASE_MOVES := 5
const IAP_MAX_MOVES := 10
const MULTIPLIER_MIN := 1.0
const MULTIPLIER_MAX := 2.0
const WEIGHT_STREAK := 0.25
const WEIGHT_FAILS := 0.20
const WEIGHT_LOW_LIFE := 0.20
const WEIGHT_STANDING := 0.10
const WEIGHT_STRUGGLE := 0.25
const STREAK_SCALE := 3.0
const FAILS_SCALE := 4.0


static func make_offer(
	proximity: float,
	losing_streak: int,
	level_fails: int,
	lives: int,
	max_lives: int,
	race_rank: int,
	race_size: int
) -> RevivalOffer:
	var offer := RevivalOffer.new()
	offer.proximity = clampf(proximity, 0.0, 1.0)
	offer.ad_moves = ad_revival_moves(offer.proximity)
	offer.reward_multiplier = reward_multiplier(
		offer.proximity, losing_streak, level_fails, lives, max_lives, race_rank, race_size
	)
	offer.iap_moves = iap_revival_moves(offer.reward_multiplier)
	return offer


## Moves an ad grants: fewer the closer the player already was to winning.
static func ad_revival_moves(proximity: float) -> int:
	var t := clampf(
		(proximity - AD_PROXIMITY_LOW) / (AD_PROXIMITY_HIGH - AD_PROXIMITY_LOW), 0.0, 1.0
	)
	return roundi(lerpf(AD_MOVES_MAX, AD_MOVES_MIN, t))


static func reward_multiplier(
	proximity: float,
	losing_streak: int,
	level_fails: int,
	lives: int,
	max_lives: int,
	race_rank: int,
	race_size: int
) -> float:
	var streak := 1.0 - exp(-maxf(losing_streak, 0) / STREAK_SCALE)
	var fails := 1.0 - exp(-maxf(level_fails, 0) / FAILS_SCALE)
	var low_life := clampf(float(max_lives - lives) / maxf(max_lives, 1), 0.0, 1.0)
	var standing := 1.0 - clampf(float(race_rank - 1) / maxf(race_size - 1, 1), 0.0, 1.0)
	var struggle := 1.0 - clampf(proximity, 0.0, 1.0)
	var raw := (
		WEIGHT_STREAK * streak
		+ WEIGHT_FAILS * fails
		+ WEIGHT_LOW_LIFE * low_life
		+ WEIGHT_STANDING * standing
		+ WEIGHT_STRUGGLE * struggle
	)
	return MULTIPLIER_MIN + (MULTIPLIER_MAX - MULTIPLIER_MIN) * clampf(raw, 0.0, 1.0)


## Moves a purchased revival grants for a given multiplier.
static func iap_revival_moves(multiplier: float) -> int:
	return mini(IAP_MAX_MOVES, roundi(IAP_BASE_MOVES * maxf(multiplier, MULTIPLIER_MIN)))
