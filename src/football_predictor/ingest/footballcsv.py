"""Adapter for the footballcsv mirror of football-data.co.uk.

The ``datasets/football-datasets`` mirror covers only the big-five leagues.
``footballcsv/cache.footballdata`` covers every league football-data.co.uk
publishes, converted to the football.csv "standard": one file per league and
season, named by ISO country code and tier::

    2023-24/tr.1.csv      Süper Lig
    2023/no.1.csv         Eliteserien  (calendar-year season)

The format is minimal - five columns, with the scores as strings::

    Date,Team 1,FT,HT,Team 2
    Fri Aug 11 2023,Trabzonspor,1-0,1-0,Antalyaspor
    Mon Apr 10 2023,Rosenborg,1-0,?,Viking

``?`` means the value was not recorded. football-data.co.uk publishes its
"extra" leagues (Norway among them) without half-time scores at all, and the
older seasons of its main leagues likewise, so a missing half time is normal
here rather than exceptional. It is left null and reported, which switches the
half-time markets off for that competition instead of inventing them.
"""
from __future__ import annotations

import io
import re

import pandas as pd

from ..config import Competition, Source
from ..normalize import seasons as season_utils
from ..schema import coerce_dtypes

_SCORE = re.compile(r"^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$")


class FootballCsvAdapter:
    name = "footballcsv"

    def urls(self, comp: Competition, source: Source, season: str) -> list[str]:
        path = source.path_template.format(
            source_key=comp.source_key,
            season_dir=season_utils.season_long(season, comp.season_style),
        )
        return [f"{source.base_url.rstrip('/')}/{path}"]

    def parse(self, text: str, comp: Competition, season: str, url: str) -> pd.DataFrame:
        raw = pd.read_csv(io.StringIO(text), encoding_errors="replace")
        raw.columns = [c.strip() for c in raw.columns]
        required = {"Date", "Team 1", "Team 2", "FT"}
        if not required.issubset(raw.columns):
            return coerce_dtypes(pd.DataFrame())

        out = pd.DataFrame()
        # Dates carry their year, so no carry-forward is needed here.
        out["date"] = pd.to_datetime(
            raw["Date"].astype("string").str.strip(),
            format="%a %b %d %Y", errors="coerce",
        )
        out["home_team"] = raw["Team 1"].astype("string").str.strip()
        out["away_team"] = raw["Team 2"].astype("string").str.strip()

        full = raw["FT"].map(_split_score)
        out["home_goals"] = [s[0] for s in full]
        out["away_goals"] = [s[1] for s in full]
        if "HT" in raw.columns:
            half = raw["HT"].map(_split_score)
            out["ht_home_goals"] = [s[0] for s in half]
            out["ht_away_goals"] = [s[1] for s in half]

        out["competition"] = comp.code
        out["season"] = season_utils.canonical_season(season, comp.season_style)
        out["stage"] = "league" if comp.format == "league" else None
        out["neutral_venue"] = comp.neutral_venue
        out = out[out["home_team"].notna() & out["away_team"].notna()]
        return coerce_dtypes(out)


def _split_score(value) -> tuple[int | None, int | None]:
    """``"3-2"`` -> ``(3, 2)``; ``"?"``, blanks and anything odd -> nulls."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return (None, None)
    match = _SCORE.match(str(value))
    if not match:
        return (None, None)
    return (int(match.group(1)), int(match.group(2)))
