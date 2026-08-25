# Benchmark: measured results

Every number in this document is produced by
`python scripts/backtest.py` and rendered by `python scripts/report.py`.
Nothing is written by hand and nothing is estimated.

**Protocol.** Walk-forward validation over 11 seasons
(2015/16 to 2025/26), 21,260 test matches. For each
test season, base models are fitted on earlier data, ensemble weights and
calibrators are fitted on a 2-season validation
window that ends before the test season, and the test season is then predicted
by models that have never seen it. Statistical models are refitted every
30 days inside the test season; ML models are
refitted per season on the most recent 8 seasons.
Full protocol in [LEAKAGE.md](LEAKAGE.md).

Run time: 51 minutes.

---

## 1. Model comparison

The headline comparison, across every market a model is able to quote. BTTS
and over/under need a goal distribution to sum over, which Elo and the direct
three-way classifiers do not have - those cells are dashed rather than filled
in from elsewhere.

| Model | Log Loss | Brier | Accuracy | BTTS | O/U 2.5 | Calibration (ECE) |
| ------------- | -------: | ----: | -------: | ---: | --: | ----------: |
| Elo | 0.9854 | 0.5871 | 52.7% | &mdash; | &mdash; | 0.0305 |
| Poisson | 0.9826 | 0.5849 | 52.9% | 54.2% | 56.7% | 0.0241 |
| Dixon-Coles | 0.9822 | 0.5847 | 52.8% | 54.2% | 56.8% | 0.0215 |
| Random Forest | 0.9778 | 0.5817 | 53.2% | &mdash; | &mdash; | 0.0233 |
| XGBoost | 0.9832 | 0.5848 | 53.1% | &mdash; | &mdash; | 0.0283 |
| LightGBM (goal model) | 0.9791 | 0.5827 | 53.3% | 53.9% | 56.8% | 0.0231 |
| Ensemble | 0.9753 | 0.5802 | 53.2% | 54.4% | 57.2% | 0.0230 |

## 2. The HUB market in full

Log loss and Brier are proper scoring rules; RPS additionally accounts for the
outcomes being ordered (home &gt; draw &gt; away). Lower is better for all
three, and for ECE. Accuracy is included because it is asked for, but it is
the least informative column here.

| Model | Log Loss | Brier | RPS | Accuracy | Calibration (ECE) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Naive base rates | 1.0739 | 0.6495 | 0.2315 | 44.3% | 0.0298 |
| Elo (ordered logit) | 0.9854 | 0.5871 | 0.2013 | 52.7% | 0.0305 |
| Poisson | 0.9826 | 0.5849 | 0.2004 | 52.9% | 0.0241 |
| Dixon-Coles | 0.9822 | 0.5847 | 0.2004 | 52.8% | 0.0215 |
| Logistic regression | 0.9845 | 0.5853 | 0.2001 | 52.9% | 0.0294 |
| Random forest | 0.9778 | 0.5817 | 0.1990 | 53.2% | 0.0233 |
| XGBoost | 0.9832 | 0.5848 | 0.1999 | 53.1% | 0.0283 |
| LightGBM | 0.9932 | 0.5906 | 0.2020 | 52.4% | 0.0358 |
| CatBoost | 0.9773 | 0.5812 | 0.1988 | 53.3% | 0.0235 |
| LightGBM goal model | 0.9791 | 0.5827 | 0.1993 | 53.3% | 0.0231 |
| **Ensemble** | 0.9753 | 0.5802 | 0.1983 | 53.2% | 0.0230 |
| **Ensemble (calibrated)** | 0.9845 | 0.5826 | 0.1992 | 53.2% | 0.0290 |

## 3. Calibration

Both post-hoc methods were carried through every fold and scored on the test
season, rather than assumed to help.

| Variant | Log loss | Brier | Accuracy | ECE |
| --- | ---: | ---: | ---: | ---: |
| Uncalibrated | 0.9753 | 0.5802 | 53.2% | 0.0230 |
| Isotonic | 0.9845 | 0.5826 | 53.2% | 0.0290 |
| Platt scaling | 0.9768 | 0.5811 | 53.3% | 0.0281 |

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

| Predicted band | Matches | Mean predicted | Observed frequency |
| --- | ---: | ---: | ---: |
| 0.0&ndash;0.1 | 2320 | 7.2% | 7.3% |
| 0.1&ndash;0.2 | 9597 | 15.8% | 15.6% |
| 0.2&ndash;0.3 | 24656 | 25.6% | 25.7% |
| 0.3&ndash;0.4 | 9129 | 34.3% | 34.0% |
| 0.4&ndash;0.5 | 7080 | 44.9% | 45.6% |
| 0.5&ndash;0.6 | 5026 | 54.6% | 54.2% |
| 0.6&ndash;0.7 | 3196 | 64.7% | 63.8% |
| 0.7&ndash;0.8 | 1954 | 74.3% | 75.3% |
| 0.8&ndash;0.9 | 768 | 83.9% | 84.0% |
| 0.9&ndash;1.0 | 54 | 91.7% | 94.4% |

