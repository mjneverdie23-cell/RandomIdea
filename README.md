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

### Blind mode

A separate game at `/blind`: a four-rung survival ladder played with the draft
alone. No team names, no player names, no tournament, no date, no patch — the
bans, the picks and the league, and nothing else.

One question per rung, each drawn to be harder than the last. A wrong call costs
you that rung's points and nothing else — you play all four either way, because
ending a run on one bad guess at a coin flip is a punishment out of proportion
to the mistake.

Harder rungs pay more, and the progression is steeper than the rung numbers:

| rung | points |
| --- | --- |
| Easy | 100 |
| Medium | 200 |
| Hard | 350 |
| Impossible | 550 |
| **a flawless, hint-free run** | **1200** |

With the teams hidden every rung sits closer to a coin flip than its measured
hit rate suggests, and the top one genuinely is one — so clearing Impossible is
the difference between a good run and a great one. It stops short of a curve
steep enough to make the board a record of who got luckiest on the last
question.

**Three hints** are available on every rung, in order:

1. Reveal teams and players
2. Reveal the patch and its meta
3. Reveal the tournament and date

Each costs **25%** of the rung it is spent on, so a fully-hinted rung is worth a
quarter of face value — still worth answering, never worth defaulting to. Hints
have to cost something, or every run takes all three and the board measures
nothing.

#### The blind board

Blind runs get their own leaderboard rather than another category on the quiz
board: the two modes score different things, and a run of four fixed questions
has no length, no clock and no streak to rank by. Score ranks first, then the
run that needed **fewer hints** — two runs can bank the same points very
differently, and the unhinted read is the better one.

#### How a level's difficulty is decided

Difficulty is the gap between the two teams' season win rates, which is the
closest thing the data has to "how obvious was this on paper". The bands are cut
from the real distribution rather than guessed — measured across the 2026
season, the favourite went on to win:

| rung | gap in win rate | games | favourite won |
| --- | --- | --- | --- |
| Easy | 0.22 and up | 344 | **78.8%** |
| Medium | 0.12 – 0.22 | 611 | **64.5%** |
| Hard | 0.05 – 0.12 | 418 | **58.6%** |
| Impossible | below 0.05 | 373 | **51.7%** |

Two details make those numbers mean what they say.

Each team's record is taken over the whole pool **minus the game being rated**.
Leaving it in is a quiet form of leakage: a team's win rate is nudged up by the
game it just won, which at small gaps is enough to flip which side counts as the
favourite. It made the coin-flip rung look 6 points more predictable than it is
— 57.7% against the 51.7% that shows up once the game is excluded.

The **easy** rung additionally requires that the favourite actually won. Without
it about a fifth of easy questions are upsets, which makes the one rung that has
to be winnable a trap. Every rung above takes whatever the band offers, upsets
included, because that is the difficulty being asked for.

A team needs at least 10 games before its win rate is used to rate anything, so
a side with two matches on record cannot land a question on the wrong rung.

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
| Win-rate base | The five champions' win rates for **the player starting that lane** — current split and career averaged — capped at 1.00 per lane. An off-meta champion they have no record on counts as 1.00 |
| Meta champions | +1 per champion clearing the pick-rate bar on the newest patches (5% of games in that role, and at least 4 actual picks) |
| Pocket picks | +1.5 per off-meta pick, up to two; three or more −2. Halved in game one |
| Form edge | Up to +1 for the better current-season series record |
| Motivation | +0.5 must-win, −0.5 nothing to play for, −1 tank incentive. **Stated by you** — see below |
| Series edge | +0.3 per game of lead in the series so far, capped at +0.6 |
| Rank edge | +0.1 per place of GlobalRank gap, capped at +1.5 |
| Dark horse | +0.1 per hand-listed high-ceiling champion (Lee Sin, Akali) |

The **fraud rating is reported, not scored**. Backtested over 374 games it was
the most harmful term in the model: subtracting it cost about 1.4 points of
accuracy, and on its own it predicted the winner just 44.2% of the time — the
*more* fraudulent side won more often. It now appears in the notices as a
high / medium / low band and moves nothing.

