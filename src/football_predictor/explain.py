"""Explanations for a single prediction.

Every factor here is read back out of the same feature row the model scored,
so the explanation describes the actual inputs rather than a plausible story
about them. If a feature is missing for this fixture, no factor is emitted for
it - nothing is invented to fill the panel.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class Factor:
    name: str
    detail: str
    #: Which side the factor favours: "home", "away" or "neutral".
    favours: str
    #: Rough magnitude in [0, 1], used only for ordering and bar widths.
    weight: float
    value: float | None = None


def _get(row, key):
    value = row.get(key)
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    if pd.isna(value):
        return None
    return float(value)


def _side(value: float, threshold: float = 0.0) -> str:
    if value > threshold:
        return "home"
    return "away" if value < -threshold else "neutral"


def explain(row, *, home_team: str, away_team: str, max_factors: int = 7) -> list[Factor]:
    """Ordered list of the factors actually driving this prediction."""
    factors: list[Factor] = []

    elo_diff = _get(row, "elo_diff")
    if elo_diff is not None:
        factors.append(Factor(
            name="Elo rating difference",
            detail=(
                f"{home_team} rated {abs(elo_diff):.0f} points "
                f"{'above' if elo_diff > 0 else 'below'} {away_team}"
                + (" (home advantage included)" if not _get(row, "is_neutral") else "")
            ),
            favours=_side(elo_diff, 10),
            weight=float(np.clip(abs(elo_diff) / 300.0, 0, 1)),
            value=round(elo_diff, 1),
        ))

    home_attack = _get(row, "home_attack_decayed")
    away_defence = _get(row, "away_defence_decayed")
    if home_attack is not None and away_defence is not None:
        factors.append(Factor(
            name="Home attack vs away defence",
            detail=(
                f"{home_team} scoring {home_attack:.2f}/match recently; "
                f"{away_team} conceding {away_defence:.2f}"
            ),
            favours="home" if home_attack > away_defence else "away",
            weight=float(np.clip(abs(home_attack - away_defence) / 1.5, 0, 1)),
            value=round(home_attack - away_defence, 3),
        ))

    away_attack = _get(row, "away_attack_decayed")
    home_defence = _get(row, "home_defence_decayed")
    if away_attack is not None and home_defence is not None:
        factors.append(Factor(
            name="Away attack vs home defence",
            detail=(
                f"{away_team} scoring {away_attack:.2f}/match recently; "
                f"{home_team} conceding {home_defence:.2f}"
            ),
            favours="away" if away_attack > home_defence else "home",
            weight=float(np.clip(abs(away_attack - home_defence) / 1.5, 0, 1)),
            value=round(away_attack - home_defence, 3),
        ))

    form = _get(row, "form_ppg_diff")
    if form is not None:
        factors.append(Factor(
            name="Recent form (last 5)",
            detail=(
                f"{home_team} {_get(row, 'home_last5_ppg') or 0:.2f} points/match vs "
                f"{away_team} {_get(row, 'away_last5_ppg') or 0:.2f}"
            ),
            favours=_side(form, 0.15),
            weight=float(np.clip(abs(form) / 2.0, 0, 1)),
            value=round(form, 3),
        ))

    xg = _get(row, "xg_diff_decayed")
    if xg is not None:
        factors.append(Factor(
            name="Expected-goals trend (shot-based proxy)",
            detail=(
                f"net expected-goals difference {xg:+.2f} per match in favour of "
                f"{home_team if xg > 0 else away_team}"
            ),
            favours=_side(xg, 0.1),
            weight=float(np.clip(abs(xg) / 1.5, 0, 1)),
            value=round(xg, 3),
        ))

    btts = _get(row, "btts_rate_combined")
    if btts is not None:
        factors.append(Factor(
            name="Both-teams-to-score history",
            detail=f"both sides scored in {btts * 100:.0f}% of their last 10 matches",
            favours="neutral",
            weight=float(abs(btts - 0.5) * 2),
            value=round(btts, 3),
        ))

    over = _get(row, "over25_rate_combined")
    if over is not None:
        factors.append(Factor(
            name="Over 2.5 goals history",
            detail=f"{over * 100:.0f}% of their last 10 matches went over 2.5 goals",
            favours="neutral",
            weight=float(abs(over - 0.5) * 2),
            value=round(over, 3),
        ))

    congestion = _get(row, "congestion_diff")
    rest = _get(row, "rest_days_diff")
    if congestion is not None and abs(congestion) >= 1:
        heavier = away_team if congestion < 0 else home_team
        factors.append(Factor(
            name="Fixture congestion",
            detail=(
                f"{heavier} has played {abs(congestion):.0f} more match(es) "
                "in the last 14 days"
            ),
            favours="away" if congestion > 0 else "home",
            weight=float(np.clip(abs(congestion) / 3.0, 0, 1)),
            value=round(congestion, 2),
        ))
    elif rest is not None and abs(rest) >= 2:
        factors.append(Factor(
            name="Rest days",
            detail=(
                f"{home_team} had {_get(row, 'home_rest_days') or 0:.0f} days' rest, "
                f"{away_team} {_get(row, 'away_rest_days') or 0:.0f}"
            ),
            favours=_side(rest, 1),
            weight=float(np.clip(abs(rest) / 7.0, 0, 1)),
            value=round(rest, 1),
        ))

    h2h_matches = _get(row, "h2h_matches")
    h2h_diff = _get(row, "h2h_goal_diff")
    if h2h_matches and h2h_matches >= 3 and h2h_diff is not None:
        factors.append(Factor(
            name="Head to head",
            detail=(
                f"{int(h2h_matches)} recent meetings, average goal difference "
                f"{h2h_diff:+.2f} for {home_team}"
            ),
            favours=_side(h2h_diff, 0.3),
            weight=float(np.clip(abs(h2h_diff) / 2.0, 0, 1)) * 0.6,
            value=round(h2h_diff, 3),
        ))

    if _get(row, "is_knockout"):
        factors.append(Factor(
            name="Knockout tie",
            detail="knockout fixture: home advantage is typically smaller than in league play",
            favours="neutral", weight=0.3,
        ))
    if _get(row, "is_neutral"):
        factors.append(Factor(
            name="Neutral venue",
            detail="played at a neutral venue, so no home advantage is applied",
            favours="neutral", weight=0.5,
        ))

    factors.sort(key=lambda f: f.weight, reverse=True)
    return factors[:max_factors]
