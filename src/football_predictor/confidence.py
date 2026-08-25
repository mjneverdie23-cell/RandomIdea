"""Confidence and data-quality assessment.

Confidence here is a statement about how much the forecast can be relied on,
not a claim that it will be right. It combines four things a user cannot see
from the probabilities alone:

* **sharpness** - how far the top probability sits above the base rate;
* **model agreement** - how tightly the ensemble members agree;
* **sample size** - how much history the two teams have;
* **data completeness** - whether the inputs the model likes were available.

A confident-looking probability built on a promoted club's eight matches is
not the same object as one built on ten seasons, and the label says so.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

#: Reference distribution of the three outcomes across the training data.
BASE_RATES = np.array([0.46, 0.26, 0.28])


@dataclass
class Confidence:
    label: str
    score: float
    components: dict[str, float] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


@dataclass
class DataQuality:
    label: str
    score: float
    checks: list[dict] = field(default_factory=list)

    @property
    def warnings(self) -> list[str]:
        return [c["message"] for c in self.checks if c["status"] != "ok"]


def _jensen_shannon(members: list[np.ndarray]) -> float:
    """Average divergence of members from their mean - 0 means unanimity."""
    if len(members) < 2:
        return 0.0
    stacked = np.clip(np.vstack(members), 1e-12, 1.0)
    mean = stacked.mean(axis=0)
    divergences = [
        float(np.sum(p * np.log(p / mean))) for p in stacked
    ]
    return float(np.mean(divergences))


def assess_confidence(
    probabilities: np.ndarray,
    member_probabilities: list[np.ndarray] | None = None,
    *,
    home_history: int = 0,
    away_history: int = 0,
    calibration_ece: float | None = None,
) -> Confidence:
    probs = np.asarray(probabilities, dtype=float).ravel()
    notes: list[str] = []

    # Sharpness: how much more decided than the league base rate.
    top = float(probs.max())
    sharpness = float(np.clip((top - BASE_RATES.max()) / (1.0 - BASE_RATES.max()), 0, 1))

    # Agreement: small divergence between members means they tell one story.
    divergence = _jensen_shannon(member_probabilities or [])
    agreement = float(np.exp(-6.0 * divergence))
    if member_probabilities and len(member_probabilities) > 1 and agreement < 0.75:
        notes.append("models disagree noticeably on this fixture")

    # Sample size: both teams need history before form features mean anything.
    history = min(home_history, away_history)
    sample = float(np.clip(history / 30.0, 0.0, 1.0))
    if history < 10:
        notes.append(f"limited match history for one side ({history} matches)")

    # Calibration: a model measured as poorly calibrated earns less confidence.
    calibration = 1.0
    if calibration_ece is not None and np.isfinite(calibration_ece):
        calibration = float(np.clip(1.0 - calibration_ece * 4.0, 0.3, 1.0))

    score = float(
        0.30 * sharpness + 0.30 * agreement + 0.25 * sample + 0.15 * calibration
    )
    label = "High" if score >= 0.62 else ("Moderate" if score >= 0.42 else "Low")
    return Confidence(
        label=label,
        score=round(score, 4),
        components={
            "sharpness": round(sharpness, 4),
            "model_agreement": round(agreement, 4),
            "sample_size": round(sample, 4),
            "calibration": round(calibration, 4),
        },
        notes=notes,
    )


def assess_data_quality(
    *,
    home_history: int,
    away_history: int,
    has_half_time_model: bool,
    has_xg: bool,
    has_shots: bool,
    teams_known_to_goal_model: bool,
    historical_replay: bool = False,
    competition_matches: int = 0,
) -> DataQuality:
    checks: list[dict] = []

    def add(name: str, ok: bool, message: str, severity: str = "warning") -> None:
        checks.append({
            "name": name,
            "status": "ok" if ok else severity,
            "message": message,
        })

    history = min(home_history, away_history)
    add("match_history", history >= 10,
        f"{history} prior matches for the less-established side"
        if history < 10 else f"both teams have {history}+ matches of history")
    add("team_coverage", teams_known_to_goal_model,
        "a team is new to the goal model and is treated as league average"
        if not teams_known_to_goal_model else "both teams are in the fitted goal model")
    add("half_time_model", has_half_time_model,
        "no half-time data for this competition, half markets unavailable"
        if not has_half_time_model else "half-time markets available")
    add("expected_goals", has_xg,
        "no expected-goals feed; a shot-based proxy is used where shots exist"
        if not has_xg else "expected-goals inputs available", severity="info")
    add("shot_data", has_shots,
        "no shot data for this competition, so shot-derived features are absent"
        if not has_shots else "shot data available", severity="info")
    add("competition_history", competition_matches >= 200,
        f"only {competition_matches} matches recorded for this competition"
        if competition_matches < 200 else "competition has ample history")
    if historical_replay:
        add("historical_replay", True,
            "past date: state was replayed to the day before kickoff, so this "
            "is an out-of-sample forecast rather than a hindsight fit",
            severity="info")

    weights = {"warning": 1.0, "info": 0.25, "ok": 0.0}
    penalty = sum(weights.get(c["status"], 0.0) for c in checks)
    score = float(np.clip(1.0 - penalty / max(len(checks), 1), 0.0, 1.0))
    label = "Good" if score >= 0.8 else ("Fair" if score >= 0.55 else "Limited")
    return DataQuality(label=label, score=round(score, 4), checks=checks)