#### Motivation is an input, not a derivation

Nothing in a results export knows a team is already eliminated, has its seed
locked, or would rather draw a softer bracket. Working it out needs the
schedule, the playoff cutline and the tiebreakers — none of which Oracle's
Elixir carries, and the 2026 file alone spans splits labelled *Summer*,
*Split 3*, *Rounds 1-2*, *Cup* and *Versus*, so there is not even one format to
assume. So motivation stays a stated input, and a pasted match scores zero for
it unless you add a `"motivation"` key to a side.

What the data *does* know is the series score, and that is now scored in its own
right. The direction is the opposite of the intuition: across July and August
2026 the side facing elimination won only **42.0%** (60/143) of the next game.
A team is behind because it has been losing, and that keeps being true — so the
lead is credited rather than the pressure.

#### The dark-horse list, and what measuring it showed

`DARK_HORSE` in `src/predictor/engine.ts` is a hand-maintained set of champions
credited a small extra for carry potential — the claim being that they swing a
game more than their win rate suggests, because the ceiling is higher than the
average. Nothing in a results export measures that, so it is stated rather than
computed, and the set is a one-line edit.

It is priced at +0.1, and the measurements are the reason it is that low rather
than higher:

- Over the 2026 season **Lee Sin appears in 12.6% of games** (228 of 230 picks
  in the jungle) and **Akali in 10.2%** (175 of 185 mid). Both clear the 5%
  meta bar comfortably, so in most windows they are already collecting a full
  meta point — they are staples, not surprises.
- Their win rates are **53.9%** and **55.1%**. Real, but slight.
- Across the 374-game backtest the side holding more of them won **53.5%**
  (68/127) — and adding the bonus did not improve the model at any value
  tested. It cost one game at +0.1 and three at +0.5, with the Brier score
  unchanged at 0.247 throughout. A *negative* bonus scored the same as a
  positive one, which is what a term made of noise looks like.

So it is kept small enough to colour a close call without overriding anything
the data supports. Raise `DARK_HORSE_POINT` if you trust the read over the
measurement; the backtest button will tell you what it costs.

#### The rank edge, and why it carries real weight

It is the only term that can compare teams across regions. Everything else is
computed from the games themselves, and that is exactly why none of it can tell
a good minor team from a good major one: a win rate is only as meaningful as the
opposition behind it, and nothing in an Oracle's Elixir export says how hard a
schedule was.

EWC's LØS is the case it exists for. Going into their match with JD Gaming they
had a **71% win rate over 17 games and 83% recent form**, against JDG's **52%
over 110 games and 31%**. Every internal read said LØS were the better team and
the model gave them **80%**. They lost — as they lost every game against a
major-region side.

Two changes followed. The award **scales with the gap** (0.1 a place, capped at
1.5) rather than paying a flat fee over a threshold, because a two-place gap and
a thirty-place gap are not the same claim. And a team **absent from the ratings
table is ranked behind every team in it**: being missing from a hand-maintained
list of the teams that matter is itself evidence, and treating it as "no
information" is what let LØS through — with no entry they took no rank edge at
all, so the term meant to catch exactly that team never fired. The fallback is
derived from the table rather than hardcoded, and the cap saturates long before
the precise value matters.

On the five LØS games in the backtest the model went from 2/5 to 3/5, and the
two worst calls collapsed: Hanwha Life Esports 64% → 36%, JD Gaming 80% → 54%.

**The caveat that comes with it.** Every term is scoped to games played before
kickoff except this one — the ratings table is a static snapshot, so a July game
is scored with ranks formed knowing how the season went. It is a hand-maintained
judgement rather than a statistic, so it is not the same as reading the result,
but it does borrow from the future and it makes any backtest number leaning on
it optimistic. The cap is there to bound how far that can go.

One limitation worth knowing: because the cap saturates, the model cannot tell
"unrated against rank 3" from "unrated against rank 27". LØS beat LYON (rank 27)
twice and the model called both against them.

The point margin becomes a per-game probability through a logistic curve, and
the series and sweep odds follow by counting the ways a best-of can still be
won from the current score.

