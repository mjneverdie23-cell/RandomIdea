# DraftCall

**Read the draft. Call the winner.**

A competitive League of Legends prediction quiz. Each question shows one real
professional game's pre-game state — bans, picks, rosters, tournament, stage,
patch — and you get **30 seconds** to call which side won. Faster correct calls
score more.

Questions come in two styles: **matchups**, where a drawn series plays out from
game 1 to its decider the way it was actually played, or **random games**, where
every question is an unrelated draft.

Games come from [Oracle's Elixir](https://oracleselixir.com/tools/downloads)
match-data CSVs, filtered to eight competitions: **LCK, LEC, LCS, LPL, Worlds,
First Stand, MSI, EWC**.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # typecheck + production bundle into dist/
npm run preview    # serve the production build
npm test           # vitest
npm run typecheck
npm run assets     # download champion art + team logos into public/assets/
```

No backend, no API keys, no build-time data step. The app boots on a bundled
synthetic dataset so every screen works immediately, pulling champion art from
Riot's CDN until you download it locally with `npm run assets`.

---

## Loading real data

1. Download the yearly match-data CSVs from Oracle's Elixir — 2022 through the
   current partial season.
2. Open **Data** in the app and drop them in, together or one at a time.
3. That's it — each file is parsed in your browser, filtered, and merged into
   its own season. Nothing is uploaded anywhere.

The import report tells you exactly what happened: rows read, games kept, how
many were dropped for being outside the eight competitions, how many had
incomplete drafts, and which seasons the file contributed to.

### Seasons

**Imports accumulate.** Games are bucketed by the season *in the data* — a file
that spans a year boundary lands in both — so loading 2024 doesn't disturb 2023.
Re-importing a year replaces just that year, which is what you want when
Oracle's Elixir revises rows or a partial season grows.

Each season gets a bar on the Data page with a **switch**: on means its games
feed the quiz, off means they don't. Switching off isn't deleting — the games
stay stored, so you can focus a session on 2025 without re-importing everything
to get the rest back. The switch state is saved with the data.

### Where seasons are stored

Two backends, picked at runtime:

| | |
| --- | --- |
| **Project folder** | `data/<year>.json`, written by the dev/preview server (`scripts/vite-data-folder.mjs`). Used whenever it's available, and it's the copy that survives clearing browser storage or moving to another machine. |
| **IndexedDB** | The fallback for a statically served build, and the offline mirror. |

Both hold the same normalized, competition-filtered games — never the source
CSV. The Data page says which one is in use. The folder is gitignored; it's
derived data, and a full season is a couple of MB of JSON.

If you already had a dataset stored from before seasons existed, it's split
into per-year buckets on first load rather than discarded, and pushed up to the
folder if that's available.

### What the parser expects

The standard Oracle's Elixir layout: **12 rows per game** — ten player rows
(`participantid` 1-10) and two team rows (`participantid` 100/200), with bans on
the team rows.

| | Columns |
| --- | --- |
| **Required** | `gameid`, `league`, `champion`, `result` |
| **Draft** | `participantid`, `side`, `position`, `playername`, `teamname`, `ban1`–`ban5` |
| **Context** | `date`, `year`, `split`, `playoffs`, `patch`, `game`, `gamelength` |
| **Optional** | `stage`/`round`, `bestof`, `playerid`, `teamid`, `datacompleteness` |

Header casing, spacing and punctuation are normalized on read (`Game ID`,
`gameid` and `GAMEID` are the same column), and each logical field accepts
several aliases — see `COLUMN_ALIASES` in `src/data/oracleSchema.ts`.

### Competition filtering

`src/domain/competitions.ts` is the single source of truth. Each competition
carries display metadata, an accent color, alias list and optional regex
patterns; a global exclusion list keeps academy/challenger/development leagues
out (`LCK CL`, `LDL`, `NACL`, `LCS Academy`, …).

Matching is done on a normalized league string, so `WLDs`, `Worlds`,
`worlds 2024` and `World Championship` all resolve to the same competition.
Adding or removing a competition is a one-file change — no UI component
hardcodes a league name.

---

## How the quiz works

**Setup** — pick a source (Mixed, or a single competition) and a length (10, 25
or 50). Only the seasons switched on in the Data tab are in the pool. Options that the loaded dataset can't satisfy are disabled and labelled
with the pool size, so an impossible configuration can't be started. Picking a
thin source auto-trims the length to fit.

**Question style** — two modes, chosen on the setup screen.

*Matchups* draws a series at a time. Series are shuffled, then taken whole while
they fit the remaining slots, so a best-of-5 contributes all five games in order
and the sides swap between them exactly as they did live. Later games are the
interesting ones: by then you have seen how the earlier games went, which is the
same information a viewer would have, and the quiz screen shows the running
series score above the draft — counting only games you have already answered and
had revealed.

*Random games* is a straight shuffle of the eligible pool, one unrelated game per
question.

Both modes sample without replacement and honour the requested question count
exactly — the leaderboard compares runs of the same length — so in matchup mode,
when no remaining series fits the last few slots, one series is truncated,
keeping game 1 onward. The mode is recorded with each run and shown on the
board.

**Question** — the draft board renders with the winner withheld. The quiz screen
receives a `GamePrompt` (`Omit<Game, 'winner'>`), so the answer is not merely
hidden in the UI, it isn't in the props at all.

**Timer** — 30 seconds, starting when the question goes live. Remaining time is
derived from wall-clock deltas rather than accumulated per frame, so a throttled
tab can't buy extra time. At zero, a timeout is submitted automatically and
scores 0.

The clock's start time is decided in the same render that switches question, not
from an effect afterwards. Deriving it a commit later meant a freshly mounted
countdown briefly held the *previous* question's start time; after a timeout
that value was already expired, so the next question was instantly ruled a
timeout too.

**Scoring** — transparent and printed on the setup screen:

```
correct   = 100 base
          + up to 100 speed bonus, linear in the time left on the clock
          + 10 per answer in the current correct streak, capped at 50
incorrect = 0
timeout   = 0
```

So a question is worth 100–250 points, and an instant correct call is worth
roughly twice a last-second one. The speed bonus is a fraction of the time
remaining, so it rescales itself if the clock length changes.

**Reveal** — the winning side lights up, the losing side dims, and the points
breakdown (base + speed + streak) is shown before auto-advancing. `Space`
skips ahead; `B`/`←` and `R`/`→` call blue and red.

**Results** — final score, rating band, accuracy, correct/incorrect/timeouts,
average and fastest answer, best streak, best competition, a per-competition
breakdown, and a question-by-question review that expands to the full draft with
the winner marked.

**Leaderboard** — every completed run is recorded automatically, and **each
style and length keeps its own board**. A 50-question run can score five times
what a 10-question run can, so ranking them together would just sort by length;
instead the page opens on a records grid — one card per style × length — showing
that board's leader, the maximum possible score, and where you sit in it.
Selecting a card scopes the table to that board. Within a board, ties break on
accuracy, then on the faster average answer. Source is a further filter on top.

The results screen reports where a finished run landed on its own board
("#2 of 7 · Matchups · 25 questions"), and calls out a new record.

Runs recorded before question styles existed have no style attached; they show
under "any style" rather than being guessed into a bucket.

### Reproducibility

Every quiz carries a seed. The same seed against the same dataset produces the
same questions in the same order, which makes runs shareable and bugs
reportable. The seed is editable on the setup screen and shown on results.

---

## Patch meta

The **Patch Meta** panel on the quiz screen is computed from the loaded dataset
for the game's patch — nothing is hardcoded, so importing a different export
changes the numbers. Rates are per-game: a champion picked in 40 of 100 games on
a patch shows 40% pick rate; ban rate counts games where either team banned it.
When a single competition has too thin a sample on that patch, the cross-league
sample for the patch is used instead so the panel never shows noise.

---

## Images

```bash
npm run assets              # champion art + team logos
npm run assets:champions
npm run assets:teams
npm run assets -- --force   # re-download files that already exist
```

Everything lands in `public/assets/`, which is empty on a fresh clone:

```
champions/portrait/<ChampionId>.jpg   tall art, cropped to the face on pick cards
champions/icon/<ChampionId>.png       square face icon, for bans and the meta panel
teams/<team-slug>.png                 team logo
```

**Champions** come from Riot's [Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon)
— every champion on the current patch, both sizes. `src/domain/champions.ts`
maps display names to asset ids with one rule (strip non-alphanumerics) plus a
small table of irregulars (`Kai'Sa` → `Kaisa`, `Wukong` → `MonkeyKing`,
`Nunu & Willump` → `Nunu`, …).

