"""Assemble the model feature matrix.

One chronological pass over the match table. For every fixture the builder
reads the current state of both teams, the competition and the head-to-head
record, writes those out as the feature row, and only then folds the result
into state. Nothing that happened during or after a match can reach its own
feature row.

The builder also produces the prediction targets, kept in separate columns so
that a target can never be mistaken for a feature: see :data:`TARGET_COLUMNS`.
"""
from __future__ import annotations

import logging
from collections import defaultdict, deque
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..config import load_model_config
from ..normalize.competitions import is_knockout_stage
from .elo import EloConfig, EloRatings
from .form import MatchRecord, TeamState

log = logging.getLogger(__name__)

#: Columns the models predict. Never fed back in as inputs.
TARGET_COLUMNS: tuple[str, ...] = (
    "target_home_goals", "target_away_goals",
    "target_ht_home_goals", "target_ht_away_goals",
    "target_result", "target_btts", "target_total_goals",
)

#: Non-feature columns carried through for joining, filtering and display.
CONTEXT_COLUMNS: tuple[str, ...] = (
    "match_id", "date", "competition", "season", "stage",
    "home_team", "away_team", "neutral_venue",
)


@dataclass
class _CompetitionState:
    """Running competition-level baselines, used to make features comparable.

    A goal in Serie A is not worth the same as a goal in the Bundesliga, and
    home advantage differs by league, so team rates are expressed relative to
    the competition's own running averages.
    """

    n: int = 0
    home_goals: float = 0.0
    away_goals: float = 0.0
    ht_home_goals: float = 0.0
    ht_away_goals: float = 0.0
    ht_n: int = 0
    home_wins: float = 0.0
    draws: float = 0.0
    sot: float = 0.0
    sot_goals: float = 0.0

    def observe(self, row) -> None:
        self.n += 1
        self.home_goals += row["home_goals"]
        self.away_goals += row["away_goals"]
        if row["home_goals"] > row["away_goals"]:
            self.home_wins += 1
        elif row["home_goals"] == row["away_goals"]:
            self.draws += 1
        if not pd.isna(row.get("ht_home_goals")):
            self.ht_n += 1
            self.ht_home_goals += row["ht_home_goals"]
            self.ht_away_goals += row["ht_away_goals"]
        for side in ("home", "away"):
            sot = row.get(f"{side}_shots_on_target")
            if sot is not None and not pd.isna(sot):
                self.sot += float(sot)
                self.sot_goals += float(row[f"{side}_goals"])

    @property
    def avg_home_goals(self) -> float:
        return self.home_goals / self.n if self.n else float("nan")

    @property
    def avg_away_goals(self) -> float:
        return self.away_goals / self.n if self.n else float("nan")

    @property
    def home_win_rate(self) -> float:
        return self.home_wins / self.n if self.n else float("nan")

    @property
    def draw_rate(self) -> float:
        return self.draws / self.n if self.n else float("nan")

    @property
    def first_half_share(self) -> float:
        """Share of goals scored before half time.

        Football scores roughly 45% of its goals in the first half; carrying
        the competition's own measured value avoids assuming a 50/50 split.
        """
        if not self.ht_n:
            return float("nan")
        total_ft = (self.home_goals + self.away_goals) * (self.ht_n / max(self.n, 1))
        total_ht = self.ht_home_goals + self.ht_away_goals
        return total_ht / total_ft if total_ft > 0 else float("nan")

    @property
    def goals_per_sot(self) -> float:
        """Conversion rate behind the shot-based expected-goals proxy."""
        return self.sot_goals / self.sot if self.sot > 20 else float("nan")