The pocket term is halved in game one, where neither side has seen what the
other intends to play and an off-meta pick says far less about a plan than the
same pick in game three. Worth knowing: because an off-meta pick still forfeits
its full meta point while earning only half a pocket bonus, a game-one pocket
pick nets −0.25 against an all-meta draft, and +0.5 from game two on.

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

### First-time picks count as 100%

A champion a team has no recorded games on scores a full 1.00 rather than a
neutral 0.50. Nobody first-times a champion on stage: it has been scrimmed, it
is aimed at this opponent, and the other side has no film on it. Knight's Swain
at MSI is the case this exists for.

Only a champion with no record *anywhere* qualifies — one the team plays
constantly at home but has never used at an international event still scores its
real rate, from the wider scope, and the report names which scope it used.

Worth watching: combined with the as-of cutoff below, an early-season backtest
has little recorded play, so many lanes qualify at once and both bases inflate
together. `UNPLAYED_WIN_RATE` in `src/predictor/engine.ts` is the dial.

### Where its numbers come from

Everything is derived from the seasons you have imported — there is no separate
data file to build or keep in sync. Two different time scopes are used
deliberately:

- **Champion win rates** belong to the **player**, not the team, and prefer the
  split that player is currently in. A team-keyed record dragged a departed
  player's results into their replacement's number: swap a top laner who went
  0-4 on a champion for one who is 3-4 on it and the team still read 3-8.
  Records now follow the player, so a roster change counts immediately and a
  transfer takes the player's history with them.

  The current split is worked out per player, not globally, because split
  labels are per-league — on the same weekend the LCK is in *Summer*, the LPL
  in *Split 3* and the LEC in *Rounds 3-4*. A player needs at least two games
  in their current split before it outranks their career record; one game is
  0% or 100% and nothing in between, which would let a single result overwrite
  a career's worth of evidence.

  When both records exist they are **averaged**. Career already contains the
  split games, so the mean is a 50/50 blend that leans on recent form without
  letting it erase what came before: a player who is 1-3 on a champion this
  split but 20-5 across his career is neither a 25% pick nor an 80% one.

  The per-lane detail shows **both** numbers side by side, with whichever fed
  the score marked — so a player who is 50% on Yone across his career and has
  not touched it this split reads differently from one who is 50% on it right
  now.

  With no record for that player, an **off-meta** champion is credited a full
  1.00: nobody first-times an off-meta pick on stage, so it is prepared and
  aimed at this opponent. A *meta* champion they simply have not been handed
  says nothing about preparation, and falls back to the team's record on it, or
  a neutral 50%. The test is off-meta rather than "nobody has ever played it",
  because Swain had seven recorded games in 2026 before Knight's MSI pick — a
  literal never-played rule would not have fired for the case it exists for.
- **Standings and behaviour** cover the most recent season only. These are
  current-form reads; averaging five seasons together would wash out exactly
  the signal they exist to provide.

### Backtesting: paste matches instead of clicking them

Composing a matchup by hand takes about a minute — fine for one prediction,
hopeless for a season. The **Load matches** box on the Predictor takes the same
information as text and fills the composer from it. Paste one match, or a whole
list and step through it with Previous/Next or the scrubber. The queue survives
switching tabs and reloading.

```json
{
  "matches": [
    {
      "id": "LOLTMNT99_1234",
      "date": "2026-07-14",
      "competition": "LCK",
      "stage": "regular",
      "series": "BO3",
      "game": 1,
      "blue": { "team": "T1",    "top": "Aatrox", "jungle": "Viego",   "mid": "Azir",    "bot": "Jinx",   "support": "Thresh" },
      "red":  { "team": "Gen.G", "top": "Gnar",   "jungle": "Sejuani", "mid": "Orianna", "bot": "Ezreal", "support": "Nautilus" }
    }
  ]
}
```

Read leniently, because the point is to paste without thinking about syntax:
a bare object or a bare array works as well as the `matches` wrapper, keys need
no quotes, single quotes and trailing commas are fine, `//` and `/* */`
comments are ignored, `jng`/`jungle`/`jgl` all name the same lane, champions may
be a list in draft order instead of a per-role map, and competition names go
through the same alias table as the CSV import (`WLDS` finds Worlds). Anything
it can't resolve is reported rather than silently dropped.

