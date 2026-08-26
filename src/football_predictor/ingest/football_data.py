"""Adapter for the football-data.co.uk CSV mirror.

Column layout (stable from 1993/94 to the present in this mirror)::

    Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,HTR,Referee,
    HS,AS,HST,AST,HF,AF,HC,AC,HY,AY,HR,AR

Older seasons carry the goal columns but leave the match statistics blank;
that is handled by leaving them null rather than imputing.
"""
from __future__ import annotations

import io

import pandas as pd

from ..config import Competition, Source
from ..normalize import seasons as season_utils
from ..schema import coerce_dtypes

COLUMN_MAP: dict[str, str] = {
    "FTHG": "home_goals",
    "FTAG": "away_goals",
    "HTHG": "ht_home_goals",
    "HTAG": "ht_away_goals",
    "HS": "home_shots",
    "AS": "away_shots",
    "HST": "home_shots_on_target",
    "AST": "away_shots_on_target",
    "HC": "home_corners",
    "AC": "away_corners",
    "HF": "home_fouls",
    "AF": "away_fouls",
    "HY": "home_yellow",
    "AY": "away_yellow",
    "HR": "home_red",
    "AR": "away_red",
    "Referee": "referee",
    # Odds columns are absent from this mirror but present in some
    # football-data exports; map them so a richer drop-in file just works.
    "B365H": "odds_home", "B365D": "odds_draw", "B365A": "odds_away",
    "B365>2.5": "odds_over25", "B365<2.5": "odds_under25",
    "AvgH": "odds_home", "AvgD": "odds_draw", "AvgA": "odds_away",
}


class FootballDataAdapter:
    name = "football_data"

    def urls(self, comp: Competition, source: Source, season: str) -> list[str]:
        path = source.path_template.format(
            source_key=comp.source_key,
            season_short=season_utils.season_short(season),
            season_long=season_utils.season_long(season, comp.season_style),
            file=comp.source_file or "",
        )
        return [f"{source.base_url.rstrip('/')}/{path}"]

    def parse(self, text: str, comp: Competition, season: str, url: str) -> pd.DataFrame:
        raw = pd.read_csv(io.StringIO(text), encoding_errors="replace")
        raw.columns = [c.strip() for c in raw.columns]
        if "HomeTeam" not in raw.columns or "Date" not in raw.columns:
            return coerce_dtypes(pd.DataFrame())

        out = pd.DataFrame()
        out["date"] = _parse_dates(raw["Date"])
        out["home_team"] = raw["HomeTeam"].astype("string").str.strip()
        out["away_team"] = raw["AwayTeam"].astype("string").str.strip()
        for src_col, dest in COLUMN_MAP.items():
            if src_col in raw.columns and dest not in out.columns:
                out[dest] = raw[src_col]

        out["competition"] = comp.code
        out["season"] = season_utils.canonical_season(season, comp.season_style)
        out["stage"] = "league" if comp.format == "league" else None
        out["neutral_venue"] = comp.neutral_venue
        # Rows without a result are unplayed fixtures in an in-progress season.
        out = out[out["home_team"].notna() & out["away_team"].notna()]
        return coerce_dtypes(out)


def _parse_dates(series: pd.Series) -> pd.Series:
    """The mirror uses ISO dates; original exports use ``dd/mm/yy``."""
    text = series.astype("string").str.strip()
    iso = pd.to_datetime(text, format="%Y-%m-%d", errors="coerce")
    if iso.notna().mean() > 0.9:
        return iso
    return pd.to_datetime(text, dayfirst=True, errors="coerce")
