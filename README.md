# Football Match Predictor

A calibrated probability forecasting system for football. It ingests raw match
data, normalises it into one schema, builds leak-free features, fits
statistical and machine-learning models, blends and calibrates them, and
serves a full market book for any fixture you pick.

The objective is a **statistically sound, calibrated** forecaster. It is not a
system that claims to find guaranteed winners — the peer-reviewed ceiling for
football result accuracy is roughly 50-55%, and results here sit inside that
range. A 70% forecast from this system is meant to be wrong about three times
in ten.

A real response from the running service, not an illustration:

```
Manchester City vs Everton · Premier League · 2026-09-19

Expected goals    2.16 - 0.80          Total 2.96

HUB      Home 70%    Draw 18%    Away 12%
BTTS     Yes 49%     No 51%
Over 2.5 57%
Manchester City   over 0.5  89%   clean sheet  45%
Everton           over 0.5  55%   clean sheet  11%
Half-time HUB     Home 50%   Draw 37%   Away 13%
Most likely scores   2-0, 1-0, 2-1
Confidence  High (0.81)       Data quality  Good
```

## What "HUB" means

**H**jemmeseier / **U**avgjort / **B**orteseier — the Norwegian labels for the
three-way match-result market, used on Norsk Tipping's *Tippekupongen* coupon.
It is the same market as **1X2**: `H = 1`, `U = X`, `B = 2`.

It settles on **regulation time**, which matters for knockout ties: a
Champions League match that finishes 1-1 after 90 minutes and is won on
penalties is a **U**. The ingestion layer parses regulation scores out of
`3-4 pen. 1-1 a.e.t. (1-1, 0-1)` notation for exactly this reason. Full
sourcing in [docs/RESEARCH.md §0](docs/RESEARCH.md).

## Markets

| Market | Lines |
|---|---|
| **HUB** (= 1X2, full-time result) | home / draw / away |
| **BTTS** | yes / no |
| **Over/under total goals** | 0.5, 1.5, 2.5, 3.5, 4.5, 5.5 |
| **Team goals** | over 0.5/1.5/2.5/3.5 per side, to-score, clean sheet |
| **Half-time** | HT HUB, first-half over/under, first-half BTTS, first-half team goals |
| **Second half** | second-half over/under, expected goals |
| **Exact score** | six most likely scorelines |

Every goal-based market is derived from **one** score-probability matrix, so
they cannot contradict each other. Half markets are fitted as separate
first-half and second-half models — the measured split on this data is
**44% / 56%**, not 50/50, so halving the full-time numbers would misprice
every first-half line. See [docs/MARKETS.md](docs/MARKETS.md).

## Data

61,076 matches, 305 teams, 1993/94 to 2025/26, from two free public sources.

| Competition | Matches | Half-time | Shots |
|---|---:|---:|---:|
| Premier League | 12,704 | 92.7% | 77.8% |
| La Liga | 12,704 | 94.0% | 62.8% |
| Ligue 1 | 11,847 | 92.5% | 64.6% |
| Serie A | 11,726 | 94.8% | 67.9% |
| Bundesliga | 10,098 | 93.9% | 75.7% |
| UEFA Champions League | 1,997 | 94.4% | 0% |

Cups, the Europa League, the Conference League, the World Cup and the Euros
are configured in `config/competitions.yml` and can be enabled once a source
is wired — see [docs/ADDING_COMPETITIONS.md](docs/ADDING_COMPETITIONS.md).

No xG feed is freely available for these competitions, so a **shot-based xG
proxy** is derived instead and labelled as such everywhere it appears. It is
not an Opta or StatsBomb figure and is never presented as one.

Details: [docs/DATA.md](docs/DATA.md).

## Models

| Model | Role |
|---|---|
| Poisson (time-weighted) | baseline goal model |
| **Dixon-Coles** | Poisson + low-score `rho` correction + exponential time decay |
| **Elo** | cross-competition team strength, mapped to HUB by ordered logit |
| Logistic regression | linear ensemble member |
| Random forest | ensemble diversity |
| XGBoost / LightGBM / CatBoost | gradient boosting on 173 features |
| LightGBM goal model | two Poisson regressors → expected goals → full market book |
| Halves model | separate first-half and second-half Dixon-Coles fits |
| **Ensemble** | weighted logarithmic blend, weights fitted on validation |
| Calibration | isotonic / Platt, fitted out of sample and **measured** |

Which architecture wins was decided by walk-forward validation, not by
preference.

### Measured results

Walk-forward over 11 seasons, **21,260 test matches**, each predicted by models
that never saw it. HUB market:

| Model | Log loss | Brier | RPS | Accuracy |
|---|---:|---:|---:|---:|
| Naive base rates | 1.0739 | 0.6495 | 0.2315 | 44.3% |
| Elo | 0.9854 | 0.5871 | 0.2013 | 52.7% |
| Poisson | 0.9826 | 0.5849 | 0.2004 | 52.9% |
| Dixon-Coles | 0.9822 | 0.5847 | 0.2004 | 52.8% |
| Random forest | 0.9778 | 0.5817 | 0.1990 | 53.2% |
| XGBoost | 0.9832 | 0.5848 | 0.1999 | 53.1% |
| CatBoost | 0.9773 | 0.5812 | 0.1988 | 53.3% |
| **Ensemble** | **0.9753** | **0.5802** | **0.1983** | **53.2%** |

53.2% accuracy sits inside the ~50-55% ceiling reported in peer-reviewed work.
Anything claiming much more out of sample is worth checking for leakage.

