# Architecture

## Pipeline

```
config/*.yml
    │
    ▼
ingest/          adapters fetch raw files (cached under data/raw/)
    │            football_data.py · openfootball.py
    ▼
normalize/       teams · competitions · seasons  →  canonical schema
    │
    ▼
clean.py         validate · dedupe · range-check · report
    │
    ▼
data/processed/matches.parquet          ← the canonical match table
    │
    ▼
features/        one chronological pass, streaming state
    │            elo.py · form.py · builder.py
    ▼
data/processed/features.parquet         ← 173 numeric features, leak-free
    │
    ├──────────────┬──────────────┬─────────────────┐
    ▼              ▼              ▼                 ▼
models/        models/         models/           models/
dixon_coles    elo_model       ml                halves
poisson                        (LR/RF/XGB/       (1H and 2H
                                LGBM/CatBoost)    goal models)
    │              │              │                 │
    └──────────────┴──────┬───────┴─────────────────┘
                          ▼
                    models/ensemble.py       weights from validation log loss
                          │
                          ▼
                   models/calibration.py     isotonic / Platt, out of sample
                          │
                          ▼
                   models/score_matrix.py    reconcile → every market
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
        train.py                 predict.py
        (fit, save bundle)       (load bundle, serve)
                                      │
                                      ▼
                                  api/main.py  →  frontend/
```

Training and inference are separate processes. `train.py` writes one artifact
bundle; `predict.py` loads it and fits nothing except the as-of-date refits
that historical predictions require.

## Layers

### Configuration (`config/`)

`competitions.yml`, `sources.yml`, `model.yml`, `team_aliases.yml`. Loaded
only by `config.py`, which hands the rest of the package typed objects.
Competitions, tiers, model hyperparameters and team aliases are all data.

### Ingestion (`src/football_predictor/ingest/`)

An adapter turns one competition-season into canonical-schema rows. Downloads
are cached by URL hash so re-runs are offline and reproducible. A missing
season is an expected outcome, not an error: coverage is uneven and
`try_fetch` returns `None` rather than raising.

### Schema (`schema.py`)

The canonical column set, dtypes, `ValidationReport`, and deterministic
`match_id` generation. `POST_MATCH_FIELDS` marks what may never describe its
own match.

### Cleaning (`clean.py`)

Drops only what cannot be trusted; nulls what is merely implausible; reports
everything. See [DATA.md](DATA.md).

### Features (`features/`)

- `elo.py` — streaming Elo with goal-difference scaling, competition
  importance, between-season regression, and low-quantile seeding for
  debutants.
- `form.py` — per-team state: fixed windows (3/5/10), venue-split history,
  time-decayed means, season-to-date, congestion.
- `builder.py` — one chronological pass combining team state, competition
  baselines, head-to-head and the shot-based xG proxy into 173 numeric
  features, plus the `target_*` columns.

The streaming design is what makes leakage structurally hard — see
[LEAKAGE.md](LEAKAGE.md).

### Models (`models/`)

| Module | What it does |
|---|---|
| `score_matrix.py` | the joint score distribution and every market read off it; Dixon-Coles `tau`; convolution; blending; reconciliation |
| `dixon_coles.py` | weighted-MLE goal models with analytic gradient (`DixonColesModel`, `PoissonModel`) |
| `halves.py` | separate first-half and second-half fits |
| `elo_model.py` | ordered logit from Elo difference to HUB |
| `ml.py` | classifiers, Poisson-objective goal regressors, binary market models |
| `ensemble.py` | linear / logarithmic / stacked blending, weights from validation |
| `calibration.py` | isotonic and Platt, plus ECE and reliability curves |
| `base.py` | `MarketPredictions` — the one output format every model produces |

Every model, statistical or learned, ends up as a `MarketPredictions` batch.
The backtest, ensemble and API contain no model-specific branches, so a new
model becomes available in every market at once.

### Evaluation (`evaluation/`)

- `metrics.py` — log loss, Brier, RPS, accuracy, precision/recall/F1, ROC-AUC,
  MAE/RMSE, Poisson deviance, ECE, exact-score hit rate, naive baseline.
- `backtest.py` — the walk-forward engine: two-stage folds, periodic refits,
  per-market scoring, aggregation.

### Serving (`predict.py`, `api/`, `frontend/`)

`PredictionEngine` resolves the state for a date (current, or replayed),
collects member probabilities, blends and calibrates them, reconciles the
consensus score matrix to the result probabilities, and assembles markets,
explanation, confidence and data quality.

FastAPI is deliberately thin — validate, call, serialise. The React frontend
talks only to the API.

## Key design decisions

**One score distribution, many markets.** Deriving everything from a single
matrix means the markets cannot disagree. The alternative — a classifier per
line — is easier to build and produces panels where "over 1.5" is somehow less
likely than "over 2.5".

**Reconciliation instead of choosing.** The ensemble's HUB probabilities carry
information the goal models lack; the score matrix carries structure the
classifiers lack. Rather than picking one, the matrix is rescaled per outcome
region to match the ensemble, keeping both.

**Config over code.** Adding a competition should not require an edit to a
Python file, and it does not.

**Replay-safe serving.** A historical date is answered by rewinding state and
refitting, using only members that can be honestly rewound. The alternative —
answering with a model that has seen the match — would make the UI a
hindsight viewer while looking identical.

**Refit cadence differs by model type.** Goal models carry team strength *in
their parameters*, so they are refitted every 30 days. ML models carry recency
*through their features*, which update every match, so they are refitted per
season. Refitting five gradient-boosting models monthly across 11 seasons
would cost hours for no measured gain.

## Repository layout

```
config/          competition, source, model and alias configuration
data/
  raw/           cached downloads (URL-hashed)
  processed/     matches.parquet, features.parquet, backtest/
src/football_predictor/
  ingest/        source adapters and registry
  normalize/     teams, competitions, seasons
  features/      elo, form, builder
  models/        statistical, ML, ensemble, calibration, score matrix
  evaluation/    metrics, walk-forward backtest
  schema.py clean.py pipeline.py train.py predict.py explain.py confidence.py
api/             FastAPI service
frontend/        React + Vite predictor UI
scripts/         build_dataset · build_features · train · backtest · serve · check_names
tests/           normalization · ingest · clean · leakage · markets · models · predict · api
notebooks/       exploration
docs/            this documentation
models/          trained bundle
```
