"""Configuration loading.

All competition, source and model settings live in ``config/*.yml``. This
module is the only place that reads them, so the rest of the package can ask
for typed objects instead of poking at dictionaries.
"""
from __future__ import annotations

import functools
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


def project_root() -> Path:
    return Path(os.environ.get("FP_PROJECT_ROOT", Path(__file__).resolve().parents[2]))


def config_dir() -> Path:
    return Path(os.environ.get("FP_CONFIG_DIR", project_root() / "config"))


def data_dir() -> Path:
    return Path(os.environ.get("FP_DATA_DIR", project_root() / "data"))


def model_dir() -> Path:
    return Path(os.environ.get("FP_MODEL_DIR", project_root() / "models"))


@dataclass(frozen=True)
class Competition:
    code: str
    name: str
    country: str
    tier: int
    format: str
    source: str
    source_key: str | None
    source_file: str | None = None
    season_dirs: tuple[str, ...] = ()
    seasons: tuple[str, str] | None = None
    neutral_venue: bool = False
    two_legged: bool = False
    enabled: bool = False

    @property
    def is_knockout(self) -> bool:
        return self.format in ("knockout", "group_then_knockout")

    @property
    def is_domestic_league(self) -> bool:
        return self.format == "league" and self.country != "INT"


@dataclass(frozen=True)
class Source:
    name: str
    adapter: str
    base_url: str
    path_template: str
    description: str = ""
    licence: str = ""
    provides: tuple[str, ...] = ()
    missing: tuple[str, ...] = ()


def _load_yaml(path: Path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


@functools.lru_cache(maxsize=1)
def load_competitions() -> dict[str, Competition]:
    raw = _load_yaml(config_dir() / "competitions.yml")
    defaults = raw.get("defaults", {})
    out: dict[str, Competition] = {}
    for entry in raw.get("competitions", []):
        merged = {**defaults, **entry}
        seasons = merged.get("seasons")
        out[merged["code"]] = Competition(
            code=merged["code"],
            name=merged["name"],
            country=merged.get("country", ""),
            tier=int(merged.get("tier", 2)),
            format=merged.get("format", "league"),
            source=merged.get("source", ""),
            source_key=merged.get("source_key"),
            source_file=merged.get("source_file"),
            season_dirs=tuple(merged.get("season_dirs") or ()),
            seasons=tuple(seasons) if seasons else None,
            neutral_venue=bool(merged.get("neutral_venue", False)),
            two_legged=bool(merged.get("two_legged", False)),
            enabled=bool(merged.get("enabled", False)),
        )
    return out


@functools.lru_cache(maxsize=1)
def load_sources() -> dict[str, Source]:
    raw = _load_yaml(config_dir() / "sources.yml")
    return {
        name: Source(
            name=name,
            adapter=cfg["adapter"],
            base_url=cfg["base_url"],
            path_template=cfg["path_template"],
            description=cfg.get("description", ""),
            licence=cfg.get("licence", ""),
            provides=tuple(cfg.get("provides", ())),
            missing=tuple(cfg.get("missing", ())),
        )
        for name, cfg in (raw.get("sources") or {}).items()
    }


@functools.lru_cache(maxsize=1)
def load_model_config() -> dict[str, Any]:
    return _load_yaml(config_dir() / "model.yml")


def enabled_competitions(tier: int | None = None) -> list[Competition]:
    """Competitions included in training runs, optionally filtered to a tier."""
    comps = [c for c in load_competitions().values() if c.enabled]
    if tier is not None:
        comps = [c for c in comps if c.tier <= tier]
    return sorted(comps, key=lambda c: (c.tier, c.code))


def get_competition(code: str) -> Competition:
    comps = load_competitions()
    if code not in comps:
        raise KeyError(
            f"Unknown competition {code!r}. Known: {', '.join(sorted(comps))}"
        )
    return comps[code]


def reset_caches() -> None:
    """Drop cached config - used by tests that write temporary config files."""
    load_competitions.cache_clear()
    load_sources.cache_clear()
    load_model_config.cache_clear()
