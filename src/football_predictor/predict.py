"""Inference: turn a fixture into a full set of calibrated market probabilities.

Loads a bundle written by :mod:`football_predictor.train` and never fits
anything on data it should not see. In particular, asking for a date that lies
inside the training period does **not** hand back a hindsight fit: the engine
replays team state to the day before kickoff and refits the goal models on
matches before that date, using only the members that can be honestly
replayed. The response says which mode was used.

Market consistency is enforced in one place. The three-way HUB probabilities
come from the calibrated ensemble; a consensus score matrix is then reconciled
to those probabilities, and every other market - BTTS, over/under, team totals,
exact scores - is read off that single reconciled distribution.
"""
from __future__ import annotations

import copy
import functools
import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .confidence import assess_confidence, assess_data_quality
from .config import get_competition, load_competitions
from .explain import explain
from .features.builder import FeatureBuilder
from .models.base import MarketPredictions
from .models.dixon_coles import DixonColesModel, GoalModelConfig, PoissonModel
from .models.halves import HalvesModel
from .models.score_matrix import (
    TEAM_LINES, TOTAL_LINES, ScoreMatrix, blend_matrices, reconcile_to_result,
)
from .normalize.seasons import canonical_season, season_from_date
from .normalize.teams import display_team
from .train import REPLAY_SAFE_MEMBERS, TrainedBundle, load_bundle

log = logging.getLogger(__name__)

GOAL_MEMBERS = ("dixon_coles", "poisson", "lightgbm_goals")


class UnknownTeamError(ValueError):
    pass


@dataclass
class _AsOfState:
    """Everything refitted for one prediction date."""

    builder: FeatureBuilder
    dixon_coles: DixonColesModel
    poisson: PoissonModel
    halves: HalvesModel | None
    historical: bool


