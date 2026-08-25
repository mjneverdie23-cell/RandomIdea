"""Probability calibration.

A model can rank matches well and still be badly calibrated: if the fixtures
it calls 70% only come in 60% of the time, the number on screen is
misleading. Calibration fixes the numbers without touching the ranking.

Both standard post-hoc methods are supported:

* **isotonic regression** - non-parametric, corrects any monotone distortion,
  needs a reasonable amount of validation data;
* **Platt scaling** - a one-parameter logistic fit, safer on small samples.

Multiclass HUB is calibrated one-vs-rest and renormalised, which is the usual
treatment and keeps the three probabilities summing to one.

Calibrators are always fitted on a validation slice that is *later* than the
training data and *earlier* than the test data - never on the test fold.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression


@dataclass
class BinaryCalibrator:
    method: str = "isotonic"
    min_samples: int = 800
    fitted: bool = False
    _isotonic: IsotonicRegression | None = None
    _platt: LogisticRegression | None = None

    def fit(self, probabilities: np.ndarray, outcomes: np.ndarray) -> "BinaryCalibrator":
        p = np.clip(np.asarray(probabilities, dtype=float).ravel(), 1e-9, 1 - 1e-9)
        y = np.asarray(outcomes, dtype=int).ravel()
        ok = np.isfinite(p) & np.isin(y, (0, 1))
        p, y = p[ok], y[ok]
        # Too little data, or only one class seen: leave probabilities alone
        # rather than fit a calibrator that would do more harm than good.
        if len(p) < self.min_samples or len(np.unique(y)) < 2 or self.method == "none":
            self.fitted = False
            return self
        if self.method == "isotonic":
            self._isotonic = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
            self._isotonic.fit(p, y)
        else:
            self._platt = LogisticRegression(C=1e6, solver="lbfgs")
            self._platt.fit(_logit(p).reshape(-1, 1), y)
        self.fitted = True
        return self

    def transform(self, probabilities: np.ndarray) -> np.ndarray:
        p = np.clip(np.asarray(probabilities, dtype=float).ravel(), 1e-9, 1 - 1e-9)
        if not self.fitted:
            return p
        if self._isotonic is not None:
            out = self._isotonic.predict(p)
        else:
            out = self._platt.predict_proba(_logit(p).reshape(-1, 1))[:, 1]
        return np.clip(out, 1e-6, 1 - 1e-6)


@dataclass
class MulticlassCalibrator:
    """One-vs-rest calibration for the three HUB outcomes."""

    method: str = "isotonic"
    min_samples: int = 800
    calibrators: list[BinaryCalibrator] = field(default_factory=list)
    fitted: bool = False

    def fit(self, probabilities: np.ndarray, labels: np.ndarray,
            classes=("H", "U", "B")) -> "MulticlassCalibrator":
        probs = np.asarray(probabilities, dtype=float)
        labels = np.asarray(labels)
        self.calibrators = []
        for i, cls in enumerate(classes):
            calibrator = BinaryCalibrator(self.method, self.min_samples)
            calibrator.fit(probs[:, i], (labels == cls).astype(int))
            self.calibrators.append(calibrator)
        self.fitted = any(c.fitted for c in self.calibrators)
        return self

    def transform(self, probabilities: np.ndarray) -> np.ndarray:
        probs = np.asarray(probabilities, dtype=float)
        if not self.fitted:
            return probs
        out = np.column_stack([
            calibrator.transform(probs[:, i])
            for i, calibrator in enumerate(self.calibrators)
        ])
        out = np.clip(out, 1e-6, None)
        return out / out.sum(axis=1, keepdims=True)


def _logit(p: np.ndarray) -> np.ndarray:
    return np.log(p / (1.0 - p))


# -- diagnostics -------------------------------------------------------------
def expected_calibration_error(
    probabilities: np.ndarray, outcomes: np.ndarray, n_bins: int = 10
) -> float:
    """Average gap between predicted probability and observed frequency."""
    p = np.asarray(probabilities, dtype=float).ravel()
    y = np.asarray(outcomes, dtype=float).ravel()
    ok = np.isfinite(p) & np.isfinite(y)
    p, y = p[ok], y[ok]
    if not len(p):
        return float("nan")
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    bins = np.clip(np.digitize(p, edges[1:-1]), 0, n_bins - 1)
    error = 0.0
    for b in range(n_bins):
        mask = bins == b
        if mask.any():
            error += mask.mean() * abs(p[mask].mean() - y[mask].mean())
    return float(error)


def reliability_curve(
    probabilities: np.ndarray, outcomes: np.ndarray, n_bins: int = 10
) -> dict[str, list[float]]:
    """Points for a reliability diagram: predicted vs observed, per bin."""
    p = np.asarray(probabilities, dtype=float).ravel()
    y = np.asarray(outcomes, dtype=float).ravel()
    ok = np.isfinite(p) & np.isfinite(y)
    p, y = p[ok], y[ok]
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    bins = np.clip(np.digitize(p, edges[1:-1]), 0, n_bins - 1)
    predicted, observed, counts = [], [], []
    for b in range(n_bins):
        mask = bins == b
        if mask.sum() >= 5:
            predicted.append(float(p[mask].mean()))
            observed.append(float(y[mask].mean()))
            counts.append(int(mask.sum()))
    return {"predicted": predicted, "observed": observed, "count": counts}