**No winner field is read, ever** — the point is to fill in what a predictor
would know before the game.

#### Grading the whole queue at once

**Backtest all matches** scores every match in the queue and prints the record:

```
Accuracy 62.0% · 232R 142W
Always picking blue side would have scored 57.0%.
374 of 374 graded · Brier 0.247 (coin flip = 0.250)
```

The predictor never reads the result of the game it is predicting, and the
export carries no winner, so the answer key comes from somewhere else: each
pasted match is joined back to its source game by Oracle's Elixir game id (or
by date + teams + game number for a paste from elsewhere), and only then is the
winner read. History is cut at each match's own kickoff regardless of the
as-of switch — a hundred matches graded against a model that has already seen
their results is a lookup table, not a backtest.

Three numbers rather than one, because accuracy alone hides too much:

- **The record** is the headline: right, wrong, and the share.
- **The blue-side baseline** makes it readable. 54% sounds fine until you learn
  that picking blue every time — no model, no history, no data beyond which end
  of the map a team started on — scored better.
- **The Brier score** catches overconfidence: a model right 70% of the time
  while claiming 95% scores far worse than one honest about its 70%. 0.250 is
  what calling every game a coin flip gets.

The confidence table underneath breaks the record down by what the model
claimed, so a band that says 80% and delivers 56% is visible rather than
averaged away. **Every call** lists each match, and clicking one loads it into
the composer.
### Backtesting without lookahead

A model built from the whole season already knows how the season went. Predict
a July game against it and the champion win rates, standings, form and meta all
contain August — the classic lookahead mistake, and it flatters the model badly.

When a queue is loaded, **Only use history up to this game** cuts the model at
the current match's kickoff. It is on by default and can be switched off for
live prediction, where you do want everything.

Measured on the real 2026 export, same match (T1 vs Team Liquid, 1 July):

| History | Games | Meta from | T1 win probability |
| --- | --- | --- | --- |
| Cut at kickoff | 1,446 | patch 16.13 / 16.11 | 66.9% |
| Whole season | 1,820 | patch 16.16 / 16.15 | 83.5% |

A 16.6-point swing, and the uncut version was scoring a 1 July draft against a
meta from patches that had not shipped yet.

The cut uses the exported `kickoff` timestamp, so game three of a series can
legitimately see games one and two. With only a date it falls back to midnight,
which is conservative — everything that day counts as not yet played. Models
are cached per cutoff, so stepping back and forth through a queue does not
rebuild.

### Generating a queue

`scripts/export_matches.py` turns an Oracle's Elixir CSV into one paste-ready
file. Standard library only, no install step.

```bash
# July through today, all tracked competitions
python scripts/export_matches.py 2026_LoL_esports_match_data_from_OraclesElixir.csv

# a different window, one league, newest first
python scripts/export_matches.py data.csv --from 2026-05-01 --to 2026-08-01 \
    --league LCK --order desc --out lck-backtest.json
```

Games come out series by series, each series in game order, ordered by when it
started. (Oracle's Elixir game ids are not sequential within a series, so
sorting on them scattered a best-of-five into G1, G3, G4, G2, G5.)

It writes no result — no winner, score, kills, gold or game length. A backtest
that can see the answer is not a backtest, so scoring each prediction against
what really happened is left to you.

Each game carries the series score *entering* it, so stepping to game two of a
series moves the score and the series odds with it. That is legitimate pre-game
information — a 1-1 going into game three is what any analyst would know — and
the result of the game being predicted is still never written. The winner is
read only to build that running score for later games, then discarded.

The best-of is inferred from both the games played and the winner's total,
because neither alone is enough: counting games reads every Bo5 sweep as a Bo3
(a 3-0 and a 2-1 both run to three games), and counting the winner's games reads
a two-game 1-1 as a Bo1. Getting this wrong put impossible scorelines — 0-2 in a
best-of-three — into the queue.

### Early-game gold tempo

