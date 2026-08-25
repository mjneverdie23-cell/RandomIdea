#!/usr/bin/env python3
"""Audit team-name normalisation.

Reports (a) how many clubs are shared between competitions - the number that
proves cross-source unification worked - and (b) names that resolved by
rule-based cleaning rather than the reviewed alias table, so they can be
promoted into config/team_aliases.yml if they matter.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd  # noqa: E402

from football_predictor.normalize.teams import TeamNormalizer, lookup_key  # noqa: E402
from football_predictor.pipeline import load_dataset  # noqa: E402


def main() -> int:
    df = load_dataset()
    comps = defaultdict(set)
    for col in ("home_team", "away_team"):
        for comp, team in zip(df["competition"], df[col]):
            comps[team].add(comp)

    shared = {t: c for t, c in comps.items() if len(c) > 1}
    print(f"teams total: {len(comps)}   appearing in >1 competition: {len(shared)}")

    ucl = {t for t, c in comps.items() if "UEFA_UCL" in c}
    ucl_only = {t for t in ucl if comps[t] == {"UEFA_UCL"}}
    print(f"UCL teams: {len(ucl)}   also seen in a league: {len(ucl - ucl_only)}"
          f"   UCL-only: {len(ucl_only)}")

    # A name that resolves to a key another name also resolves to, without an
    # alias entry, is the failure mode worth catching.
    normalizer = TeamNormalizer()
    by_key = defaultdict(set)
    for team in comps:
        by_key[lookup_key(team)].add(team)
    collisions = {k: v for k, v in by_key.items() if len(v) > 1}
    print(f"\nname keys resolving to more than one canonical name: {len(collisions)}")
    for key, names in sorted(collisions.items()):
        print(f"  {key}: {sorted(names)}")

    print("\nUCL-only clubs (expected: teams outside the big-five leagues)")
    print("  " + ", ".join(sorted(ucl_only)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
