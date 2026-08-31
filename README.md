# Raptor Strike

A playable prototype of a **tactical dinosaur shooter**: Counter-Strike's round and
objective structure, hero-shooter character classes, dinosaurs instead of humans.

Everything is primitives and placeholders on purpose - capsule characters, box geometry,
synthesised sounds - so the *systems* can be judged and extended before any art exists.

```bash
npm start      # play at http://localhost:5173  (no install, no build step)
npm test       # 86 headless tests, ~8 seconds
npm run sim    # simulate a full bot-vs-bot match in the terminal
```

**[HANDBOOK.md](HANDBOOK.md) explains how to change everything** - models, classes, weapons,
prices, the map, round rules, UI, audio, bots - with the exact file for each change.

## What's implemented

| Area | State |
|---|---|
| **Map** | "Dustbowl Proto": three lanes, mid, two bomb sites, elevated positions, cover. Authored as walkable rectangles; walls and bot navigation are generated from them |
| **Movement** | Kinematic controller: acceleration, sprint, crouch, jump, gravity, automatic step-up, fall damage, AABB collision |
| **Classes** | Tank (Ankylo), Sniper (Ptera), Assassin (Raptor), Ranger (Para), Bruiser (Rex) - each with own stats, hitbox, ability pair and shop |
| **Abilities** | 10 abilities on cooldowns, driven by a modifier/effect system (shields, dashes, scans, heals, buffs, camouflage) |
| **Weapons** | 14 weapons + 5 equipment items. Hitscan with spread, recoil, falloff, penetration, fire modes (auto/semi/burst/melee), reload, switching, shotgun pellets, grenades |
| **Teams** | Two persistent teams, attacker/defender sides that swap at halftime |
| **Bomb** | Carrier, drop, pickup, plant on either site, interruptible plant/defuse, fuse, defuse kit, detonation damage |
| **Rounds** | Warmup, buy (freeze), live, round end. Five win conditions, gear carry-over for survivors |
| **Match** | First to 13 round wins, sides switch after round 12, cap at 24 rounds, optional overtime |
| **Economy** | Starting money, kill rewards per weapon, win/loss income with a consecutive-loss bonus, objective rewards |
| **UI** | HUD (health, armour, ammo, weapon, money, abilities, round timer, score, objective, bomb state, killfeed, hitmarkers), buy menu, scoreboard, class picker, match summary |
| **Bots** | Fill both teams, buy per class, A* navigation, vision cones and line of sight, target selection, burst fire, plant and defuse |
| **Audio** | Event-driven cue system with synthesised placeholders for every sound |

## Architecture in one line

`src/core` is a renderer-free, DOM-free simulation (it runs a whole match in Node);
`src/render`, `src/ui`, `src/audio` and `src/platform` are consumers wired together in
`src/main.js`. Players and bots both produce the same `Intent` struct, and all tuning lives
in `src/config`.

See [HANDBOOK.md](HANDBOOK.md) §2-3 for the full map of the codebase.

## Placeholders to replace later

- Capsule characters -> `src/render/ModelRegistry.js` (single swap point, documented)
- Box/cylinder map props -> `registerPropModel()` in `src/render/MapView.js`
- Synthesised sounds -> add `src` paths in `src/config/audio.config.js`
- Prototype HUD styling -> `src/ui/styles.css`

## Licence

MIT (see `LICENSE`). Bundled three.js is MIT - `vendor/THREE_LICENSE.txt`.
