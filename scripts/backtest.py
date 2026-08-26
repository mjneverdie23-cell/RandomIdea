#!/usr/bin/env python3
"""Run the walk-forward backtest and write the benchmark tables.

    python scripts/backtest.py                        # every configured season
    python scripts/backtest.py --seasons 2023/24      # one season
    python scripts/backtest.py --quick                # fewer ML members

Outputs land in ``data/processed/backtest/``: per-fold metrics, aggregated
tables, per-competition breakdowns and the reliability data used by
docs/BENCHMARK.md.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

warnings.filterwarnings("ignore")

from football_predictor.config import data_dir  # noqa: E402
from football_predictor.evaluation.backtest import (  # noqa: E402
    BacktestConfig, aggregate, build_windows, run_fold,
)
from football_predictor.pipeline import load_dataset  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", nargs="*", default=None)
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")

    features = pd.read_parquet(data_dir() / "processed" / "features.parquet")
    features = features[features["target_result"].notna()].copy()
    matches = load_dataset()

    config = BacktestConfig.from_config()
    if args.quick:
        config.ml_models = ("logistic", "xgboost")

    windows = build_windows(matches, config)
    if args.seasons:
        wanted = set(args.seasons)
        windows = [w for w in windows if w.label in wanted]

    out_dir = Path(args.out) if args.out else data_dir() / "processed" / "backtest"
    out_dir.mkdir(parents=True, exist_ok=True)

    results = []
    all_predictions = []
    started = time.time()
    for window in windows:
        fold_started = time.time()
        fold = run_fold(features, matches, window, config, keep_predictions=True)
        if fold is None:
            print(f"  {window.label}: skipped (insufficient history)")
            continue
        results.append(fold)
        if fold.predictions is not None:
            all_predictions.append(fold.predictions)
        best = min(
            ((m, v["log_loss"]) for m, v in fold.metrics.items() if "log_loss" in v),
            key=lambda kv: kv[1],
        )
        print(f"  {window.label}: n={fold.n_test:5d}  best={best[0]} ({best[1]:.4f})  "
              f"[{time.time() - fold_started:.0f}s]")
        sys.stdout.flush()

    if not results:
        print("no folds ran")
        return 1

    summary = aggregate(results)
    summary.to_csv(out_dir / "summary.csv")

    per_fold = []
    for fold in results:
        for model, metrics in fold.metrics.items():
            per_fold.append({"season": fold.season, "model": model, **metrics})
    pd.DataFrame(per_fold).to_csv(out_dir / "per_fold.csv", index=False)

    weights = pd.DataFrame(
        [{"season": f.season, **f.ensemble_weights} for f in results]
    )
    weights.to_csv(out_dir / "ensemble_weights.csv", index=False)

    if all_predictions:
        predictions = pd.concat(all_predictions, ignore_index=True)
        predictions.to_parquet(out_dir / "predictions.parquet", index=False)

    meta = {
        "seasons": [f.season for f in results],
        "n_matches": int(sum(f.n_test for f in results)),
        "ml_models": list(config.ml_models),
        "validation_seasons": config.validation_seasons,
        "refit_interval_days": config.refit_interval_days,
        "ml_train_seasons": config.ml_train_seasons,
        "runtime_seconds": round(time.time() - started, 1),
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2))

    core = [c for c in ("log_loss", "brier", "rps", "accuracy", "ece", "n")
            if c in summary.columns]
    print(f"\n=== aggregated over {meta['n_matches']} matches, "
          f"{len(results)} seasons ===")
    print(summary[core].sort_values("log_loss").to_string())
    print(f"\nwrote {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
