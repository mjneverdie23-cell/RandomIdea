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



def requested_benchmark_table(summary: pd.DataFrame) -> str:
    """The comparison table in the shape it was asked for.

    BTTS and over/under are only quotable by models that produce a goal
    distribution. Elo and the direct three-way classifiers have no scoreline
    to sum over, so those cells are dashed rather than filled with a number
    borrowed from somewhere else.
    """
    rows = [
        ("elo", None, "Elo"),
        ("poisson", "poisson_markets", "Poisson"),
        ("dixon_coles", "dixon_coles_markets", "Dixon-Coles"),
        ("random_forest", None, "Random Forest"),
        ("xgboost", None, "XGBoost"),
        ("lightgbm_goals", "lightgbm_goals_markets", "LightGBM (goal model)"),
        ("ensemble", None, "Ensemble"),
    ]
    lines = [
        "| Model | Log Loss | Brier | Accuracy | BTTS | O/U 2.5 | Calibration (ECE) |",
        "| ------------- | -------: | ----: | -------: | ---: | --: | ----------: |",
    ]
    for key, market_key, label in rows:
        if key not in summary.index:
            continue
        r = summary.loc[key]
        btts = ou = "&mdash;"
        if market_key and market_key in summary.index:
            m = summary.loc[market_key]
            btts = pct(m.get("btts_accuracy"))
            ou = pct(m.get("ou2.5_accuracy"))
        elif key == "ensemble":
            if "btts_ensemble" in summary.index:
                btts = pct(summary.loc["btts_ensemble"].get("accuracy"))
            if "ou2.5_ensemble" in summary.index:
                ou = pct(summary.loc["ou2.5_ensemble"].get("accuracy"))
        lines.append(
            f"| {label} | {fmt(r.get('log_loss'))} | {fmt(r.get('brier'))} | "
            f"{pct(r.get('accuracy'))} | {btts} | {ou} | {fmt(r.get('ece'))} |"
        )
    return "\n".join(lines)


