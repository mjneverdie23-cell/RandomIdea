# Game rules specification

This is the contract that **both** engine implementations follow. The Unity core
(`unity/Assets/TacticalShooter/Scripts/Core`) and the Unreal core
(`unreal/Source/TacticalShooter/Core`) implement every formula here, and
`shared/tools/reference_rules.py` implements it a third time in Python to generate
`shared/tests/rules_vectors.json`. Both engines' test suites replay those vectors, so
if the two engines ever disagree about a rule, a test fails.

All numbers named below come from `shared/config/*.json`. Nothing is hard-coded.

---

## 1. Teams and sides

- There are two persistent teams, **A** and **B**. The human player is always on team A.
- Each team is on one **side**: `Attack` or `Defense`. Team B is always on the opposite side.
- The player picks the starting side in match setup. Sides swap at halftime and in overtime.

## 2. Match flow

Phases: `NotStarted -> BuyPhase -> Live -> RoundEnd -> (Halftime) -> BuyPhase ... -> MatchOver`.

| Phase | Duration | Notes |
|---|---|---|
| BuyPhase | `round.buyPhaseSeconds` (+ `match.firstRoundExtraBuySeconds` in round 1) | Movement frozen when `round.freezeDuringBuyPhase` |
| Live | `round.roundSeconds` | Once the bomb is planted the round timer stops and the fuse (`bomb.fuseSeconds`) runs instead |
| RoundEnd | `round.roundEndSeconds` | Scores are already updated when this phase starts |
| Halftime | `match.halftimeSeconds` in regulation, 0 in overtime (skipped) | Sides swap when this phase starts |
| MatchOver | - | Terminal |

### 2.1 Round end conditions (checked every tick during Live, in this order)

1. Bomb detonated -> **attackers** win, reason `BombDetonated`.
2. Bomb defused -> **defenders** win, reason `BombDefused`.
3. Bomb not planted and no attacker alive -> **defenders** win, reason `Elimination`.
4. No defender alive -> **attackers** win, reason `Elimination` (planted or not).
5. Bomb not planted and round timer reached 0 -> **defenders** win, reason `TimeExpired`.

If attackers are eliminated **after** the plant the round continues: defenders must defuse.

### 2.2 After a round ends

Let `played` be the number of the round that just ended (rounds are numbered from 1) and
`regulation = 2 * match.halftimeAfterRound`.

Scores and loss streaks are updated first (section 3.1). Then, in regulation:

1. A team with `match.roundsToWin` wins the match.
2. Otherwise, if `match.overtimeEnabled` and both teams have `roundsToWin - 1`, overtime begins
   with the next round (no side swap at the start of overtime).
3. Otherwise, if `played >= regulation`, the higher score wins, or the match is a draw.
4. Otherwise, if `played == halftimeAfterRound`, sides swap (Halftime phase).

In overtime (`otPlayed` counts overtime rounds including this one):

1. A team leading by `match.overtimeWinMargin` wins.
2. Otherwise, if `otPlayed >= match.maxOvertimeRounds`, the leader wins, or it is a draw.
3. Otherwise, if `otPlayed % match.overtimeSwapEveryRounds == 0`, sides swap
   (the Halftime phase is skipped; the swap still happens).

### 2.3 Economy resets at the start of a round

| When | Money | Loadouts | Loss streaks |
|---|---|---|---|
| Round 1 | `economy.startMoney` | cleared | 0 |
| First round after a regulation halftime swap | `economy.startMoney` | cleared | 0 |
| Every overtime round | set to `match.overtimeStartMoney` | cleared if the sides swapped before this round | 0 |

"Cleared" means: no primary, default secondary, no armour, no defuse kit. **Ability charges and
ultimate points are never cleared** by a reset.

## 3. Economy

### 3.1 Loss streak

Each team has a loss streak. When a team loses a round its streak becomes `streak + 1`
(capped at 10); when it wins, its streak becomes 0.

### 3.2 Round income (paid to every player of a team when the round ends, dead or alive)

```
lossBonus(streak) = streak <= 0 ? lossBase
                  : min(lossBase + (streak - 1) * lossStreakIncrement, lossMax)

income = (won ? winReward : lossBonus(streakAfterThisRound))
       + (isAttacker && bombWasPlanted ? plantRewardTeam : 0)
```

### 3.3 Individual rewards

- Kill: `weapon.killReward` if it is `>= 0`, else `economy.defaultKillReward`. Ability kills
  use `defaultKillReward`. No reward for killing a teammate or yourself.
- Planting: `economy.plantRewardPlayer` to the planter. Defusing: `economy.defuseRewardPlayer`.
- Money is always clamped to `[0, economy.maxMoney]` after every change.

## 4. Damage

### 4.1 Hit zones (from the hit height, never from the mesh)

```
fraction = (hitPointHeight - feetHeight) / currentCapsuleHeight
zone = fraction >= combat.headZoneFraction ? Head
     : fraction <  combat.legZoneFraction  ? Legs
     : Body
```

### 4.2 Weapon damage