**Calibration was measured, not assumed** — and it turned out that post-hoc
correction *hurts* this ensemble (ECE 0.0230 uncalibrated, 0.0281 with Platt,
0.0290 with isotonic). The blend is already well calibrated because its members
are fitted by proper scoring rules. Production therefore applies none, which is
what the measurement says rather than what the convention says. Pooled over
63,780 outcome probabilities, the largest gap between predicted and observed
frequency in any well-populated band is **0.9 percentage points**.

Full tables including per-competition, per-season, half-time markets and
ensemble weights: [docs/BENCHMARK.md](docs/BENCHMARK.md). Why each approach was
adopted or rejected: [docs/RESEARCH.md](docs/RESEARCH.md).

## Data leakage

The failure mode that matters most, because it is silent. Features are built
by a **streaming state machine** that reads state, emits the row, and only
then folds in the result — so a rolling average cannot contain the match it
describes. Validation is chronological and three-way, so calibrators and blend
weights never touch the test fold. Historical dates in the UI are **replayed**,
not answered in hindsight.

The decisive test rewrites every match after a cut-off to 9-0 and asserts that
every feature row before the cut-off is bit-for-bit identical.

Full treatment: [docs/LEAKAGE.md](docs/LEAKAGE.md).

## Quick start

```bash
# 1. install
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 2. fetch and clean the data (~60s, cached afterwards)
python scripts/build_dataset.py

# 3. build the feature matrix (~50s)
python scripts/build_features.py

# 4. train the production models (~5 min)
python scripts/train.py

# 5. serve the API
python scripts/serve.py            # http://127.0.0.1:8000/docs

# 6. in another shell, the UI
cd frontend && npm install && npm run dev    # http://localhost:5173
```

A prediction without the UI:

```bash
curl -s -X POST http://127.0.0.1:8000/predict \
  -H 'Content-Type: application/json' \
  -d '{"competition":"ENG_PL","home_team":"Liverpool",
       "away_team":"Arsenal","date":"2026-09-12","season":"2026/27"}' | jq
```

## The interface

Pick competition, season, home team, away team and match date. The UI shows
expected goals for both sides, the HUB split, BTTS, the over/under ladder,
per-team goal lines, half-time and second-half markets, the most likely
scorelines, a confidence label, a data-quality report, and the factors that
actually drove the prediction — read back out of the feature row the model
scored, never generated to fill the panel.

## Retraining

```bash
python scripts/build_dataset.py     # pull new results
python scripts/build_features.py    # rebuild features
python scripts/train.py             # refit and save models/predictor.joblib
```

Retrain when new matches land — weekly during a season is sensible. The
statistical models apply exponential time decay, so they adapt without a
rebuild, but the ML members and the ensemble weights need one.

To re-run the full evaluation:

```bash
python scripts/backtest.py          # ~40 min, writes data/processed/backtest/
python scripts/report.py            # regenerates docs/BENCHMARK.md
```

## Adding a competition

Usually a config change with no Python:

```yaml
# config/competitions.yml
  - code: NED_ED
    name: Eredivisie
    country: Netherlands
    tier: 2
    source: football_data_mirror
    source_key: eredivisie
    seasons: [2000/01, 2025/26]
    enabled: true
```

Then `build_dataset.py`, `check_names.py` (to review team-name resolution),
`build_features.py`, `train.py`. Full guide including new sources:
[docs/ADDING_COMPETITIONS.md](docs/ADDING_COMPETITIONS.md).

## Tests

```bash
python -m pytest tests/ -q
```

Covers normalisation, both source parsers, cleaning rules, **leakage**, market
derivation, model fitting, the prediction engine and the HTTP API.

## Documentation

| Document | Contents |
|---|---|
| [RESEARCH.md](docs/RESEARCH.md) | literature review, sources, what was adopted and rejected, and why |
| [BENCHMARK.md](docs/BENCHMARK.md) | measured walk-forward results, generated from the experiment |
| [DATA.md](docs/DATA.md) | sources, canonical schema, normalisation, cleaning, coverage |
| [LEAKAGE.md](docs/LEAKAGE.md) | how leakage is prevented and how that is proved |
| [MARKETS.md](docs/MARKETS.md) | every market and how its probability is computed |
| [CONFIDENCE.md](docs/CONFIDENCE.md) | how the confidence label and data-quality report are computed |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | module layout and design decisions |
| [ADDING_COMPETITIONS.md](docs/ADDING_COMPETITIONS.md) | extending to new leagues and sources |

## Limitations

Stated plainly, because they bound what the numbers mean:

- **No lineups, injuries or suspensions** in any wired source. A late injury
  to a key player is invisible to the model.
- **No real xG** — a shot-based proxy stands in, with no shot-location data
  behind it.
- **No odds** in the current mirror, so no market-efficiency comparison.
- **Transfers and managerial changes** are absorbed slowly through form and
  between-season rating regression, not modelled. Early-season predictions
  after heavy squad turnover are the weakest the system produces.
- **Motivation is not modelled** — a dead rubber scores the same as a decider.
- **Champions League has no shot data**, so shot-derived features are absent
  there and its predictions rest on fewer inputs.
- **Accuracy has a ceiling.** Football is genuinely uncertain. The value here
  is in calibrated probabilities, not in a high hit rate.

## Licence

MIT — see [LICENSE](LICENSE).

Match data is mirrored from [football-data.co.uk](https://www.football-data.co.uk/)
(free for personal use) and [openfootball](https://github.com/openfootball)
(public domain). Please respect the original terms.