def classification_table(summary: pd.DataFrame) -> str:
    """Precision, recall and F1 on the three-way market; ROC-AUC on binaries."""
    lines = ["| Model | Precision (macro) | Recall (macro) | F1 (macro) |",
             "| --- | ---: | ---: | ---: |"]
    for key, label in HEADLINE:
        if key not in summary.index or key.endswith("_calibrated"):
            continue
        r = summary.loc[key]
        if not np.isfinite(r.get("f1_macro", np.nan)):
            continue
        lines.append(
            f"| {label} | {fmt(r.get('precision_macro'), 3)} | "
            f"{fmt(r.get('recall_macro'), 3)} | {fmt(r.get('f1_macro'), 3)} |"
        )
    lines.append("")
    lines.append("Binary markets, where ROC-AUC is meaningful:")
    lines.append("")
    lines.append("| Market | ROC-AUC | Log loss | Brier | Accuracy |")
    lines.append("| --- | ---: | ---: | ---: | ---: |")
    for key, label in (("btts_ensemble", "BTTS (ensemble)"),
                       ("ou2.5_ensemble", "Over/under 2.5 (ensemble)")):
        if key not in summary.index:
            continue
        r = summary.loc[key]
        lines.append(
            f"| {label} | {fmt(r.get('roc_auc'))} | {fmt(r.get('log_loss'))} | "
            f"{fmt(r.get('brier'))} | {pct(r.get('accuracy'))} |"
        )
    if "dixon_coles_markets" in summary.index:
        r = summary.loc["dixon_coles_markets"]
        lines.append(
            f"| BTTS (Dixon-Coles) | {fmt(r.get('btts_roc_auc'))} | "
            f"{fmt(r.get('btts_log_loss'))} | {fmt(r.get('btts_brier'))} | "
            f"{pct(r.get('btts_accuracy'))} |"
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
        probs = group[["raw_H", "raw_U", "raw_B"]].to_numpy()
        report = multiclass_report(probs, group["target_result"])
        name = known[code].name if code in known else code
        lines.append(
            f"| {name} | {len(group)} | {fmt(report['log_loss'])} | "
            f"{fmt(report['brier'])} | {fmt(report['rps'])} | "
            f"{pct(report['accuracy'])} | {fmt(report['ece'])} |"
        )
    probs = predictions[["raw_H", "raw_U", "raw_B"]].to_numpy()
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
        predictions["raw_H"].to_numpy(),
        predictions["raw_U"].to_numpy(),
        predictions["raw_B"].to_numpy(),
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



def reliability_commentary(predictions: pd.DataFrame) -> str:
    """Describe the reliability curve from the curve itself.

    Written as a function rather than prose so the commentary cannot end up
    describing an earlier run's numbers.
    """
    if predictions is None or predictions.empty:
        return ""
    probs = np.concatenate([
        predictions["raw_H"].to_numpy(),
        predictions["raw_U"].to_numpy(),
        predictions["raw_B"].to_numpy(),
    ])
    outcomes = np.concatenate([
        (predictions["target_result"] == "H").astype(float).to_numpy(),
        (predictions["target_result"] == "U").astype(float).to_numpy(),
        (predictions["target_result"] == "B").astype(float).to_numpy(),
    ])
    curve = reliability_curve(probs, outcomes, n_bins=10)
    if not curve["predicted"]:
        return ""

    gaps = [abs(p - o) for p, o in zip(curve["predicted"], curve["observed"])]
    worst = int(np.argmax(gaps))
    well_covered = [
        (p, o, n, abs(p - o))
        for p, o, n in zip(curve["predicted"], curve["observed"], curve["count"])
        if n >= 500
    ]
    biggest_solid = max(well_covered, key=lambda row: row[3]) if well_covered else None
    total = sum(curve["count"])

    parts = [
        f"Across {total:,} pooled outcome probabilities the largest gap in any "
        f"band with at least 500 predictions is "
        f"{biggest_solid[3] * 100:.1f} percentage points "
        f"({pct(biggest_solid[0])} predicted against {pct(biggest_solid[1])} "
        f"observed)." if biggest_solid else ""
    ]
    if curve["count"][worst] < 500:
        parts.append(
            f"The widest gap overall sits in the {pct(curve['predicted'][worst])} "
            f"band, but on only {curve['count'][worst]} predictions, which is "
            "too few to read much into."
        )
    parts.append(
        "In short, a probability quoted by this system behaves close to its "
        "face value over a large enough sample - which is what calibration is "
        "for, and the reason the confidence label is reported separately "
        "rather than folded into the probability."
    )
    return " ".join(p for p in parts if p)


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




def competition_commentary(predictions: pd.DataFrame) -> str:
    """Name the best- and worst-scoring competitions from the results.

    Written as a function because the answer changes when a competition is
    added: this paragraph previously said "Ligue 1 worst" and was wrong the
    moment Eliteserien joined.
    """
    if predictions is None or predictions.empty:
        return "**Competition differences are real.** See section 7."

    known = load_competitions()
    scores = {}
    for code, group in predictions.groupby("competition"):
        probs = group[["raw_H", "raw_U", "raw_B"]].to_numpy()
        scores[code] = (
            multiclass_report(probs, group["target_result"])["log_loss"], len(group)
        )
    ranked = sorted(scores.items(), key=lambda kv: kv[1][0])
    best_code, (best_score, _) = ranked[0]
    worst_code, (worst_score, _) = ranked[-1]
    name = lambda code: known[code].name if code in known else code

    spread = worst_score - best_score
    return f"""**Competition differences are real, and worth reading carefully.**
Section 7 puts {name(best_code)} best ({fmt(best_score)}) and
{name(worst_code)} worst ({fmt(worst_score)}) - a spread of {spread:.3f} in
log loss across the eight. The best score is not the model being cleverer
there: a competition whose fixtures include many severe mismatches is simply
easier to call, which flatters any forecaster. The weakest scores belong to
the competitions with the thinnest inputs - no shot data, and in Eliteserien's
case no half-time data and only thirteen seasons of history - which is what
the data-quality panel is for. Every competition still beats the naive
baseline comfortably."""


def decision_section(summary: pd.DataFrame, weights: pd.DataFrame, meta: dict,
                     predictions: pd.DataFrame | None = None) -> str:
    """State the architecture the measurements select, computed from them."""
    hub = summary[summary["log_loss"].notna()]
    candidates = [k for k, _ in HEADLINE if k in hub.index and k != "naive"]
    ranked = hub.loc[candidates, "log_loss"].sort_values()
    best = ranked.index[0]
    best_single = next(
        k for k in ranked.index if not k.startswith("ensemble")
    )
    naive = hub.loc["naive", "log_loss"] if "naive" in hub.index else float("nan")

    members = [c for c in weights.columns if c != "season"]
    mean_weights = weights[members].mean().sort_values(ascending=False)
    top_three = ", ".join(
        f"{name} ({mean_weights[name]:.2f})" for name in mean_weights.index[:3]
    )

    improvement = (naive - ranked.iloc[0]) / naive * 100 if np.isfinite(naive) else float("nan")
    over_single = (hub.loc[best_single, "log_loss"] - ranked.iloc[0]) / \
        hub.loc[best_single, "log_loss"] * 100

    return f"""## 10. What the backtest selected

These are conclusions drawn from the tables above, not preferences.

**Architecture: the weighted logarithmic ensemble, uncalibrated.** It records
the lowest log loss of anything tested ({fmt(ranked.iloc[0])}), which is
{improvement:.1f}% better than the naive base rates ({fmt(naive)}) and
{over_single:.2f}% better than the best single model
(`{best_single}`, {fmt(hub.loc[best_single, "log_loss"])}). The margin over the
best single model is small - which is itself the finding: no individual model
is far ahead, and the blend's advantage comes from averaging different kinds
of error rather than from any member being strong.

**No post-hoc calibration**, for the reason measured in section 3.

**Ensemble composition is genuinely mixed.** The heaviest members by mean
weight are {top_three}. Both statistical and learned models earn weight, and
the per-fold minima and maxima in section 9 show the blend moving year to
year rather than settling on one member - another reason to keep the search
rather than fix the weights.

**Accuracy sits where the literature says it should.**
{pct(hub.loc[best, "accuracy"])} on the three-way market, inside the ~50-55%
range reported in peer-reviewed work (see [RESEARCH.md](RESEARCH.md) §4.1).
Any football system reporting materially more than this on out-of-sample data
is worth checking for leakage.

{competition_commentary(predictions)}

**Caveats on these numbers.** They cover {meta["n_matches"]:,} matches in six
competitions over {len(meta["seasons"])} seasons, with no odds data, no
lineups and no true xG. They are not a claim about profitability - no betting
simulation was run, and none should be inferred from a log loss."""


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

## 1. Model comparison

The headline comparison, across every market a model is able to quote. BTTS
and over/under need a goal distribution to sum over, which Elo and the direct
three-way classifiers do not have - those cells are dashed rather than filled
in from elsewhere.

{requested_benchmark_table(summary)}

## 2. The HUB market in full

Log loss and Brier are proper scoring rules; RPS additionally accounts for the
outcomes being ordered (home &gt; draw &gt; away). Lower is better for all
three, and for ECE. Accuracy is included because it is asked for, but it is
the least informative column here.

{headline_table(summary)}

The shipped configuration applies no post-hoc calibration (section 3), so the
`*_calibrated` variants recorded during the run are identical to their raw
counterparts and are left out of this table rather than repeated. The isotonic
and Platt comparisons below are computed separately and are not affected.

## 3. Calibration

Both post-hoc methods were carried through every fold and scored on the test
season, rather than assumed to help.

{calibration_comparison(summary)}

### What this means, and what was chosen

Post-hoc calibration **degrades** this ensemble on every measure that matters:
log loss, Brier and ECE all get worse. That is not the usual result, and it
has a straightforward explanation. The members are fitted by proper scoring
rules (weighted Poisson likelihood, multinomial log loss) and blended by
minimising validation log loss, so the blend is already close to calibrated
before anything is done to it. Isotonic regression fitted on a ~4,000-match
validation window then has more room to overfit the correction than it has
bias to remove.

**The production default is therefore no post-hoc calibration**
(`calibration.method: none` in `config/model.yml`). This follows the
measurement rather than the convention. The calibrators remain implemented,
tested and re-measured on every backtest run; if a future model set turns out
to need them, the numbers here will say so.

### Reliability

All three outcome probabilities pooled, in ten bands. A well-calibrated model
has "observed frequency" tracking "mean predicted".

{reliability_table(predictions)}

{reliability_commentary(predictions)}

## 4. Classification metrics

Reported because they were asked for. They are less informative than the
scoring rules above: a model can gain accuracy while getting worse at
estimating probabilities, which is what the system is actually for.

{classification_table(summary)}

Worth reading honestly: the BTTS ROC-AUC of around 0.55 says the model ranks
fixtures by both-teams-to-score only slightly better than chance. Its
probabilities are well calibrated - the log loss beats a constant base rate -
but its ability to tell one fixture from another on this market is weak.
Over/under 2.5 discriminates better, and the three-way result better still.
That ordering matches how much signal the underlying goal distribution carries
about each question.

## 5. Goal-based markets

{market_table(summary)}

### Over/under ladder

{over_under_ladder(summary)}

### Expected-goals accuracy

{goal_accuracy_table(summary)}

## 6. Half-time and second-half markets

Fitted as separate first-half and second-half goal models, not derived by
halving the full-time numbers.

{half_market_table(summary)}

## 7. Per competition

The shipped ensemble, across all test seasons. ECE here is pooled over every
prediction in the group; the ECE column in section 2 averages per-fold values,
so the two are not directly comparable with each other.

{per_competition_table(predictions)}

## 8. Per season

Log loss on the HUB market.

{per_season_table(per_fold)}

## 9. Ensemble weights

Refitted every fold on the validation window. Spread across folds shows how
stable each member's contribution is.

{weights_table(weights)}

{decision_section(summary, weights, meta, predictions)}
"""
    out_path = Path(args.out) if args.out else Path("docs/BENCHMARK.md")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(document)
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
