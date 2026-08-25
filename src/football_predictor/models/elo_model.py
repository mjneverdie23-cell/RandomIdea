"""Elo as a standalone forecasting model.

Elo produces a single number - the rating difference - so turning it into
three outcome probabilities needs a link function. Hvattum & Arntzen (2010)
use ordered logistic regression on the rating difference, which respects the
natural ordering away win < draw < home win, and that is what is fitted here::

    P(away)      = sigma(c1 - beta * d)
    P(draw)      = sigma(c2 - beta * d) - sigma(c1 - beta * d)
    P(home)      = 1 - sigma(c2 - beta * d)

with ``d`` the pre-match Elo difference (including home advantage) in units of
100 points. Two cutpoints and one slope: it cannot overfit, which is exactly
what a baseline should look like.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import expit

RESULT_ORDER: tuple[str, str, str] = ("H", "U", "B")


@dataclass
class EloOutcomeModel:
    """Ordered-logit mapping from Elo difference to HUB probabilities."""

    beta: float = 1.0
    cut_away: float = -0.5
    cut_draw: float = 0.5
    fitted: bool = False
    name: str = "elo"

    def fit(self, elo_diff: np.ndarray, results: np.ndarray) -> "EloOutcomeModel":
        x = np.asarray(elo_diff, dtype=float) / 100.0
        y = np.asarray(results)
        ok = np.isfinite(x) & pd.notna(y)
        x, y = x[ok], y[ok]
        # 0 = away win, 1 = draw, 2 = home win
        levels = np.select([y == "B", y == "U", y == "H"], [0, 1, 2], default=-1)
        x, levels = x[levels >= 0], levels[levels >= 0]
        if len(x) < 50:
            return self

        def negative_log_likelihood(params):
            beta, cut_away, gap = params
            cut_draw = cut_away + np.exp(gap)      # keeps the cutpoints ordered
            z1 = cut_away - beta * x
            z2 = cut_draw - beta * x
            p_away = expit(z1)
            p_draw = expit(z2) - p_away
            p_home = 1.0 - expit(z2)
            probs = np.clip(
                np.choose(levels, [p_away, p_draw, p_home]), 1e-12, 1.0
            )
            return -np.log(probs).sum()

        result = minimize(
            negative_log_likelihood, np.array([0.8, -0.6, np.log(1.2)]),
            method="Nelder-Mead", options={"maxiter": 2000, "xatol": 1e-6},
        )
        beta, cut_away, gap = result.x
        self.beta = float(beta)
        self.cut_away = float(cut_away)
        self.cut_draw = float(cut_away + np.exp(gap))
        self.fitted = bool(result.success)
        return self

    def predict_proba(self, elo_diff) -> np.ndarray:
        x = np.asarray(elo_diff, dtype=float) / 100.0
        x = np.nan_to_num(x, nan=0.0)
        p_away = expit(self.cut_away - self.beta * x)
        upper = expit(self.cut_draw - self.beta * x)
        p_draw = np.clip(upper - p_away, 1e-9, None)
        p_home = np.clip(1.0 - upper, 1e-9, None)
        stacked = np.vstack([p_home, p_draw, p_away]).T
        return stacked / stacked.sum(axis=1, keepdims=True)

    def fit_frame(self, df: pd.DataFrame) -> "EloOutcomeModel":
        return self.fit(df["elo_diff"].to_numpy(), df["target_result"].to_numpy())

    def predict_frame(self, df: pd.DataFrame) -> np.ndarray:
        return self.predict_proba(df["elo_diff"].to_numpy())
