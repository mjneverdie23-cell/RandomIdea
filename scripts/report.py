#!/usr/bin/env python3
"""Generate docs/BENCHMARK.md from the backtest outputs.

Reads data/processed/backtest/ and writes the benchmark tables. Every number
comes from a file produced by scripts/backtest.py - nothing here is written by
hand, so the document cannot drift from the experiment.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from football_predictor.config import data_dir, load_competitions  # noqa: E402
from football_predictor.evaluation.metrics import (  # noqa: E402
    binary_report, multiclass_report, to_index,
)
from football_predictor.models.calibration import reliability_curve  # noqa: E402

#: Display names for the models that appear in the headline table.
HEADLINE = [
    ("naive", "Naive base rates"),
    ("elo", "Elo (ordered logit)"),
    ("poisson", "Poisson"),
    ("dixon_coles", "Dixon-Coles"),
    ("logistic", "Logistic regression"),
    ("random_forest", "Random forest"),
    ("xgboost", "XGBoost"),
    ("lightgbm", "LightGBM"),
    ("catboost", "CatBoost"),
    ("lightgbm_goals", "LightGBM goal model"),
    ("ensemble", "**Ensemble**"),
    ("ensemble_calibrated", "**Ensemble (calibrated)**"),
]


def fmt(value, digits=4):
    if value is None or (isinstance(value, float) and not np.isfinite(value)):
        return "&mdash;"
    return f"{value:.{digits}f}"


def pct(value, digits=1):
    if value is None or (isinstance(value, float) and not np.isfinite(value)):
        return "&mdash;"
    return f"{value * 100:.{digits}f}%"


def load(out_dir: Path):
    summary = pd.read_csv(out_dir / "summary.csv").set_index("model")
    per_fold = pd.read_csv(out_dir / "per_fold.csv")
    weights = pd.read_csv(out_dir / "ensemble_weights.csv")
    meta = json.loads((out_dir / "meta.json").read_text())
    predictions = None
    path = out_dir / "predictions.parquet"
    if path.exists():
        predictions = pd.read_parquet(path)
    return summary, per_fold, weights, meta, predictions


def headline_table(summary: pd.DataFrame) -> str:
    lines = [
        "| Model | Log Loss | Brier | RPS | Accuracy | Calibration (ECE) |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for key, label in HEADLINE:
        if key not in summary.index:
            continue
        row = summary.loc[key]
        lines.append(
            f"| {label} | {fmt(row.get('log_loss'))} | {fmt(row.get('brier'))} | "
            f"{fmt(row.get('rps'))} | {pct(row.get('accuracy'))} | "
            f"{fmt(row.get('ece'))} |"
        )
    return "\n".join(lines)


def market_table(summary: pd.DataFrame) -> str:
    """BTTS / over-under / half markets from the models that quote them."""
    rows = [
        ("dixon_coles_markets", "Dixon-Coles"),
        ("poisson_markets", "Poisson"),
        ("lightgbm_goals_markets", "LightGBM goal model"),
    ]
    lines = [
        "| Model | BTTS log loss | BTTS acc | O/U 2.5 log loss | O/U 2.5 acc | "
        "HT HUB log loss | HT HUB acc | Exact score |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for key, label in rows:
        if key not in summary.index:
            continue
        r = summary.loc[key]
        lines.append(
            f"| {label} | {fmt(r.get('btts_log_loss'))} | {pct(r.get('btts_accuracy'))} | "
            f"{fmt(r.get('ou2.5_log_loss'))} | {pct(r.get('ou2.5_accuracy'))} | "
            f"{fmt(r.get('ht_hub_log_loss'))} | {pct(r.get('ht_hub_accuracy'))} | "
            f"{pct(r.get('exact_score_hit_rate'))} |"
        )
    for key, label in (("btts_ensemble", "BTTS ensemble"),
                       ("btts_ensemble_calibrated", "BTTS ensemble (calibrated)"),
                       ("ou2.5_ensemble", "O/U 2.5 ensemble"),
                       ("ou2.5_ensemble_calibrated", "O/U 2.5 ensemble (calibrated)")):
        if key not in summary.index:
            continue
        r = summary.loc[key]
        marker = "BTTS" if "btts" in key else "O/U 2.5"
        if marker == "BTTS":
            lines.append(
                f"| {label} | {fmt(r.get('log_loss'))} | {pct(r.get('accuracy'))} | "
                "&mdash; | &mdash; | &mdash; | &mdash; | &mdash; |"
            )
        else:
            lines.append(
                f"| {label} | &mdash; | &mdash; | {fmt(r.get('log_loss'))} | "
                f"{pct(r.get('accuracy'))} | &mdash; | &mdash; | &mdash; |"
            )
    return "\n".join(lines)


def goal_accuracy_table(summary: pd.DataFrame) -> str:
    lines = [
        "| Model | Home goals MAE | Home RMSE | Home Poisson dev. | "
        "Away goals MAE | Away RMSE | Away Poisson dev. |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for key, label in (("dixon_coles_markets", "Dixon-Coles"),
                       ("poisson_markets", "Poisson"),
                       ("lightgbm_goals_markets", "LightGBM goal model")):
        if key not in summary.index:
            continue
        r = summary.loc[key]
        lines.append(
            f"| {label} | {fmt(r.get('home_goals_mae'), 3)} | "
            f"{fmt(r.get('home_goals_rmse'), 3)} | "
            f"{fmt(r.get('home_goals_poisson_deviance'), 3)} | "
            f"{fmt(r.get('away_goals_mae'), 3)} | "
            f"{fmt(r.get('away_goals_rmse'), 3)} | "
            f"{fmt(r.get('away_goals_poisson_deviance'), 3)} |"
        )
    return "\n".join(lines)


def half_market_table(summary: pd.DataFrame) -> str:
    key = "dixon_coles_markets"
    if key not in summary.index:
        return "_no half-market results in this run_"
    r = summary.loc[key]
    lines = [
        "| Market | Log loss | Accuracy |",
        "| --- | ---: | ---: |",
        f"| Half-time HUB | {fmt(r.get('ht_hub_log_loss'))} | {pct(r.get('ht_hub_accuracy'))} |",
        f"| First-half BTTS | {fmt(r.get('ht_btts_log_loss'))} | {pct(r.get('ht_btts_accuracy'))} |",
    ]
    for line in ("0.5", "1.5", "2.5"):
        lines.append(
            f"| First half over {line} | {fmt(r.get(f'ht_ou{line}_log_loss'))} | "
            f"{pct(r.get(f'ht_ou{line}_accuracy'))} |"
        )
    for line in ("0.5", "1.5", "2.5"):
        lines.append(
            f"| Second half over {line} | {fmt(r.get(f'sh_ou{line}_log_loss'))} | "
            f"{pct(r.get(f'sh_ou{line}_accuracy'))} |"
        )
    return "\n".join(lines)


def over_under_ladder(summary: pd.DataFrame) -> str:
    key = "dixon_coles_markets"
    if key not in summary.index:
        return ""
    r = summary.loc[key]
    lines = ["| Line | Log loss | Brier | Accuracy | ECE |",
             "| --- | ---: | ---: | ---: | ---: |"]
    for line in ("0.5", "1.5", "2.5", "3.5", "4.5", "5.5"):
        lines.append(
            f"| Over/under {line} | {fmt(r.get(f'ou{line}_log_loss'))} | "
            f"{fmt(r.get(f'ou{line}_brier'))} | {pct(r.get(f'ou{line}_accuracy'))} | "
            f"{fmt(r.get(f'ou{line}_ece'))} |"
        )
    return "\n".join(lines)


def per_season_table(per_fold: pd.DataFrame) -> str:
    subset = per_fold[per_fold["model"].isin(["ensemble_calibrated", "ensemble",
                                              "dixon_coles", "elo", "naive"])]
    pivot = subset.pivot_table(index="season", columns="model",
                               values="log_loss", aggfunc="mean")
    order = [c for c in ("naive", "elo", "dixon_coles", "ensemble",
                         "ensemble_calibrated") if c in pivot.columns]
    pivot = pivot[order]
    lines = ["| Season | " + " | ".join(order) + " |",
             "| --- | " + " | ".join(["---:"] * len(order)) + " |"]
    for season, row in pivot.iterrows():
        lines.append(f"| {season} | " + " | ".join(fmt(row[c]) for c in order) + " |")
    return "\n".join(lines)


def weights_table(weights: pd.DataFrame) -> str:
    members = [c for c in weights.columns if c != "season"]
    mean = weights[members].mean().sort_values(ascending=False)
    lines = ["| Member | Mean weight | Min | Max |",
             "| --- | ---: | ---: | ---: |"]
    for name in mean.index:
        lines.append(
            f"| {name} | {fmt(mean[name], 3)} | {fmt(weights[name].min(), 3)} | "
            f"{fmt(weights[name].max(), 3)} |"
        )
    return "\n".join(lines)


def per_competition_table(predictions: pd.DataFrame) -> str:
    if predictions is None or predictions.empty:
        return "_no stored predictions in this run_"
    known = load_competitions()
    lines = ["| Competition | Matches | Log loss | Brier | RPS | Accuracy | ECE |",
             "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for code, group in predictions.groupby("competition"):
        probs = group[["p_H", "p_U", "p_B"]].to_numpy()
        report = multiclass_report(probs, group["target_result"])
        name = known[code].name if code in known else code
        lines.append(
            f"| {name} | {len(group)} | {fmt(report['log_loss'])} | "
            f"{fmt(report['brier'])} | {fmt(report['rps'])} | "
            f"{pct(report['accuracy'])} | {fmt(report['ece'])} |"
        )
    probs = predictions[["p_H", "p_U", "p_B"]].to_numpy()
    overall = multiclass_report(probs, predictions["target_result"])
    lines.append(
        f"| **All** | {len(predictions)} | {fmt(overall['log_loss'])} | "
        f"{fmt(overall['brier'])} | {fmt(overall['rps'])} | "
        f"{pct(overall['accuracy'])} | {fmt(overall['ece'])} |"
    )
    return "\n".join(lines)


def reliability_table(predictions: pd.DataFrame) -> str:
    if predictions is None or predictions.empty:
        return "_no stored predictions in this run_"
    lines = ["| Predicted band | Matches | Mean predicted | Observed frequency |",
             "| --- | ---: | ---: | ---: |"]
    probs = np.concatenate([
        predictions["p_H"].to_numpy(),
        predictions["p_U"].to_numpy(),
        predictions["p_B"].to_numpy(),
    ])
    outcomes = np.concatenate([
        (predictions["target_result"] == "H").astype(float).to_numpy(),
        (predictions["target_result"] == "U").astype(float).to_numpy(),
        (predictions["target_result"] == "B").astype(float).to_numpy(),
    ])
    curve = reliability_curve(probs, outcomes, n_bins=10)
    edges = np.linspace(0, 1, 11)
    for predicted, observed, count in zip(curve["predicted"], curve["observed"],
                                          curve["count"]):
        index = min(int(predicted * 10), 9)
        lines.append(
            f"| {edges[index]:.1f}&ndash;{edges[index + 1]:.1f} | {count} | "
            f"{pct(predicted)} | {pct(observed)} |"
        )
    return "\n".join(lines)


def calibration_comparison(summary: pd.DataFrame) -> str:
    lines = ["| Variant | Log loss | Brier | Accuracy | ECE |",
             "| --- | ---: | ---: | ---: | ---: |"]
    for key, label in (("ensemble", "Uncalibrated"),
                       ("ensemble_isotonic", "Isotonic"),
                       ("ensemble_platt", "Platt scaling")):
        if key not in summary.index:
            continue
        r = summary.loc[key]
        lines.append(
            f"| {label} | {fmt(r.get('log_loss'))} | {fmt(r.get('brier'))} | "
            f"{pct(r.get('accuracy'))} | {fmt(r.get('ece'))} |"
        )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=None)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    out_dir = Path(args.input) if args.input else data_dir() / "processed" / "backtest"
    summary, per_fold, weights, meta, predictions = load(out_dir)

    seasons = meta["seasons"]
    document = f"""# Benchmark: measured results