class PredictionEngine:
    """Serves predictions from a trained bundle."""

    def __init__(self, bundle: TrainedBundle | None = None) -> None:
        self.bundle = bundle or load_bundle()
        self._replay_cache: dict[str, _AsOfState] = {}
        matches = self.bundle.matches
        self._teams_by_competition = {
            code: sorted(
                set(group["home_team"]) | set(group["away_team"])
            )
            for code, group in matches.groupby("competition")
        }
        self._seasons_by_competition = {
            code: sorted(group["season"].unique())
            for code, group in matches.groupby("competition")
        }
        self._competition_counts = matches["competition"].value_counts().to_dict()
        self._ht_coverage = (
            matches.groupby("competition")["ht_home_goals"]
            .apply(lambda s: float(s.notna().mean())).to_dict()
        )
        self._shot_coverage = (
            matches.groupby("competition")["home_shots"]
            .apply(lambda s: float(s.notna().mean())).to_dict()
        )

    # -- catalogue for the UI ---------------------------------------------
    def competitions(self) -> list[dict]:
        known = load_competitions()
        out = []
        for code in self.bundle.competitions:
            comp = known.get(code)
            out.append({
                "code": code,
                "name": comp.name if comp else code,
                "country": comp.country if comp else "",
                "tier": comp.tier if comp else 2,
                "format": comp.format if comp else "league",
                "seasons": self._seasons_by_competition.get(code, []),
                "n_matches": int(self._competition_counts.get(code, 0)),
                "n_teams": len(self._teams_by_competition.get(code, [])),
            })
        return sorted(out, key=lambda c: (c["tier"], c["name"]))

    def teams(self, competition: str, season: str | None = None) -> list[dict]:
        matches = self.bundle.matches
        subset = matches[matches["competition"] == competition]
        if season:
            subset = subset[subset["season"] == canonical_season(season)]
        names = sorted(set(subset["home_team"]) | set(subset["away_team"]))
        return [{"name": n, "display": display_team(n)} for n in names]

    def seasons(self, competition: str) -> list[str]:
        return self._seasons_by_competition.get(competition, [])

    # -- state for a date --------------------------------------------------
    def _state_for(self, as_of: pd.Timestamp) -> _AsOfState:
        cutoff = self.bundle.trained_through
        if as_of > cutoff:
            # A genuine forecast: current state is already correct.
            return _AsOfState(
                builder=self.bundle.builder,
                dixon_coles=self.bundle.dixon_coles,
                poisson=self.bundle.poisson,
                halves=self.bundle.halves,
                historical=False,
            )

        key = as_of.strftime("%Y-%m-%d")
        if key in self._replay_cache:
            return self._replay_cache[key]

        matches = self.bundle.matches
        history = matches[matches["date"] < as_of]
        if history.empty:
            raise ValueError(f"no match history before {key}")

        season = season_from_date(as_of)
        snapshot = self.bundle.builder_snapshots.get(season)
        if snapshot is None:
            # No snapshot this far back: rebuild from scratch. Slow but correct.
            log.info("no snapshot for %s, rebuilding state from scratch", season)
            builder = FeatureBuilder()
            replay = history
        else:
            builder = copy.deepcopy(snapshot)
            season_start = matches[matches["season"] == season]["date"].min()
            replay = history[history["date"] >= season_start]

        for _, row in replay.sort_values(
            ["date", "competition", "home_team"], kind="mergesort"
        ).iterrows():
            if not pd.isna(row["home_goals"]):
                builder._observe(row)

        dixon_coles = DixonColesModel(
            GoalModelConfig.from_config("dixon_coles")
        ).fit(history, reference_date=as_of)
        poisson = PoissonModel().fit(history, reference_date=as_of)
        try:
            halves = HalvesModel.from_config().fit(history, reference_date=as_of)
        except ValueError:
            halves = None

        state = _AsOfState(builder, dixon_coles, poisson, halves, historical=True)
        if len(self._replay_cache) > 24:
            self._replay_cache.clear()
        self._replay_cache[key] = state
        return state

    # -- prediction --------------------------------------------------------
    def predict(
        self,
        *,
        competition: str,
        home_team: str,
        away_team: str,
        date,
        season: str | None = None,
        stage: str | None = None,
        neutral_venue: bool | None = None,
    ) -> dict:
        comp = get_competition(competition)
        known = set(self._teams_by_competition.get(competition, []))
        for team in (home_team, away_team):
            if team not in known and team not in self.bundle.builder.teams:
                raise UnknownTeamError(
                    f"{team!r} has no recorded matches; known teams for "
                    f"{competition}: {len(known)}"
                )
        if home_team == away_team:
            raise ValueError("a team cannot play itself")

        as_of = pd.Timestamp(date).normalize()
        season = canonical_season(season) if season else season_from_date(as_of)
        neutral = comp.neutral_venue if neutral_venue is None else bool(neutral_venue)
        state = self._state_for(as_of)

        row = state.builder.features_for_fixture(
            date=as_of, competition=competition, season=season,
            home_team=home_team, away_team=away_team,
            stage=stage, neutral_venue=neutral,
        )

        members, member_names = self._member_probabilities(row, state, neutral,
                                                           home_team, away_team)
        hub, ensemble_used = self._blend_hub(members, state.historical)

        matrix = self._consensus_matrix(row, state, neutral, home_team, away_team)
        reconciled = ScoreMatrix(reconcile_to_result(matrix.matrix, hub))

        first_half = second_half = None
        if state.halves is not None:
            try:
                first_half = state.halves.first_half_matrix(
                    home_team, away_team, neutral=neutral
                )
                second_half = state.halves.second_half_matrix(
                    home_team, away_team, neutral=neutral
                )
            except Exception:
                log.exception("half-time model failed")

        book = MarketPredictions.from_matrices(
            [reconciled],
            [first_half] if first_half else None,
            [second_half] if second_half else None,
        )

        history_home = float(row.get("home_history") or 0)
        history_away = float(row.get("away_history") or 0)
        confidence = assess_confidence(
            hub_array(hub),
            [m for m in members.values()],
            home_history=int(history_home),
            away_history=int(history_away),
            calibration_ece=self.bundle.metadata.get("ensemble_ece"),
        )
        quality = assess_data_quality(
            home_history=int(history_home),
            away_history=int(history_away),
            has_half_time_model=first_half is not None,
            has_xg=bool(row.get("home_xg_for_decayed") == row.get("home_xg_for_decayed")),
            has_shots=self._shot_coverage.get(competition, 0.0) > 0.2,
            teams_known_to_goal_model=(
                state.dixon_coles.knows(home_team) and state.dixon_coles.knows(away_team)
            ),
            historical_replay=state.historical,
            competition_matches=int(self._competition_counts.get(competition, 0)),
        )

        return {
            "fixture": {
                "competition": competition,
                "competition_name": comp.name,
                "season": season,
                "date": as_of.strftime("%Y-%m-%d"),
                "home_team": home_team,
                "away_team": away_team,
                "home_display": display_team(home_team),
                "away_display": display_team(away_team),
                "neutral_venue": neutral,
                "stage": stage,
            },
            "expected_goals": {
                "home": round(float(book.home_rate[0]), 3),
                "away": round(float(book.away_rate[0]), 3),
                "total": round(float(book.home_rate[0] + book.away_rate[0]), 3),
            },
            "hub": {
                "home": round(hub["H"], 4),
                "draw": round(hub["U"], 4),
                "away": round(hub["B"], 4),
            },
            "btts": {
                "yes": round(float(book.btts[0]), 4),
                "no": round(1.0 - float(book.btts[0]), 4),
            },
            "totals": {
                str(line): {
                    "over": round(float(probs[0]), 4),
                    "under": round(1.0 - float(probs[0]), 4),
                }
                for line, probs in book.totals.items()
            },
            "team_goals": {
                "home": _team_block(book.home_goals_over, book.home_clean_sheet, 0,
                                    reconciled, "home"),
                "away": _team_block(book.away_goals_over, book.away_clean_sheet, 0,
                                    reconciled, "away"),
            },
            "halves": _halves_block(book, first_half, second_half),
            "most_likely_scores": reconciled.top_scores(6),
            "confidence": {
                "label": confidence.label,
                "score": confidence.score,
                "components": confidence.components,
                "notes": confidence.notes,
            },
            "data_quality": {
                "label": quality.label,
                "score": quality.score,
                "checks": quality.checks,
                "warnings": quality.warnings,
            },
            "factors": [
                {"name": f.name, "detail": f.detail, "favours": f.favours,
                 "weight": round(f.weight, 3), "value": f.value}
                for f in explain(row, home_team=display_team(home_team),
                                 away_team=display_team(away_team))
            ],
            "model": {
                "mode": "historical_replay" if state.historical else "forecast",
                "members": member_names,
                "ensemble_weights": {
                    k: round(v, 4) for k, v in (ensemble_used or {}).items()
                },
                "trained_through": self.bundle.trained_through.strftime("%Y-%m-%d"),
                "dixon_coles_rho": round(float(state.dixon_coles.rho), 4),
                "home_advantage": round(float(state.dixon_coles.home_advantage), 4),
            },
        }

    # -- internals ---------------------------------------------------------
    def _member_probabilities(self, row, state, neutral, home_team, away_team):
        members: dict[str, np.ndarray] = {}

        for name, model in (("dixon_coles", state.dixon_coles),
                            ("poisson", state.poisson)):
            probs = model.score_matrix(
                home_team, away_team, neutral=neutral
            ).result_probabilities()
            members[name] = np.array([[probs["H"], probs["U"], probs["B"]]])

        if self.bundle.elo_outcome is not None:
            members["elo"] = self.bundle.elo_outcome.predict_proba(
                np.array([row.get("elo_diff", 0.0)])
            )

        if not state.historical:
            frame = _feature_frame(row, self.bundle.feature_names)
            for name, model in self.bundle.ml_members.items():
                try:
                    members[name] = model.predict_proba(frame)
                except Exception:
                    log.exception("member %s failed", name)

        for name, probs in list(members.items()):
            calibrator = self.bundle.calibrators.get(name)
            if calibrator is not None and calibrator.fitted:
                members[name] = calibrator.transform(probs)
        return members, list(members)

    def _blend_hub(self, members, historical: bool):
        ensemble = self.bundle.replay_ensemble if historical else self.bundle.ensemble
        calibrator = (
            self.bundle.replay_calibrator if historical
            else self.bundle.calibrators.get("ensemble")
        )
        if ensemble is None or not set(ensemble.member_names) <= set(members):
            available = {k: v for k, v in members.items()
                         if not historical or k in REPLAY_SAFE_MEMBERS}
            stacked = np.mean(np.stack(list(available.values())), axis=0)
            probs = stacked / stacked.sum()
            return _hub_dict(probs[0]), None
        probs = ensemble.predict_proba(
            {k: members[k] for k in ensemble.member_names}
        )
        if calibrator is not None and calibrator.fitted:
            probs = calibrator.transform(probs)
        return _hub_dict(probs[0]), ensemble.weight_table()

    def _consensus_matrix(self, row, state, neutral, home_team, away_team) -> ScoreMatrix:
        """Geometric blend of the goal models' score distributions."""
        matrices, weights = [], []
        blend_weights = (self.bundle.ou_ensemble.weight_table()
                         if self.bundle.ou_ensemble else {})
        for name, model in (("dixon_coles", state.dixon_coles),
                            ("poisson", state.poisson)):
            matrices.append(
                model.score_matrix(home_team, away_team, neutral=neutral).matrix
            )
            weights.append(blend_weights.get(name, 1.0))

        goal_model = self.bundle.ml_members.get("lightgbm_goals")
        if goal_model is not None and not state.historical:
            try:
                frame = _feature_frame(row, self.bundle.feature_names)
                matrices.append(goal_model.score_matrices(frame)[0].matrix)
                weights.append(blend_weights.get("lightgbm", 1.0))
            except Exception:
                log.exception("ML goal model failed")

        return ScoreMatrix(blend_matrices(matrices, weights))