```
zoneMult = Head: weapon.headMultiplier | Legs: weapon.legMultiplier | Body: 1

falloff(d) = 1                                    if falloffEnd <= falloffStart and d <= falloffStart
           = falloffMinMultiplier                 if falloffEnd <= falloffStart and d >  falloffStart
           = 1                                    if d <= falloffStart
           = falloffMinMultiplier                 if d >= falloffEnd
           = lerp(1, falloffMinMultiplier, (d - falloffStart) / (falloffEnd - falloffStart))

raw = weapon.damage * zoneMult * falloff(distance)
```

A weapon with `falloffStart = falloffEnd = 0` and `falloffMinMultiplier = 1` has no falloff.

### 4.3 Armour

```
total          = floor(raw * damageTakenMultiplier + 0.5 + 0.0001)   // round half up
absorbFraction = clamp01(combat.armorAbsorption * (1 - armorPenetration))
armorDamage    = min(armor, floor(total * absorbFraction + 0.0001))
healthDamage   = total - armorDamage
```

The `0.0001` makes rounding agree between engines that store config values as 32-bit
floats and the 64-bit reference (for example `55 * 2.9` is `159.4999...` in one and
`159.5000...` in the other).

`damageTakenMultiplier` is 1 unless a buff (e.g. Fortify) changes it.

### 4.4 Area damage

- Frag: `raw = ability.damage * max(0, 1 - distance / ability.radius)`, needs line of sight
  from the explosion to the target's chest, armour penetration 0.
- Fire zone: every 0.25 s, `ability.damage * 0.25` raw damage to enemies whose feet are within
  `ability.radius` horizontally, armour penetration 0. Each tick is rounded by 4.3, so the rate
  is only exactly `ability.damage` per second when it is a multiple of 4 (35 gives 9 per tick).
- Bomb: `bomb.blastDamage * max(0, 1 - distance / bomb.blastRadius)`, ignores walls,
  armour penetration 1 (armour does not help).

### 4.5 Melee and flashes

- Melee: a 0.35 m sphere swept from the eyes along the aim, `weapon.maxRange` long and
  stopped by the first wall. The first enemy it touches takes `weapon.damage` as Body damage,
  doubled from behind (a backstab: `dot(victimForward, horizontalDirection(attacker -> victim)) > 0.5`).
- Flash: every living character except the thrower whose eyes are within `ability.radius` of
  the pop, with line of sight to it, is blinded for
  `ability.duration * facing * (1 - 0.5 * distance / ability.radius)` seconds, where
  `facing = 1` within 30 degrees of the aim direction, `0` beyond 110 degrees and linear in
  between. Results under 0.2 s are ignored, and a new blind only replaces a shorter remaining one.

## 5. Weapons

### 5.1 Spread (degrees, half-angle of the cone)

```
bloom  = min(shotIndex * bloomPerShot, maxBloom)
stable = (baseSpread + bloom)
       * (crouched and grounded ? crouchSpreadMultiplier : 1)
       * (aiming ? adsSpreadMultiplier : 1)
moving = moveSpread * clamp01(horizontalSpeed / movement.runSpeed)
       + (airborne ? airSpread : 0)
spread = stable + moving
```

Movement inaccuracy is never reduced by aiming or crouching. `shotIndex` counts shots in the
current spray and resets to 0 after `recoilResetSeconds` without firing.

Each pellet's direction is sampled uniformly inside the cone: `angle = 2*pi*u1`,
`radius = spread * sqrt(u2)`, pitch offset `radius * sin(angle)`, yaw offset `radius * cos(angle)`.

### 5.2 Recoil

After shot `i` the view kicks by `recoilPattern[min(i, len - 1)]` (pitch up, yaw right) plus a
random yaw in `[-recoilRandomYaw, +recoilRandomYaw]`. Bullets always travel along the view,
so the crosshair shows where the next shot goes. When not firing, the accumulated kick
returns to zero at `recoilRecovery` degrees per second.

### 5.3 Fire rate, magazines

- Minimum time between shots: `1 / (fireRate * fireRateMultiplier)`.
- `auto` fires while the trigger is held; `semi` and `melee` fire once per press.
- `magazineSize = 0` means no ammo (melee). Reloading moves ammo from reserve to magazine
  after `reloadSeconds`; switching weapons cancels a reload.
- Survivors keep their weapons between rounds; ammo is refilled at the start of every round.

## 6. Shop

- Buying is allowed during BuyPhase, and during the first `round.buyGraceSeconds` of Live,
  only while standing in your side's spawn zone (if `round.buyOnlyInSpawnZone`).
- Checks happen in this order, and the first failure is the result: `notForSale` (melee
  weapons, ultimates, abilities with price 0), `wrongSide`, `alreadyOwned` / `maxCharges`,
  `notEnoughMoney`.
- Weapons: buying a weapon for an occupied slot replaces it. If the replaced weapon was bought
  this round it is refunded, and the refund counts towards the price. Otherwise a weapon with a
  price is dropped on the ground and a free default weapon simply vanishes.
- Equipment (armour and the defuse kit) with a `side` other than `any` fails with `wrongSide`
  for the other side.