class FeatureBuilder:
    """Builds the feature matrix, streaming and strictly causal."""

    def __init__(self, elo_config: EloConfig | None = None) -> None:
        cfg = load_model_config().get("features", {})
        self.halflife = float(cfg.get("time_decay_halflife_days", 180))
        self.min_history = int(cfg.get("min_history_matches", 6))
        self.elo = EloRatings(elo_config)
        self.teams: dict[str, TeamState] = defaultdict(
            lambda: TeamState(halflife_days=self.halflife)
        )
        self.competitions: dict[str, _CompetitionState] = defaultdict(_CompetitionState)
        self.head_to_head: dict[tuple[str, str], deque] = defaultdict(
            lambda: deque(maxlen=10)
        )

    # -- main pass ---------------------------------------------------------
    def transform(self, df: pd.DataFrame, *, update: bool = True) -> pd.DataFrame:
        """Feature rows for every match in ``df`` (chronological order)."""
        ordered = df.sort_values(["date", "competition", "home_team"], kind="mergesort")
        rows: list[dict] = []
        for _, row in ordered.iterrows():
            rows.append(self._row_features(row))
            if update and not pd.isna(row["home_goals"]):
                self._observe(row)
        out = pd.DataFrame(rows, index=ordered.index)
        return out.reindex(df.index)

    def features_for_fixture(
        self,
        *,
        date,
        competition: str,
        season: str,
        home_team: str,
        away_team: str,
        stage: str | None = None,
        neutral_venue: bool = False,
    ) -> pd.Series:
        """Feature row for a fixture that has not been played.

        Used at inference time. Shares the same code path as training so a
        prediction cannot be built from a different feature definition.
        """
        row = pd.Series(
            {
                "date": pd.Timestamp(date),
                "competition": competition,
                "season": season,
                "stage": stage,
                "home_team": home_team,
                "away_team": away_team,
                "neutral_venue": bool(neutral_venue),
                "home_goals": np.nan,
                "away_goals": np.nan,
                "ht_home_goals": np.nan,
                "ht_away_goals": np.nan,
            }
        )
        return pd.Series(self._row_features(row))

    # -- internals ---------------------------------------------------------
    def _row_features(self, row) -> dict:
        date = pd.Timestamp(row["date"])
        home, away = row["home_team"], row["away_team"]
        competition = row.get("competition", "") or ""
        neutral = bool(row.get("neutral_venue", False))
        stage = row.get("stage")

        home_state = self.teams[home]
        away_state = self.teams[away]
        comp_state = self.competitions[competition]

        out: dict = {col: row.get(col) for col in CONTEXT_COLUMNS if col in row.index}
        out["date"] = date

        # -- ratings
        out["elo_home"] = self.elo.rating(home)
        out["elo_away"] = self.elo.rating(away)
        out["elo_diff"] = self.elo.rating_difference(home, away, neutral=neutral)
        out["elo_expected_home"] = self.elo.expected_home_score(home, away, neutral=neutral)

        # -- form
        out.update(home_state.features(date, "home", "home"))
        out.update(away_state.features(date, "away", "away"))

        # -- matchup: this team's attack against that team's defence
        out["matchup_home_attack_vs_away_defence"] = _safe_sub(
            out.get("home_attack_decayed"), out.get("away_defence_decayed")
        )
        out["matchup_away_attack_vs_home_defence"] = _safe_sub(
            out.get("away_attack_decayed"), out.get("home_defence_decayed")
        )
        out["form_ppg_diff"] = _safe_sub(
            out.get("home_last5_ppg"), out.get("away_last5_ppg")
        )
        out["form_gd_diff"] = _safe_sub(
            out.get("home_last5_gd"), out.get("away_last5_gd")
        )
        out["xg_diff_decayed"] = _safe_sub(
            _safe_sub(out.get("home_xg_for_decayed"), out.get("home_xg_against_decayed")),
            _safe_sub(out.get("away_xg_for_decayed"), out.get("away_xg_against_decayed")),
        )
        out["btts_rate_combined"] = _safe_mean(
            out.get("home_last10_btts_rate"), out.get("away_last10_btts_rate")
        )
        out["over25_rate_combined"] = _safe_mean(
            out.get("home_last10_over25_rate"), out.get("away_last10_over25_rate")
        )
        out["expected_total_goals_form"] = _safe_sum(
            out.get("home_attack_decayed"), out.get("away_attack_decayed"),
            out.get("home_defence_decayed"), out.get("away_defence_decayed"),
        )
        out["rest_days_diff"] = _safe_sub(
            out.get("home_rest_days"), out.get("away_rest_days")
        )
        out["congestion_diff"] = _safe_sub(
            out.get("home_matches_14d"), out.get("away_matches_14d")
        )

        # -- competition context
        out["comp_avg_home_goals"] = comp_state.avg_home_goals
        out["comp_avg_away_goals"] = comp_state.avg_away_goals
        out["comp_home_win_rate"] = comp_state.home_win_rate
        out["comp_draw_rate"] = comp_state.draw_rate
        out["comp_first_half_share"] = comp_state.first_half_share
        out["comp_matches_seen"] = float(comp_state.n)
        out["is_knockout"] = float(is_knockout_stage(stage))
        out["is_neutral"] = float(neutral)

        # -- head to head (order-independent pairing, oriented to this fixture)
        h2h = self.head_to_head[_pair_key(home, away)]
        out.update(_h2h_features(h2h, home))

        # -- data-quality signals, also used by the confidence layer
        out["history_min"] = float(min(home_state.n_matches, away_state.n_matches))
        out["has_enough_history"] = float(
            min(home_state.n_matches, away_state.n_matches) >= self.min_history
        )

        # -- targets
        if not pd.isna(row.get("home_goals")):
            hg, ag = int(row["home_goals"]), int(row["away_goals"])
            out["target_home_goals"] = hg
            out["target_away_goals"] = ag
            out["target_total_goals"] = hg + ag
            # H / U / B: the HUB market's own labels (home win, draw = the
            # Norwegian "uavgjort", away win). One vocabulary everywhere.
            out["target_result"] = "H" if hg > ag else ("U" if hg == ag else "B")
            out["target_btts"] = int(hg > 0 and ag > 0)
            out["target_ht_home_goals"] = (
                np.nan if pd.isna(row.get("ht_home_goals")) else int(row["ht_home_goals"])
            )
            out["target_ht_away_goals"] = (
                np.nan if pd.isna(row.get("ht_away_goals")) else int(row["ht_away_goals"])
            )
        return out

    def _observe(self, row) -> None:
        date = pd.Timestamp(row["date"])
        home, away = row["home_team"], row["away_team"]
        competition = row.get("competition", "") or ""
        comp_state = self.competitions[competition]

        # xG proxy from shots on target, using only the conversion rate the
        # competition had shown *before* this match.
        conversion = comp_state.goals_per_sot
        home_xg = _xg_proxy(row.get("home_shots_on_target"), conversion)
        away_xg = _xg_proxy(row.get("away_shots_on_target"), conversion)
        if not pd.isna(row.get("home_xg")):        # a real xG feed wins if present
            home_xg = float(row["home_xg"])
        if not pd.isna(row.get("away_xg")):
            away_xg = float(row["away_xg"])

        ht_home = None if pd.isna(row.get("ht_home_goals")) else int(row["ht_home_goals"])
        ht_away = None if pd.isna(row.get("ht_away_goals")) else int(row["ht_away_goals"])
        season = str(row.get("season") or "")

        self.teams[home].observe(
            MatchRecord(
                date=date, competition=competition, season=season, is_home=True,
                goals_for=int(row["home_goals"]), goals_against=int(row["away_goals"]),
                ht_goals_for=ht_home, ht_goals_against=ht_away,
                shots_for=_opt(row.get("home_shots")), shots_against=_opt(row.get("away_shots")),
                sot_for=_opt(row.get("home_shots_on_target")),
                sot_against=_opt(row.get("away_shots_on_target")),
                corners_for=_opt(row.get("home_corners")),
                xg_for=home_xg, xg_against=away_xg,
            )
        )
        self.teams[away].observe(
            MatchRecord(
                date=date, competition=competition, season=season, is_home=False,
                goals_for=int(row["away_goals"]), goals_against=int(row["home_goals"]),
                ht_goals_for=ht_away, ht_goals_against=ht_home,
                shots_for=_opt(row.get("away_shots")), shots_against=_opt(row.get("home_shots")),
                sot_for=_opt(row.get("away_shots_on_target")),
                sot_against=_opt(row.get("home_shots_on_target")),
                corners_for=_opt(row.get("away_corners")),
                xg_for=away_xg, xg_against=home_xg,
            )
        )
        comp_state.observe(row)
        self.head_to_head[_pair_key(home, away)].append(
            {"home": home, "home_goals": int(row["home_goals"]),
             "away_goals": int(row["away_goals"]), "date": date}
        )
        self.elo.update(
            home, away, int(row["home_goals"]), int(row["away_goals"]),
            competition=competition, season=season,
            neutral=bool(row.get("neutral_venue", False)),
        )


