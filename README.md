# DraftCall

**Read the draft. Call the winner.**

A competitive League of Legends prediction quiz. Each question shows one real
professional game's pre-game state — bans, picks, rosters, tournament, stage,
patch — and you get **30 seconds** to call which side won. Faster correct calls
score more.

Questions come in two styles: **matchups**, where a drawn series plays out from
game 1 to its decider the way it was actually played, or **random games**, where
every question is an unrelated draft.

It also carries a **Predictor**: build any two drafts and get a transparent,
additive point tally, per-game and series probabilities, behavioural reads and
scouting notes — computed from the same imported games, with no fitted weights
and nothing hidden.

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

## Predictor

The **Predictor** tab composes any two drafts and scores them. There are no
fitted weights: each side's total is a plain sum of labelled line items, and the
higher total is the predicted winner.

| Line item | What it adds |
| --- | --- |
| Win-rate base | The five champions' historical win rates for that team in that role, capped at 1.00 per lane |
| Meta champions | +1 per champion clearing the pick-rate bar on the newest patches |
| Pocket picks | +1.5 per off-meta pick, up to two; three or more −2 |
| Rank edge | +0.5 when GlobalRank differs by 2 or more |
| Form edge | Up to +1 for the better current-season series record |
| Motivation | +0.5 must-win, −0.5 nothing to play for, −1 tank incentive |
| Fraud penalty | Minus the team's inconsistency rating |

The point margin becomes a per-game probability through a logistic curve, and
the series and sweep odds follow by counting the ways a best-of can still be
won from the current score.

A pocket pick is priced above a meta pick on purpose. An off-meta champion
earns no meta bonus, so while the two were equal they cancelled exactly: four
meta picks plus a pocket pick scored the same as five meta picks, and the
surprise factor the term exists to reward was invisible in the total.

Motivation is the one term the data cannot supply — nothing in a results export
knows a team is already eliminated or would rather draw a softer bracket — so
you state it and the model takes you at your word. It is scaled against the
form edge rather than the meta bonus, so it can tip a close matchup without
ever outweighing what the teams actually drafted.

### The draft is kept

The composition survives switching tabs, and a reload or a closed browser. Use
**Reset** to clear it; that forgets the saved copy too.

### Where its numbers come from

Everything is derived from the seasons you have imported — there is no separate
data file to build or keep in sync. Two different time scopes are used
deliberately:

- **Champion win rates** span every enabled season, because how well a team
  plays a champion is a durable signal and thin samples are the main way this
  model goes wrong. A team that has never played a champion in the selected
  competition falls back to its record everywhere, and the report says which
  scope produced each number.
- **Standings and behaviour** cover the most recent season only. These are
  current-form reads; averaging five seasons together would wash out exactly
  the signal they exist to provide.

### What it reports but does not score

Behavioural reads — recent form, side preference, thrown leads, comebacks,
bounce-back after a loss, deciders, game-five chokes — are shown as
plain-language tendencies and deliberately kept out of the score. They are
context for the reader, not fitted terms. Each is suppressed when its sample is
too small to mean anything.

Champion counters and synergies annotate the per-lane breakdown, restricted to
champions actually on the board, and likewise never move a total.

### Team ratings

GlobalRank and Fraud are the one input with no equivalent in an Oracle's Elixir
export — they are hand-maintained judgements about how strong a team is and how
reliably it plays to that strength.

A default table ships with the app, so the rank edge and fraud penalty work
immediately. Replace it by importing a champion-pool CSV (columns `teamName`,
`GlobalRank`, `Fraud`) on the **Data** tab; **Revert to default** drops the
import again. Team names are matched case- and punctuation-insensitively, so
`BNK FEARX` finds `BNK FearX` and `GENG` finds `Gen.G`, and the report names
which table it used plus any team in the matchup that isn't in it.

Rank and fraud are read per column across each team's block of rows, because
the two do not reliably share a row — a team can carry its rank on the first
player's line and its fraud rating on the separator row that closes the block.

Rankings go stale as teams rise and fall. Refresh them by importing a new file,
or regenerate the shipped table with
`node scripts/build-team-ratings.mjs <champpool.csv>`.

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
  predictor/       prediction engine, model derivation, champion matchup graph,
                   league formats, optional team ratings
  meta/            patch meta aggregation
  leaderboard/     repository interface + localStorage implementation
  storage/         IndexedDB key-value store, dataset persistence
  components/      draft board, quiz controls, meta panel, predictor composer
                   and report, layout
  pages/           Home, Setup, Quiz, Results, Predictor, Leaderboard, Data
  styles/          tokens, base, layout, draft, quiz, predictor, pages
  lib/             display formatting
```

Boundaries worth knowing:

- **Oracle's Elixir column names never leave `src/data/`.** Everything above
  ingestion speaks the domain model in `src/domain/types.ts`.
- **Scoring, generation and session state are pure** (`src/quiz/`), so they're
  tested without React and the UI stays a renderer. The same holds for the
  predictor: `src/predictor/engine.ts` takes a model plus an input and returns
  structured values, never formatted text.
- **The predictor has no cache files.** Everything it needs is derived from the
  seasons already imported, so switching a season off changes its numbers with
  no rebuild step.
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
duplicates, exact counts, impossible configs), patch meta aggregation,
leaderboard ranking/filtering, and the predictor (every point rule and its
boundaries, series/sweep probability against hand-computed values, win-rate
scope fallback, behaviour narration thresholds, meta derivation, standings and
series reconstruction, and ratings parsing with fuzzy team matching).

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
- **The predictor's rank and fraud terms come from a hand-maintained table.**
  GlobalRank and Fraud appear nowhere in an Oracle's Elixir export. A default
  table ships with the app and can be replaced on the Data tab; teams it does
  not list score zero on both lines, which the report states.
- **Champion counters and synergies are static reference data**
  (`src/predictor/data/championGraph.json`). They annotate the per-lane
  breakdown and never move a score. Regenerate with
  `node scripts/build-champion-graph.mjs <champions_data_enriched.json>`.
- **Throw and comeback reads need gold-diff columns.** Exports carrying
  `golddiffat10/15/20/25` get them; older imports and files without those
  columns simply omit those two lines rather than guessing.

---

Not endorsed by Riot Games. Champion art © Riot Games, served via Data Dragon.
Team logos are the trademarks of their respective organizations and are shown to
identify the teams in a match — they are not covered by Leaguepedia's CC
license. Empty `scripts/teams.json` and re-run the script for a build without
them; the monogram fallback covers it. Team and player names belong to their
organizations.
