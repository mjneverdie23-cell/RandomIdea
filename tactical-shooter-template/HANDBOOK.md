# Tactical Shooter Template - Handbook

How the template is built, how the Unity and Unreal versions stay identical, and exactly which
file to touch for each kind of change. Read sections 1-3 once; use the rest as a reference.

## 1. The idea

One game, two engines, one set of rules:

```
shared/config/*.json, shared/maps/*.json   <- all tuning and the map (edit here)
shared/spec/GAME_RULES.md                  <- the rules, written as formulas
shared/tools/reference_rules.py            <- the rules, as a small Python reference
shared/tests/rules_vectors.json            <- expected results, generated from the reference

        | copied by sync_shared.py                  | implemented and tested against
        v                                           v
unity/Assets/TacticalShooter/Resources/...    TacticalShooter.Core (C#, no UnityEngine)
unreal/Content/Data/...                       Source/TacticalShooter/Core (C++, no engine types)
```

Each engine has an **engine-free rules core** (economy, damage, spread, recoil, shop, match
flow, map grid, pathfinding, RNG, sound synthesis) and a **game layer** on top (characters,
weapons, bots, effects, bomb, UI, audio). Both cores replay the same `rules_vectors.json`, so
a rule cannot drift in one engine without a test failing.

## 2. Folder map

| Concern | Unity (`unity/Assets/TacticalShooter/Scripts/`) | Unreal (`unreal/Source/TacticalShooter/`) |
|---|---|---|
| Config structs + loading | `Core/Config/ConfigTypes.cs`, `GameData.cs`, `Json/` | `Core/TSConfigTypes.h`, `TSGameData.*`, `TSGameDataLoad.cpp` |
| Enums and string ids | `Core/Enums.cs` | `Core/TSEnums.h` |
| Economy, damage, spread, recoil, shop | `Core/Rules/*.cs` | `Core/TSRules.*` |
| Match flow (phases, score, halftime, OT) | `Core/Match/MatchFlow.cs` | `Core/TSMatchFlow.*` |
| Map grid + A* | `Core/Map/MapGrid.cs`, `NavGrid.cs` | `Core/TSMapGrid.*`, `TSNavGrid.*` |
| Bot buying | `Core/AI/BotBuyPlanner.cs` | `Core/TSRules.*` (`TSBotBuy`) |
| RNG, hashing | `Core/Rules/Rng.cs` | `Core/TSRng.h` |
| Sound synthesis | `Core/Audio/Synth.cs` | `Core/TSSynth.*` |
| Key names, key map | `Core/Input/KeyNames.cs` | `Core/TSKeyNames.h` |
| Intent (the input contract) | `Core/Intent.cs` | `Core/TSIntent.h` |
| Player record (money, stats, loadout) | `Core/Match/PlayerRecord.cs` | `Game/TSTypes.h` |
| Startup, data, settings file | `Runtime/Bootstrap/GameBootstrap.cs`, `Game.cs` | `Game/TSGameSubsystem.*` |
| Match driver (tick order, rounds) | `Runtime/Match/MatchController.cs` | `Game/TSGameMode.*` |
| Character (movement, health, status) | `Runtime/Characters/TacticalCharacter.cs` | `Game/TSCharacter.*` |
| Character model (swap point) | `Runtime/Characters/CharacterVisual.cs` | `ATSCharacter::BuildVisuals` |
| Weapons, abilities | `WeaponHandler.cs`, `AbilityHandler.cs` | `Game/TSWeapons.*` |
| Player input + camera | `PlayerController.cs`, `CameraRig.cs`, `Runtime/Input/InputReader.cs` | `Game/TSPlayerController.*`, `ATSCharacter::UpdateCamera` |
| Bots | `Runtime/Characters/BotBrain.cs` | `Game/TSBotBrain.*` |
| Hit resolution, line of sight | `Runtime/Match/Combat.cs` | `Game/TSCombat.*` |
| Grenades, smoke, fire, walls, pickups | `Runtime/Match/EffectsWorld.cs` | `Game/TSEffects.*` |
| Bomb | `Runtime/Match/BombSystem.cs` | `Game/TSBomb.*` |
| Level geometry (swap point) | `Runtime/World/WorldMap.cs`, `Prims.cs` | `Game/TSMapActor.*`, `UTSGameSubsystem::AddShape` |
| Audio playback | `Runtime/Audio/AudioManager.cs` | `Game/TSAudio.*` |
| HUD | `Runtime/UI/HudScreen.cs` | `UI/TSHUD.*` (canvas) |
| Menus, buy menu, scoreboard | `Runtime/UI/MenuScreens.cs`, `ScoreScreens.cs`, `UIManager.cs`, `UIFactory.cs` | `UI/STSMenuRoot.*` (Slate), page switching in `TSPlayerController` |
| Game events (kill, damage, announce) | `Core/GameEvents.cs` | `OnKill` / `OnDamage` / `OnAnnounce` on `ATSGameMode` |
| Tests | `Assets/TacticalShooter/Tests/EditMode/` | `Tests/TSRulesTests.cpp` |
| Editor menu | `Scripts/Editor/TacticalShooterMenu.cs` | - |

