"""Season and date normalisation.

Sources label seasons inconsistently ("2324", "2023-24", "2023/2024"). The
canonical form is ``"2023/24"``. European seasons straddle a calendar year, so
a season is also derivable from a kickoff date, which matters for cup rounds
that a source labels only by year.
"""
from __future__ import annotations

import re

import pandas as pd

_SHORT = re.compile(r"^(\d{2})(\d{2})$")            # 2324
_LONG = re.compile(r"^(\d{4})[-/](\d{2,4})$")        # 2023-24, 2023/2024
_SINGLE = re.compile(r"^(\d{4})$")                   # 2022 (single-year tournament)


def _century(two_digit: int) -> int:
    """Map a two-digit year to a full year. Football data starts in the 1990s."""
    return 1900 + two_digit if two_digit >= 90 else 2000 + two_digit


def canonical_season(value: str) -> str:
    """Normalise any supported season label to ``YYYY/YY`` (or ``YYYY``).

    A bare four-digit string is ambiguous: "2324" is the 2023/24 season in
    football-data's file naming, while "2022" is the 2022 World Cup. They are
    told apart by whether the two halves are consecutive years - a season code
    always is, a calendar year almost never is.
    """
    text = str(value).strip()
    if m := _SHORT.match(text):
        first, second = int(m.group(1)), int(m.group(2))
        if (first + 1) % 100 == second:
            start = _century(first)
            return f"{start}/{str(start + 1)[2:]}"
    if m := _LONG.match(text):
        start = int(m.group(1))
        return f"{start}/{str(start + 1)[2:]}"
    if _SINGLE.match(text):
        return text            # single-calendar-year tournament (World Cup, Euro)
    raise ValueError(f"Unrecognised season label: {value!r}")


def season_short(season: str) -> str:
    """Inverse of the football-data mirror's ``season-2324`` file naming."""
    canon = canonical_season(season)
    if "/" not in canon:
        return canon
    start, end = canon.split("/")
    return f"{start[2:]}{end}"


def season_long(season: str) -> str:
    """openfootball's ``2023-24`` directory naming."""
    canon = canonical_season(season)
    if "/" not in canon:
        return canon
    start, end = canon.split("/")
    return f"{start}-{end}"


def season_start_year(season: str) -> int:
    return int(canonical_season(season).split("/")[0])


def season_from_date(date, split_month: int = 7) -> str:
    """Season a kickoff belongs to. Seasons roll over at the start of July."""
    ts = pd.Timestamp(date)
    start = ts.year if ts.month >= split_month else ts.year - 1
    return f"{start}/{str(start + 1)[2:]}"


def season_range(first: str, last: str) -> list[str]:
    """Inclusive list of canonical seasons between two labels."""
    a, b = season_start_year(first), season_start_year(last)
    return [f"{y}/{str(y + 1)[2:]}" for y in range(a, b + 1)]


def parse_date(value, dayfirst: bool = True) -> pd.Timestamp:
    return pd.to_datetime(value, dayfirst=dayfirst, errors="coerce")
