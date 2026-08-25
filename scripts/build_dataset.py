#!/usr/bin/env python3
"""Fetch, clean and store the canonical match dataset.

    python scripts/build_dataset.py                 # every enabled competition
    python scripts/build_dataset.py --codes ENG_PL  # a subset
    python scripts/build_dataset.py --no-cache      # force re-download
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from football_predictor.pipeline import build_dataset, summarise  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codes", nargs="*", default=None,
                        help="competition codes (default: all enabled)")
    parser.add_argument("--tier", type=int, default=None,
                        help="keep competitions at or above this tier")
    parser.add_argument("--no-cache", action="store_true",
                        help="re-download raw files instead of using data/raw")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )

    df, report = build_dataset(args.codes, tier=args.tier, use_cache=not args.no_cache)
    print(report.summary())
    print()
    print(summarise(df).to_string(index=False))
    print(f"\nseasons: {df['season'].min()} .. {df['season'].max()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
