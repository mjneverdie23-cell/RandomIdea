# Adding a league or tournament

Nothing about competitions is hardcoded in Python. Adding one is a
configuration change, and in the common case no code is written at all.

## 1. The competition already has a source adapter

Most additions are like this — another league on the football-data mirror, or
another openfootball tournament.

Add an entry to `config/competitions.yml`:

```yaml
  - code: NED_ED                 # canonical code, used everywhere
    name: Eredivisie
    country: Netherlands
    tier: 2                      # 1 = major, 2 = supported, 3 = experimental
    source: football_data_mirror
    source_key: eredivisie       # the adapter's locator (here, the URL path segment)
    seasons: [2000/01, 2025/26]
    enabled: true
```

**If the league plays a calendar-year season** (the Nordics, most of the
Americas and Asia), say so — otherwise `2021` will be read as the 2020/21
season and the whole season gets relabelled:

```yaml
  - code: NOR_EL
    name: Eliteserien
    country: Norway
    tier: 2
    source: footballcsv_cache
    source_key: no.1
    season_style: calendar        # March to November, so "2023" not "2023/24"
    seasons: ["2012", "2024"]
    enabled: true
```

Quote the season bounds in a calendar-year config; unquoted, YAML reads them
as integers.

For a cup or tournament, describe its shape as well:

```yaml
  - code: UEFA_UEL
    name: UEFA Europa League
    country: INT
    tier: 1
    format: group_then_knockout  # league | knockout | group_then_knockout
    two_legged: true
    neutral_venue: false         # per-competition default; finals override it
    source: openfootball_txt
    source_key: europa-league
    source_file: el
    seasons: [2015/16, 2025/26]
    enabled: true
```

Then:

```bash
python scripts/build_dataset.py --codes NED_ED   # fetch and validate just this one
python scripts/check_names.py                    # review team-name resolution
```

`check_names.py` is the step that matters. It lists clubs that resolved by
rule-based cleaning rather than the reviewed alias table, and any name key
that maps to more than one canonical name. If the new competition shares clubs
with an existing one — an Eredivisie side that also plays in Europe — add the
spellings to `config/team_aliases.yml` so ratings follow the club across both:

```yaml
canonical:
  Ajax: [AFC Ajax, Ajax Amsterdam]
```

Do **not** rely on fuzzy matching to do this. It was measured on this data and
mapped `FC Porto → Portsmouth`.

Finally rebuild features and retrain:

```bash
python scripts/build_features.py
python scripts/train.py
```

## 2. The competition needs a new source

Implement an adapter with two methods:

```python
class MyAdapter:
    name = "my_source"

    def urls(self, comp, source, season) -> list[str]:
        """Where to fetch this competition-season from."""

    def parse(self, text, comp, season, url) -> pd.DataFrame:
        """Return rows in the canonical schema (schema.coerce_dtypes helps)."""
```

Register it in `ingest/registry.py`:

```python
ADAPTERS = {..., MyAdapter.name: MyAdapter()}
```

and declare it in `config/sources.yml`. Be honest in `provides` and `missing`
— those lists drive the per-fixture data-quality panel, and overstating them
makes the system claim inputs it does not have.

Nothing downstream needs to change: cleaning, features, models, API and UI all
read the canonical schema.

## Tiers

`tier` controls what a default training run includes:

```python
enabled_competitions(tier=1)      # majors only
filter_to_competitions(df, tier=2)
```

`enabled: false` keeps a competition configured but out of runs — useful for
one that is wired but whose data has not been reviewed yet. Several are shipped
in that state.

## Worked example: what adding Turkey and Norway actually took

Both are in the repository, and between them they exercise most of what can go
wrong.

**Turkey (Süper Lig)** was the straightforward case: a split season, half-time
scores present, five clubs shared with the Champions League. It needed a new
source adapter — `footballcsv_cache`, because the big-five mirror carries only
those five leagues — and a handful of aliases.

**Norway (Eliteserien)** was the interesting one, and surfaced three real
problems:

1. **Calendar-year seasons.** Its season is `2023`, not `2023/24`, and `2021`
   is ambiguous with the 2020/21 season. Adding `season_style` was not enough
   on its own: the ingestion parsed `2021` correctly and then the *cleaning*
   layer re-canonicalised it without the style, quietly turning a whole season
   into `2020/21`.
2. **Walk-forward folds built from season labels.** Eliteserien 2015 overlaps
   the Premier League 2015/16 in time, so label-based folds would have trained
   on matches played after some of the ones they scored. Folds are now date
   windows.
3. **No half-time data at all.** football-data.co.uk publishes its "extra"
   leagues without half-time scores. Left alone, the half models would have
   fallen back to league averages borrowed from other competitions and quoted
   them as a prediction about a Norwegian match. Half markets are now offered
   only where the half models actually know both clubs.

None of these were visible from the config. The lesson for the next addition:
a league with an unusual calendar or a thinner feed is where the assumptions
show up, and it is worth checking each of the five points below rather than
trusting that ingestion succeeding means it worked.

## What to check before enabling a competition

1. **Match count.** Under ~200 matches and the goal model has little to work
   with; the data-quality panel will flag it.
2. **Team overlap.** Run `check_names.py`. Clubs shared with existing
   competitions must resolve to one canonical name.
3. **Half-time coverage.** No half-time goals means no half markets for that
   competition — the API reports this per fixture rather than fabricating them.
4. **Neutral venues.** Tournaments at a single host should set
   `neutral_venue: true`; club competitions should leave it false and let the
   final be detected by stage.
5. **Season style.** A league playing March-to-November needs
   `season_style: calendar`. Check the ingested labels afterwards — a
   mislabelled season looks like perfectly normal data.
6. **Backtest it.** `python scripts/backtest.py --seasons 2024/25` and compare
   against the per-competition table in [BENCHMARK.md](BENCHMARK.md). A
   competition that scores much worse than the leagues is telling you
   something about its data.
