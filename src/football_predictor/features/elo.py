"""Elo ratings for football clubs.

Follows the World Football Elo formulation (Hvattum & Arntzen 2010 showed Elo
difference is a genuinely useful covariate for match forecasting):

    R' = R + K * g(goal difference) * (W - We)
    We = 1 / (1 + 10^(-d / 400))

with ``d`` the rating difference including a home-advantage bonus. Three
football-specific adjustments are made on top:

* **goal-difference scaling** - a 4-0 win moves ratings further than a 1-0.
* **competition importance** - a Champions League tie counts for more than a
  mid-table league fixture, via a per-competition K multiplier.
* **between-season regression** - squads change over a summer, so ratings are
  pulled part of the way back to the mean.

Ratings are global rather than per-competition, so a club's league form feeds
its European fixtures.

The rating stream is strictly causal: :meth:`EloRatings.rate_frame` returns
the ratings *before* each match and only then applies its result.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..config import load_model_config


def goal_difference_multiplier(goal_diff: int) -> float:
    """World Football Elo goal-difference index."""
    gd = abs(int(goal_diff))
    if gd <= 1:
        return 1.0
    if gd == 2:
        return 1.5
    if gd == 3:
        return 1.75
    return (11.0 + gd) / 8.0


def expected_score(rating_diff: float) -> float:
    return 1.0 / (1.0 + 10.0 ** (-rating_diff / 400.0))


@dataclass
class EloConfig:
    start_rating: float = 1500.0
    k_factor: float = 20.0
    home_advantage: float = 65.0
    goal_diff_scaling: bool = True
    season_regression: float = 0.25
    competition_k: dict[str, float] = field(default_factory=dict)
    #: Promoted / debutant clubs are on average weaker than the incumbents, so
    #: they enter at a low quantile of the competition's current ratings rather
    #: than at the global mean.
    newcomer_quantile: float = 0.25

    @classmethod
    def from_config(cls) -> "EloConfig":
        cfg = load_model_config().get("elo", {})
        return cls(
            start_rating=float(cfg.get("start_rating", 1500.0)),
            k_factor=float(cfg.get("k_factor", 20.0)),
            home_advantage=float(cfg.get("home_advantage", 65.0)),
            goal_diff_scaling=bool(cfg.get("goal_diff_scaling", True)),
            season_regression=float(cfg.get("season_regression", 0.25)),
            competition_k=dict(cfg.get("competition_k", {}) or {}),
        )


class EloRatings:
    """Streaming Elo state. Feed matches in chronological order, once each."""

    def __init__(self, config: EloConfig | None = None) -> None:
        self.config = config or EloConfig.from_config()
        self.ratings: dict[str, float] = {}
        self._competition_members: dict[str, set[str]] = {}
        self._last_season: dict[str, str] = {}
        self.n_matches: dict[str, int] = {}

    # -- state -------------------------------------------------------------
    def rating(self, team: str) -> float:
        return self.ratings.get(team, self.config.start_rating)

    def _seed_rating(self, team: str, competition: str) -> float:
        """Entry rating for a club we have never rated before."""
        peers = [
            self.ratings[t]
            for t in self._competition_members.get(competition, ())
            if t in self.ratings
        ]
        if len(peers) < 6:
            return self.config.start_rating
        return float(np.quantile(peers, self.config.newcomer_quantile))

    def _ensure(self, team: str, competition: str) -> None:
        if team not in self.ratings:
            self.ratings[team] = self._seed_rating(team, competition)
        self._competition_members.setdefault(competition, set()).add(team)

    def _apply_season_regression(self, team: str, season: str) -> None:
        previous = self._last_season.get(team)
        if previous is not None and previous != season:
            pull = self.config.season_regression
            self.ratings[team] = (
                (1.0 - pull) * self.ratings[team] + pull * self.config.start_rating
            )
        self._last_season[team] = season

    # -- prediction --------------------------------------------------------
    def pre_match_ratings(
        self, home: str, away: str, competition: str = ""
    ) -> tuple[float, float]:
        """Ratings both sides carry into this match, seeding debutants.

        Use this rather than :meth:`rating` when a team may not have been seen
        before: :meth:`rating` falls back to the global start rating, while a
        debutant is actually entered at a low quantile of its competition, and
        the two answers would otherwise disagree.
        """
        self._ensure(home, competition)
        self._ensure(away, competition)
        return self.ratings[home], self.ratings[away]

    def rating_difference(
        self, home: str, away: str, *, neutral: bool = False
    ) -> float:
        bonus = 0.0 if neutral else self.config.home_advantage
        return self.rating(home) + bonus - self.rating(away)

    def expected_home_score(
        self, home: str, away: str, *, neutral: bool = False
    ) -> float:
        """Expected points share for the home team (a draw counts as a half)."""
        return expected_score(self.rating_difference(home, away, neutral=neutral))

    # -- update ------------------------------------------------------------
    def update(
        self,
        home: str,
        away: str,
        home_goals: int,
        away_goals: int,
        *,
        competition: str = "",
        season: str = "",
        neutral: bool = False,
    ) -> None:
        self._ensure(home, competition)
        self._ensure(away, competition)
        if season:
            self._apply_season_regression(home, season)
            self._apply_season_regression(away, season)

        diff = self.rating_difference(home, away, neutral=neutral)
        expected = expected_score(diff)
        actual = 1.0 if home_goals > away_goals else (0.5 if home_goals == away_goals else 0.0)

        k = self.config.k_factor * self.config.competition_k.get(
            competition, self.config.competition_k.get("default", 1.0)
        )
        if self.config.goal_diff_scaling:
            k *= goal_difference_multiplier(home_goals - away_goals)

        delta = k * (actual - expected)
        self.ratings[home] += delta
        self.ratings[away] -= delta
        self.n_matches[home] = self.n_matches.get(home, 0) + 1
        self.n_matches[away] = self.n_matches.get(away, 0) + 1

    # -- batch -------------------------------------------------------------
    def rate_frame(self, df: pd.DataFrame) -> pd.DataFrame:
        """Pre-match ratings for every row, in chronological order.

        Returns one row per match with the ratings as they stood *before* the
        match, plus how many matches each side had already been rated on -
        the sample-size signal the confidence layer uses.
        """
        ordered = df.sort_values(["date", "competition", "home_team"], kind="mergesort")
        records = []
        for row in ordered.itertuples(index=True):
            home, away = row.home_team, row.away_team
            competition = getattr(row, "competition", "") or ""
            neutral = bool(getattr(row, "neutral_venue", False))
            home_rating, away_rating = self.pre_match_ratings(home, away, competition)
            records.append(
                {
                    "index": row.Index,
                    "elo_home": home_rating,
                    "elo_away": away_rating,
                    "elo_diff": self.rating_difference(home, away, neutral=neutral),
                    "elo_expected_home": self.expected_home_score(
                        home, away, neutral=neutral
                    ),
                    "elo_matches_home": self.n_matches.get(home, 0),
                    "elo_matches_away": self.n_matches.get(away, 0),
                }
            )
            if pd.notna(row.home_goals) and pd.notna(row.away_goals):
                self.update(
                    home, away, int(row.home_goals), int(row.away_goals),
                    competition=competition,
                    season=str(getattr(row, "season", "") or ""),
                    neutral=neutral,
                )
        out = pd.DataFrame.from_records(records).set_index("index")
        return out.reindex(df.index)

    def snapshot(self) -> dict[str, float]:
        return dict(self.ratings)