Every number in this document is produced by
`python scripts/backtest.py` and rendered by `python scripts/report.py`.
Nothing is written by hand and nothing is estimated.

**Protocol.** Walk-forward validation over {len(seasons)} seasons
({seasons[0]} to {seasons[-1]}), {meta['n_matches']:,} test matches. For each
test season, base models are fitted on earlier data, ensemble weights and
calibrators are fitted on a {meta['validation_seasons']}-season validation
window that ends before the test season, and the test season is then predicted
by models that have never seen it. Statistical models are refitted every
{meta['refit_interval_days']} days inside the test season; ML models are
refitted per season on the most recent {meta['ml_train_seasons']} seasons.
Full protocol in [LEAKAGE.md](LEAKAGE.md).

Run time: {meta['runtime_seconds'] / 60:.0f} minutes.

---

## 1. Headline: the HUB market

Log loss and Brier are proper scoring rules; RPS additionally accounts for the
outcomes being ordered (home &gt; draw &gt; away). Lower is better for all
three, and for ECE. Accuracy is included because it is asked for, but it is
the least informative column here.

{headline_table(summary)}

## 2. Calibration

Both post-hoc methods were carried through every fold and scored on the test
season, rather than assumed to help.

{calibration_comparison(summary)}

### Reliability

All three outcome probabilities pooled, in ten bands. A well-calibrated model
has "observed frequency" tracking "mean predicted".

{reliability_table(predictions)}

## 3. Goal-based markets

{market_table(summary)}

### Over/under ladder

{over_under_ladder(summary)}

### Expected-goals accuracy

{goal_accuracy_table(summary)}

## 4. Half-time and second-half markets

Fitted as separate first-half and second-half goal models, not derived by
halving the full-time numbers.

{half_market_table(summary)}

## 5. Per competition

Calibrated ensemble only, across all test seasons.

{per_competition_table(predictions)}

## 6. Per season

Log loss on the HUB market.

{per_season_table(per_fold)}

## 7. Ensemble weights

Refitted every fold on the validation window. Spread across folds shows how
stable each member's contribution is.

{weights_table(weights)}
"""
    out_path = Path(args.out) if args.out else Path("docs/BENCHMARK.md")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(document)
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
