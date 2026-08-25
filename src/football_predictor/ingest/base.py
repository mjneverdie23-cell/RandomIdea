"""Shared ingestion plumbing: cached HTTP fetch and the adapter protocol."""
from __future__ import annotations

import hashlib
import logging
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Protocol

import pandas as pd

from ..config import Competition, Source, data_dir

log = logging.getLogger(__name__)

USER_AGENT = "football-predictor/1.0 (+https://github.com/mjneverdie23-cell/RandomIdea)"


class FetchError(RuntimeError):
    """Raised when a raw file cannot be retrieved."""


class Adapter(Protocol):
    """Turns a competition + season into canonical-schema rows."""

    def urls(self, comp: Competition, source: Source, season: str) -> list[str]: ...

    def parse(
        self, text: str, comp: Competition, season: str, url: str
    ) -> pd.DataFrame: ...


def cache_path(url: str) -> Path:
    digest = hashlib.sha1(url.encode()).hexdigest()[:12]
    name = url.rstrip("/").split("/")[-1] or "raw"
    return data_dir() / "raw" / f"{digest}_{name}"


def fetch(url: str, *, use_cache: bool = True, retries: int = 4,
          timeout: int = 60) -> str:
    """Download a raw file, caching it under ``data/raw``.

    Cached files make re-runs offline-capable and keep the backtest
    reproducible: the same bytes produce the same training set.
    """
    path = cache_path(url)
    if use_cache and path.exists() and path.stat().st_size > 0:
        return path.read_text(encoding="utf-8", errors="replace")

    path.parent.mkdir(parents=True, exist_ok=True)
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            path.write_text(body, encoding="utf-8")
            return body
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise FetchError(f"not found: {url}") from exc
            last = exc
        except Exception as exc:  # network flake
            last = exc
        if attempt < retries - 1:
            time.sleep(2 ** attempt)
    raise FetchError(f"failed to fetch {url}: {last}")


def try_fetch(url: str, **kwargs) -> str | None:
    """Fetch, returning None for a missing file instead of raising.

    Coverage is uneven across sources and seasons, so a missing season is an
    expected outcome, not an error.
    """
    try:
        return fetch(url, **kwargs)
    except FetchError as exc:
        log.debug("skip %s (%s)", url, exc)
        return None