## 3. Architecture

**One input contract.** The local player's controller and every bot produce the same
`Intent` (move, look angles, fire, aim, reload, interact, drop, weapon slot, ability). A
character only ever reads an Intent, so anything a player can do a bot can do, and the
Intent is the message a networked version would send to the server.

**One explicit tick order**, owned by the match driver (`MatchController.Update` /
`ATSGameMode::Tick`), never by individual actors:

1. **think** - each participant builds its Intent (player input or `BotBrain.Think`)
2. **act** - each character applies it: movement, weapons, abilities, drop / pick up
3. **world** - effects (projectiles, smoke, fire, barriers, pickups) and the bomb
4. **rules** - `MatchFlow.Tick` with the alive counts; the driver reacts to its events
   (round started, phase changed, bomb planted, round ended, sides swapped, match ended)

**Records outlive bodies.** Money, stats, loadout and ability charges live in the player
record; the character exists only while alive. Death drops the gun and clears the loadout
(GAME_RULES.md 7); survivors keep theirs.

**Read-only UI.** The HUD and menus only read game state and listen to the event hub (kills
for the killfeed, damage for hit markers and the damage flash, announcements for the banner).
They change the game only through the driver's public calls (buy, sell, start, leave).

**No engine navigation.** The map is an ASCII grid; walls and cover are generated from it
and bots path over the same grid with A* + string pulling (`NavGrid`), so both engines path
identically and there is nothing to bake.

**Coordinates.** Rules use a plane in metres, `(east, north)`, with the map centred on the
origin (GAME_RULES.md 11). Unity: `x = east, y = up, z = north`, metres. Unreal:
`X = north, Y = east, Z = up`, centimetres. Yaw 0 looks north in both and grows towards east.

## 4. Changing things

After editing anything under `shared/`, run:

```bash
python3 shared/tools/validate_shared.py   # catches bad references, key names, broken maps
python3 shared/tools/sync_shared.py       # copies config + maps into both engine projects
```

(Unity also has **Tactical Shooter > Sync Config From shared** and **Validate Config**.) Both
games also validate at startup and log any problem.

### 4.1 Match, round, economy and movement numbers - `shared/config/game.json`

| Section | What it controls |
|---|---|
| `match` | rounds to win, halftime round, overtime (on/off, win margin, money, swap cadence, cap), default team size |
| `round` | buy phase, round and round-end lengths, freeze during buy, buy zone only, buy grace after the round starts |
| `economy` | start/max money, win reward, loss bonus + streak step + cap, plant/defuse rewards, default kill reward, sell-back |
| `bomb` | plant/defuse/kit seconds, half-defuse checkpoint, fuse, blast radius and damage, interact/pickup radius, beep rate |
| `movement` | run speed, walk/crouch multipliers, acceleration, gravity, jump, heights, eye heights, step height |
| `combat` | health, max armour, friendly fire, armour absorption, head/leg zone fractions, assist threshold, grenade physics |
| `ultimate`, `scoring` | ultimate points and scoreboard points per event |
| `loadout` | the free knife and sidearm everyone spawns with |
| `visuals` | every placeholder colour (teams, floor, walls, cover, sites, spawns, skin, bomb, sky) |
| `mapRotation` | which maps exist (the setup screen lists these) |

Changing a formula rather than a number means editing GAME_RULES.md, `reference_rules.py`,
both cores, then regenerating the vectors (`python3 shared/tools/generate_vectors.py`) and
running the tests (section 6).

### 4.2 Weapons - `shared/config/weapons.json`

Add or edit an entry; no code changes. Fields: `category` (`sidearm`, `smg`, `shotgun`, `rifle`,
`sniper`, `melee`), `slot` (`primary`, `secondary`, `melee`), `price`, `killReward` (-1 = default),
`damage`, `headMultiplier`, `legMultiplier`, `armorPenetration` (0-1), damage falloff
(`falloffStart`, `falloffEnd`, `falloffMinMultiplier`), `maxRange`, `fireMode` (`auto`, `semi`,
`melee`), `fireRate` (shots/s), `magazineSize`, `reserveAmmo`, `reloadSeconds`, `equipSeconds`,
`pellets`, spread (`baseSpread`, `moveSpread`, `airSpread`, `crouchSpreadMultiplier`,
`adsSpreadMultiplier`, `bloomPerShot`, `maxBloom`), recoil (`recoilPattern` - pitch/yaw kick per
shot, `recoilRandomYaw`, `recoilRecovery`, `recoilResetSeconds`), aiming (`adsFovMultiplier`,
`scoped`, `adsMoveMultiplier`), `moveSpeedMultiplier`, `fireSound` (an audio cue id), `color`.
The buy menu groups guns by category. Bots prefer the rifles listed in `bots.json`.

