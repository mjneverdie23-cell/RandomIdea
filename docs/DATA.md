# Data: sources, schema and quality

## Sources

Two adapters are wired. Both are free and public; neither needs a key.

### 1. `football_data_mirror` — Big-5 European leagues

The [Frictionless Data `football-datasets`](https://github.com/datasets/football-datasets)
mirror of [football-data.co.uk](https://www.football-data.co.uk/) match CSVs.

| | |
|---|---|
| Competitions | Premier League, La Liga, Bundesliga, Serie A, Ligue 1 |
| Seasons | 1993/94 – 2025/26 |
| Matches | ~59,000 |
| Provides | full-time goals, **half-time goals**, shots, shots on target, corners, fouls, cards, referee |
| Missing | xG, possession, odds, lineups, injuries |

Column layout is stable across all seasons:

```
Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,HTR,Referee,
HS,AS,HST,AST,HF,AF,HC,AC,HY,AY,HR,AR
```

Older seasons carry the goal columns but leave the match statistics blank.
Those are left null rather than imputed — see *Missing data* below.

> The adapter also maps the odds columns (`B365H`, `AvgH`, …) that appear in
> football-data.co.uk's own exports. They are absent from this mirror, so odds
> coverage is currently 0%; dropping in a richer CSV makes them work with no
> code change.

### 2. `footballcsv_cache` — leagues outside the big five

[`footballcsv/cache.footballdata`](https://github.com/footballcsv/cache.footballdata),
which mirrors football-data.co.uk's full catalogue in the football.csv
"standard": one file per league and season, named by ISO country code and
tier.

| | |
|---|---|
| Competitions | Süper Lig (Turkey), Eliteserien (Norway) |
| Seasons | Turkey 1994/95 – 2023/24, Norway 2012 – 2024 |
| Matches | ~12,400 |
| Provides | full-time goals; half-time goals for football-data's "main" leagues |
| Missing | shots, corners, cards, xG, possession, odds |

The format is five columns with the scores as strings:

```
Date,Team 1,FT,HT,Team 2
Fri Aug 11 2023,Trabzonspor,1-0,1-0,Antalyaspor
Mon Apr 10 2023,Rosenborg,1-0,?,Viking
```

`?` means the value was not recorded. football-data.co.uk splits its coverage
into "main" leagues (Turkey among them, with half-time scores) and "extra"
leagues (Norway among them, **with no half-time scores at all**). A missing
half time is therefore normal here rather than exceptional: it is left null,
and half-time markets are switched off for that competition rather than
invented from other competitions' averages.

Two known limitations of this mirror, both real and both reported:

* it stopped updating around mid-2024, so Turkey ends at 2023/24 and Norway's
  2024 season is present but **partial** (92 of ~240 matches);
* older Turkish seasons (roughly pre-2003) have no half-time scores either,
  which is why Turkey's overall half-time coverage is 83% rather than ~95%.

### 3. `openfootball_txt` — cups and international tournaments

[openfootball](https://github.com/openfootball) plain-text fixture files.
Currently wired for the Champions League; the World Cup and Euros are
configured but disabled pending review of their team-name coverage.

| | |
|---|---|
| Competitions | UEFA Champions League (2011/12 – 2025/26) |
| Matches | ~2,000 |
| Provides | full-time goals, half-time goals, stage, neutral-venue flag |
| Missing | shots, corners, cards, xG, possession, odds |

The format is human-written and the parser is tolerant of it:

```
▪ Group, Matchday 1
  Tue Sep 19 2023
    18:45  AC Milan (ITA)  v Newcastle United FC (ENG)  0-0
           BSC Young Boys (SUI) v RB Leipzig (GER)      1-3 (1-1)

▪ Finals, Quarterfinals
    21:00  Manchester City FC (ENG) v Real Madrid CF (ESP)  3-4 pen. 1-1 a.e.t. (1-1, 0-1)
```

Score notations handled:

| Written | Meaning | Stored as result |
|---|---|---|
| `1-3 (1-1)` | full time, half time | `1-3`, HT `1-1` |
| `0-0` | full time, half time not recorded | `0-0`, HT null |
| `3-4 pen. 1-1 a.e.t. (1-1, 0-1)` | shootout, after extra time, then **(score after 90, score at half time)** | `1-1`, HT `0-1` |

**Only the regulation score is stored.** HUB settles on 90 minutes, so extra
time and shootouts are discarded. This also keeps knockout fixtures
comparable with league fixtures, where extra time never happens.

Two further details the parser handles: the year appears on a date line only
when it changes, and is carried forward — with a roll-over when the month
jumps backwards, because a European season spans two calendar years. And a
neutral venue is treated as a property of the *fixture*, not the competition:
a Champions League final is neutral, its group stage is not.

## Adding a source

Implement two methods and register the class:

```python
class MyAdapter:
    name = "my_source"
    def urls(self, comp, source, season) -> list[str]: ...
    def parse(self, text, comp, season, url) -> pd.DataFrame: ...   # canonical schema
```

Register it in `src/football_predictor/ingest/registry.py` and declare it in
`config/sources.yml`, including an honest `provides` / `missing` list — those
lists drive the data-quality panel. Nothing downstream changes.

## Canonical schema

Defined in `src/football_predictor/schema.py`. Every adapter emits this
regardless of its input format.

### Identity and context

| Field | Type | Notes |
|---|---|---|
| `match_id` | string | SHA-1 of competition + date + teams; makes re-ingestion idempotent |
| `date` | datetime | kickoff date |
| `competition` | string | canonical code, e.g. `ENG_PL` |
| `season` | string | canonical label, e.g. `2023/24` |
| `stage` | string | `league`, `group`, `round_of_16`, `final`, … (nullable) |
| `home_team`, `away_team` | string | canonical team names |
| `neutral_venue` | bool | per fixture |

### Result (post-match — never a feature for its own match)

`home_goals`, `away_goals`, `ht_home_goals`, `ht_away_goals`

Full-time goals are **regulation only**.

### Optional statistics

`home_shots`/`away_shots`, `home_shots_on_target`/`away_shots_on_target`,
`home_corners`/`away_corners`, `home_fouls`/`away_fouls`,
`home_yellow`/`away_yellow`, `home_red`/`away_red`,
`home_possession`/`away_possession`, `home_xg`/`away_xg`, `referee`

### Optional odds

`odds_home`, `odds_draw`, `odds_away`, `odds_over25`, `odds_under25`

Every optional field is genuinely optional. A source that cannot supply it
leaves it null, and the data-quality layer records the gap rather than
hiding it.

## Normalisation

### Teams

The two sources name the same club differently — `Man City` versus
`Manchester City FC`. Unifying them matters because ratings must follow a club
across competitions: Real Madrid's league form has to inform its Champions
League prediction.

Resolution order, in `normalize/teams.py`:

1. exact match against the reviewed alias table in `config/team_aliases.yml`;
2. match after rule-based cleaning (accent folding, corporate-suffix removal);
3. the cleaned name itself, recorded as unmapped.

**Fuzzy matching is not used at any stage.** It was evaluated and rejected: on
this data it mapped `Celtic FC → Celta`, `FC Porto → Portsmouth`,
`PSV Eindhoven → Swindon` and `Beşiktaş → Brescia`. The alias table is 110
canonical entries covering 183 spellings, hand-reviewed.

Verify with:

```bash
python scripts/check_names.py
```

which reports how many clubs are shared between competitions (52), how many
are Champions League only (56 — all genuinely outside the leagues carried
here), and any name key resolving to more than one canonical name (0).

Adding Turkey and Norway is what this machinery is for. Five clubs now link a
domestic league to the Champions League that previously appeared only in
Europe: Galatasaray, Beşiktaş, Trabzonspor, Bodø/Glimt, and İstanbul
Başakşehir — the last only because football-data.co.uk still files it under
the club's former name, `Buyuksehyr`.

Three pairs were deliberately **not** merged despite looking like renames:

| Kept apart | Why |
|---|---|
| Gaziantepspor / Gaziantep | different clubs (1969–2020 vs founded 2013) |
| Malatyaspor / Yeni Malatyaspor | different clubs (dissolved 2011 vs founded 2010) |
| Ankaragucu / Ankaraspor | both played the 2004/05 season, so two clubs |

The decisive test for "same club or two?" is whether the two names ever appear
in the same season. It is a signal, not a proof — `Ham-Kam` and `HamKam` both
appear in Eliteserien 2023, but between them they account for exactly one
club's 30 matches, so they are one club spelled two ways mid-file.

A separate `display` map gives the UI readable labels (`Ath Madrid` →
*Atlético Madrid*) without changing the modelling identity.

### Seasons

Canonical form is `2023/24`. Handled inputs: `2324`, `2023-24`, `2023/2024`,
`9394`, and bare years for single-year tournaments.

A four-digit string is ambiguous — `2324` is the 2023/24 season, `2022` is the
World Cup. They are told apart by whether the halves are consecutive years: a
season code always is, a calendar year almost never is. Seasons roll over on
1 July when derived from a date.

**Calendar-year competitions.** Not every league runs autumn to spring.
Eliteserien plays March to November, so its season is `2023`, not `2023/24`.
Such a competition declares `season_style: calendar`, and every place that
turns a date or a label into a season takes that style as an argument.

The heuristic above is not sufficient on its own here: `2021` reads as the
2020/21 season *and* is a real Eliteserien season. Getting this wrong is not
theoretical — the first version of the Norway ingestion parsed `2021`
correctly and then the cleaning layer re-canonicalised it without the style,
turning a whole season into `2020/21`. `tests/test_calendar_seasons.py` pins
the fix.

### Competitions

Codes and metadata come from `config/competitions.yml`; stage labels are
normalised through a small alias map. Nothing about competitions is hardcoded
in Python — see [ADDING_COMPETITIONS.md](ADDING_COMPETITIONS.md).

## Validation and cleaning

`src/football_predictor/clean.py`. The rule throughout: **drop a row only when
it cannot be trusted as a training example; keep anything merely incomplete
and record the gap.**

| Check | Action |
|---|---|
| Unparsable date | drop |
| Missing or empty team | drop |
| Team listed against itself | drop |
| No full-time score (unplayed fixture) | drop from training, counted |
| Half-time goals above full-time goals | null the half-time score, keep the match |
| Statistic outside a plausible range | null that statistic, keep the match |
| Identical fixture ingested twice | de-duplicate on `match_id` |
| Same fixture within three days | treat as a re-listing, drop the later one |

Two legs of a knockout tie are **not** duplicates — they have different home
teams — and `tests/test_clean.py` pins that.

Out-of-range statistics are nulled rather than clipped: clipping would invent
a value that was never observed.

## Current coverage

From `python scripts/build_dataset.py`:

| Competition | Matches | Teams | From | To | Half-time | Shots |
|---|---:|---:|---|---|---:|---:|
| ENG_PL | 12,704 | 51 | 1993-08-14 | 2026-05-24 | 92.7% | 77.8% |
| ESP_LL | 12,704 | 49 | 1993-09-05 | 2026-05-24 | 94.0% | 62.8% |
| FRA_L1 | 11,847 | 46 | 1993-07-23 | 2026-05-17 | 92.5% | 64.6% |
| GER_BL | 10,098 | 45 | 1993-08-07 | 2026-05-16 | 93.9% | 75.7% |
| ITA_SA | 11,726 | 53 | 1993-08-29 | 2026-05-24 | 94.8% | 67.9% |
| TUR_SL | 9,444 | 61 | 1994-08-13 | 2024-05-26 | 83.4% | 0% |
| NOR_EL | 2,992 | 28 | 2012-03-23 | 2024-06-02 | **0%** | 0% |
| UEFA_UCL | 1,997 | 108 | 2011-09-13 | 2026-05-30 | 94.4% | 0% |
| **Total** | **73,512** | **389** | | | | |

xG coverage is 0% (no free feed — a shot-based proxy is derived instead) and
odds coverage is 0% (absent from this mirror).

## Missing data

Never silently imputed at the data layer. Instead:

- gradient boosting models see the missing values and handle them natively;
- linear and forest models get median imputation *inside their own pipeline*,
  so imputation is a property of that estimator, not of the dataset;
- rolling features return null until a team has enough history;
- the per-fixture data-quality panel reports what was missing.

## Caching and reproducibility

Raw downloads are cached under `data/raw/` keyed by URL hash. Re-runs are
offline-capable and reproducible: the same bytes produce the same training
set. Force a refresh with `python scripts/build_dataset.py --no-cache`.
