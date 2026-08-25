"""Validation and cleaning of ingested match data.

Runs after ingestion and normalisation, before feature building. The guiding
rule is that a row is dropped only when it cannot be trusted as a training
example; anything merely incomplete is kept with nulls, and recorded in the
validation report so the data-quality display can tell the user about it.
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from .normalize import seasons as season_utils
from .normalize.teams import TeamNormalizer
from .schema import ValidationReport, coerce_dtypes, make_match_id

log = logging.getLogger(__name__)

#: Beyond these, a value is almost certainly a data error rather than a freak
#: match. The record for a top-flight European league match is 12 goals by one
#: side, so 15 leaves room without admitting nonsense.
LIMITS: dict[str, tuple[float, float]] = {
    "home_goals": (0, 15),
    "away_goals": (0, 15),
    "ht_home_goals": (0, 12),
    "ht_away_goals": (0, 12),
    "home_shots": (0, 60),
    "away_shots": (0, 60),
    "home_shots_on_target": (0, 40),
    "away_shots_on_target": (0, 40),
    "home_corners": (0, 30),
    "away_corners": (0, 30),
    "home_fouls": (0, 45),
    "away_fouls": (0, 45),
    "home_yellow": (0, 12),
    "away_yellow": (0, 12),
    "home_red": (0, 5),
    "away_red": (0, 5),
    "home_possession": (0, 100),
    "away_possession": (0, 100),
    "home_xg": (0, 12),
    "away_xg": (0, 12),
}


def clean_matches(
    df: pd.DataFrame,
    *,
    normalizer: TeamNormalizer | None = None,
    report: ValidationReport | None = None,
) -> tuple[pd.DataFrame, ValidationReport]:
    """Normalise, validate and de-duplicate a frame of ingested matches."""
    report = report or ValidationReport()
    report.n_input = len(df)
    out = coerce_dtypes(df)

    out = _normalise_identity(out, normalizer or TeamNormalizer(), report)
    out = _drop_unusable(out, report)
    out = _fix_impossible_halftime(out, report)
    out = _null_out_of_range(out, report)
    out = _drop_duplicates(out, report)

    out = out.sort_values(["date", "competition", "home_team"], kind="mergesort")
    out = out.reset_index(drop=True)
    report.n_output = len(out)
    return out, report


def _normalise_identity(
    df: pd.DataFrame, normalizer: TeamNormalizer, report: ValidationReport
) -> pd.DataFrame:
    out = normalizer.normalize_frame(df)

    bad_date = out["date"].isna()
    report.add("error", "unparsable_date", "kickoff date could not be parsed",
               bad_date.sum(), df.loc[bad_date, "date"].head())
    out = out[~bad_date]

    # Trust the recorded season where present, derive it where it is not.
    missing_season = out["season"].isna()
    if missing_season.any():
        out.loc[missing_season, "season"] = (
            out.loc[missing_season, "date"].map(season_utils.season_from_date)
        )
    out["season"] = out["season"].map(
        lambda s: season_utils.canonical_season(s) if pd.notna(s) else s
    ).astype("string")

    out["neutral_venue"] = out["neutral_venue"].fillna(False).astype("boolean")
    out["match_id"] = make_match_id(
        out["competition"], out["date"], out["home_team"], out["away_team"]
    )
    if normalizer.unmapped:
        report.add(
            "warning", "unmapped_team_names",
            "names resolved by rule-based cleaning rather than the alias table",
            len(normalizer.unmapped), sorted(normalizer.unmapped),
        )
    return out


def _drop_unusable(df: pd.DataFrame, report: ValidationReport) -> pd.DataFrame:
    out = df
    no_teams = out["home_team"].isna() | out["away_team"].isna() | (
        out["home_team"].fillna("") == ""
    ) | (out["away_team"].fillna("") == "")
    report.add("error", "missing_team", "match with no identifiable team", no_teams.sum())
    out = out[~no_teams]

    self_match = out["home_team"] == out["away_team"]
    report.add("error", "self_match", "team listed against itself",
               self_match.sum(), out.loc[self_match, "home_team"].head())
    out = out[~self_match]

    # An unplayed fixture is legitimate data but cannot be a training example.
    no_result = out["home_goals"].isna() | out["away_goals"].isna()
    report.add("warning", "no_result", "fixture without a full-time score (dropped from training)",
               no_result.sum())
    out = out[~no_result]
    return out


def _fix_impossible_halftime(df: pd.DataFrame, report: ValidationReport) -> pd.DataFrame:
    """Half-time goals can never exceed full-time goals."""
    out = df
    bad = (
        (out["ht_home_goals"].notna() & (out["ht_home_goals"] > out["home_goals"]))
        | (out["ht_away_goals"].notna() & (out["ht_away_goals"] > out["away_goals"]))
    )
    report.add("warning", "halftime_exceeds_fulltime",
               "half-time score above full-time score (half-time nulled)", bad.sum())
    out.loc[bad, ["ht_home_goals", "ht_away_goals"]] = pd.NA
    return out


def _null_out_of_range(df: pd.DataFrame, report: ValidationReport) -> pd.DataFrame:
    """Out-of-range statistics are nulled, not dropped.

    A corrupt shot count should not cost us an otherwise valid result, and
    silently clipping it would invent data that was never observed.
    """
    out = df
    for col, (lo, hi) in LIMITS.items():
        if col not in out.columns:
            continue
        values = pd.to_numeric(out[col], errors="coerce")
        bad = values.notna() & ((values < lo) | (values > hi))
        if bad.any():
            report.add("warning", "out_of_range",
                       f"{col} outside [{lo}, {hi}] (nulled)", bad.sum(),
                       values[bad].head().tolist())
            out.loc[bad, col] = pd.NA

    # Goals are load-bearing: a match whose result is out of range is dropped.
    for col in ("home_goals", "away_goals"):
        bad = out[col].isna()
        if bad.any():
            report.add("error", "invalid_result", f"{col} unusable after range check",
                       bad.sum())
            out = out[~bad]
    return out


def _drop_duplicates(df: pd.DataFrame, report: ValidationReport) -> pd.DataFrame:
    """Remove repeated fixtures.

    Two legs of a knockout tie are *not* duplicates - they have different home
    teams. Exact repeats of the same fixture on the same day in the same
    competition are.
    """
    out = df
    exact = out.duplicated(subset=["match_id"], keep="first")
    report.add("warning", "duplicate_match", "identical fixture ingested twice",
               exact.sum(), out.loc[exact, "match_id"].head())
    out = out[~exact]

    # Same pairing, same competition, same season, kickoffs within three days:
    # a re-listed fixture (e.g. a postponement recorded twice).
    out = out.sort_values("date", kind="mergesort")
    key = out["competition"].astype(str) + "|" + out["season"].astype(str) + "|" + \
        out["home_team"].astype(str) + "|" + out["away_team"].astype(str)
    gap = out.groupby(key, sort=False)["date"].diff()
    near = gap.notna() & (gap < pd.Timedelta(days=3))
    report.add("warning", "near_duplicate_match",
               "same fixture recorded twice within three days", near.sum())
    return out[~near]


def data_quality(df: pd.DataFrame) -> dict[str, float | int]:
    """Coverage summary used by the API's data-quality panel."""
    n = max(len(df), 1)
    return {
        "n_matches": int(len(df)),
        "n_teams": int(pd.concat([df["home_team"], df["away_team"]]).nunique()),
        "n_competitions": int(df["competition"].nunique()),
        "date_min": str(df["date"].min().date()) if len(df) else None,
        "date_max": str(df["date"].max().date()) if len(df) else None,
        "halftime_coverage": float(df["ht_home_goals"].notna().sum()) / n,
        "shots_coverage": float(df["home_shots"].notna().sum()) / n,
        "shots_on_target_coverage": float(df["home_shots_on_target"].notna().sum()) / n,
        "xg_coverage": float(df["home_xg"].notna().sum()) / n,
        "odds_coverage": float(df["odds_home"].notna().sum()) / n,
    }
