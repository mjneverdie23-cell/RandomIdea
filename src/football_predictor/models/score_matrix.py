"""Joint score distributions and the markets derived from them.

Every goal-based market in this system comes from one object: a matrix
``P[h, a]`` giving the probability of the match ending with ``h`` home goals
and ``a`` away goals. Deriving HUB, BTTS, over/under and team totals from a
single distribution guarantees they are mutually consistent - the probability
of "over 2.5" and the probability of the scorelines that make up "over 2.5"
cannot disagree, because they are the same numbers summed differently.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.stats import poisson

DEFAULT_MAX_GOALS = 12
#: Lines quoted for total goals and for a single team's goals.
TOTAL_LINES: tuple[float, ...] = (0.5, 1.5, 2.5, 3.5, 4.5, 5.5)
TEAM_LINES: tuple[float, ...] = (0.5, 1.5, 2.5, 3.5)


def poisson_matrix(
    home_rate: float, away_rate: float, max_goals: int = DEFAULT_MAX_GOALS
) -> np.ndarray:
    """Independent-Poisson joint distribution of the two scores."""
    goals = np.arange(max_goals + 1)
    home = poisson.pmf(goals, max(home_rate, 1e-6))
    away = poisson.pmf(goals, max(away_rate, 1e-6))
    return np.outer(home, away)


def dixon_coles_tau(
    matrix: np.ndarray, home_rate: float, away_rate: float, rho: float
) -> np.ndarray:
    """Apply the Dixon-Coles low-score dependence correction.

    Independent Poisson misprices the four scorelines where both teams are on
    0 or 1 goals - in practice it under-predicts 0-0 and 1-1 and over-predicts
    1-0 and 0-1. Dixon & Coles (1997) multiply just those four cells by::

        tau(0,0) = 1 - lambda*mu*rho    tau(0,1) = 1 + lambda*rho
        tau(1,0) = 1 + mu*rho           tau(1,1) = 1 - rho

    Everything else is left alone, and the matrix is renormalised.
    """
    out = matrix.copy()
    lam, mu = max(home_rate, 1e-6), max(away_rate, 1e-6)
    out[0, 0] *= 1.0 - lam * mu * rho
    out[0, 1] *= 1.0 + lam * rho
    out[1, 0] *= 1.0 + mu * rho
    out[1, 1] *= 1.0 - rho
    np.clip(out, 1e-12, None, out=out)
    return out / out.sum()


@dataclass
class ScoreMatrix:
    """A joint score distribution, plus every market read off it."""

    matrix: np.ndarray

    def __post_init__(self) -> None:
        self.matrix = np.asarray(self.matrix, dtype=float)
        total = self.matrix.sum()
        if total <= 0:
            raise ValueError("score matrix has zero mass")
        self.matrix = self.matrix / total

    # -- constructors ------------------------------------------------------
    @classmethod
    def from_rates(
        cls,
        home_rate: float,
        away_rate: float,
        rho: float = 0.0,
        max_goals: int = DEFAULT_MAX_GOALS,
    ) -> "ScoreMatrix":
        matrix = poisson_matrix(home_rate, away_rate, max_goals)
        if rho:
            matrix = dixon_coles_tau(matrix, home_rate, away_rate, rho)
        return cls(matrix)

    def convolve(self, other: "ScoreMatrix") -> "ScoreMatrix":
        """Distribution of the summed scores of two independent periods.

        Used to build a full-time distribution out of separate first-half and
        second-half models.
        """
        size = self.matrix.shape[0] + other.matrix.shape[0] - 1
        out = np.zeros((size, size))
        for h1 in range(self.matrix.shape[0]):
            for a1 in range(self.matrix.shape[1]):
                weight = self.matrix[h1, a1]
                if weight > 1e-12:
                    out[h1:h1 + other.matrix.shape[0],
                        a1:a1 + other.matrix.shape[1]] += weight * other.matrix
        return ScoreMatrix(out)

    # -- summaries ---------------------------------------------------------
    @property
    def max_goals(self) -> int:
        return self.matrix.shape[0] - 1

    @property
    def expected_home_goals(self) -> float:
        return float((self.matrix.sum(axis=1) * np.arange(self.matrix.shape[0])).sum())

    @property
    def expected_away_goals(self) -> float:
        return float((self.matrix.sum(axis=0) * np.arange(self.matrix.shape[1])).sum())

    @property
    def expected_total_goals(self) -> float:
        return self.expected_home_goals + self.expected_away_goals

    # -- markets -----------------------------------------------------------
    def result_probabilities(self) -> dict[str, float]:
        """HUB: home win / draw / away win, settled on regulation time.

        H-U-B is the Scandinavian rendering of the three-way match-result
        market (Hjemmeseier / Uavgjort / Borteseier); it is the same market
        as 1X2 and settles the same way.
        """
        home = float(np.tril(self.matrix, -1).sum())
        draw = float(np.trace(self.matrix))
        away = float(np.triu(self.matrix, 1).sum())
        return {"H": home, "U": draw, "B": away}

    def btts(self) -> dict[str, float]:
        yes = float(self.matrix[1:, 1:].sum())
        return {"yes": yes, "no": 1.0 - yes}

    def total_goals_distribution(self) -> np.ndarray:
        size = self.matrix.shape[0] + self.matrix.shape[1] - 1
        totals = np.zeros(size)
        for h in range(self.matrix.shape[0]):
            totals[h:h + self.matrix.shape[1]] += self.matrix[h]
        return totals

    def over_under(self, lines=TOTAL_LINES) -> dict[str, dict[str, float]]:
        totals = self.total_goals_distribution()
        goals = np.arange(len(totals))
        out = {}
        for line in lines:
            over = float(totals[goals > line].sum())
            out[f"{line}"] = {"over": over, "under": 1.0 - over}
        return out

    def team_goals_distribution(self, side: str) -> np.ndarray:
        return self.matrix.sum(axis=1 if side == "home" else 0)

    def team_over_under(self, side: str, lines=TEAM_LINES) -> dict[str, dict[str, float]]:
        distribution = self.team_goals_distribution(side)
        goals = np.arange(len(distribution))
        out = {}
        for line in lines:
            over = float(distribution[goals > line].sum())
            out[f"{line}"] = {"over": over, "under": 1.0 - over}
        return out

    def team_to_score(self, side: str) -> float:
        return float(self.team_goals_distribution(side)[1:].sum())

    def clean_sheet(self, side: str) -> float:
        """Probability ``side`` concedes nothing."""
        opponent = "away" if side == "home" else "home"
        return float(self.team_goals_distribution(opponent)[0])

    def top_scores(self, n: int = 5) -> list[dict]:
        flat = self.matrix.flatten()
        idx = np.argsort(flat)[::-1][:n]
        rows, cols = np.unravel_index(idx, self.matrix.shape)
        return [
            {"home_goals": int(h), "away_goals": int(a),
             "probability": float(self.matrix[h, a]), "score": f"{h}-{a}"}
            for h, a in zip(rows, cols)
        ]

    def exact_score(self, home_goals: int, away_goals: int) -> float:
        if home_goals >= self.matrix.shape[0] or away_goals >= self.matrix.shape[1]:
            return 0.0
        return float(self.matrix[home_goals, away_goals])

    def winning_margin(self) -> dict[str, float]:
        """Distribution over goal difference, for the explanation panel."""
        out: dict[str, float] = {}
        for h in range(self.matrix.shape[0]):
            for a in range(self.matrix.shape[1]):
                key = str(h - a)
                out[key] = out.get(key, 0.0) + float(self.matrix[h, a])
        return out


def reconcile_to_result(
    matrix: np.ndarray, target: dict[str, float]
) -> np.ndarray:
    """Rescale a score matrix so its HUB probabilities match ``target``.

    The ensemble's three-way probabilities carry information the goal models
    alone do not - the direct classifiers contribute to them. But BTTS,
    over/under, team totals and exact scores all have to be read off a score
    distribution, and if that distribution implied different HUB numbers than
    the ones on screen, the panel would contradict itself.

    So the three outcome regions (home win, draw, away win) are each scaled by
    a single factor to hit the target, which leaves the *shape* within each
    region untouched - the relative likelihood of 2-0 against 3-1 is still the
    goal model's - while making every market consistent with one distribution.
    """
    out = np.asarray(matrix, dtype=float).copy()
    size = out.shape[0]
    rows, cols = np.indices(out.shape)
    regions = {
        "H": rows > cols,
        "U": rows == cols,
        "B": rows < cols,
    }
    for key, mask in regions.items():
        current = out[mask].sum()
        wanted = max(float(target.get(key, 0.0)), 1e-9)
        if current > 1e-12:
            out[mask] *= wanted / current
    total = out.sum()
    return out / total if total > 0 else np.asarray(matrix, dtype=float)


def blend_matrices(matrices, weights=None) -> np.ndarray:
    """Weighted geometric blend of score matrices of possibly different sizes."""
    matrices = list(matrices)
    if not matrices:
        raise ValueError("nothing to blend")
    size = max(m.shape[0] for m in matrices)
    weights = np.ones(len(matrices)) if weights is None else np.asarray(weights, float)
    weights = weights / weights.sum()
    stacked = np.zeros((len(matrices), size, size))
    for i, m in enumerate(matrices):
        stacked[i, : m.shape[0], : m.shape[1]] = m
    logs = np.log(np.clip(stacked, 1e-12, None))
    out = np.exp(np.tensordot(weights, logs, axes=(0, 0)))
    return out / out.sum()
