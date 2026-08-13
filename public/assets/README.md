# Image assets

Populated by `npm run assets` — this folder is empty on a fresh clone.

```
champions/portrait/<ChampionId>.jpg   tall loading art, cropped to the face by the pick cards
champions/icon/<ChampionId>.png       square face icon, used for bans and the meta panel
teams/<team-slug>.png                 team logo
```

`<ChampionId>` is the Data Dragon id (`Kaisa`, `MonkeyKing`, `JarvanIV`) —
see `src/domain/champions.ts` for the name → id rule.

`<team-slug>` is a readable slug (`gen-g.png`, `100-thieves.png`). The app never
derives these paths itself: `src/assets/assetManifest.json` maps a normalized
team name to its file, and the script writes both.

## Fetching

```bash
npm run assets                    # champions + team logos
npm run assets:champions
npm run assets:teams
npm run assets -- --force         # re-download files that already exist
npm run assets -- --version=15.24.1
```

Champion art comes from Riot's [Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon).
Team logos come from [Leaguepedia](https://lol.fandom.com) via its MediaWiki API;
edit `scripts/teams.json` to change which teams are fetched.

Roughly 170 champions × 2 files ≈ 10 MB, plus a few hundred KB of logos.

## Missing files are fine

Nothing here is required. Champion art falls back to Riot's CDN and then to a
colored plate with the champion's initials; team logos fall back to the team's
derived monogram tag. A partial download degrades gracefully rather than
breaking the draft.

## Licensing

Champion art is © Riot Games, distributed through Data Dragon for use in
community projects. Team logos are the trademarks of their respective
organizations and are shown here to identify the teams in a match; they are not
covered by Leaguepedia's CC license. Clear `scripts/teams.json` and re-run the
script if you need a build without them — the monogram fallback covers it.
