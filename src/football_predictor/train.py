"""Training entry point: fit the production models and save them.

Training is deliberately separate from inference. This module writes a single
artifact bundle; :mod:`football_predictor.predict` loads it and never fits
anything of its own except the as-of-date refits described there.

What gets saved:

* the fitted feature-builder state (team form, Elo, competition baselines,
  head-to-head) as of the training cutoff, plus season-start snapshots so a
  historical date can be replayed without a full rebuild;
* the statistical goal models and the half models;
* the ML members and the Elo outcome model;
* ensemble weights and calibrators, both fitted on a validation window that
  ends before the cutoff.
"""
from __future__ import annotations

import copy
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from .config import load_model_config, model_dir
from .evaluation.backtest import GOAL_ML_ID, BacktestConfig, _recent_years
from .features.builder import FeatureBuilder, feature_columns
from .models.base import MarketPredictions
from .models.calibration import (
    BinaryCalibrator, MulticlassCalibrator, expected_calibration_error,
)
from .models.dixon_coles import DixonColesModel, GoalModelConfig, PoissonModel
from .models.elo_model import EloOutcomeModel
from .models.ensemble import BinaryEnsemble, ProbabilityEnsemble
from .models.halves import HalvesModel
from .models.ml import MLGoalModel, MLResultModel
from .pipeline import load_dataset

log = logging.getLogger(__name__)

BUNDLE_NAME = "predictor.joblib"

#: Bumped whenever the bundle's layout changes in a way older files cannot
#: satisfy. 1.1.0 moved feature-builder snapshots from season-label keys to
#: calendar-boundary dates, which a 1.0.0 bundle cannot be read as.
BUNDLE_VERSION = "1.1.0"
MIN_BUNDLE_VERSION = "1.1.0"

#: Feature-builder state is captured on 1 July each year - after every European
#: season has finished and before the next has started.
SNAPSHOT_MONTH = 7
SNAPSHOT_DAY = 1
#: How many recent snapshots to carry in the bundle.
SNAPSHOT_LIMIT = 8


def _snapshot_boundary(date) -> pd.Timestamp:
    """The most recent 1 July on or before ``date``."""
    ts = pd.Timestamp(date)
    year = ts.year if (ts.month, ts.day) >= (SNAPSHOT_MONTH, SNAPSHOT_DAY) else ts.year - 1
    return pd.Timestamp(year=year, month=SNAPSHOT_MONTH, day=SNAPSHOT_DAY)

#: Members that can be honestly replayed to any historical date, because they
#: are refitted from scratch on data before that date at prediction time.
REPLAY_SAFE_MEMBERS = ("poisson", "dixon_coles", "elo")


@dataclass
class TrainedBundle:
    """Everything inference needs."""

    version: str = BUNDLE_VERSION
    trained_at: pd.Timestamp | None = None
    trained_through: pd.Timestamp | None = None
    seasons: list[str] = field(default_factory=list)
    competitions: list[str] = field(default_factory=list)
    feature_names: list[str] = field(default_factory=list)

    builder: FeatureBuilder | None = None
    #: Feature-builder state captured at fixed calendar boundaries, keyed by
    #: the boundary date. Keying on season labels does not work once a
    #: calendar-year league (Eliteserien, season "2023") is interleaved with
    #: split-season ones ("2023/24"): the label flips back and forth through
    #: the chronological stream, so "the season changed" stops meaning "a new
    #: period started".
    builder_snapshots: dict[str, FeatureBuilder] = field(default_factory=dict)
    #: Row position, in the canonically sorted match table, of each snapshot.
    #: Replaying from a position rather than a date is exact: several matches
    #: can share the boundary date, and a date comparison would replay them
    #: twice or not at all.
    snapshot_positions: dict[str, int] = field(default_factory=dict)

    dixon_coles: DixonColesModel | None = None
    poisson: PoissonModel | None = None
    halves: HalvesModel | None = None
    elo_outcome: EloOutcomeModel | None = None
    ml_members: dict[str, object] = field(default_factory=dict)

    ensemble: ProbabilityEnsemble | None = None
    calibrators: dict[str, MulticlassCalibrator] = field(default_factory=dict)
    btts_ensemble: BinaryEnsemble | None = None
    ou_ensemble: BinaryEnsemble | None = None
    btts_calibrator: BinaryCalibrator | None = None
    ou_calibrator: BinaryCalibrator | None = None

    replay_ensemble: ProbabilityEnsemble | None = None
    replay_calibrator: MulticlassCalibrator | None = None

    matches: pd.DataFrame | None = None
    metadata: dict = field(default_factory=dict)

    def path(self) -> Path:
        return model_dir() / BUNDLE_NAME


