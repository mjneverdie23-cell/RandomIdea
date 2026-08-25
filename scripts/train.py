#!/usr/bin/env python3
"""Fit the production models and write models/predictor.joblib."""
from __future__ import annotations

import argparse
import logging
import sys
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
warnings.filterwarnings("ignore")

from football_predictor.train import train  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )
    bundle = train()
    print(f"trained through {bundle.trained_through.date()} "
          f"on {bundle.metadata['n_matches']} matches "
          f"in {bundle.metadata['training_seconds']}s")
    print(f"saved: {bundle.path()}")
    print("\nensemble weights:")
    for name, weight in sorted(bundle.metadata["ensemble_weights"].items(),
                               key=lambda kv: -kv[1]):
        print(f"  {name:20s} {weight:.4f}")
    print("\nreplay-safe weights (used for historical dates):")
    for name, weight in sorted(bundle.metadata["replay_weights"].items(),
                               key=lambda kv: -kv[1]):
        print(f"  {name:20s} {weight:.4f}")
    print(f"\nrho={bundle.metadata['dixon_coles_rho']:.4f}  "
          f"home advantage={bundle.metadata['home_advantage']:.4f}")
    shares = bundle.metadata.get("half_shares") or {}
    if shares:
        print(f"goal split: first half {shares['first_half_share']:.1%}, "
              f"second half {shares['second_half_share']:.1%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
