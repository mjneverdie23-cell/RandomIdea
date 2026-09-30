# Tactical Shooter Template (Unity + Unreal Engine 5)

A scratch-built template for a round-based **5v5 bomb-defusal shooter** in the style of
Counter-Strike and Valorant, with **the same rules, data and features in Unity and in
Unreal Engine 5**. Every model is a basic shape (cubes, spheres, cylinders), every sound is
synthesised at startup, and every menu is built from code, so both projects open and play
with no imported assets.

```
tactical-shooter-template/
  shared/     one source of truth: JSON config, the ASCII map, the rules spec, test vectors
  unity/      Unity 6 project (C#, uGUI built in code)
  unreal/     Unreal Engine 5.3+ project (C++, Slate menus + canvas HUD)
  tools/      checks that run without either engine
  HANDBOOK.md how everything works and how to change it
```

## Play it

**Unity** (6000.0 or newer): open `unity/` in Unity Hub, then **Tactical Shooter > Create Game
Scene** and press Play. (Pressing Play in a new, empty scene also works: the game starts itself.)

**Unreal Engine 5** (5.3 or newer, 5.5 recommended): right-click `unreal/TacticalShooter.uproject`
> *Generate Visual Studio project files* (or open it and let the editor build the module),
then press Play. The level is built at runtime, so no map asset is needed. In the editor Esc
stops Play-In-Editor, so use **P** for the pause menu.

Then: **Play vs bots** -> pick an agent, side, difficulty, team size, match length -> **Start**.

| Key | Action | Key | Action |
|---|---|---|---|
| WASD / arrows | move | 1 / 2 / 3, wheel | primary / sidearm / knife |
| Space / L-Ctrl / L-Shift | jump / crouch / walk | C, Q, E, X | abilities and ultimate |
| LMB / RMB | fire / aim or scope | B | buy menu (right click sells back) |
| R / F / G | reload / plant, defuse, pick up / drop | Tab | scoreboard |
| Esc or P | pause | | everything is rebindable in Settings |

## What's in it

| Area | Both engines |
|---|---|
| Match | first to 13 (or 5 / 3), halftime side swap, overtime with win-by-2, 1v1 to 5v5 |
| Rounds | buy phase (frozen), live, round end; elimination, detonation, defuse and time-out wins |
| Economy | start money, win reward, loss streak bonus, kill rewards per weapon, plant/defuse rewards, money cap |
| Shop | 8 guns plus a knife, 2 armours, defuse kit, agent abilities; sell back during the buy phase; buy zone + grace time |
| Weapons | hitscan with falloff, head/body/leg zones, armour penetration, spread, bloom, recoil patterns, reload, ADS / scope, shotguns, knife backstabs |
| Agents | 5 agents with C/Q/E/X kits: flash, smoke, frag, incendiary, dash, heal, barrier, recon, buff; ultimate points |
| Bomb | carrier, drop and pick up, plant on A or B, fuse with beeps, defuse with half checkpoint, defuse kit, blast |
| Bots | 3 difficulties; buy logic, team plan (site split, mid route, defender spots), A* on the map grid, sight cone + hearing, reaction time, aim error, recoil control, bursts, ability use, plant / defuse / retake |
| UI | main menu, match setup, settings (gameplay, video, audio, key rebinding, crosshair editor), pause, buy menu, HUD (score, clock, minimap, killfeed, vitals, abilities, ammo, money, hit markers, flash/smoke/damage overlays, scope, world markers), scoreboard, match end with MVP |
| Settings | saved to disk; sensitivity, ADS multiplier, invert Y, FOV, V-Sync, FPS cap, quality, fullscreen, volume, crosshair |

## Checks (no engine needed)

```bash
python3 shared/tools/validate_shared.py      # cross-checks every config file and the map
python3 shared/tools/sync_shared.py --check  # engine copies of the data are up to date
bash tools/ue-core-check/run.sh              # compiles the Unreal rules core with g++, replays the vectors
dotnet test tools/dotnet-core-tests          # compiles the Unity rules core with .NET, runs its tests
```

Inside the engines: Unity **Window > General > Test Runner** (EditMode), Unreal **Tools > Test
Automation** (filter `TacticalShooter`).

Read **[HANDBOOK.md](HANDBOOK.md)** before changing anything - it names the file for every change.
