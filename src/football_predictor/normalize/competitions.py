"""Competition normalisation and tier filtering."""
from __future__ import annotations

import pandas as pd

from ..config import Competition, enabled_competitions, load_competitions

#: Stage labels used across sources, mapped to canonical values.
STAGE_ALIASES: dict[str, str] = {
    "group": "group",
    "group stage": "group",
    "league phase": "league_phase",
    "matchday": "group",
    "play-off": "playoff",
    "playoffs": "playoff",
    "knockout play-off": "playoff",
    "round of 16": "round_of_16",
    "last 16": "round_of_16",
    "quarter-final": "quarter_final",
    "quarterfinals": "quarter_final",
    "semi-final": "semi_final",
    "semifinals": "semi_final",
    "final": "final",
    "third place": "third_place",
    "league": "league",
}


def canonical_stage(raw: str | None) -> str | None:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return None
    text = str(raw).strip().lower()
    for key, value in STAGE_ALIASES.items():
        if key in text:
            return value
    return text.replace(" ", "_") or None


def is_knockout_stage(stage: str | None) -> bool:
    return stage in {"round_of_16", "quarter_final", "semi_final", "final",
                     "playoff", "third_place"}


def filter_to_competitions(
    df: pd.DataFrame, codes: list[str] | None = None, tier: int | None = None
) -> pd.DataFrame:
    """Restrict a match frame to configured competitions.

    With no arguments this keeps every enabled competition, which is what
    training runs use. Passing ``tier`` keeps only competitions at or above
    that tier of importance.
    """
    if codes is None:
        codes = [c.code for c in enabled_competitions(tier=tier)]
    elif tier is not None:
        allowed = {c.code for c in enabled_competitions(tier=tier)}
        codes = [c for c in codes if c in allowed]
    known = set(load_competitions())
    unknown = set(codes) - known
    if unknown:
        raise KeyError(f"Unknown competition codes: {sorted(unknown)}")
    return df[df["competition"].isin(codes)].copy()


def competition_metadata(code: str) -> dict:
    comp: Competition = load_competitions()[code]
    return {
        "code": comp.code,
        "name": comp.name,
        "country": comp.country,
        "tier": comp.tier,
        "format": comp.format,
        "is_knockout": comp.is_knockout,
        "two_legged": comp.two_legged,
        "neutral_venue": comp.neutral_venue,
    }