### 4.3 Armour and the defuse kit - `shared/config/equipment.json`

`type` is `armor` (with `amount`) or `defuseKit`; `side` restricts who can buy it.

### 4.4 Agents and abilities - `agents.json`, `abilities.json`

An agent has exactly four slots, `C`, `Q`, `E`, `X`, in that order. Per slot: `abilityId`, `price` (0 = not for sale),
`maxCharges`, `freeChargesPerRound` (signature abilities refill every round) and `ultPoints`
(> 0 makes it the ultimate, charged by kills, deaths, plants and defuses). New agents and
new abilities of an existing type need no code.

An ability's `type` picks its behaviour: `flash`, `smoke`, `frag`, `incendiary` (thrown, with
`throwSpeed` and `fuseSeconds`), `dash` (`distance`, `duration`), `heal` (`amount` over
`duration`), `wall` (`width`, `height`, `distance`, `duration`; also blocks bot paths),
`recon` (reveals enemies within `radius` for `duration`), `buff` (`speedMultiplier`,
`fireRateMultiplier`, `damageTakenMultiplier`, optional armour `amount`, `duration`).

A **new ability type** is code in both engines: add it to the enum (`Enums.cs` /
`TSEnums.h`, including the string parser), to `ABILITY_TYPES` in `validate_shared.py`,
implement it in `AbilityHandler.Execute` / `FTSAbilityHandler::Execute` (and in the effects
world if it leaves something behind), and teach the bots when to use it in `UseAbilities`.

### 4.5 Maps - `shared/maps/<id>.json`

`rows` is the level, north at the top, one character per `cellSize`-metre cell:

```
#  wall          .  floor         c  low cover (jumpable)    h  high cover
A  bomb site A   B  bomb site B   T  attacker spawn + buy    D  defender spawn + buy
```

Rows must have equal length, the border must be walls, both spawns and at least one site
must exist and every walkable cell must be reachable - the validator checks all of it.
`wallHeight`, `lowCoverHeight` and `highCoverHeight` set the block heights. To add a map, add
the file and its id to `game.json` `mapRotation`; it appears on the setup screen.

### 4.6 Bots - `shared/config/bots.json`

`difficulties`: reaction time, aim error, turn speed, view angle, sight range, burst length and
pause, headshot bias, recoil control, ability use chance. `buy`: full-buy and force-buy money,
preferred rifles, force-buy weapons, sniper and ability chances. `behaviour`: perception rate,
repath and stuck timers, memory, hold radius, mid-route chance. `names`: the bot names.
Decision code: `BotBrain` (`Decide` for tasks, `Fight` for shooting, `UseAbilities`).

### 4.7 Keys - `shared/config/input.json`

Default key and alternative key per action, using engine-neutral names (`W`, `Mouse1`,
`LeftCtrl`, `Space`, `F1`...; the list is in `KeyNames` / `TSKeyNames`). Players rebind in
Settings > Controls; their overrides are saved with their settings, not in this file.

### 4.8 Default settings - `shared/config/settings.json`

The first-run values of everything on the settings and setup screens. Saved copies:
Unity `Application.persistentDataPath/tactical_shooter_settings.json`, Unreal
`Saved/TacticalShooter/settings.json`. Delete the file to get the defaults back.

### 4.9 Sounds - `shared/config/audio.json`

Each cue is synthesised at startup from `wave`, `frequency` -> `frequencyEnd`, `duration`,
`attack`, `decay`, `noise`, `volume`; `range` (metres) and `spatial` control playback. To use
recorded sounds: in Unity, put an `AudioClip` named after the cue id in
`Assets/TacticalShooter/Resources/TacticalShooter/Audio/` (it replaces the synthesised one); in
Unreal, change `ATSAudioHost::Play` / `Play2D` to play a `USoundBase` asset (for example with
`UGameplayStatics::PlaySoundAtLocation`) for cues you have assets for.

### 4.10 Replacing the basic shapes with real art

Gameplay never reads a mesh: hit zones come from the capsule height, collision from the
capsule and the map grid. So art swaps are local:

