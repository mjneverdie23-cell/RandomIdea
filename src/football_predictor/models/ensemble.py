"""Ensembling of base-model probabilities.

Three schemes, all fitted on a validation slice that sits between the
training data and the test fold:

* **weighted linear** - the arithmetic mean of member probabilities;
* **weighted logarithmic** - the normalised geometric mean, which is the
  natural pooling rule for probabilities and is less easily dragged around by
  one confident-but-wrong member;
* **stacking** - a multinomial logistic regression over member probabilities.

Weights come from a random search over the probability simplex, scored by
validation log loss. That is slower than solving in closed form but makes no
assumption about the members being independent or individually calibrated,
and the search space is small enough for it not to matter.

Which scheme wins is decided by the backtest, not here.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from sklearn.linear_model import LogisticRegression

from ..config import load_model_config


def _log_loss(probabilities: np.ndarray, label_index: np.ndarray) -> float:
    p = np.clip(probabilities, 1e-12, 1.0)
    return float(-np.mean(np.log(p[np.arange(len(label_index)), label_index])))


def blend_linear(members: list[np.ndarray], weights: np.ndarray) -> np.ndarray:
    stacked = np.stack(members, axis=0)
    out = np.tensordot(weights, stacked, axes=(0, 0))
    return out / out.sum(axis=1, keepdims=True)


def blend_logarithmic(members: list[np.ndarray], weights: np.ndarray) -> np.ndarray:
    """Normalised weighted geometric mean."""
    stacked = np.log(np.clip(np.stack(members, axis=0), 1e-12, 1.0))
    out = np.exp(np.tensordot(weights, stacked, axes=(0, 0)))
    return out / out.sum(axis=1, keepdims=True)


@dataclass
class ProbabilityEnsemble:
    """Blends member probability matrices of shape ``(n, n_classes)``."""

    method: str = "weighted_logarithmic"
    n_samples: int = 4000
    member_names: list[str] = field(default_factory=list)
    weights: np.ndarray | None = None
    stacker: LogisticRegression | None = None
    validation_log_loss: float = float("nan")

    @classmethod
    def from_config(cls) -> "ProbabilityEnsemble":
        cfg = load_model_config().get("ensemble", {}) or {}
        return cls(
            method=str(cfg.get("method", "weighted_logarithmic")),
            n_samples=int(cfg.get("n_weight_samples", 4000)),
        )

    def fit(
        self,
        members: dict[str, np.ndarray],
        label_index: np.ndarray,
        *,
        seed: int = 0,
    ) -> "ProbabilityEnsemble":
        self.member_names = list(members)
        matrices = [members[name] for name in self.member_names]
        n_members = len(matrices)
        if n_members == 0:
            raise ValueError("ensemble needs at least one member")
        if n_members == 1:
            self.weights = np.ones(1)
            self.validation_log_loss = _log_loss(matrices[0], label_index)
            return self

        if self.method == "stacking":
            features = np.hstack([m[:, :-1] for m in matrices])   # drop one column per member
            self.stacker = LogisticRegression(max_iter=2000, C=1.0)
            self.stacker.fit(features, label_index)
            self.validation_log_loss = _log_loss(
                self.stacker.predict_proba(features), label_index
            )
            return self

        blend = blend_logarithmic if self.method == "weighted_logarithmic" else blend_linear
        rng = np.random.default_rng(seed)
        # Start from the equal-weight blend and each single member, then search.
        candidates = [np.ones(n_members) / n_members]
        candidates += list(np.eye(n_members))
        candidates += list(rng.dirichlet(np.ones(n_members), size=self.n_samples))

        best_weights, best_score = candidates[0], np.inf
        for weights in candidates:
            score = _log_loss(blend(matrices, weights), label_index)
            if score < best_score:
                best_weights, best_score = weights, score
        self.weights = np.asarray(best_weights, dtype=float)
        self.validation_log_loss = float(best_score)
        return self

    def predict_proba(self, members: dict[str, np.ndarray]) -> np.ndarray:
        matrices = [members[name] for name in self.member_names]
        if self.stacker is not None:
            features = np.hstack([m[:, :-1] for m in matrices])
            return self.stacker.predict_proba(features)
        blend = blend_logarithmic if self.method == "weighted_logarithmic" else blend_linear
        return blend(matrices, self.weights)

    def weight_table(self) -> dict[str, float]:
        if self.weights is None:
            return {}
        return {n: float(w) for n, w in zip(self.member_names, self.weights)}


@dataclass
class BinaryEnsemble:
    """Same idea for a single-probability market such as BTTS or over/under."""

    method: str = "weighted_logarithmic"
    n_samples: int = 2000
    member_names: list[str] = field(default_factory=list)
    weights: np.ndarray | None = None

    def fit(self, members: dict[str, np.ndarray], outcomes: np.ndarray,
            *, seed: int = 0) -> "BinaryEnsemble":
        self.member_names = list(members)
        matrices = [
            np.column_stack([1.0 - members[n], members[n]]) for n in self.member_names
        ]
        y = np.asarray(outcomes, dtype=int)
        if len(matrices) == 1:
            self.weights = np.ones(1)
            return self
        blend = blend_logarithmic if self.method == "weighted_logarithmic" else blend_linear
        rng = np.random.default_rng(seed)
        candidates = [np.ones(len(matrices)) / len(matrices)]
        candidates += list(np.eye(len(matrices)))
        candidates += list(rng.dirichlet(np.ones(len(matrices)), size=self.n_samples))
        best, best_score = candidates[0], np.inf
        for weights in candidates:
            score = _log_loss(blend(matrices, weights), y)
            if score < best_score:
                best, best_score = weights, score
        self.weights = np.asarray(best, dtype=float)
        return self

    def predict(self, members: dict[str, np.ndarray]) -> np.ndarray:
        matrices = [
            np.column_stack([1.0 - members[n], members[n]]) for n in self.member_names
        ]
        blend = blend_logarithmic if self.method == "weighted_logarithmic" else blend_linear
        return blend(matrices, self.weights)[:, 1]

    def weight_table(self) -> dict[str, float]:
        if self.weights is None:
            return {}
        return {n: float(w) for n, w in zip(self.member_names, self.weights)}