Across 63,780 pooled outcome probabilities the largest gap in any band with at least 500 predictions is 0.9 percentage points (74.3% predicted against 75.3% observed). The widest gap overall sits in the 91.7% band, but on only 54 predictions, which is too few to read much into. In short, a probability quoted by this system behaves close to its face value over a large enough sample - which is what calibration is for, and the reason the confidence label is reported separately rather than folded into the probability.

## 4. Classification metrics

Reported because they were asked for. They are less informative than the
scoring rules above: a model can gain accuracy while getting worse at
estimating probabilities, which is what the system is actually for.

| Model | Precision (macro) | Recall (macro) | F1 (macro) |
| --- | ---: | ---: | ---: |
| Naive base rates | 0.148 | 0.333 | 0.205 |
| Elo (ordered logit) | 0.354 | 0.444 | 0.384 |
| Poisson | 0.433 | 0.454 | 0.393 |
| Dixon-Coles | 0.435 | 0.454 | 0.395 |
| Logistic regression | 0.459 | 0.458 | 0.412 |
| Random forest | 0.354 | 0.451 | 0.390 |
| XGBoost | 0.456 | 0.455 | 0.404 |
| LightGBM | 0.447 | 0.452 | 0.412 |
| CatBoost | 0.447 | 0.456 | 0.398 |
| LightGBM goal model | 0.352 | 0.455 | 0.393 |
| **Ensemble** | 0.414 | 0.455 | 0.394 |

Binary markets, where ROC-AUC is meaningful:

| Market | ROC-AUC | Log loss | Brier | Accuracy |
| --- | ---: | ---: | ---: | ---: |
| BTTS (ensemble) | 0.5559 | 0.6867 | 0.2468 | 54.4% |
| Over/under 2.5 (ensemble) | 0.5964 | 0.6768 | 0.2420 | 57.2% |
| BTTS (Dixon-Coles) | 0.5515 | 0.6913 | 0.2489 | 54.2% |

Worth reading honestly: the BTTS ROC-AUC of around 0.55 says the model ranks
fixtures by both-teams-to-score only slightly better than chance. Its
probabilities are well calibrated - the log loss beats a constant base rate -
but its ability to tell one fixture from another on this market is weak.
Over/under 2.5 discriminates better, and the three-way result better still.
That ordering matches how much signal the underlying goal distribution carries
about each question.

## 5. Goal-based markets

| Model | BTTS log loss | BTTS acc | O/U 2.5 log loss | O/U 2.5 acc | HT HUB log loss | HT HUB acc | Exact score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Dixon-Coles | 0.6913 | 54.2% | 0.6825 | 56.8% | 1.0479 | 44.8% | 12.4% |
| Poisson | 0.6920 | 54.2% | 0.6825 | 56.7% | 1.0479 | 44.8% | 12.4% |
| LightGBM goal model | 0.6877 | 53.9% | 0.6793 | 56.8% | &mdash; | &mdash; | 12.5% |
| BTTS ensemble | 0.6867 | 54.4% | &mdash; | &mdash; | &mdash; | &mdash; | &mdash; |
| BTTS ensemble (calibrated) | 0.6922 | 54.4% | &mdash; | &mdash; | &mdash; | &mdash; | &mdash; |
| O/U 2.5 ensemble | &mdash; | &mdash; | 0.6768 | 57.2% | &mdash; | &mdash; | &mdash; |
| O/U 2.5 ensemble (calibrated) | &mdash; | &mdash; | 0.6843 | 57.2% | &mdash; | &mdash; | &mdash; |

### Over/under ladder

| Line | Log loss | Brier | Accuracy | ECE |
| --- | ---: | ---: | ---: | ---: |
| Over/under 0.5 | 0.2440 | 0.0621 | 93.4% | 0.0137 |
| Over/under 1.5 | 0.5337 | 0.1753 | 76.9% | 0.0286 |
| Over/under 2.5 | 0.6825 | 0.2445 | 56.8% | 0.0391 |
| Over/under 3.5 | 0.6080 | 0.2085 | 69.1% | 0.0317 |
| Over/under 4.5 | 0.4200 | 0.1273 | 84.6% | 0.0234 |
| Over/under 5.5 | 0.2392 | 0.0618 | 93.3% | 0.0097 |

### Expected-goals accuracy

| Model | Home goals MAE | Home RMSE | Home Poisson dev. | Away goals MAE | Away RMSE | Away Poisson dev. |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dixon-Coles | 0.967 | 1.227 | 1.119 | 0.872 | 1.115 | 1.140 |
| Poisson | 0.967 | 1.227 | 1.119 | 0.872 | 1.115 | 1.140 |
| LightGBM goal model | 0.966 | 1.221 | 1.107 | 0.864 | 1.111 | 1.132 |

## 6. Half-time and second-half markets

Fitted as separate first-half and second-half goal models, not derived by
halving the full-time numbers.

| Market | Log loss | Accuracy |
| --- | ---: | ---: |
| Half-time HUB | 1.0479 | 44.8% |
| First-half BTTS | 0.5022 | 80.2% |
| First half over 0.5 | 0.5991 | 70.9% |
| First half over 1.5 | 0.6490 | 64.5% |
| First half over 2.5 | 0.3840 | 87.1% |
| Second half over 0.5 | 0.4969 | 80.2% |
| Second half over 1.5 | 0.6923 | 54.9% |
| Second half over 2.5 | 0.5091 | 79.2% |

