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


#: How a competition's seasons are laid out in time.
SPLIT = "split"        # autumn to spring, e.g. 2023/24 - most of Europe
CALENDAR = "calendar"  # a single calendar year, e.g. 2023 - the Nordic
                       # leagues, and much of the Americas and Asia


def canonical_season(value: str, style: str = SPLIT) -> str:
    """Normalise any supported season label to ``YYYY/YY`` (or ``YYYY``).

    A bare four-digit string is ambiguous: "2324" is the 2023/24 season in
    football-data's file naming, while "2022" is the 2022 World Cup. They are
    told apart by whether the two halves are consecutive years - a season code
    always is, a calendar year almost never is.

    That heuristic is not enough on its own: "2021" reads as the 2020/21
    season but is also a real Eliteserien season, which runs March to
    November. Pass ``style=CALENDAR`` for such a competition and a four-digit
    value is always taken as the year it plainly is.
    """
    text = str(value).strip()
    if style == CALENDAR and _SINGLE.match(text):
        return text
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


def season_long(season: str, style: str = SPLIT) -> str:
    """Directory naming used by openfootball and footballcsv: ``2023-24``.

    A calendar-year season is just its year, so ``2023`` stays ``2023``.
    """
    canon = canonical_season(season, style)
    if "/" not in canon:
        return canon
    start, end = canon.split("/")
    return f"{start}-{end}"


def season_start_year(season: str, style: str = SPLIT) -> int:
    return int(canonical_season(season, style).split("/")[0])


def season_from_date(date, style: str = SPLIT, split_month: int = 7) -> str:
    """Season a kickoff belongs to.

    A split season rolls over at the start of July; a calendar-year season is
    simply the year the match was played in.
    """
    ts = pd.Timestamp(date)
    if style == CALENDAR:
        return str(ts.year)
    start = ts.year if ts.month >= split_month else ts.year - 1
    return f"{start}/{str(start + 1)[2:]}"


def season_range(first: str, last: str, style: str = SPLIT) -> list[str]:
    """Inclusive list of canonical seasons between two labels."""
    a, b = season_start_year(first, style), season_start_year(last, style)
    if style == CALENDAR:
        return [str(y) for y in range(a, b + 1)]
    return [f"{y}/{str(y + 1)[2:]}" for y in range(a, b + 1)]


def parse_date(value, dayfirst: bool = True) -> pd.Timestamp:
    return pd.to_datetime(value, dayfirst=dayfirst, errors="coerce")
