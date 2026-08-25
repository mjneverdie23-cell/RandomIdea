"""Scoring rules and evaluation metrics.

Probabilistic forecasts need proper scoring rules - ones a forecaster cannot
improve by lying about their beliefs. Log loss and the Brier score are both
proper and are reported side by side because they punish different mistakes:
log loss is savage about confident errors, Brier is gentler and bounded.

The Ranked Probability Score is included because football's three outcomes are
ordered (home / draw / away): calling a home win when the away side wins is a
worse error than calling a draw, and RPS is the standard scoring rule that
knows this. Constantinou & Fenton (2012) argue specifically for RPS in
football forecast evaluation.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics import f1_score, precision_score, recall_score, roc_auc_score

from ..models.calibration import expected_calibration_error

RESULT_CLASSES: tuple[str, str, str] = ("H", "U", "B")
CLASS_INDEX = {c: i for i, c in enumerate(RESULT_CLASSES)}


def to_index(labels) -> np.ndarray:
    return np.asarray([CLASS_INDEX[str(v)] for v in labels], dtype=int)


# -- multiclass --------------------------------------------------------------
def log_loss_multiclass(probabilities: np.ndarray, label_index: np.ndarray) -> float:
    p = np.clip(np.asarray(probabilities, dtype=float), 1e-12, 1.0)
    return float(-np.mean(np.log(p[np.arange(len(label_index)), label_index])))


def brier_multiclass(probabilities: np.ndarray, label_index: np.ndarray) -> float:
    """Multiclass Brier score: mean squared error against the one-hot truth."""
    p = np.asarray(probabilities, dtype=float)
    onehot = np.zeros_like(p)
    onehot[np.arange(len(label_index)), label_index] = 1.0
    return float(np.mean(np.sum((p - onehot) ** 2, axis=1)))


def ranked_probability_score(probabilities: np.ndarray, label_index: np.ndarray) -> float:
    """RPS over the ordered outcomes home > draw > away."""
    p = np.asarray(probabilities, dtype=float)
    onehot = np.zeros_like(p)
    onehot[np.arange(len(label_index)), label_index] = 1.0
    cum_p = np.cumsum(p[:, :-1], axis=1)
    cum_y = np.cumsum(onehot[:, :-1], axis=1)
    return float(np.mean(np.sum((cum_p - cum_y) ** 2, axis=1) / (p.shape[1] - 1)))


def accuracy(probabilities: np.ndarray, label_index: np.ndarray) -> float:
    return float(np.mean(np.argmax(probabilities, axis=1) == label_index))


def multiclass_report(probabilities: np.ndarray, labels) -> dict[str, float]:
    idx = to_index(labels)
    predicted = np.argmax(probabilities, axis=1)
    out = {
        "log_loss": log_loss_multiclass(probabilities, idx),
        "brier": brier_multiclass(probabilities, idx),
        "rps": ranked_probability_score(probabilities, idx),
        "accuracy": accuracy(probabilities, idx),
        "precision_macro": float(precision_score(idx, predicted, average="macro", zero_division=0)),
        "recall_macro": float(recall_score(idx, predicted, average="macro", zero_division=0)),
        "f1_macro": float(f1_score(idx, predicted, average="macro", zero_division=0)),
    }
    # Calibration is measured per outcome, then averaged.
    eces = [
        expected_calibration_error(probabilities[:, i], (idx == i).astype(float))
        for i in range(probabilities.shape[1])
    ]
    out["ece"] = float(np.nanmean(eces))
    return out


# -- binary ------------------------------------------------------------------
def binary_report(probabilities: np.ndarray, outcomes: np.ndarray) -> dict[str, float]:
    p = np.clip(np.asarray(probabilities, dtype=float).ravel(), 1e-12, 1 - 1e-12)
    y = np.asarray(outcomes, dtype=float).ravel()
    ok = np.isfinite(p) & np.isfinite(y)
    p, y = p[ok], y[ok]
    if not len(p):
        return {k: float("nan") for k in
                ("log_loss", "brier", "accuracy", "roc_auc", "ece", "n")}
    out = {
        "log_loss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))),
        "brier": float(np.mean((p - y) ** 2)),
        "accuracy": float(np.mean((p >= 0.5) == (y >= 0.5))),
        "ece": expected_calibration_error(p, y),
        "n": int(len(p)),
    }
    out["roc_auc"] = (
        float(roc_auc_score(y, p)) if len(np.unique(y)) > 1 else float("nan")
    )
    return out


# -- counts ------------------------------------------------------------------
def goal_report(predicted: np.ndarray, actual: np.ndarray) -> dict[str, float]:
    """Accuracy of expected-goals output."""
    pred = np.asarray(predicted, dtype=float).ravel()
    true = np.asarray(actual, dtype=float).ravel()
    ok = np.isfinite(pred) & np.isfinite(true)
    pred, true = np.clip(pred[ok], 1e-9, None), true[ok]
    if not len(pred):
        return {"mae": float("nan"), "rmse": float("nan"), "poisson_deviance": float("nan")}
    with np.errstate(divide="ignore", invalid="ignore"):
        term = np.where(true > 0, true * np.log(true / pred), 0.0)
    return {
        "mae": float(np.mean(np.abs(pred - true))),
        "rmse": float(np.sqrt(np.mean((pred - true) ** 2))),
        "poisson_deviance": float(np.mean(2.0 * (term - (true - pred)))),
    }


def exact_score_hit_rate(
    top_scores: list[str], actual_home: np.ndarray, actual_away: np.ndarray
) -> float:
    """Share of matches whose single most likely scoreline was right."""
    actual = [f"{int(h)}-{int(a)}" for h, a in zip(actual_home, actual_away)]
    if not actual:
        return float("nan")
    return float(np.mean([p == a for p, a in zip(top_scores, actual)]))


def naive_baseline(labels) -> np.ndarray:
    """Base rates of the three outcomes - the floor every model must clear."""
    idx = to_index(labels)
    counts = np.bincount(idx, minlength=3).astype(float)
    rates = counts / counts.sum()
    return np.tile(rates, (len(idx), 1))
