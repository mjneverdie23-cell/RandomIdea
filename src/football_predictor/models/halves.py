"""First-half and second-half goal models.

Halving a full-time expectation is wrong: football scores roughly 45% of its
goals before the break and 55% after it, and the split is not identical for
every team or competition. The two halves are therefore fitted as separate
Dixon-Coles models, on first-half goals and on second-half goals
(full time minus half time) respectively.

That yields three things:

* first-half markets (half-time HUB, first-half over/under, first-half BTTS)
  from the first-half distribution;
* second-half markets from the second-half distribution;
* an *alternative* full-time distribution, by convolving the two halves,
  which the backtest compares against the directly fitted full-time model.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..config import load_model_config
from .dixon_coles import DixonColesModel, GoalModelConfig
from .score_matrix import ScoreMatrix

log = logging.getLogger(__name__)


@dataclass
class HalvesModel:
    """A pair of Dixon-Coles models, one per half."""

    first_half: DixonColesModel | None = None
    second_half: DixonColesModel | None = None
    max_goals: int = 8
    name: str = "halves"

    @classmethod
    def from_config(cls) -> "HalvesModel":
        cfg = load_model_config().get("halves", {}) or {}
        return cls(max_goals=int(cfg.get("max_goals", 8)))

    def fit(self, df: pd.DataFrame, *, reference_date=None) -> "HalvesModel":
        cfg = load_model_config().get("halves", {}) or {}
        base = GoalModelConfig.from_config("dixon_coles")
        base.xi = float(cfg.get("xi", base.xi))
        base.max_goals = self.max_goals

        data = df[df["ht_home_goals"].notna() & df["ht_away_goals"].notna()].copy()
        if data.empty:
            raise ValueError("no matches with half-time scores")

        data["sh_home_goals"] = data["home_goals"] - data["ht_home_goals"]
        data["sh_away_goals"] = data["away_goals"] - data["ht_away_goals"]

        self.first_half = DixonColesModel(_copy(base)).fit(
            data, reference_date=reference_date,
            home_col="ht_home_goals", away_col="ht_away_goals",
        )
        self.second_half = DixonColesModel(_copy(base)).fit(
            data, reference_date=reference_date,
            home_col="sh_home_goals", away_col="sh_away_goals",
        )
        return self

    # -- prediction --------------------------------------------------------
    def first_half_matrix(self, home: str, away: str, *, neutral: bool = False) -> ScoreMatrix:
        return self.first_half.score_matrix(home, away, neutral=neutral)

    def second_half_matrix(self, home: str, away: str, *, neutral: bool = False) -> ScoreMatrix:
        return self.second_half.score_matrix(home, away, neutral=neutral)

    def full_time_matrix(self, home: str, away: str, *, neutral: bool = False) -> ScoreMatrix:
        """Full-time distribution implied by the two halves."""
        return self.first_half_matrix(home, away, neutral=neutral).convolve(
            self.second_half_matrix(home, away, neutral=neutral)
        )

    def half_shares(self) -> dict[str, float]:
        """Measured share of goals in each half - reported, never assumed."""
        first = self.first_half.baseline_rate
        second = self.second_half.baseline_rate
        total = first + second
        return {
            "first_half_share": first / total if total else float("nan"),
            "second_half_share": second / total if total else float("nan"),
            "first_half_rate": first,
            "second_half_rate": second,
        }


def _copy(config: GoalModelConfig) -> GoalModelConfig:
    return GoalModelConfig(
        xi=config.xi, max_history_days=config.max_history_days,
        max_goals=config.max_goals, min_matches_per_team=config.min_matches_per_team,
        use_rho=config.use_rho, rho_bounds=config.rho_bounds,
    )
