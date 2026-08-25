"""Canonical match schema.

Every ingestion adapter, whatever its source format, emits rows conforming to
this schema. Downstream code (cleaning, features, models) reads only canonical
column names, so adding a new data source never touches the modelling layer.

Optional fields are genuinely optional: a source that cannot supply shots or
half-time goals leaves them null, and the data-quality layer records that
rather than silently imputing a value.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np
import pandas as pd

# --- identity / context ----------------------------------------------------
IDENTITY_FIELDS: tuple[str, ...] = (
    "match_id",        # deterministic hash of (competition, date, home, away)
    "date",            # tz-naive UTC date of kickoff
    "competition",     # canonical competition code, e.g. ENG_PL
    "season",          # canonical season label, e.g. "2023/24"
    "stage",           # league | group | round_of_16 | ... (nullable)
    "home_team",       # canonical team name
    "away_team",
    "neutral_venue",   # bool
)

# --- outcome (post-match: never usable as a feature for the same match) -----
RESULT_FIELDS: tuple[str, ...] = (
    "home_goals",      # full time, regulation (90' + stoppage)
    "away_goals",
    "ht_home_goals",   # half time
    "ht_away_goals",
)

# --- optional match statistics ---------------------------------------------
STAT_FIELDS: tuple[str, ...] = (
    "home_shots", "away_shots",
    "home_shots_on_target", "away_shots_on_target",
    "home_corners", "away_corners",
    "home_fouls", "away_fouls",
    "home_yellow", "away_yellow",
    "home_red", "away_red",
    "home_possession", "away_possession",
    "home_xg", "away_xg",
    "referee",
)

# --- optional market data ---------------------------------------------------
ODDS_FIELDS: tuple[str, ...] = (
    "odds_home", "odds_draw", "odds_away",
    "odds_over25", "odds_under25",
)

ALL_FIELDS: tuple[str, ...] = IDENTITY_FIELDS + RESULT_FIELDS + STAT_FIELDS + ODDS_FIELDS

#: Fields that describe what happened during or after the match. Feature code
#: may only read these for *earlier* matches - see features/builder.py.
POST_MATCH_FIELDS: frozenset[str] = frozenset(RESULT_FIELDS + STAT_FIELDS + ODDS_FIELDS)

DTYPES: dict[str, str] = {
    "match_id": "string",
    "date": "datetime64[ns]",
    "competition": "string",
    "season": "string",
    "stage": "string",
    "home_team": "string",
    "away_team": "string",
    "neutral_venue": "boolean",
    "referee": "string",
    **{c: "Float64" for c in (
        "home_possession", "away_possession", "home_xg", "away_xg",
        *ODDS_FIELDS,
    )},
    **{c: "Int64" for c in (
        *RESULT_FIELDS,
        "home_shots", "away_shots",
        "home_shots_on_target", "away_shots_on_target",
        "home_corners", "away_corners",
        "home_fouls", "away_fouls",
        "home_yellow", "away_yellow",
        "home_red", "away_red",
    )},
}


@dataclass
class ValidationIssue:
    """One problem found in a batch of ingested rows."""

    level: str          # "error" (row dropped) | "warning" (row kept, flagged)
    code: str
    message: str
    n_rows: int
    sample: list = field(default_factory=list)

    def __str__(self) -> str:  # pragma: no cover - display helper
        return f"[{self.level}] {self.code}: {self.message} (n={self.n_rows})"


@dataclass
class ValidationReport:
    issues: list[ValidationIssue] = field(default_factory=list)
    n_input: int = 0
    n_output: int = 0

    def add(self, level: str, code: str, message: str, n_rows: int, sample=None) -> None:
        if n_rows:
            # `sample or []` would evaluate a pandas Series' truthiness, which
            # raises; samples arrive as Series often enough to matter.
            values = [] if sample is None else list(sample)
            self.issues.append(
                ValidationIssue(level, code, message, int(n_rows), values[:5])
            )

    @property
    def errors(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.level == "error"]

    def summary(self) -> str:
        head = f"{self.n_input} rows in -> {self.n_output} rows out"
        if not self.issues:
            return head + " (clean)"
        return head + "\n" + "\n".join(f"  {i}" for i in self.issues)


def empty_frame() -> pd.DataFrame:
    """An empty frame with the full canonical schema and correct dtypes."""
    df = pd.DataFrame({c: pd.Series(dtype=object) for c in ALL_FIELDS})
    return coerce_dtypes(df)


def coerce_dtypes(df: pd.DataFrame) -> pd.DataFrame:
    """Add any missing canonical columns as null and apply canonical dtypes."""
    df = df.copy()
    for col in ALL_FIELDS:
        if col not in df.columns:
            df[col] = pd.NA
    for col, dtype in DTYPES.items():
        if dtype.startswith("datetime"):
            df[col] = pd.to_datetime(df[col], errors="coerce")
        elif dtype in ("Int64", "Float64"):
            df[col] = pd.to_numeric(df[col], errors="coerce").astype(dtype)
        else:
            df[col] = df[col].astype(dtype)
    return df[list(ALL_FIELDS)]


def make_match_id(
    competition: Sequence[str], date: Sequence, home: Sequence[str], away: Sequence[str]
) -> pd.Series:
    """Deterministic id so re-ingesting the same fixture is idempotent."""
    import hashlib

    keys = pd.Series(
        [
            f"{c}|{pd.Timestamp(d).date() if pd.notna(d) else 'NaT'}|{h}|{a}"
            for c, d, h, a in zip(competition, date, home, away)
        ]
    )
    return keys.map(lambda k: hashlib.sha1(k.encode("utf-8")).hexdigest()[:16]).astype("string")


def available_fields(df: pd.DataFrame, fields: Sequence[str] | None = None) -> dict[str, float]:
    """Fraction of non-null values per field - drives the data-quality report."""
    fields = fields or ALL_FIELDS
    n = max(len(df), 1)
    return {c: float(df[c].notna().sum()) / n for c in fields if c in df.columns}