- **Characters:** Unity `CharacterVisual.cs` (keep its public methods), Unreal
  `ATSCharacter::BuildVisuals` (plus `SetWeaponVisual`, `SetCarryingBomb`, `RefreshColors`).
  First-person visibility: Unity turns off the body renderers of the character the camera
  looks out of (`CharacterVisual.SetHidden`); Unreal uses `OwnerNoSee` for the body and
  `OnlyOwnerSee` for the view model.
- **Level:** Unity `MapBuilder` in `WorldMap.cs`, Unreal `ATSMapActor::Build`. Keep the grid as
  the logical map (bots and buy/site zones use it) and place art that matches it, or generate
  art per cell type.
- **Effects, bomb, pickups:** `EffectsWorld` / `FTSEffectsWorld` and `BombSystem` / `FTSBombSystem`
  spawn shapes through one helper each (`Prims` / `ATSShapeActor`).

### 4.11 UI

- Unity: every screen is built in code with `UIFactory` (colours and fonts at its top);
  `UIManager` switches screens. The HUD is `HudScreen.cs`.
- Unreal: menus are Slate widgets in `STSMenuRoot.cpp` (palette and helpers at the top), the
  HUD is drawn on the canvas in `TSHUD.cpp` at a 1080p reference scale. `ATSPlayerController`
  switches pages and input modes. Replacing them with UMG means creating widgets that call the
  same `ATSPlayerController` / `ATSGameMode` functions.

## 5. Engine notes

**Unity.** Needs Unity 6 (`6000.0`+) and uGUI (in `Packages/manifest.json`). Works with either
input backend: the old Input Manager, or the Input System package (detected through the
`TS_INPUT_SYSTEM` define in `TacticalShooter.Runtime.asmdef`). Characters use built-in layer 2
("Ignore Raycast") and the world layer 0, so no tags or layers need setting up. Only
`ProjectVersion.txt` is committed from `ProjectSettings/`, and no `.meta` files are committed;
Unity creates both on first open (nothing references asset GUIDs).
`GameBootstrap` starts the game in any scene that is empty apart from a camera or light.

**Unreal.** Needs UE 5.3+ and a C++ toolchain. The single module `TacticalShooter` uses only
Core, CoreUObject, Engine, InputCore, Json, JsonUtilities, Slate and SlateCore. The game mode
(`Config/DefaultEngine.ini`) builds the level at runtime on the engine's empty `Entry` map;
any empty level works too. Data is read from `Content/Data` with `FFileHelper`, and
`DefaultGame.ini` stages that folder when packaging. Traces use the built-in object types
(WorldStatic, WorldDynamic, Pawn), so no collision channels need configuring. Keys are read
directly (`IsInputKeyDown`) through the engine-neutral names, so no input mappings are needed.
In Play-In-Editor, Esc ends the session: use P for pause.

## 6. Tests and checks

| Check | Command / place | Covers |
|---|---|---|
| Data validation | `python3 shared/tools/validate_shared.py` | references, enums, key names, map shape and connectivity |
| Engine copies | `python3 shared/tools/sync_shared.py --check` | Unity and Unreal data equal `shared/` |
| Unreal core | `bash tools/ue-core-check/run.sh` | compiles `Core/` with g++ (`-Wall -Wextra -Wshadow -Werror`) against a tiny CoreMinimal stand-in, replays every vector, fuzzes bot buying and random matches |
| Unity core | `dotnet test tools/dotnet-core-tests` | compiles `TacticalShooter.Core` + the EditMode tests with .NET 8 and runs them |
| Unity tests | Test Runner > EditMode | the same vectors plus gameplay-core tests |
| Unreal tests | Test Automation, `TacticalShooter.*` | the same vectors, invariants, `Content/Data` up to date |

`shared/tools/generate_vectors.py` rebuilds `rules_vectors.json` from `reference_rules.py`;
only run it after an intentional rule change, and commit the new vectors with the code.

## 7. Status and limits

- **Offline only:** one human against bots. The Intent / tick-order split is where networking
  would go (clients send Intents, the server runs the tick and replicates state); it is not
  implemented.
- **What was verified where:** both engine-free cores compile and pass the shared vectors
  without an engine (section 6). The Unity game layer was compile-checked against Unity's
  reference assemblies with .NET, not run inside the Unity editor. The Unreal game layer
  (`Game/`, `UI/`, `Tests/`) was written against the UE 5.3-5.5 API but not compiled here,
  because no Unreal Engine install was available; expect to fix small API differences on the
  first build, especially on other engine versions.
- **Placeholders by design:** basic-shape models and level, synthesised sounds, code-built UI,
  one map ("Outpost").