- Armour: can be bought when current armour is below the item's `amount`; sets armour to
  `amount`. An armour bought earlier this round is refunded the same way as a weapon.
- Defuse kit: defenders only (whatever its `side` says), one per player.
- Abilities: `price` per charge up to `maxCharges`.
- Every purchase is recorded for the round with what it replaced. Sell-back
  (`economy.sellBackDuringBuyPhase`, BuyPhase only) refunds the latest purchase of an item that
  is still owned and restores what it replaced: the previous weapon if it was not dropped
  (otherwise an empty primary / the default secondary), the previous armour value, no kit, or
  one fewer ability charge.
- The purchase record is cleared at the start of every round.
- At the start of each round, each ability slot's charges become `max(charges, freeChargesPerRound)`.

## 7. Death and carry-over

On death: primary is dropped as a pickup (or, if there is no primary, the secondary when it
has a price; a free default sidearm vanishes, as in the shop), the bomb is dropped, loadout becomes: no primary, default secondary, armour 0, no kit.
Ability charges and ultimate points are kept. Players do not respawn until the next round.

## 8. Ultimates

`ultimate.pointsPerKill`, `pointsPerDeath`, `pointsPerPlant`, `pointsPerDefuse` are added to
the player's points, capped at the agent's ultimate cost. Using the ultimate resets points to 0.

## 9. Bomb

- One random living attacker receives the bomb at the start of each round.
- The carrier can drop it (it lands up to `bomb.pickupRadius` in front of them, short of walls);
  it is dropped on death. Any living attacker picks it up by walking within `bomb.pickupRadius`,
  except that whoever dropped it must first step out of that radius. Dropped weapons follow the
  same rule for the player who dropped them.
- **Plant**: carrier, alive, grounded, feet inside a bomb-site cell, holding Interact for
  `bomb.plantSeconds`. Moving is blocked while planting; releasing resets progress.
- **Defuse**: a living defender within `bomb.interactRadius` holds Interact for
  `bomb.defuseSeconds` (`bomb.defuseKitSeconds` with a kit). Releasing resets progress to 0, or
  to half if `bomb.halfDefuseCheckpoint` and half was already reached.
- **Fuse**: `bomb.fuseSeconds`. The beep interval goes from `beepIntervalStart` to
  `beepIntervalEnd` as the fuse runs down.

## 10. Scoring

`scoring.kill` per kill, `scoring.assist` per assist, `scoring.plant`, `scoring.defuse`.
An assist is credited to every enemy of the victim (except the killer) who dealt at least
`combat.assistMinDamage` to the victim this round. The MVP is the player with the highest score.

## 11. Map grid

- A map is ASCII rows (`shared/maps/*.json`). North is the first row.
- Cell `(x, y)` has its centre at plane coordinates
  `east = (x + 0.5 - width / 2) * cellSize`, `north = (height / 2 - y - 0.5) * cellSize`.
  Unity maps this to `(x = east, y = up, z = north)`; Unreal to `(X = north, Y = east, Z = up)`
  in centimetres.
- Walkable for navigation: `.`, `A`, `B`, `T`, `D`. Low cover `c` can be jumped on by players
  but bots path around it. `#` and `h` block everything.
- Geometry is built from merged rectangles (greedy: extend right first, then down).

## 12. Navigation

A* on the grid, 8-neighbour moves, diagonal moves only when both adjacent orthogonal cells
are walkable (no corner cutting), octile heuristic, straight cost 1, diagonal cost sqrt(2).
Paths are then shortened by string-pulling: from each kept point, skip ahead to the farthest
point with a clear grid line (sampled every quarter cell).

## 13. Random numbers

Both engines use the same xorshift32 generator (`state ^= state << 13; state ^= state >> 17;
state ^= state << 5`, seed 0 replaced by `0x9E3779B9`). `NextFloat() = (next() >> 8) / 16777216`.

## 14. Placeholder audio synthesis

Every cue in `config/audio.json` is synthesised at startup, identically in both engines:

```
n     = floor(duration * sampleRate + 0.5)
rng   = xorshift32 seeded with fnv1a32(cue.id)      // FNV-1a, 32-bit, over the UTF-8 bytes
phase = 0
for i in 0 .. n-1:
    t = i / sampleRate ; u = t / duration
    f = (frequencyEnd > 0) ? frequency * pow(frequencyEnd / frequency, u) : frequency
    phase = frac(phase + f / sampleRate)
    osc   = sine: sin(2*pi*phase) | square: phase < 0.5 ? 1 : -1 | saw: 2*phase - 1
          | triangle: 1 - 4*|phase - 0.5| | noise: 0
    noise = rng.NextFloat() * 2 - 1                  // drawn every sample, whatever the wave
    mix   = (wave == "noise") ? 1 : cue.noise
    env   = min(1, t / max(attack, 0.0001)) * pow(1 - u, decay)
    sample[i] = (osc * (1 - mix) + noise * mix) * env * volume
```

Non-spatial cues (`"spatial": false`) are played 2D (UI, hit markers, announcements).