**Team logos** come from [Leaguepedia](https://lol.fandom.com) via its MediaWiki
API: the `Teams` Cargo table gives each org's logo file, which a second call
resolves to a download URL. Edit `scripts/teams.json` to change which teams are
fetched — teams that can't be resolved are listed at the end of the run and
simply keep their monogram.

The script is re-runnable (existing files are skipped), writes
`src/assets/assetManifest.json` describing what it got, and can be pointed at a
mirror with `DRAFTCALL_DDRAGON_BASE` / `DRAFTCALL_FANDOM_API`. Expect roughly
10 MB for ~170 champions plus a few hundred KB of logos.

### Face-focused crops

Data Dragon's loading art is a full-body portrait whose aspect ratio is close to
the pick card's, so `object-fit: cover` alone would barely crop it and every
champion would read as a small full-body figure. The card oversizes the image to
156% and anchors it to the top, zooming into the head-and-shoulders — the
treatment a broadcast draft uses. Bans use the square face icon instead,
desaturated, dimmed and struck through so they read as removed while staying
recognizable.

Run this **before** `npm run build` if you want the local copies in a production
bundle — the manifest is read at build time. The Data page shows what is
currently on disk.

### Nothing here is required

Assets are a convenience, not a dependency. Champion art falls back to Riot's
CDN and then to a colored plate with the champion's initials; team logos fall
back to the team's derived monogram tag. A skipped, partial or failed download
degrades rather than breaking the draft — which is also why the repo ships with
an empty manifest and still works. Team logos are the one thing with no remote
fallback: without the download every team shows its monogram.

Each source also gets a second attempt before the chain moves on. Ten portraits
load per question, and a single dropped request used to strand that card on its
initials for the rest of the run, which reads as art randomly failing.

---

## Demo data

With no CSV imported, the app generates a synthetic dataset (~1,100 games across
all eight competitions, ten patches, a full season calendar). **The games are
invented.** Team names are real organizations and player names are drawn from
real regional player pools so the draft reads naturally, but the rosters are
illustrative and none of the results happened. Every such game is flagged
`demo: true` and the UI says so on the dashboard, the setup screen, every
question and every leaderboard row.

The demo data is generated *as CSV text* and travels through the same
parse → ingest → validate path as a real file, so there is no separate "demo
mode" branch anywhere downstream.

---

## Project structure

```
data/              imported seasons, one JSON per year (gitignored)
public/assets/     champion art + team logos (populated by `npm run assets`)
scripts/           asset downloader, team list, data-folder dev middleware
src/
  assets/          local-asset manifest
  domain/          types, competition registry, champion + team identity/art
  data/            Oracle's Elixir schema, CSV parsing, ingestion, stage
                   inference, per-season merging, synthetic demo dataset
  quiz/            seeded RNG, config, matchup grouping, question generation,
                   scoring, session reducer + summary
  meta/            patch meta aggregation
  leaderboard/     repository interface + localStorage implementation
  storage/         IndexedDB key-value store, dataset persistence
  components/      draft board, quiz controls, meta panel, layout
  pages/           Home, Setup, Quiz, Results, Leaderboard, Data
  styles/          tokens, base, layout, draft, quiz, pages
  lib/             display formatting
```

Boundaries worth knowing:

- **Oracle's Elixir column names never leave `src/data/`.** Everything above
  ingestion speaks the domain model in `src/domain/types.ts`.
- **Scoring, generation and session state are pure** (`src/quiz/`), so they're
  tested without React and the UI stays a renderer.
- **Storage sits behind interfaces.** Swapping the leaderboard for a hosted
  backend means writing one class satisfying `LeaderboardRepository`.

## Tests

```bash
npm test
```

Covers competition matching (aliases, casing, season labels, academy-league
exclusion), CSV ingestion (row grouping, role assignment, ban reading, winner
resolution, header normalization, rejection accounting), per-season bucketing
and merging (adding a year, replacing a re-imported year, switches, combining
only enabled seasons), series/stage inference,
champion id derivation, scoring in every branch, the session reducer and
summary, matchup grouping and series ordering, quiz generation (determinism, no
duplicates, exact counts, impossible configs), patch meta aggregation, and
leaderboard ranking/filtering.

---

## Notes and limitations

- **Series format is inferred.** Oracle's Elixir has no best-of column, so the
  format is derived from how many games a series actually contained. A sweep
  hides the true format (a 3-0 in a BO5 looks like a BO3), so inferred values
  are marked with `*` in the UI. An explicit `bestof` column, if present, is
  used instead.
- **Stage detail depends on the export.** `playoffs` + `split` give
  regular season / play-in / group / playoffs reliably; named rounds
  (quarterfinal, semifinal, final) are only recognized when the split or an
  optional stage/round column names them.
- **Team tags are algorithmic**, not a lookup table, so new organizations work
  without code changes — at the cost of not always matching the official tag.
- **The leaderboard is per-device** (localStorage). "Global" means global across
  runs on that device until a backend is attached.

---

Not endorsed by Riot Games. Champion art © Riot Games, served via Data Dragon.
Team logos are the trademarks of their respective organizations and are shown to
identify the teams in a match — they are not covered by Leaguepedia's CC
license. Empty `scripts/teams.json` and re-run the script for a build without
them; the monogram fallback covers it. Team and player names belong to their
organizations.
