#!/usr/bin/env python3
"""Build and cache the model feature matrix.

One chronological pass over every match, so a row's features only ever see
earlier matches. The cached matrix is what training and backtesting read.
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from football_predictor.config import data_dir  # noqa: E402
from football_predictor.features.builder import (  # noqa: E402
    FeatureBuilder, feature_columns,
)
from football_predictor.pipeline import load_dataset  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)

    df = load_dataset()
    print(f"building features for {len(df)} matches ...")
    started = time.time()
    features = FeatureBuilder().transform(df)
    print(f"done in {time.time() - started:.1f}s -> {features.shape}")

    out = Path(args.out) if args.out else data_dir() / "processed" / "features.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    features.to_parquet(out, index=False)

    cols = feature_columns(features)
    print(f"wrote {out}")
    print(f"numeric features: {len(cols)}")
    coverage = features[cols].notna().mean().sort_values()
    print("\nleast-covered features:")
    print(coverage.head(8).to_string())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
