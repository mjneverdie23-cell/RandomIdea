"""Rolling team form state.

Every statistic here is produced by a streaming state machine: features for a
match are read out of state, and only afterwards is that match's result folded
in. A rolling average therefore cannot contain the match it describes, which
is the structural guarantee against leakage described in docs/LEAKAGE.md.

Two averaging schemes are kept side by side because they answer different
questions:

* fixed windows (last 3 / 5 / 10) - "what has this team just been doing",
  robust and easy to explain to a user;
* time-decayed means - "how good is this team now", which handles gaps
  between fixtures and mid-season breaks properly.
"""
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field

import pandas as pd

WINDOWS: tuple[int, ...] = (3, 5, 10)
MAX_HISTORY = 40


@dataclass
class MatchRecord:
    """One completed match from a single team's point of view."""

    date: pd.Timestamp
    competition: str
    season: str
    is_home: bool
    goals_for: int
    goals_against: int
    ht_goals_for: int | None
    ht_goals_against: int | None
    shots_for: float | None
    shots_against: float | None
    sot_for: float | None
    sot_against: float | None
    corners_for: float | None
    xg_for: float | None
    xg_against: float | None

    @property
    def points(self) -> int:
        if self.goals_for > self.goals_against:
            return 3
        return 1 if self.goals_for == self.goals_against else 0

    @property
    def total_goals(self) -> int:
        return self.goals_for + self.goals_against

    @property
    def btts(self) -> int:
        return int(self.goals_for > 0 and self.goals_against > 0)

    @property
    def clean_sheet(self) -> int:
        return int(self.goals_against == 0)

    @property
    def failed_to_score(self) -> int:
        return int(self.goals_for == 0)

    @property
    def second_half_goals_for(self) -> int | None:
        if self.ht_goals_for is None:
            return None
        return self.goals_for - self.ht_goals_for

    @property
    def second_half_goals_against(self) -> int | None:
        if self.ht_goals_against is None:
            return None
        return self.goals_against - self.ht_goals_against


@dataclass
class _Decayed:
    """Time-decayed weighted mean; weights halve every ``halflife`` days."""

    halflife: float
    weight: float = 0.0
    total: float = 0.0
    last: pd.Timestamp | None = None

    def _decay_to(self, now: pd.Timestamp) -> None:
        if self.last is not None:
            days = max((now - self.last).days, 0)
            factor = 0.5 ** (days / self.halflife)
            self.weight *= factor
            self.total *= factor
        self.last = now

    def observe(self, value: float, now: pd.Timestamp) -> None:
        self._decay_to(now)
        self.weight += 1.0
        self.total += float(value)

    def mean(self, default: float = float("nan")) -> float:
        return self.total / self.weight if self.weight > 1e-9 else default


