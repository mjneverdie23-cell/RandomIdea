"""Common output format for every model.

Whatever produces the numbers - Dixon-Coles, a gradient boosting goal model,
or a blend of both - the result is a :class:`MarketPredictions` batch. That
keeps the backtest, the ensemble and the API free of model-specific branches,
and means a new model becomes available in every market at once.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .score_matrix import TEAM_LINES, TOTAL_LINES, ScoreMatrix


@dataclass
class MarketPredictions:
    """Every market this system quotes, for a batch of fixtures."""

    hub: np.ndarray                                    # (n, 3) ordered H, U, B
    home_rate: np.ndarray                              # expected home goals
    away_rate: np.ndarray
    btts: np.ndarray                                   # P(both teams score)
    totals: dict[float, np.ndarray] = field(default_factory=dict)      # P(over line)
    home_goals_over: dict[float, np.ndarray] = field(default_factory=dict)
    away_goals_over: dict[float, np.ndarray] = field(default_factory=dict)
    home_clean_sheet: np.ndarray | None = None
    away_clean_sheet: np.ndarray | None = None
    top_score: list[str] = field(default_factory=list)

    # first half
    ht_hub: np.ndarray | None = None
    ht_totals: dict[float, np.ndarray] = field(default_factory=dict)
    ht_btts: np.ndarray | None = None
    ht_home_rate: np.ndarray | None = None
    ht_away_rate: np.ndarray | None = None
    # second half
    sh_totals: dict[float, np.ndarray] = field(default_factory=dict)
    sh_home_rate: np.ndarray | None = None
    sh_away_rate: np.ndarray | None = None

    def __len__(self) -> int:
        return len(self.hub)

    @classmethod
    def from_matrices(
        cls,
        full_time: list[ScoreMatrix],
        first_half: list[ScoreMatrix] | None = None,
        second_half: list[ScoreMatrix] | None = None,
        *,
        total_lines=TOTAL_LINES,
        team_lines=TEAM_LINES,
        ht_lines=(0.5, 1.5, 2.5),
    ) -> "MarketPredictions":
        n = len(full_time)
        hub = np.zeros((n, 3))
        home_rate = np.zeros(n)
        away_rate = np.zeros(n)
        btts = np.zeros(n)
        home_cs = np.zeros(n)
        away_cs = np.zeros(n)
        totals = {line: np.zeros(n) for line in total_lines}
        home_over = {line: np.zeros(n) for line in team_lines}
        away_over = {line: np.zeros(n) for line in team_lines}
        top_score: list[str] = []

        for i, matrix in enumerate(full_time):
            result = matrix.result_probabilities()
            hub[i] = [result["H"], result["U"], result["B"]]
            home_rate[i] = matrix.expected_home_goals
            away_rate[i] = matrix.expected_away_goals
            btts[i] = matrix.btts()["yes"]
            home_cs[i] = matrix.clean_sheet("home")
            away_cs[i] = matrix.clean_sheet("away")
            over_under = matrix.over_under(total_lines)
            for line in total_lines:
                totals[line][i] = over_under[f"{line}"]["over"]
            home_lines = matrix.team_over_under("home", team_lines)
            away_lines = matrix.team_over_under("away", team_lines)
            for line in team_lines:
                home_over[line][i] = home_lines[f"{line}"]["over"]
                away_over[line][i] = away_lines[f"{line}"]["over"]
            top_score.append(matrix.top_scores(1)[0]["score"])

        out = cls(
            hub=hub, home_rate=home_rate, away_rate=away_rate, btts=btts,
            totals=totals, home_goals_over=home_over, away_goals_over=away_over,
            home_clean_sheet=home_cs, away_clean_sheet=away_cs, top_score=top_score,
        )

        if first_half is not None:
            out.ht_hub = np.zeros((n, 3))
            out.ht_btts = np.zeros(n)
            out.ht_home_rate = np.zeros(n)
            out.ht_away_rate = np.zeros(n)
            out.ht_totals = {line: np.zeros(n) for line in ht_lines}
            for i, matrix in enumerate(first_half):
                result = matrix.result_probabilities()
                out.ht_hub[i] = [result["H"], result["U"], result["B"]]
                out.ht_btts[i] = matrix.btts()["yes"]
                out.ht_home_rate[i] = matrix.expected_home_goals
                out.ht_away_rate[i] = matrix.expected_away_goals
                over_under = matrix.over_under(ht_lines)
                for line in ht_lines:
                    out.ht_totals[line][i] = over_under[f"{line}"]["over"]

        if second_half is not None:
            out.sh_home_rate = np.zeros(n)
            out.sh_away_rate = np.zeros(n)
            out.sh_totals = {line: np.zeros(n) for line in ht_lines}
            for i, matrix in enumerate(second_half):
                out.sh_home_rate[i] = matrix.expected_home_goals
                out.sh_away_rate[i] = matrix.expected_away_goals
                over_under = matrix.over_under(ht_lines)
                for line in ht_lines:
                    out.sh_totals[line][i] = over_under[f"{line}"]["over"]
        return out

    def subset(self, mask: np.ndarray) -> "MarketPredictions":
        def pick(value):
            if value is None:
                return None
            if isinstance(value, dict):
                return {k: v[mask] for k, v in value.items()}
            if isinstance(value, list):
                return [v for v, keep in zip(value, mask) if keep]
            return value[mask]

        return MarketPredictions(
            hub=self.hub[mask], home_rate=self.home_rate[mask],
            away_rate=self.away_rate[mask], btts=self.btts[mask],
            totals=pick(self.totals), home_goals_over=pick(self.home_goals_over),
            away_goals_over=pick(self.away_goals_over),
            home_clean_sheet=pick(self.home_clean_sheet),
            away_clean_sheet=pick(self.away_clean_sheet),
            top_score=pick(self.top_score),
            ht_hub=pick(self.ht_hub), ht_totals=pick(self.ht_totals),
            ht_btts=pick(self.ht_btts), ht_home_rate=pick(self.ht_home_rate),
            ht_away_rate=pick(self.ht_away_rate),
            sh_totals=pick(self.sh_totals), sh_home_rate=pick(self.sh_home_rate),
            sh_away_rate=pick(self.sh_away_rate),
        )
