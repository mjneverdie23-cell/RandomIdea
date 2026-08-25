"""Machine-learning models over the engineered feature matrix.

Two complementary jobs:

* :class:`MLResultModel` classifies the three-way HUB outcome directly.
* :class:`MLGoalModel` fits two Poisson-objective regressors, one per side,
  producing expected goals. Those feed the same :class:`ScoreMatrix`
  machinery the statistical models use, so an ML model can quote BTTS,
  over/under, team totals and exact scores without a separate classifier per
  line - and every market it quotes stays mutually consistent.

A direct BTTS / over-2.5 classifier is also provided, so the backtest can
check whether modelling the goal distribution beats modelling the market
outcome directly. That comparison is reported in docs/BENCHMARK.md rather
than assumed either way.

Tree models see raw features including missing values, which XGBoost,
LightGBM and CatBoost all handle natively; linear and forest models get
median imputation, and the linear model additionally gets standardised.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, PoissonRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from ..config import load_model_config
from .score_matrix import DEFAULT_MAX_GOALS, ScoreMatrix

log = logging.getLogger(__name__)

RESULT_CLASSES: tuple[str, str, str] = ("H", "U", "B")

#: Model ids available to the ensemble and the benchmark.
CLASSIFIER_IDS = ("logistic", "random_forest", "xgboost", "lightgbm", "catboost")


def _cfg(name: str) -> dict:
    ml = load_model_config().get("ml", {}) or {}
    return dict(ml.get(name, {}) or {})


def _seed() -> int:
    return int((load_model_config().get("ml", {}) or {}).get("random_state", 42))


def build_classifier(model_id: str):
    """Instantiate one classifier by id."""
    seed = _seed()
    if model_id == "logistic":
        params = _cfg("logistic")
        return Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
            ("model", LogisticRegression(random_state=seed, **params)),
        ])
    if model_id == "random_forest":
        params = _cfg("random_forest")
        return Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("model", RandomForestClassifier(random_state=seed, **params)),
        ])
    if model_id == "xgboost":
        from xgboost import XGBClassifier
        return XGBClassifier(
            objective="multi:softprob", num_class=3, random_state=seed,
            n_jobs=-1, tree_method="hist", eval_metric="mlogloss", **_cfg("xgboost"),
        )
    if model_id == "lightgbm":
        from lightgbm import LGBMClassifier
        return LGBMClassifier(
            objective="multiclass", num_class=3, random_state=seed,
            n_jobs=-1, verbose=-1, **_cfg("lightgbm"),
        )
    if model_id == "catboost":
        from catboost import CatBoostClassifier
        return CatBoostClassifier(
            loss_function="MultiClass", random_seed=seed, verbose=False,
            allow_writing_files=False, **_cfg("catboost"),
        )
    raise ValueError(f"unknown classifier id: {model_id!r}")


def build_count_regressor(model_id: str):
    """Instantiate one Poisson-objective goal regressor by id."""
    seed = _seed()
    if model_id == "logistic":                      # linear Poisson GLM
        return Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
            ("model", PoissonRegressor(alpha=1e-3, max_iter=1000)),
        ])
    if model_id == "random_forest":
        params = _cfg("random_forest")
        return Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("model", RandomForestRegressor(random_state=seed, **params)),
        ])
    if model_id == "xgboost":
        from xgboost import XGBRegressor
        return XGBRegressor(
            objective="count:poisson", random_state=seed, n_jobs=-1,
            tree_method="hist", **_cfg("xgboost"),
        )
    if model_id == "lightgbm":
        from lightgbm import LGBMRegressor
        return LGBMRegressor(
            objective="poisson", random_state=seed, n_jobs=-1, verbose=-1,
            **_cfg("lightgbm"),
        )
    if model_id == "catboost":
        from catboost import CatBoostRegressor
        return CatBoostRegressor(
            loss_function="Poisson", random_seed=seed, verbose=False,
            allow_writing_files=False, **_cfg("catboost"),
        )
    raise ValueError(f"unknown regressor id: {model_id!r}")


@dataclass
class MLResultModel:
    """Three-way HUB classifier."""

    model_id: str = "xgboost"
    feature_names: list[str] = field(default_factory=list)
    estimator: object = None
    classes_: list[str] = field(default_factory=lambda: list(RESULT_CLASSES))

    @property
    def name(self) -> str:
        return self.model_id

    def fit(self, X: pd.DataFrame, y: pd.Series) -> "MLResultModel":
        self.feature_names = list(X.columns)
        self.estimator = build_classifier(self.model_id)
        encoded = pd.Series(y).map({c: i for i, c in enumerate(RESULT_CLASSES)})
        self.estimator.fit(self._prepare(X), encoded.to_numpy())
        return self

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        probs = np.asarray(self.estimator.predict_proba(self._prepare(X)), dtype=float)
        if probs.ndim == 3:                      # CatBoost multiclass shape
            probs = probs.reshape(len(X), -1)
        probs = np.clip(probs, 1e-9, 1.0)
        return probs / probs.sum(axis=1, keepdims=True)

    def _prepare(self, X: pd.DataFrame) -> pd.DataFrame:
        return X.reindex(columns=self.feature_names).astype(float)

    def feature_importance(self) -> pd.Series:
        estimator = self.estimator
        if isinstance(estimator, Pipeline):
            estimator = estimator.named_steps["model"]
        values = getattr(estimator, "feature_importances_", None)
        if values is None:
            coef = getattr(estimator, "coef_", None)
            if coef is None:
                return pd.Series(dtype=float)
            values = np.abs(np.asarray(coef)).mean(axis=0)
        return pd.Series(values, index=self.feature_names).sort_values(ascending=False)


@dataclass
class MLGoalModel:
    """Two Poisson regressors giving expected goals for each side.

    Predicting the goal *rates* rather than the outcome lets a gradient
    boosting model quote the whole market book through the shared score
    matrix, instead of needing one classifier per line.
    """

    model_id: str = "xgboost"
    max_goals: int = DEFAULT_MAX_GOALS
    rho: float = 0.0
    feature_names: list[str] = field(default_factory=list)
    home_estimator: object = None
    away_estimator: object = None

    @property
    def name(self) -> str:
        return f"{self.model_id}_goals"

    def fit(
        self, X: pd.DataFrame, home_goals: pd.Series, away_goals: pd.Series,
        *, rho: float = 0.0,
    ) -> "MLGoalModel":
        self.feature_names = list(X.columns)
        prepared = self._prepare(X)
        self.home_estimator = build_count_regressor(self.model_id)
        self.away_estimator = build_count_regressor(self.model_id)
        self.home_estimator.fit(prepared, np.asarray(home_goals, dtype=float))
        self.away_estimator.fit(prepared, np.asarray(away_goals, dtype=float))
        # rho is carried over from the statistical fit: the low-score
        # dependence is a property of football, not of the estimator.
        self.rho = float(rho)
        return self

    def rates(self, X: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        prepared = self._prepare(X)
        home = np.clip(np.asarray(self.home_estimator.predict(prepared), dtype=float), 0.02, 8.0)
        away = np.clip(np.asarray(self.away_estimator.predict(prepared), dtype=float), 0.02, 8.0)
        return home, away

    def score_matrices(self, X: pd.DataFrame) -> list[ScoreMatrix]:
        home, away = self.rates(X)
        return [
            ScoreMatrix.from_rates(h, a, rho=self.rho, max_goals=self.max_goals)
            for h, a in zip(home, away)
        ]

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        out = np.zeros((len(X), 3))
        for i, matrix in enumerate(self.score_matrices(X)):
            probs = matrix.result_probabilities()
            out[i] = [probs["H"], probs["U"], probs["B"]]
        return out

    def _prepare(self, X: pd.DataFrame) -> pd.DataFrame:
        return X.reindex(columns=self.feature_names).astype(float)


@dataclass
class MLBinaryModel:
    """Direct classifier for a two-outcome market (BTTS, over/under a line)."""

    model_id: str = "xgboost"
    market: str = "btts"
    feature_names: list[str] = field(default_factory=list)
    estimator: object = None

    @property
    def name(self) -> str:
        return f"{self.model_id}_{self.market}"

    def fit(self, X: pd.DataFrame, y: pd.Series) -> "MLBinaryModel":
        self.feature_names = list(X.columns)
        estimator = build_classifier(self.model_id)
        if self.model_id == "xgboost":
            from xgboost import XGBClassifier
            estimator = XGBClassifier(
                objective="binary:logistic", random_state=_seed(), n_jobs=-1,
                tree_method="hist", eval_metric="logloss", **_cfg("xgboost"),
            )
        elif self.model_id == "lightgbm":
            from lightgbm import LGBMClassifier
            estimator = LGBMClassifier(
                objective="binary", random_state=_seed(), n_jobs=-1,
                verbose=-1, **_cfg("lightgbm"),
            )
        elif self.model_id == "catboost":
            from catboost import CatBoostClassifier
            estimator = CatBoostClassifier(
                loss_function="Logloss", random_seed=_seed(), verbose=False,
                allow_writing_files=False, **_cfg("catboost"),
            )
        self.estimator = estimator
        self.estimator.fit(self._prepare(X), np.asarray(y, dtype=int))
        return self

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        probs = np.asarray(self.estimator.predict_proba(self._prepare(X)), dtype=float)
        if probs.ndim == 3:
            probs = probs.reshape(len(X), -1)
        return np.clip(probs[:, 1], 1e-9, 1 - 1e-9)

    def _prepare(self, X: pd.DataFrame) -> pd.DataFrame:
        return X.reindex(columns=self.feature_names).astype(float)
