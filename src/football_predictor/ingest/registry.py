"""Adapter registry and the top-level ingestion entry point."""
from __future__ import annotations

import logging

import pandas as pd

from ..config import Competition, enabled_competitions, load_competitions, load_sources
from ..normalize import seasons as season_utils
from ..schema import coerce_dtypes, empty_frame
from .base import try_fetch
from .football_data import FootballDataAdapter
from .openfootball import OpenFootballAdapter

log = logging.getLogger(__name__)

ADAPTERS = {
    FootballDataAdapter.name: FootballDataAdapter(),
    OpenFootballAdapter.name: OpenFootballAdapter(),
}


def competition_seasons(comp: Competition) -> list[str]:
    if comp.season_dirs:
        return [season_utils.canonical_season(d.split("--")[0]) for d in comp.season_dirs]
    if comp.seasons:
        return season_utils.season_range(comp.seasons[0], comp.seasons[1])
    return []


def ingest_competition(
    comp: Competition, seasons: list[str] | None = None, *, use_cache: bool = True
) -> pd.DataFrame:
    """Fetch and parse every available season of one competition."""
    if not comp.source_key:
        log.info("%s has no wired source, skipping", comp.code)
        return empty_frame()

    source = load_sources()[comp.source]
    adapter = ADAPTERS[source.adapter]
    frames: list[pd.DataFrame] = []

    for season in seasons or competition_seasons(comp):
        for url in adapter.urls(comp, source, season):
            text = try_fetch(url, use_cache=use_cache)
            if text is None:
                continue
            try:
                frame = adapter.parse(text, comp, season, url)
            except Exception:  # a malformed season must not kill the run
                log.exception("failed parsing %s", url)
                continue
            if len(frame):
                frames.append(frame)
                log.info("%s %s: %d matches", comp.code, season, len(frame))

    if not frames:
        return empty_frame()
    return coerce_dtypes(pd.concat(frames, ignore_index=True))


def ingest_all(
    codes: list[str] | None = None, *, tier: int | None = None, use_cache: bool = True
) -> pd.DataFrame:
    """Ingest every enabled competition (or an explicit subset)."""
    comps = (
        [load_competitions()[c] for c in codes]
        if codes
        else enabled_competitions(tier=tier)
    )
    frames = [ingest_competition(c, use_cache=use_cache) for c in comps]
    frames = [f for f in frames if len(f)]
    if not frames:
        return empty_frame()
    return coerce_dtypes(pd.concat(frames, ignore_index=True))
