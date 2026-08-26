"""Adapter for openfootball plain-text fixture files.

The format is human-written, so the parser has to be tolerant::

    ▪ Group, Matchday 1
      Tue Sep 19 2023
        18:45  AC Milan (ITA)   v Newcastle United FC (ENG)  0-0
               BSC Young Boys (SUI) v RB Leipzig (GER)       1-3 (1-1)

    ▪ Finals, Quarterfinals
      Tue Mar 12
        21:00  Arsenal FC (ENG) v FC Porto (POR)  4-2 pen. 1-0 a.e.t. (1-0, 1-0)

Score conventions:

* ``X-Y (H-A)``                       - full time, then half time.
* ``P-Q pen. C-D a.e.t. (E-F, G-H)``  - shootout, after-extra-time, then
  ``(score after 90 minutes, score at half time)``.

Only the **regulation** (90 minute) score is stored as the match result.
That is what the HUB / 1X2 market settles on, and it keeps knockout fixtures
comparable with league fixtures, where extra time never happens.
"""
from __future__ import annotations

import logging
import re

import pandas as pd

from ..config import Competition, Source
from ..normalize import seasons as season_utils
from ..normalize.competitions import canonical_stage
from ..schema import coerce_dtypes

log = logging.getLogger(__name__)

_STAGE = re.compile(r"^\s*[▪»*-]\s*(?P<stage>.+?)\s*$")
_DATE = re.compile(
    r"^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?\s+"
    r"(?P<rest>[A-Z][a-z]{2}\.?\s+\d{1,2}(?:\s+\d{4})?)\s*$"
)
_TIME = re.compile(r"^\s*(?P<time>\d{1,2}[:.]\d{2})\s+")
# "Home v Away  <scores>"; the separator is " v " or " vs "
_MATCH = re.compile(
    r"^(?P<home>.+?)\s+v(?:s)?\.?\s+(?P<away>.+?)\s{2,}(?P<scores>[\d\s\-–:().,a-z]+)$"
)
_SCORE = re.compile(r"(\d{1,2})\s*[-–:]\s*(\d{1,2})")
_COUNTRY = re.compile(r"\s*\(([A-Z]{3})\)\s*$")


class OpenFootballAdapter:
    name = "openfootball"

    def urls(self, comp: Competition, source: Source, season: str) -> list[str]:
        base = source.base_url.rstrip("/")
        file = comp.source_file or "cl"
        dirs = comp.season_dirs or (season_utils.season_long(season, comp.season_style),)
        return [
            f"{base}/{comp.source_key}/master/{d}/{file}.txt"
            for d in dirs
            if not comp.season_dirs or d.startswith(str(season_utils.season_start_year(season)))
        ]

    def parse(self, text: str, comp: Competition, season: str, url: str) -> pd.DataFrame:
        rows: list[dict] = []
        stage: str | None = None
        year: int | None = None
        current_date: pd.Timestamp | None = None

        for line in text.splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue

            if line.lstrip().startswith("=") :          # title line
                continue

            if (m := _STAGE.match(line)) and " v " not in line and not _SCORE.search(line):
                stage = canonical_stage(m.group("stage"))
                continue

            if m := _DATE.match(line):
                parsed, year = _parse_date_line(m.group("rest"), year, current_date)
                if parsed is not None:
                    current_date = parsed
                continue

            body = _TIME.sub("", line).strip()
            m = _MATCH.match(body)
            if not m or current_date is None:
                continue

            home, home_cc = _split_country(m.group("home"))
            away, away_cc = _split_country(m.group("away"))
            result = _parse_scores(m.group("scores"))
            if result is None:
                continue
            (hg, ag), ht = result

            rows.append(
                {
                    "date": current_date,
                    "home_team": home,
                    "away_team": away,
                    "home_goals": hg,
                    "away_goals": ag,
                    "ht_home_goals": ht[0] if ht else None,
                    "ht_away_goals": ht[1] if ht else None,
                    "stage": stage,
                    "home_country": home_cc,
                    "away_country": away_cc,
                }
            )

        if not rows:
            log.warning("no fixtures parsed from %s", url)
            return coerce_dtypes(pd.DataFrame())

        out = pd.DataFrame(rows)
        out["competition"] = comp.code
        out["season"] = season_utils.canonical_season(season, comp.season_style)
        # A neutral venue is a property of the fixture, not just the competition:
        # a tournament played at one host is neutral throughout, while a
        # club competition is neutral only for its final.
        out["neutral_venue"] = comp.neutral_venue | (out["stage"] == "final")
        return coerce_dtypes(out.drop(columns=["home_country", "away_country"]))


def _split_country(name: str) -> tuple[str, str | None]:
    """Strip the trailing ``(ENG)`` federation tag openfootball appends."""
    if m := _COUNTRY.search(name):
        return _COUNTRY.sub("", name).strip(), m.group(1)
    return name.strip(), None


def _parse_date_line(
    rest: str, year: int | None, last: pd.Timestamp | None = None
) -> tuple[pd.Timestamp | None, int | None]:
    """Parse a date line, carrying the year forward when it is omitted.

    A European season spans two calendar years and these files state the year
    only when it changes. If a carried-forward year lands well before the
    previous fixture, the season has rolled over and the year advances.
    """
    rest = rest.replace(".", "")
    parts = rest.split()
    if len(parts) == 3:
        year = int(parts[2])
        ts = pd.to_datetime(rest, format="%b %d %Y", errors="coerce")
        return (None, year) if pd.isna(ts) else (ts, year)
    if year is None:
        return None, year

    ts = pd.to_datetime(f"{rest} {year}", format="%b %d %Y", errors="coerce")
    if pd.isna(ts):
        return None, year
    if last is not None and ts < last - pd.Timedelta(days=120):
        year += 1
        ts = pd.to_datetime(f"{rest} {year}", format="%b %d %Y", errors="coerce")
    return ts, year


def _parse_scores(text: str) -> tuple[tuple[int, int], tuple[int, int] | None] | None:
    """Return ``((home90, away90), half_time_or_None)``.

    Extra-time and shootout scores are discarded: the regulation result is the
    one every market in this system settles on.
    """
    text = text.strip().lower()
    if not text or text.startswith("("):
        return None
    pairs = [(int(a), int(b)) for a, b in _SCORE.findall(text)]
    if not pairs:
        return None

    has_pens = "pen" in text
    has_aet = "a.e.t" in text or "aet" in text

    if has_pens and has_aet:
        # P-Q pen. C-D a.e.t. (E-F, G-H) -> regulation is E-F, half time G-H
        if len(pairs) >= 4:
            return pairs[2], pairs[3]
        if len(pairs) == 3:
            return pairs[2], None
        return None
    if has_aet:
        # C-D a.e.t. (E-F, G-H)
        if len(pairs) >= 3:
            return pairs[1], pairs[2]
        if len(pairs) == 2:
            return pairs[1], None
        return None
    if has_pens:
        # P-Q pen. E-F (G-H) - regulation ended level
        if len(pairs) >= 3:
            return pairs[1], pairs[2]
        if len(pairs) == 2:
            return pairs[1], None
        return None

    # Plain: X-Y (H-A)
    return pairs[0], (pairs[1] if len(pairs) >= 2 else None)
