"""Walk-forward backtesting.

The only honest way to test a football model is the way it would actually be
used: train on the past, predict the next season, move forward, repeat. Every
number in docs/BENCHMARK.md comes from this module.

Each test season is handled in two stages:

1. **Validation stage.** Base models are fitted on everything up to a
   validation window, and predict that window. Ensemble weights and
   probability calibrators are fitted on those out-of-sample predictions.
2. **Test stage.** Base models are refitted on everything before the test
   season and predict it. The weights and calibrators from stage 1 are applied
   unchanged.

The test season is never seen by anything that was fitted - not the models,
not the blend weights, not the calibrators.

Statistical models are refitted at a fixed interval *inside* the test season,
each time using only matches before the refit date, because their team
parameters are the model's memory and would otherwise go stale by May. ML
models carry their recency through the rolling features instead, and are
refitted once per season.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..config import load_model_config
from ..features.builder import feature_columns
from ..models.base import MarketPredictions
from ..models.calibration import BinaryCalibrator, MulticlassCalibrator
from ..models.dixon_coles import DixonColesModel, GoalModelConfig, PoissonModel
from ..models.elo_model import EloOutcomeModel
from ..models.ensemble import BinaryEnsemble, ProbabilityEnsemble
from ..models.halves import HalvesModel
from ..models.ml import CLASSIFIER_IDS, MLGoalModel, MLResultModel
from ..models.score_matrix import ScoreMatrix
from ..normalize.seasons import season_start_year
from .metrics import (
    binary_report, exact_score_hit_rate, goal_report, multiclass_report,
    naive_baseline, to_index,
)

log = logging.getLogger(__name__)

STAT_MODELS = ("poisson", "dixon_coles")
GOAL_ML_ID = "lightgbm"          # ML model used for the goal-rate route


@dataclass
class BacktestConfig:
    first_test_season: str = "2015/16"
    last_test_season: str = "2025/26"
    validation_seasons: int = 2
    burn_in_seasons: int = 3
    refit_interval_days: int = 30
    ml_train_seasons: int = 8
    ml_models: tuple[str, ...] = CLASSIFIER_IDS
    calibration_method: str = "isotonic"

    @classmethod
    def from_config(cls) -> "BacktestConfig":
        cfg = load_model_config().get("backtest", {}) or {}
        calibration = (load_model_config().get("calibration", {}) or {})
        return cls(
            first_test_season=str(cfg.get("first_test_season", "2015/16")),
            last_test_season=str(cfg.get("last_test_season", "2025/26")),
            validation_seasons=int(cfg.get("validation_seasons", 2)),
            burn_in_seasons=int(cfg.get("burn_in_seasons", 3)),
            refit_interval_days=int(cfg.get("refit_interval_days", 30)),
            ml_train_seasons=int(cfg.get("ml_train_seasons", 8)),
            calibration_method=str(calibration.get("method", "isotonic")),
        )


# -- statistical model prediction with periodic refit ------------------------
def _refit_blocks(target: pd.DataFrame, interval_days: int):
    """Split a frame into consecutive date blocks for periodic refitting."""
    if target.empty:
        return
    ordered = target.sort_values("date")
    start = ordered["date"].iloc[0]
    end = ordered["date"].iloc[-1]
    while start <= end:
        stop = start + pd.Timedelta(days=interval_days)
        block = ordered[(ordered["date"] >= start) & (ordered["date"] < stop)]
        if len(block):
            yield start, block
        start = stop


def predict_statistical(
    history: pd.DataFrame,
    target: pd.DataFrame,
    *,
    kind: str = "dixon_coles",
    interval_days: int = 30,
    with_halves: bool = True,
) -> MarketPredictions | None:
    """Predict ``target`` with a goal model refitted every ``interval_days``.

    ``history`` supplies the training matches; only rows dated before each
    block's start are ever used, so a block cannot learn from itself.
    """
    pool = pd.concat([history, target], ignore_index=True)
    full_time: dict = {}
    first_half: dict = {}
    second_half: dict = {}

    for block_start, block in _refit_blocks(target, interval_days):
        train = pool[pool["date"] < block_start]
        if len(train) < 200:
            continue
        try:
            if kind == "poisson":
                model = PoissonModel().fit(train, reference_date=block_start)
            else:
                model = DixonColesModel(
                    GoalModelConfig.from_config("dixon_coles")
                ).fit(train, reference_date=block_start)
        except ValueError:
            continue

        halves = None
        if with_halves:
            try:
                halves = HalvesModel.from_config().fit(train, reference_date=block_start)
            except ValueError:
                halves = None

        for row in block.itertuples(index=True):
            neutral = bool(getattr(row, "neutral_venue", False))
            full_time[row.Index] = model.score_matrix(
                row.home_team, row.away_team, neutral=neutral
            )
            if halves is not None:
                first_half[row.Index] = halves.first_half_matrix(
                    row.home_team, row.away_team, neutral=neutral
                )
                second_half[row.Index] = halves.second_half_matrix(
                    row.home_team, row.away_team, neutral=neutral
                )

    covered = [i for i in target.index if i in full_time]
    if not covered:
        return None
    ft = [full_time[i] for i in covered]
    fh = [first_half[i] for i in covered] if len(first_half) == len(covered) else None
    sh = [second_half[i] for i in covered] if len(second_half) == len(covered) else None
    predictions = MarketPredictions.from_matrices(ft, fh, sh)
    predictions.index = pd.Index(covered)          # type: ignore[attr-defined]
    return predictions


def _align(predictions: MarketPredictions, index: pd.Index) -> np.ndarray:
    """Boolean mask of ``index`` rows this prediction batch actually covers."""
    covered = getattr(predictions, "index", None)
    if covered is None:
        return np.ones(len(index), dtype=bool)
    return index.isin(covered)



def _binary_members(
    statistical: dict[str, MarketPredictions], index: pd.Index
) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    """BTTS and over-2.5 arrays from the goal models that cover every row."""
    btts: dict[str, np.ndarray] = {}
    totals: dict[str, np.ndarray] = {}
    for name, predictions in statistical.items():
        if _align(predictions, index).all():
            btts[name] = predictions.btts
            totals[name] = predictions.totals[2.5]
    return btts, totals


# -- evaluation of one model on one fold -------------------------------------
def evaluate_markets(
    predictions: MarketPredictions, truth: pd.DataFrame
) -> dict[str, float]:
    """Score every market this system quotes against what happened."""
    out: dict[str, float] = {"n": int(len(truth))}
    out.update({f"hub_{k}": v for k, v in
                multiclass_report(predictions.hub, truth["target_result"]).items()})

    total_goals = truth["target_home_goals"] + truth["target_away_goals"]
    btts_truth = ((truth["target_home_goals"] > 0) & (truth["target_away_goals"] > 0)).astype(int)
    out.update({f"btts_{k}": v for k, v in
                binary_report(predictions.btts, btts_truth.to_numpy()).items()})

    for line, probs in predictions.totals.items():
        outcome = (total_goals > line).astype(int).to_numpy()
        report = binary_report(probs, outcome)
        out[f"ou{line}_log_loss"] = report["log_loss"]
        out[f"ou{line}_brier"] = report["brier"]
        out[f"ou{line}_accuracy"] = report["accuracy"]
        out[f"ou{line}_ece"] = report["ece"]

    for side, book in (("home", predictions.home_goals_over),
                       ("away", predictions.away_goals_over)):
        goals = truth[f"target_{side}_goals"]
        for line, probs in book.items():
            report = binary_report(probs, (goals > line).astype(int).to_numpy())
            out[f"{side}_goals_o{line}_log_loss"] = report["log_loss"]
            out[f"{side}_goals_o{line}_accuracy"] = report["accuracy"]

    out.update({f"home_goals_{k}": v for k, v in
                goal_report(predictions.home_rate, truth["target_home_goals"]).items()})
    out.update({f"away_goals_{k}": v for k, v in
                goal_report(predictions.away_rate, truth["target_away_goals"]).items()})
    out["exact_score_hit_rate"] = exact_score_hit_rate(
        predictions.top_score, truth["target_home_goals"], truth["target_away_goals"]
    )

    # -- half-time markets, where the source supplied half-time scores
    has_ht = truth["target_ht_home_goals"].notna().to_numpy()
    if predictions.ht_hub is not None and has_ht.sum() >= 50:
        ht_home = truth.loc[has_ht, "target_ht_home_goals"]
        ht_away = truth.loc[has_ht, "target_ht_away_goals"]
        ht_result = np.where(ht_home > ht_away, "H",
                             np.where(ht_home == ht_away, "U", "B"))
        report = multiclass_report(predictions.ht_hub[has_ht], ht_result)
        out.update({f"ht_hub_{k}": v for k, v in report.items()})
        out["ht_n"] = int(has_ht.sum())

        ht_total = (ht_home + ht_away).to_numpy()
        for line, probs in predictions.ht_totals.items():
            sub = binary_report(probs[has_ht], (ht_total > line).astype(int))
            out[f"ht_ou{line}_log_loss"] = sub["log_loss"]
            out[f"ht_ou{line}_accuracy"] = sub["accuracy"]
        if predictions.ht_btts is not None:
            sub = binary_report(
                predictions.ht_btts[has_ht],
                ((ht_home > 0) & (ht_away > 0)).astype(int).to_numpy(),
            )
            out["ht_btts_log_loss"] = sub["log_loss"]
            out["ht_btts_accuracy"] = sub["accuracy"]

        sh_home = (truth.loc[has_ht, "target_home_goals"] - ht_home).to_numpy()
        sh_away = (truth.loc[has_ht, "target_away_goals"] - ht_away).to_numpy()
        for line, probs in predictions.sh_totals.items():
            sub = binary_report(probs[has_ht], ((sh_home + sh_away) > line).astype(int))
            out[f"sh_ou{line}_log_loss"] = sub["log_loss"]
            out[f"sh_ou{line}_accuracy"] = sub["accuracy"]
    return out


# -- one walk-forward fold ---------------------------------------------------
@dataclass
class FoldResult:
    season: str
    n_test: int
    metrics: dict[str, dict[str, float]] = field(default_factory=dict)
    ensemble_weights: dict[str, float] = field(default_factory=dict)
    predictions: pd.DataFrame | None = None


@dataclass(frozen=True)
class Window:
    """One walk-forward fold, expressed as dates rather than season labels.

    Season labels cannot define the folds once competitions with different
    calendars are mixed. Eliteserien's "2015" runs March to November 2015 and
    the Premier League's "2015/16" runs August 2015 to May 2016: they overlap,
    so a fold built from labels would train on matches played *after* some of
    the matches it tests. Splitting on dates removes the question - every
    training match precedes every test match, whatever calendar it came from.
    """

    label: str
    test_start: pd.Timestamp
    test_end: pd.Timestamp
    validation_start: pd.Timestamp

    @property
    def train_end(self) -> pd.Timestamp:
        return self.test_start


def build_windows(
    matches: pd.DataFrame, config: BacktestConfig
) -> list[Window]:
    """Yearly test windows running 1 July to 30 June."""
    first = season_start_year(config.first_test_season)
    last = season_start_year(config.last_test_season)
    earliest = pd.Timestamp(matches["date"].min())
    latest = pd.Timestamp(matches["date"].max())

    windows = []
    for year in range(first, last + 1):
        test_start = pd.Timestamp(year=year, month=7, day=1)
        test_end = pd.Timestamp(year=year + 1, month=7, day=1)
        if test_start > latest:
            break
        validation_start = pd.Timestamp(
            year=year - config.validation_seasons, month=7, day=1
        )
        # Enough history before the validation window to fit anything on.
        if validation_start - pd.DateOffset(years=config.burn_in_seasons) < earliest:
            continue
        windows.append(
            Window(
                label=f"{year}/{str(year + 1)[2:]}",
                test_start=test_start,
                test_end=test_end,
                validation_start=validation_start,
            )
        )
    return windows



def _recent_years(frame: pd.DataFrame, years: int) -> pd.DataFrame:
    """The last ``years`` of matches in ``frame``, by date."""
    if frame.empty or years <= 0:
        return frame
    cutoff = pd.Timestamp(frame["date"].max()) - pd.DateOffset(years=years)
    return frame[frame["date"] >= cutoff]


def _fit_ml_members(
    train: pd.DataFrame, columns: list[str], config: BacktestConfig, rho: float
) -> dict[str, object]:
    """Fit the ML members on the most recent ``ml_train_seasons`` years.

    Selected by date rather than by season label, so a calendar-year league
    contributes the same span of history as a split-season one.
    """
    data = _recent_years(train, config.ml_train_seasons)
    X, y = data[columns], data["target_result"]

    members: dict[str, object] = {}
    for model_id in config.ml_models:
        try:
            members[model_id] = MLResultModel(model_id).fit(X, y)
        except Exception:
            log.exception("failed to fit %s", model_id)
    try:
        members[f"{GOAL_ML_ID}_goals"] = MLGoalModel(GOAL_ML_ID).fit(
            X, data["target_home_goals"], data["target_away_goals"], rho=rho
        )
    except Exception:
        log.exception("failed to fit ML goal model")
    return members


def _ml_hub_predictions(
    members: dict[str, object], X: pd.DataFrame
) -> dict[str, np.ndarray]:
    out = {}
    for name, model in members.items():
        try:
            out[name] = model.predict_proba(X)
        except Exception:
            log.exception("failed to predict with %s", name)
    return out


def run_fold(
    features: pd.DataFrame,
    matches: pd.DataFrame,
    window: Window,
    config: BacktestConfig,
    *,
    keep_predictions: bool = False,
) -> FoldResult | None:
    """Train, validate and test one date window."""
    columns = feature_columns(features)

    def slice_by_date(frame, start=None, end=None):
        mask = pd.Series(True, index=frame.index)
        if start is not None:
            mask &= frame["date"] >= start
        if end is not None:
            mask &= frame["date"] < end
        return frame[mask]

    test = slice_by_date(features, window.test_start, window.test_end)
    if test.empty:
        return None
    train = slice_by_date(features, None, window.test_start)
    inner = slice_by_date(features, None, window.validation_start)
    validation = slice_by_date(features, window.validation_start, window.test_start)
    if inner.empty or validation.empty:
        return None

    match_train = slice_by_date(matches, None, window.test_start)
    match_inner = slice_by_date(matches, None, window.validation_start)
    match_validation = slice_by_date(matches, window.validation_start, window.test_start)
    match_test = slice_by_date(matches, window.test_start, window.test_end)

    started = time.time()
    result = FoldResult(season=window.label, n_test=len(test))

    # ---- stage 1: validation predictions -> blend weights + calibrators ----
    validation_members: dict[str, np.ndarray] = {}
    stat_validation: dict[str, MarketPredictions] = {}
    for kind in STAT_MODELS:
        predictions = predict_statistical(
            match_inner, match_validation, kind=kind,
            interval_days=config.refit_interval_days,
        )
        if predictions is not None:
            stat_validation[kind] = predictions
            mask = _align(predictions, validation.index)
            if mask.all():
                validation_members[kind] = predictions.hub

    elo_model = EloOutcomeModel().fit_frame(inner)
    validation_members["elo"] = elo_model.predict_frame(validation)

    rho = getattr(stat_validation.get("dixon_coles"), "rho", 0.0) or -0.03
    ml_members = _fit_ml_members(inner, columns, config, rho=rho)
    validation_members.update(_ml_hub_predictions(ml_members, validation[columns]))

    validation_labels = to_index(validation["target_result"])
    ensemble = ProbabilityEnsemble.from_config().fit(validation_members, validation_labels)

    calibrators: dict[str, MulticlassCalibrator] = {}
    for name, probs in validation_members.items():
        calibrators[name] = MulticlassCalibrator(config.calibration_method).fit(
            probs, validation["target_result"].to_numpy()
        )
    ensemble_validation = ensemble.predict_proba(validation_members)
    calibrators["ensemble"] = MulticlassCalibrator(config.calibration_method).fit(
        ensemble_validation, validation["target_result"].to_numpy()
    )
    # Both post-hoc methods are carried through to the test fold so the
    # benchmark can report which one actually helps, rather than assuming.
    alternative_calibrators = {
        method: MulticlassCalibrator(method).fit(
            ensemble_validation, validation["target_result"].to_numpy()
        )
        for method in ("isotonic", "platt")
    }

    # BTTS and over-2.5 get their own blend of the statistical and ML routes.
    # Only fully-covering members may join: a goal model that could not price
    # every validation fixture returns a shorter array, and blending it against
    # one that could would silently compare different sets of matches.
    btts_members_val, ou_members_val = _binary_members(stat_validation, validation.index)
    goal_model = ml_members.get(f"{GOAL_ML_ID}_goals")
    if goal_model is not None:
        matrices = goal_model.score_matrices(validation[columns])
        book = MarketPredictions.from_matrices(matrices)
        btts_members_val[GOAL_ML_ID] = book.btts
        ou_members_val[GOAL_ML_ID] = book.totals[2.5]

    btts_truth_val = ((validation["target_home_goals"] > 0) &
                      (validation["target_away_goals"] > 0)).astype(int).to_numpy()
    ou_truth_val = ((validation["target_home_goals"] +
                     validation["target_away_goals"]) > 2.5).astype(int).to_numpy()
    btts_ensemble = BinaryEnsemble().fit(btts_members_val, btts_truth_val)
    ou_ensemble = BinaryEnsemble().fit(ou_members_val, ou_truth_val)
    btts_calibrator = BinaryCalibrator(config.calibration_method).fit(
        btts_ensemble.predict(btts_members_val), btts_truth_val
    )
    ou_calibrator = BinaryCalibrator(config.calibration_method).fit(
        ou_ensemble.predict(ou_members_val), ou_truth_val
    )

    # ---- stage 2: refit on all training seasons, predict the test season ----
    test_members: dict[str, np.ndarray] = {}
    stat_test: dict[str, MarketPredictions] = {}
    for kind in STAT_MODELS:
        predictions = predict_statistical(
            match_train, match_test, kind=kind,
            interval_days=config.refit_interval_days,
        )
        if predictions is not None:
            stat_test[kind] = predictions
            if _align(predictions, test.index).all():
                test_members[kind] = predictions.hub

    elo_model_full = EloOutcomeModel().fit_frame(train)
    test_members["elo"] = elo_model_full.predict_frame(test)
    rho_full = getattr(stat_test.get("dixon_coles"), "rho", 0.0) or rho
    ml_members_full = _fit_ml_members(train, columns, config, rho=rho_full)
    test_members.update(_ml_hub_predictions(ml_members_full, test[columns]))

    missing = set(ensemble.member_names) - set(test_members)
    if missing:
        log.warning("season %s missing members %s, refitting blend", window.label, missing)
        available = {k: v for k, v in validation_members.items() if k in test_members}
        ensemble = ProbabilityEnsemble.from_config().fit(available, validation_labels)

    # ---- scoring ----------------------------------------------------------
    truth = test
    # The floor every model has to clear: the base rates of the three outcomes
    # as they stood in the training data, quoted for every test fixture.
    base_rates = naive_baseline(train["target_result"])[0]
    naive = np.tile(base_rates, (len(truth), 1))
    result.metrics["naive"] = {
        **multiclass_report(naive, truth["target_result"]), "n": len(truth)
    }

    for name, probs in test_members.items():
        report = multiclass_report(probs, truth["target_result"])
        report["n"] = len(truth)
        result.metrics[name] = report
        calibrated = calibrators[name].transform(probs) if name in calibrators else probs
        calibrated_report = multiclass_report(calibrated, truth["target_result"])
        result.metrics[f"{name}_calibrated"] = {**calibrated_report, "n": len(truth)}

    ensemble_test = ensemble.predict_proba(
        {k: test_members[k] for k in ensemble.member_names}
    )
    result.metrics["ensemble"] = {
        **multiclass_report(ensemble_test, truth["target_result"]), "n": len(truth)
    }
    ensemble_calibrated = calibrators["ensemble"].transform(ensemble_test)
    result.metrics["ensemble_calibrated"] = {
        **multiclass_report(ensemble_calibrated, truth["target_result"]), "n": len(truth)
    }
    for method, calibrator in alternative_calibrators.items():
        result.metrics[f"ensemble_{method}"] = {
            **multiclass_report(calibrator.transform(ensemble_test),
                                truth["target_result"]),
            "n": len(truth),
        }
    result.ensemble_weights = ensemble.weight_table()

    # full market book for the statistical models and the ML goal route
    for kind, predictions in stat_test.items():
        mask = _align(predictions, test.index)
        result.metrics[f"{kind}_markets"] = evaluate_markets(predictions, truth[mask])

    goal_model_full = ml_members_full.get(f"{GOAL_ML_ID}_goals")
    if goal_model_full is not None:
        matrices = goal_model_full.score_matrices(test[columns])
        book = MarketPredictions.from_matrices(matrices)
        result.metrics[f"{GOAL_ML_ID}_goals_markets"] = evaluate_markets(book, truth)
        btts_members_test, ou_members_test = _binary_members(stat_test, test.index)
        btts_members_test[GOAL_ML_ID] = book.btts
        ou_members_test[GOAL_ML_ID] = book.totals[2.5]

        btts_truth = ((truth["target_home_goals"] > 0) &
                      (truth["target_away_goals"] > 0)).astype(int).to_numpy()
        ou_truth = ((truth["target_home_goals"] +
                     truth["target_away_goals"]) > 2.5).astype(int).to_numpy()
        if set(btts_ensemble.member_names) <= set(btts_members_test):
            raw = btts_ensemble.predict(btts_members_test)
            result.metrics["btts_ensemble"] = binary_report(raw, btts_truth)
            result.metrics["btts_ensemble_calibrated"] = binary_report(
                btts_calibrator.transform(raw), btts_truth
            )
        if set(ou_ensemble.member_names) <= set(ou_members_test):
            raw = ou_ensemble.predict(ou_members_test)
            result.metrics["ou2.5_ensemble"] = binary_report(raw, ou_truth)
            result.metrics["ou2.5_ensemble_calibrated"] = binary_report(
                ou_calibrator.transform(raw), ou_truth
            )

    if keep_predictions:
        frame = truth[["match_id", "date", "competition", "season", "home_team",
                       "away_team", "target_result", "target_home_goals",
                       "target_away_goals"]].copy()
        frame[["p_H", "p_U", "p_B"]] = ensemble_calibrated
        for i, cls in enumerate("HUB"):
            frame[f"raw_{cls}"] = ensemble_test[:, i]
        result.predictions = frame

    log.info("season %s done in %.1fs", window.label, time.time() - started)
    return result


def run_backtest(
    features: pd.DataFrame,
    matches: pd.DataFrame,
    config: BacktestConfig | None = None,
    *,
    keep_predictions: bool = False,
    progress=None,
) -> list[FoldResult]:
    config = config or BacktestConfig.from_config()
    results = []
    for window in build_windows(matches, config):
        if progress:
            progress(window.label)
        fold = run_fold(features, matches, window, config,
                        keep_predictions=keep_predictions)
        if fold is not None:
            results.append(fold)
    return results


def aggregate(results: list[FoldResult], key: str = "hub") -> pd.DataFrame:
    """Sample-size-weighted average of a metric family across folds."""
    rows: dict[str, dict[str, float]] = {}
    weights: dict[str, float] = {}
    for fold in results:
        for model, metrics in fold.metrics.items():
            n = float(metrics.get("n", fold.n_test) or 0)
            if not n:
                continue
            bucket = rows.setdefault(model, {})
            weights[model] = weights.get(model, 0.0) + n
            for name, value in metrics.items():
                if name == "n" or value is None or not np.isfinite(value):
                    continue
                bucket[name] = bucket.get(name, 0.0) + value * n
    out = []
    for model, bucket in rows.items():
        total = weights[model]
        record = {"model": model, "n": int(total)}
        record.update({k: v / total for k, v in bucket.items()})
        out.append(record)
    return pd.DataFrame(out).set_index("model").sort_index()
