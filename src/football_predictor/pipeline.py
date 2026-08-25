"""Ingestion -> normalisation -> validation -> competition filtering."""
from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from .clean import clean_matches, data_quality
from .config import data_dir
from .ingest.registry import ingest_all
from .normalize.competitions import filter_to_competitions
from .normalize.teams import TeamNormalizer
from .schema import ValidationReport

log = logging.getLogger(__name__)

PROCESSED_NAME = "matches.parquet"


def processed_path() -> Path:
    return data_dir() / "processed" / PROCESSED_NAME


def build_dataset(
    codes: list[str] | None = None,
    *,
    tier: int | None = None,
    use_cache: bool = True,
    save: bool = True,
) -> tuple[pd.DataFrame, ValidationReport]:
    """Build the canonical match table from configured sources."""
    raw = ingest_all(codes, tier=tier, use_cache=use_cache)
    log.info("ingested %d raw rows", len(raw))

    normalizer = TeamNormalizer()
    cleaned, report = clean_matches(raw, normalizer=normalizer)
    cleaned = filter_to_competitions(cleaned, codes=codes, tier=tier)
    cleaned = cleaned.sort_values(["date", "competition", "home_team"],
                                  kind="mergesort").reset_index(drop=True)

    if save:
        path = processed_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        cleaned.to_parquet(path, index=False)
        log.info("wrote %s (%d rows)", path, len(cleaned))
    return cleaned, report


def load_dataset(path: Path | None = None) -> pd.DataFrame:
    path = path or processed_path()
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found - run `python scripts/build_dataset.py` first"
        )
    df = pd.read_parquet(path)
    return df.sort_values(["date", "competition", "home_team"],
                          kind="mergesort").reset_index(drop=True)


def summarise(df: pd.DataFrame) -> pd.DataFrame:
    """Per-competition coverage table."""
    rows = []
    for code, group in df.groupby("competition"):
        quality = data_quality(group)
        rows.append({"competition": code, **quality})
    return pd.DataFrame(rows).sort_values("competition").reset_index(drop=True)