def train(
    matches: pd.DataFrame | None = None,
    *,
    validation_seasons: int | None = None,
    save: bool = True,
) -> TrainedBundle:
    """Fit every production model on the full match history."""
    started = time.time()
    matches = load_dataset() if matches is None else matches
    config = BacktestConfig.from_config()
    validation_seasons = validation_seasons or config.validation_seasons
    calibration_method = config.calibration_method

    # Sorted on the starting year, which both label styles begin with.
    seasons = sorted(matches["season"].unique(), key=lambda s: (str(s)[:4], str(s)))
    # Split on a date, not on season labels: with a calendar-year league in
    # the mix, "the last two seasons" is not a well-defined set of rows.
    validation_start = (
        pd.Timestamp(matches["date"].max()) - pd.DateOffset(years=validation_seasons)
    )

    bundle = TrainedBundle(
        trained_at=pd.Timestamp.now("UTC").tz_localize(None),
        trained_through=pd.Timestamp(matches["date"].max()),
        seasons=seasons,
        competitions=sorted(matches["competition"].unique()),
    )

    # ---- feature pass, capturing a snapshot at each season boundary --------
    log.info("building features and snapshots")
    builder = FeatureBuilder()
    snapshots: dict[str, FeatureBuilder] = {}
    positions: dict[str, int] = {}
    feature_rows: list[dict] = []
    ordered = matches.sort_values(["date", "competition", "home_team"], kind="mergesort")
    boundary: pd.Timestamp | None = None
    for position, (_, row) in enumerate(ordered.iterrows()):
        crossed = _snapshot_boundary(row["date"])
        if boundary is None or crossed > boundary:
            key = crossed.strftime("%Y-%m-%d")
            snapshots[key] = copy.deepcopy(builder)
            positions[key] = position
            boundary = crossed
        feature_rows.append(builder._row_features(row))
        if not pd.isna(row["home_goals"]):
            builder._observe(row)
    features = pd.DataFrame(feature_rows, index=ordered.index).reindex(matches.index)
    bundle.builder = builder
    # Only recent snapshots are kept: replaying a 1990s fixture is not a use
    # case worth carrying 30 deep-copied states for.
    # Only recent snapshots are kept: replaying a 1990s fixture is not a use
    # case worth carrying thirty deep-copied states for.
    recent = sorted(snapshots)[-SNAPSHOT_LIMIT:]
    bundle.builder_snapshots = {k: snapshots[k] for k in recent}
    bundle.snapshot_positions = {k: positions[k] for k in recent}

    features = features[features["target_result"].notna()].copy()
    columns = feature_columns(features)
    bundle.feature_names = columns

    inner = features[features["date"] < validation_start]
    validation = features[features["date"] >= validation_start]
    match_inner = matches[matches["date"] < validation_start]
    match_validation = matches[matches["date"] >= validation_start]

    # ---- statistical models on the full history ---------------------------
    reference = bundle.trained_through + pd.Timedelta(days=1)
    log.info("fitting statistical models")
    bundle.dixon_coles = DixonColesModel(
        GoalModelConfig.from_config("dixon_coles")
    ).fit(matches, reference_date=reference)
    bundle.poisson = PoissonModel().fit(matches, reference_date=reference)
    try:
        bundle.halves = HalvesModel.from_config().fit(matches, reference_date=reference)
    except ValueError:
        log.warning("no half-time data available; half markets disabled")

    bundle.elo_outcome = EloOutcomeModel().fit_frame(features)

    # ---- ML members -------------------------------------------------------
    ml_data = _recent_years(features, config.ml_train_seasons)
    log.info("fitting ML members on %d matches", len(ml_data))
    for model_id in config.ml_models:
        try:
            bundle.ml_members[model_id] = MLResultModel(model_id).fit(
                ml_data[columns], ml_data["target_result"]
            )
        except Exception:
            log.exception("could not fit %s", model_id)
    try:
        bundle.ml_members[f"{GOAL_ML_ID}_goals"] = MLGoalModel(GOAL_ML_ID).fit(
            ml_data[columns], ml_data["target_home_goals"], ml_data["target_away_goals"],
            rho=bundle.dixon_coles.rho,
        )
    except Exception:
        log.exception("could not fit ML goal model")

    # ---- blend weights and calibrators, fitted out of sample ---------------
    log.info("fitting ensemble weights and calibrators on %d matches from %s",
             len(validation), validation_start.date())
    members = _validation_members(
        inner, validation, match_inner, match_validation, columns, config
    )
    labels = validation["target_result"].to_numpy()
    label_index = np.array([{"H": 0, "U": 1, "B": 2}[v] for v in labels])

    bundle.ensemble = ProbabilityEnsemble.from_config().fit(members, label_index)
    for name, probs in members.items():
        bundle.calibrators[name] = MulticlassCalibrator(calibration_method).fit(probs, labels)
    ensemble_validation = bundle.ensemble.predict_proba(members)
    bundle.calibrators["ensemble"] = MulticlassCalibrator(calibration_method).fit(
        ensemble_validation, labels
    )

    replay_members = {k: v for k, v in members.items() if k in REPLAY_SAFE_MEMBERS}
    if replay_members:
        bundle.replay_ensemble = ProbabilityEnsemble.from_config().fit(
            replay_members, label_index
        )
        bundle.replay_calibrator = MulticlassCalibrator(calibration_method).fit(
            bundle.replay_ensemble.predict_proba(replay_members), labels
        )

    # ---- BTTS / over-under blends -----------------------------------------
    btts_members, ou_members = _validation_goal_members(
        inner, validation, match_inner, match_validation, columns, config
    )
    if btts_members:
        btts_truth = ((validation["target_home_goals"] > 0) &
                      (validation["target_away_goals"] > 0)).astype(int).to_numpy()
        ou_truth = ((validation["target_home_goals"] +
                     validation["target_away_goals"]) > 2.5).astype(int).to_numpy()
        bundle.btts_ensemble = BinaryEnsemble().fit(btts_members, btts_truth)
        bundle.ou_ensemble = BinaryEnsemble().fit(ou_members, ou_truth)
        bundle.btts_calibrator = BinaryCalibrator(calibration_method).fit(
            bundle.btts_ensemble.predict(btts_members), btts_truth
        )
        bundle.ou_calibrator = BinaryCalibrator(calibration_method).fit(
            bundle.ou_ensemble.predict(ou_members), ou_truth
        )

    # The confidence layer discounts a model measured as poorly calibrated, so
    # it needs a real number rather than an assumption. This is the ensemble's
    # calibration error on the validation window - out of sample, and computed
    # here rather than left for the serving layer to guess at.
    ensemble_ece = float(np.nanmean([
        expected_calibration_error(ensemble_validation[:, i], (labels == cls).astype(float))
        for i, cls in enumerate(("H", "U", "B"))
    ]))

    bundle.matches = matches
    bundle.metadata = {
        "ensemble_ece": round(ensemble_ece, 5),
        "n_matches": int(len(matches)),
        "validation_from": validation_start.strftime("%Y-%m-%d"),
        "validation_matches": int(len(validation)),
        "ensemble_weights": bundle.ensemble.weight_table(),
        "replay_weights": (
            bundle.replay_ensemble.weight_table() if bundle.replay_ensemble else {}
        ),
        "calibration_method": calibration_method,
        "dixon_coles_rho": float(bundle.dixon_coles.rho),
        "home_advantage": float(bundle.dixon_coles.home_advantage),
        "half_shares": bundle.halves.half_shares() if bundle.halves else {},
        "training_seconds": round(time.time() - started, 1),
    }

    if save:
        path = bundle.path()
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(bundle, path, compress=3)
        log.info("saved %s", path)
    return bundle


