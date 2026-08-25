"""Team-name normalisation.

Two sources describe the same club differently ("Man City" vs "Manchester
City FC"). Ratings must follow a club across competitions, so names are
resolved to a single canonical form before anything else touches the data.

Resolution order:

1. exact match against the reviewed alias table in ``config/team_aliases.yml``
2. match after rule-based cleaning (accent folding, corporate-suffix removal)
3. the cleaned name itself, recorded as unmapped

Fuzzy matching is deliberately not used at any stage - measured against this
dataset it mapped "Celtic FC" to "Celta" and "FC Porto" to "Portsmouth".
"""
from __future__ import annotations

import functools
import re
import unicodedata

import pandas as pd
import yaml

from ..config import config_dir

#: Corporate / legal tokens that carry no identifying information.
_LEGAL_TOKENS = {
    "fc", "afc", "cf", "ac", "ss", "ssc", "sc", "as", "us", "ud", "cd", "rc",
    "rcd", "sv", "vfl", "vfb", "tsg", "bsc", "fsv", "spvgg", "kv", "kaa",
    "krc", "gnk", "nk", "sk", "pfc", "pae", "sfp", "fk", "tc", "hsc", "osc",
    "bc", "jk", "sfc", "bv", "club", "calcio", "futbol", "football",
}
_PUNCT = re.compile(r"[^\w\s/'-]", flags=re.UNICODE)
_WS = re.compile(r"\s+")


def fold_accents(text: str) -> str:
    return (
        unicodedata.normalize("NFKD", str(text))
        .encode("ascii", "ignore")
        .decode("ascii")
    )


def clean_name(name: str) -> str:
    """Rule-based cleaning used both for lookup keys and as a fallback name."""
    text = _PUNCT.sub(" ", fold_accents(name)).strip()
    tokens = [t for t in _WS.split(text) if t]
    kept = [t for t in tokens if t.lower().strip(".") not in _LEGAL_TOKENS]
    # Never strip a name down to nothing ("AC Milan" must not become "").
    if not kept:
        kept = tokens
    return " ".join(kept).strip()


def lookup_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", clean_name(name).lower())


@functools.lru_cache(maxsize=1)
def _alias_config() -> dict:
    path = config_dir() / "team_aliases.yml"
    if not path.exists():
        return {"canonical": {}, "display": {}}
    with open(path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {"canonical": {}, "display": {}}


@functools.lru_cache(maxsize=1)
def _alias_index() -> dict[str, str]:
    """Map every known spelling (by lookup key) to its canonical name."""
    index: dict[str, str] = {}
    for canonical, aliases in (_alias_config().get("canonical") or {}).items():
        for spelling in [canonical, *(aliases or [])]:
            index.setdefault(lookup_key(spelling), canonical)
            # Also index the raw lower-cased spelling so names whose cleaning
            # is lossy ("PSV" -> "") still resolve.
            index.setdefault(re.sub(r"[^a-z0-9]", "", fold_accents(spelling).lower()),
                             canonical)
    return index


class TeamNormalizer:
    """Resolves source spellings to canonical team names."""

    def __init__(self) -> None:
        self._index = dict(_alias_index())
        self._display = dict(_alias_config().get("display") or {})
        self.unmapped: set[str] = set()

    def canonical(self, name: str) -> str:
        if name is None or (isinstance(name, float) and pd.isna(name)):
            return ""
        raw = str(name).strip()
        if not raw:
            return ""
        for key in (
            re.sub(r"[^a-z0-9]", "", fold_accents(raw).lower()),
            lookup_key(raw),
        ):
            if key in self._index:
                return self._index[key]
        cleaned = clean_name(raw)
        self.unmapped.add(raw)
        # Remember the resolution so two spellings that clean to the same
        # string agree with each other even without an alias entry.
        self._index.setdefault(lookup_key(raw), cleaned)
        return cleaned

    def display(self, canonical_name: str) -> str:
        return self._display.get(canonical_name, canonical_name)

    def normalize_frame(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        for col in ("home_team", "away_team"):
            out[col] = out[col].map(self.canonical).astype("string")
        return out


@functools.lru_cache(maxsize=1)
def default_normalizer() -> TeamNormalizer:
    return TeamNormalizer()


def canonical_team(name: str) -> str:
    return default_normalizer().canonical(name)


def display_team(canonical_name: str) -> str:
    return default_normalizer().display(canonical_name)


def reset_caches() -> None:
    _alias_config.cache_clear()
    _alias_index.cache_clear()
    default_normalizer.cache_clear()