@dataclass
class TeamState:
    """Everything known about one team from its past matches."""

    halflife_days: float = 180.0
    history: deque[MatchRecord] = field(default_factory=lambda: deque(maxlen=MAX_HISTORY))
    home_history: deque[MatchRecord] = field(
        default_factory=lambda: deque(maxlen=MAX_HISTORY)
    )
    away_history: deque[MatchRecord] = field(
        default_factory=lambda: deque(maxlen=MAX_HISTORY)
    )
    match_dates: deque[pd.Timestamp] = field(default_factory=lambda: deque(maxlen=60))

    season: str | None = None
    season_matches: int = 0
    season_points: int = 0
    season_goals_for: int = 0
    season_goals_against: int = 0

    attack: _Decayed = field(default=None)   # type: ignore[assignment]
    defence: _Decayed = field(default=None)  # type: ignore[assignment]
    ht_attack: _Decayed = field(default=None)  # type: ignore[assignment]
    ht_defence: _Decayed = field(default=None)  # type: ignore[assignment]
    xg_for: _Decayed = field(default=None)   # type: ignore[assignment]
    xg_against: _Decayed = field(default=None)  # type: ignore[assignment]

    def __post_init__(self) -> None:
        for name in ("attack", "defence", "ht_attack", "ht_defence", "xg_for", "xg_against"):
            if getattr(self, name) is None:
                setattr(self, name, _Decayed(self.halflife_days))

    # -- reading -----------------------------------------------------------
    @property
    def n_matches(self) -> int:
        return len(self.history)

    def rest_days(self, date: pd.Timestamp, cap: int = 30) -> float:
        if not self.match_dates:
            return float(cap)
        return float(min((date - self.match_dates[-1]).days, cap))

    def matches_within(self, date: pd.Timestamp, days: int) -> int:
        cutoff = date - pd.Timedelta(days=days)
        return sum(1 for d in self.match_dates if d > cutoff)

    def features(self, date: pd.Timestamp, prefix: str, venue: str) -> dict[str, float]:
        """Flat feature dict for this team ahead of a match on ``date``.

        ``venue`` is "home" or "away" and selects the venue-specific history,
        so a home team's home record is compared with an away team's away
        record rather than mixing the two.
        """
        out: dict[str, float] = {}
        recent = list(self.history)
        venue_history = list(self.home_history if venue == "home" else self.away_history)

        for window in WINDOWS:
            chunk = recent[-window:]
            out.update(_aggregate(chunk, f"{prefix}_last{window}"))
            venue_chunk = venue_history[-window:]
            out[f"{prefix}_{venue}_last{window}_gf"] = _mean(
                [m.goals_for for m in venue_chunk]
            )
            out[f"{prefix}_{venue}_last{window}_ga"] = _mean(
                [m.goals_against for m in venue_chunk]
            )

        out[f"{prefix}_attack_decayed"] = self.attack.mean()
        out[f"{prefix}_defence_decayed"] = self.defence.mean()
        out[f"{prefix}_ht_attack_decayed"] = self.ht_attack.mean()
        out[f"{prefix}_ht_defence_decayed"] = self.ht_defence.mean()
        out[f"{prefix}_xg_for_decayed"] = self.xg_for.mean()
        out[f"{prefix}_xg_against_decayed"] = self.xg_against.mean()

        played = max(self.season_matches, 1)
        out[f"{prefix}_season_matches"] = float(self.season_matches)
        out[f"{prefix}_season_ppg"] = self.season_points / played if self.season_matches else float("nan")
        out[f"{prefix}_season_gf_pg"] = self.season_goals_for / played if self.season_matches else float("nan")
        out[f"{prefix}_season_ga_pg"] = self.season_goals_against / played if self.season_matches else float("nan")

        out[f"{prefix}_rest_days"] = self.rest_days(date)
        out[f"{prefix}_matches_7d"] = float(self.matches_within(date, 7))
        out[f"{prefix}_matches_14d"] = float(self.matches_within(date, 14))
        out[f"{prefix}_matches_30d"] = float(self.matches_within(date, 30))
        out[f"{prefix}_history"] = float(self.n_matches)
        return out

    # -- writing -----------------------------------------------------------
    def observe(self, record: MatchRecord) -> None:
        self.history.append(record)
        (self.home_history if record.is_home else self.away_history).append(record)
        self.match_dates.append(record.date)

        if record.season != self.season:
            self.season = record.season
            self.season_matches = self.season_points = 0
            self.season_goals_for = self.season_goals_against = 0
        self.season_matches += 1
        self.season_points += record.points
        self.season_goals_for += record.goals_for
        self.season_goals_against += record.goals_against

        self.attack.observe(record.goals_for, record.date)
        self.defence.observe(record.goals_against, record.date)
        if record.ht_goals_for is not None:
            self.ht_attack.observe(record.ht_goals_for, record.date)
        if record.ht_goals_against is not None:
            self.ht_defence.observe(record.ht_goals_against, record.date)
        if record.xg_for is not None:
            self.xg_for.observe(record.xg_for, record.date)
        if record.xg_against is not None:
            self.xg_against.observe(record.xg_against, record.date)


def _mean(values) -> float:
    clean = [v for v in values if v is not None and not (isinstance(v, float) and math.isnan(v))]
    return sum(clean) / len(clean) if clean else float("nan")


def _aggregate(chunk: list[MatchRecord], prefix: str) -> dict[str, float]:
    if not chunk:
        return {
            f"{prefix}_{name}": float("nan")
            for name in (
                "ppg", "gf", "ga", "gd", "total_goals", "btts_rate", "over25_rate",
                "clean_sheet_rate", "fts_rate", "ht_gf", "ht_ga", "sh_gf", "sh_ga",
                "shots_for", "sot_for", "sot_against", "corners_for",
            )
        }
    return {
        f"{prefix}_ppg": _mean([m.points for m in chunk]),
        f"{prefix}_gf": _mean([m.goals_for for m in chunk]),
        f"{prefix}_ga": _mean([m.goals_against for m in chunk]),
        f"{prefix}_gd": _mean([m.goals_for - m.goals_against for m in chunk]),
        f"{prefix}_total_goals": _mean([m.total_goals for m in chunk]),
        f"{prefix}_btts_rate": _mean([m.btts for m in chunk]),
        f"{prefix}_over25_rate": _mean([int(m.total_goals > 2.5) for m in chunk]),
        f"{prefix}_clean_sheet_rate": _mean([m.clean_sheet for m in chunk]),
        f"{prefix}_fts_rate": _mean([m.failed_to_score for m in chunk]),
        f"{prefix}_ht_gf": _mean([m.ht_goals_for for m in chunk]),
        f"{prefix}_ht_ga": _mean([m.ht_goals_against for m in chunk]),
        f"{prefix}_sh_gf": _mean([m.second_half_goals_for for m in chunk]),
        f"{prefix}_sh_ga": _mean([m.second_half_goals_against for m in chunk]),
        f"{prefix}_shots_for": _mean([m.shots_for for m in chunk]),
        f"{prefix}_sot_for": _mean([m.sot_for for m in chunk]),
        f"{prefix}_sot_against": _mean([m.sot_against for m in chunk]),
        f"{prefix}_corners_for": _mean([m.corners_for for m in chunk]),
    }