## 7. Per competition

The shipped ensemble, across all test seasons. ECE here is pooled over every
prediction in the group; the ECE column in section 2 averages per-fold values,
so the two are not directly comparable with each other.

| Competition | Matches | Log loss | Brier | RPS | Accuracy | ECE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Premier League | 4180 | 0.9712 | 0.5768 | 0.1991 | 53.6% | 0.0075 |
| La Liga | 4180 | 0.9756 | 0.5807 | 0.1957 | 53.3% | 0.0190 |
| Ligue 1 | 3857 | 0.9989 | 0.5966 | 0.2043 | 51.3% | 0.0102 |
| Bundesliga | 3366 | 0.9900 | 0.5905 | 0.2030 | 51.3% | 0.0158 |
| Serie A | 4180 | 0.9659 | 0.5739 | 0.1933 | 54.4% | 0.0245 |
| UEFA Champions League | 1497 | 0.9181 | 0.5399 | 0.1910 | 58.2% | 0.0240 |
| **All** | 21260 | 0.9753 | 0.5802 | 0.1983 | 53.2% | 0.0073 |

## 8. Per season

Log loss on the HUB market.

| Season | naive | elo | dixon_coles | ensemble | ensemble_calibrated |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2015/16 | 1.0717 | 0.9992 | 0.9935 | 0.9865 | 0.9942 |
| 2016/17 | 1.0521 | 0.9460 | 0.9500 | 0.9401 | 0.9522 |
| 2017/18 | 1.0694 | 0.9698 | 0.9712 | 0.9626 | 0.9816 |
| 2018/19 | 1.0718 | 0.9805 | 0.9788 | 0.9723 | 0.9805 |
| 2019/20 | 1.0758 | 0.9934 | 0.9858 | 0.9800 | 0.9822 |
| 2020/21 | 1.0988 | 1.0132 | 0.9945 | 0.9934 | 0.9980 |
| 2021/22 | 1.0811 | 0.9951 | 0.9911 | 0.9842 | 0.9972 |
| 2022/23 | 1.0640 | 0.9866 | 0.9976 | 0.9841 | 1.0002 |
| 2023/24 | 1.0779 | 0.9732 | 0.9743 | 0.9661 | 0.9690 |
| 2024/25 | 1.0796 | 0.9853 | 0.9785 | 0.9741 | 0.9808 |
| 2025/26 | 1.0708 | 0.9969 | 0.9890 | 0.9848 | 0.9930 |

## 9. Ensemble weights

Refitted every fold on the validation window. Spread across folds shows how
stable each member's contribution is.

| Member | Mean weight | Min | Max |
| --- | ---: | ---: | ---: |
| catboost | 0.189 | 0.063 | 0.368 |
| dixon_coles | 0.161 | 0.000 | 0.413 |
| random_forest | 0.160 | 0.019 | 0.574 |
| lightgbm_goals | 0.156 | 0.011 | 0.353 |
| poisson | 0.130 | 0.005 | 0.441 |
| logistic | 0.098 | 0.022 | 0.218 |
| elo | 0.052 | 0.010 | 0.185 |
| xgboost | 0.028 | 0.002 | 0.070 |
| lightgbm | 0.025 | 0.004 | 0.087 |

## 10. What the backtest selected

These are conclusions drawn from the tables above, not preferences.

**Architecture: the weighted logarithmic ensemble, uncalibrated.** It records
the lowest log loss of anything tested (0.9753), which is
9.2% better than the naive base rates (1.0739) and
0.21% better than the best single model
(`catboost`, 0.9773). The margin over the
best single model is small - which is itself the finding: no individual model
is far ahead, and the blend's advantage comes from averaging different kinds
of error rather than from any member being strong.

**No post-hoc calibration**, for the reason measured in section 3.

**Ensemble composition is genuinely mixed.** The heaviest members by mean
weight are catboost (0.19), dixon_coles (0.16), random_forest (0.16). Both statistical and learned models earn weight, and
the per-fold minima and maxima in section 9 show the blend moving year to
year rather than settling on one member - another reason to keep the search
rather than fix the weights.

**Accuracy sits where the literature says it should.**
53.2% on the three-way market, inside the ~50-55%
range reported in peer-reviewed work (see [RESEARCH.md](RESEARCH.md) §4.1).
Any football system reporting materially more than this on out-of-sample data
is worth checking for leakage.

**Competition differences are real.** Section 7 shows the Champions League
scoring best and Ligue 1 worst. The Champions League result is not the model
being cleverer there: its group stage contains many severe mismatches, which
are easier to call. Ligue 1 has been the least predictable of the five
leagues over this window.

**Caveats on these numbers.** They cover 21,260 matches in six
competitions over 11 seasons, with no odds data, no
lineups and no true xG. They are not a claim about profitability - no betting
simulation was run, and none should be inferred from a log loss.