def _validation_members(inner, validation, match_inner, match_validation,
                        columns, config) -> dict[str, np.ndarray]:
    """Out-of-sample validation predictions from every member."""
    from .evaluation.backtest import predict_statistical

    members: dict[str, np.ndarray] = {}
    for kind in ("poisson", "dixon_coles"):
        predictions = predict_statistical(
            match_inner, match_validation, kind=kind,
            interval_days=config.refit_interval_days, with_halves=False,
        )
        if predictions is not None and len(predictions) == len(validation):
            members[kind] = predictions.hub

    members["elo"] = EloOutcomeModel().fit_frame(inner).predict_frame(validation)

    data = _recent_years(inner, config.ml_train_seasons)
    for model_id in config.ml_models:
        try:
            model = MLResultModel(model_id).fit(data[columns], data["target_result"])
            members[model_id] = model.predict_proba(validation[columns])
        except Exception:
            log.exception("validation fit failed for %s", model_id)
    try:
        goals = MLGoalModel(GOAL_ML_ID).fit(
            data[columns], data["target_home_goals"], data["target_away_goals"]
        )
        members[f"{GOAL_ML_ID}_goals"] = goals.predict_proba(validation[columns])
    except Exception:
        log.exception("validation fit failed for ML goal model")
    return members


def _validation_goal_members(inner, validation, match_inner, match_validation,
                             columns, config):
    from .evaluation.backtest import predict_statistical

    btts: dict[str, np.ndarray] = {}
    totals: dict[str, np.ndarray] = {}
    for kind in ("poisson", "dixon_coles"):
        predictions = predict_statistical(
            match_inner, match_validation, kind=kind,
            interval_days=config.refit_interval_days, with_halves=False,
        )
        if predictions is not None and len(predictions) == len(validation):
            btts[kind] = predictions.btts
            totals[kind] = predictions.totals[2.5]

    data = _recent_years(inner, config.ml_train_seasons)
    try:
        goals = MLGoalModel(GOAL_ML_ID).fit(
            data[columns], data["target_home_goals"], data["target_away_goals"]
        )
        book = MarketPredictions.from_matrices(goals.score_matrices(validation[columns]))
        btts[GOAL_ML_ID] = book.btts
        totals[GOAL_ML_ID] = book.totals[2.5]
    except Exception:
        log.exception("validation goal-model fit failed")
    return btts, totals


class StaleBundleError(RuntimeError):
    """A saved bundle predates a change inference cannot work around."""


def load_bundle(path: Path | None = None) -> TrainedBundle:
    path = path or (model_dir() / BUNDLE_NAME)
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found - run `python scripts/train.py` first"
        )
    bundle = joblib.load(path)
    version = getattr(bundle, "version", "0.0.0")
    if _version_tuple(version) < _version_tuple(MIN_BUNDLE_VERSION):
        raise StaleBundleError(
            f"{path} was written by version {version}, and this build needs "
            f"{MIN_BUNDLE_VERSION} or newer. Serving it would misread the "
            "stored state rather than fail outright. Retrain with "
            "`python scripts/train.py`."
        )
    return bundle


def _version_tuple(version: str) -> tuple[int, ...]:
    try:
        return tuple(int(part) for part in str(version).split("."))
    except ValueError:
        return (0,)
