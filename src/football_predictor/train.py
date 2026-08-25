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
from .evaluation.backtest import GOAL_ML_ID, BacktestConfig
from .features.builder import FeatureBuilder, feature_columns
from .models.base import MarketPredictions
from .models.calibration import BinaryCalibrator, MulticlassCalibrator
from .models.dixon_coles import DixonColesModel, GoalModelConfig, PoissonModel
from .models.elo_model import EloOutcomeModel
from .models.ensemble import BinaryEnsemble, ProbabilityEnsemble
from .models.halves import HalvesModel
from .models.ml import MLGoalModel, MLResultModel
from .normalize.seasons import season_start_year
from .pipeline import load_dataset

log = logging.getLogger(__name__)

BUNDLE_NAME = "predictor.joblib"

#: Members that can be honestly replayed to any historical date, because they
#: are refitted from scratch on data before that date at prediction time.
REPLAY_SAFE_MEMBERS = ("poisson", "dixon_coles", "elo")


@dataclass
class TrainedBundle:
    """Everything inference needs."""

    version: str = "1.0.0"
    trained_at: pd.Timestamp | None = None
    trained_through: pd.Timestamp | None = None
    seasons: list[str] = field(default_factory=list)
    competitions: list[str] = field(default_factory=list)
    feature_names: list[str] = field(default_factory=list)

    builder: FeatureBuilder | None = None
    builder_snapshots: dict[str, FeatureBuilder] = field(default_factory=dict)

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

    seasons = sorted(matches["season"].unique(), key=season_start_year)
    validation_labels = seasons[-validation_seasons:]
    inner_seasons = [s for s in seasons if s not in validation_labels]

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
    feature_rows: list[dict] = []
    ordered = matches.sort_values(["date", "competition", "home_team"], kind="mergesort")
    current_season = None
    for _, row in ordered.iterrows():
        season = str(row["season"])
        if season != current_season:
            snapshots[season] = copy.deepcopy(builder)
            current_season = season
        feature_rows.append(builder._row_features(row))
        if not pd.isna(row["home_goals"]):
            builder._observe(row)
    features = pd.DataFrame(feature_rows, index=ordered.index).reindex(matches.index)
    bundle.builder = builder
    # Only recent snapshots are kept: replaying a 1990s fixture is not a use
    # case worth carrying 30 deep-copied states for.
    bundle.builder_snapshots = {s: snapshots[s] for s in seasons[-8:] if s in snapshots}

    features = features[features["target_result"].notna()].copy()
    columns = feature_columns(features)
    bundle.feature_names = columns

    inner = features[features["season"].isin(inner_seasons)]
    validation = features[features["season"].isin(validation_labels)]
    match_inner = matches[matches["season"].isin(inner_seasons)]
    match_validation = matches[matches["season"].isin(validation_labels)]

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
    recent = set(seasons[-config.ml_train_seasons:])
    ml_data = features[features["season"].isin(recent)]
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
    log.info("fitting ensemble weights and calibrators on %s", validation_labels)
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

    bundle.matches = matches
    bundle.metadata = {
        "n_matches": int(len(matches)),
        "validation_seasons": validation_labels,
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

    seasons = sorted(inner["season"].unique(), key=season_start_year)
    recent = set(seasons[-config.ml_train_seasons:])
    data = inner[inner["season"].isin(recent)]
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

    seasons = sorted(inner["season"].unique(), key=season_start_year)
    recent = set(seasons[-config.ml_train_seasons:])
    data = inner[inner["season"].isin(recent)]
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


def load_bundle(path: Path | None = None) -> TrainedBundle:
    path = path or (model_dir() / BUNDLE_NAME)
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found - run `python scripts/train.py` first"
        )
    return joblib.load(path)