# -- helpers -----------------------------------------------------------------
def _feature_frame(row, feature_names: list[str]) -> pd.DataFrame:
    frame = pd.DataFrame([row.to_dict()])
    return frame.reindex(columns=feature_names).astype(float)


def _hub_dict(probs) -> dict[str, float]:
    values = np.clip(np.asarray(probs, dtype=float), 1e-9, None)
    values = values / values.sum()
    return {"H": float(values[0]), "U": float(values[1]), "B": float(values[2])}


def hub_array(hub: dict[str, float]) -> np.ndarray:
    return np.array([[hub["H"], hub["U"], hub["B"]]])


def _team_block(over_lines, clean_sheet, index: int, matrix: ScoreMatrix, side: str):
    return {
        "expected": round(
            float(matrix.expected_home_goals if side == "home"
                  else matrix.expected_away_goals), 3
        ),
        "to_score": round(float(matrix.team_to_score(side)), 4),
        "clean_sheet": round(float(clean_sheet[index]), 4),
        "over": {
            str(line): round(float(probs[index]), 4)
            for line, probs in over_lines.items()
        },
    }


def _halves_block(book: MarketPredictions, first_half, second_half):
    if book.ht_hub is None or first_half is None:
        return {"available": False,
                "reason": "no half-time data for this competition"}
    out = {
        "available": True,
        "first_half": {
            "hub": {
                "home": round(float(book.ht_hub[0][0]), 4),
                "draw": round(float(book.ht_hub[0][1]), 4),
                "away": round(float(book.ht_hub[0][2]), 4),
            },
            "expected_goals": {
                "home": round(float(book.ht_home_rate[0]), 3),
                "away": round(float(book.ht_away_rate[0]), 3),
                "total": round(float(book.ht_home_rate[0] + book.ht_away_rate[0]), 3),
            },
            "btts": {
                "yes": round(float(book.ht_btts[0]), 4),
                "no": round(1.0 - float(book.ht_btts[0]), 4),
            },
            "totals": {
                str(line): {"over": round(float(probs[0]), 4),
                            "under": round(1.0 - float(probs[0]), 4)}
                for line, probs in book.ht_totals.items()
            },
            "team_goals": {
                "home_over_0.5": round(float(first_half.team_to_score("home")), 4),
                "away_over_0.5": round(float(first_half.team_to_score("away")), 4),
            },
            "most_likely_scores": first_half.top_scores(3),
        },
    }
    if second_half is not None:
        out["second_half"] = {
            "expected_goals": {
                "home": round(float(book.sh_home_rate[0]), 3),
                "away": round(float(book.sh_away_rate[0]), 3),
                "total": round(float(book.sh_home_rate[0] + book.sh_away_rate[0]), 3),
            },
            "totals": {
                str(line): {"over": round(float(probs[0]), 4),
                            "under": round(1.0 - float(probs[0]), 4)}
                for line, probs in book.sh_totals.items()
            },
        }
        first_total = float(book.ht_home_rate[0] + book.ht_away_rate[0])
        second_total = float(book.sh_home_rate[0] + book.sh_away_rate[0])
        grand = first_total + second_total
        out["goal_split"] = {
            "first_half_share": round(first_total / grand, 4) if grand else None,
            "second_half_share": round(second_total / grand, 4) if grand else None,
        }
    return out


@functools.lru_cache(maxsize=1)
def default_engine() -> PredictionEngine:
    return PredictionEngine()