# -- helpers ----------------------------------------------------------------
def _pair_key(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a <= b else (b, a)


def _opt(value):
    return None if value is None or pd.isna(value) else float(value)


def _xg_proxy(shots_on_target, conversion: float) -> float | None:
    """Expected goals estimated from shots on target.

    This is a *proxy*, not a shot-quality xG model: without shot locations the
    best available estimate is the competition's own conversion rate applied to
    shots on target. It is reported as ``xg_proxy`` everywhere so it is never
    mistaken for an Opta/StatsBomb feed.
    """
    if shots_on_target is None or pd.isna(shots_on_target) or pd.isna(conversion):
        return None
    return float(shots_on_target) * float(conversion)


def _safe_sub(a, b):
    if a is None or b is None or pd.isna(a) or pd.isna(b):
        return np.nan
    return a - b


def _safe_sum(*values):
    clean = [v for v in values if v is not None and not pd.isna(v)]
    return sum(clean) if len(clean) == len(values) else np.nan


def _safe_mean(*values):
    clean = [v for v in values if v is not None and not pd.isna(v)]
    return sum(clean) / len(clean) if clean else np.nan


def _h2h_features(history, home_team: str) -> dict[str, float]:
    if not history:
        return {"h2h_matches": 0.0, "h2h_home_win_rate": np.nan,
                "h2h_avg_total_goals": np.nan, "h2h_btts_rate": np.nan,
                "h2h_goal_diff": np.nan}
    wins = totals = btts = diffs = 0.0
    for match in history:
        # Orient every past meeting to the team that is at home this time.
        if match["home"] == home_team:
            gf, ga = match["home_goals"], match["away_goals"]
        else:
            gf, ga = match["away_goals"], match["home_goals"]
        wins += gf > ga
        totals += gf + ga
        btts += (gf > 0 and ga > 0)
        diffs += gf - ga
    n = len(history)
    return {
        "h2h_matches": float(n),
        "h2h_home_win_rate": wins / n,
        "h2h_avg_total_goals": totals / n,
        "h2h_btts_rate": btts / n,
        "h2h_goal_diff": diffs / n,
    }


def feature_columns(df: pd.DataFrame) -> list[str]:
    """Numeric model inputs: everything that is neither context nor target."""
    excluded = set(CONTEXT_COLUMNS) | set(TARGET_COLUMNS)
    return [
        c for c in df.columns
        if c not in excluded and pd.api.types.is_numeric_dtype(df[c])
    ]