Oracle's Elixir records each team's gold difference at the 10, 15, 20 and 25
minute marks (there is no 5-minute bucket). The predictor averages those per
team and reports the pattern in the notices — "Gen.G: +421g on average at 10
min, ahead in 62% of 100 games — tend to lead early", against "DN SOOPers:
−379g … — tend to fall behind early" — plus a head-to-head line when the two
open more than 300g apart.

Two guards keep it honest. The average is paired with the share of games the
team was actually ahead, so a single 8k stomp can't masquerade as a habit — a
lopsided average with a middling ahead-rate is reported as "swingy starts"
instead. And a mark a game never reached contributes nothing rather than
counting as zero, so teams that win fast aren't dragged toward neutral at the
20 and 25 minute marks.

### What it reports but does not score

Behavioural reads — recent form, side preference, thrown leads, comebacks,
bounce-back after a loss, deciders, game-five chokes — and the gold tempo above
are shown as plain language and deliberately kept out of the score. They are
context for the reader, not fitted terms. Each is suppressed when its sample is
too small to mean anything.

Champion counters and synergies annotate the per-lane breakdown, restricted to
champions actually on the board, and likewise never move a total.

### Team ratings

Fraud is the one scored input with no equivalent in an Oracle's Elixir export —
a hand-maintained judgement about how reliably a team plays to its level.
GlobalRank is carried through from the same file and shown on the Data tab for
reference, but no longer scores: the rank edge was removed.

A default table ships with the app, so the fraud penalty works immediately. Replace it by importing a champion-pool CSV (columns `teamName`,
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
scripts/           asset downloader, team list, data-folder dev middleware,
                   champion-graph + team-ratings builders, match exporter (py)
src/
  assets/          local-asset manifest
  domain/          types, competition registry, champion + team identity/art
  data/            Oracle's Elixir schema, CSV parsing, ingestion, stage
                   inference, per-season merging, synthetic demo dataset
  quiz/            seeded RNG, config, matchup grouping, question generation,
                   scoring, session reducer + summary
  predictor/       prediction engine, model derivation, champion matchup graph,
                   league formats, team ratings, composer state, match paste
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
series reconstruction, player-scoped records across a roster change, per-league
split scoping, ratings parsing with fuzzy team matching, and the match
paste reader — lenient JSON repair, role and competition aliases, score/game
number reconciliation, and that no winner is ever read).

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
- **The predictor's fraud term comes from a hand-maintained table.** It appears
  nowhere in an Oracle's Elixir export. A default table ships with the app and
  can be replaced on the Data tab; teams it does not list take no penalty, which
  the report states.
- **Champion counters and synergies are static reference data**
  (`src/predictor/data/championGraph.json`). They annotate the per-lane
  breakdown and never move a score. Regenerate with
  `node scripts/build-champion-graph.mjs <champions_data_enriched.json>`.
- **Big imports parse on the main thread, not in a worker.** papaparse builds
  its worker by stringifying its own module factory into a blob, which a
  bundler's minifier rewrites into something that throws — and an uncaught
  worker error reaches neither its `error` nor its `complete` callback, so the
  import spinner ran forever. Reading incrementally on the main thread is both
  correct and faster here (10s versus a hang on the 58 MB 2026 export).
- **Gold reads need the gold-diff columns.** Exports carrying
  `golddiffat10/15/20/25` get the throw, comeback and early-tempo lines; files
  without them, and seasons imported before those columns were captured, simply
  omit those lines rather than guessing. Re-import a season to pick them up.
- **The first-pick notice credits red side.** Standard tournament draft gives
  blue the opening pick and red the last one, so this is set against the
  rulebook deliberately, matching the predictor this was ported from. Flip
  `FIRST_PICK_SIDE` in `src/predictor/engine.ts` to change it.

---

Not endorsed by Riot Games. Champion art © Riot Games, served via Data Dragon.
Team logos are the trademarks of their respective organizations and are shown to
identify the teams in a match — they are not covered by Leaguepedia's CC
license. Empty `scripts/teams.json` and re-run the script for a build without
them; the monogram fallback covers it. Team and player names belong to their
organizations.
