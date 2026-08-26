# Benchmark: measured results

Every number in this document is produced by
`python scripts/backtest.py` and rendered by `python scripts/report.py`.
Nothing is written by hand and nothing is estimated.

**Protocol.** Walk-forward validation over 11 seasons
(2015/16 to 2025/26), 26,466 test matches. For each
test season, base models are fitted on earlier data, ensemble weights and
calibrators are fitted on a 2-season validation
window that ends before the test season, and the test season is then predicted
by models that have never seen it. Statistical models are refitted every
30 days inside the test season; ML models are
refitted per season on the most recent 8 seasons.
Full protocol in [LEAKAGE.md](LEAKAGE.md).

Run time: 44 minutes.

---

## 1. Model comparison

The headline comparison, across every market a model is able to quote. BTTS
and over/under need a goal distribution to sum over, which Elo and the direct
three-way classifiers do not have - those cells are dashed rather than filled
in from elsewhere.

| Model | Log Loss | Brier | Accuracy | BTTS | O/U 2.5 | Calibration (ECE) |
| ------------- | -------: | ----: | -------: | ---: | --: | ----------: |
| Elo | 0.9893 | 0.5899 | 52.4% | &mdash; | &mdash; | 0.0269 |
| Poisson | 0.9888 | 0.5891 | 52.4% | 54.0% | 56.5% | 0.0219 |
| Dixon-Coles | 0.9882 | 0.5888 | 52.4% | 54.2% | 56.6% | 0.0200 |
| Random Forest | 0.9831 | 0.5854 | 52.8% | &mdash; | &mdash; | 0.0204 |
| XGBoost | 0.9866 | 0.5874 | 52.7% | &mdash; | &mdash; | 0.0246 |
| LightGBM (goal model) | 0.9840 | 0.5861 | 52.7% | 54.4% | 56.7% | 0.0215 |
| Ensemble | 0.9810 | 0.5842 | 52.8% | 54.6% | 57.0% | 0.0199 |

## 2. The HUB market in full

Log loss and Brier are proper scoring rules; RPS additionally accounts for the
outcomes being ordered (home &gt; draw &gt; away). Lower is better for all
three, and for ECE. Accuracy is included because it is asked for, but it is
the least informative column here.

| Model | Log Loss | Brier | RPS | Accuracy | Calibration (ECE) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Naive base rates | 1.0716 | 0.6480 | 0.2307 | 44.6% | 0.0258 |
| Elo (ordered logit) | 0.9893 | 0.5899 | 0.2026 | 52.4% | 0.0269 |
| Poisson | 0.9888 | 0.5891 | 0.2023 | 52.4% | 0.0219 |
| Dixon-Coles | 0.9882 | 0.5888 | 0.2022 | 52.4% | 0.0200 |
| Logistic regression | 0.9888 | 0.5887 | 0.2017 | 52.7% | 0.0250 |
| Random forest | 0.9831 | 0.5854 | 0.2007 | 52.8% | 0.0204 |
| XGBoost | 0.9866 | 0.5874 | 0.2013 | 52.7% | 0.0246 |
| LightGBM | 0.9942 | 0.5919 | 0.2029 | 52.3% | 0.0300 |
| CatBoost | 0.9830 | 0.5852 | 0.2006 | 52.9% | 0.0200 |
| LightGBM goal model | 0.9840 | 0.5861 | 0.2009 | 52.7% | 0.0215 |
| **Ensemble** | 0.9810 | 0.5842 | 0.2001 | 52.8% | 0.0199 |

The shipped configuration applies no post-hoc calibration (section 3), so the
`*_calibrated` variants recorded during the run are identical to their raw
counterparts and are left out of this table rather than repeated. The isotonic
and Platt comparisons below are computed separately and are not affected.

## 3. Calibration

Both post-hoc methods were carried through every fold and scored on the test
season, rather than assumed to help.

| Variant | Log loss | Brier | Accuracy | ECE |
| --- | ---: | ---: | ---: | ---: |
| Uncalibrated | 0.9810 | 0.5842 | 52.8% | 0.0199 |
| Isotonic | 0.9893 | 0.5861 | 52.7% | 0.0253 |
| Platt scaling | 0.9821 | 0.5848 | 52.7% | 0.0238 |

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
| 0.0&ndash;0.1 | 2668 | 7.3% | 7.4% |
| 0.1&ndash;0.2 | 11277 | 15.8% | 15.5% |
| 0.2&ndash;0.3 | 31432 | 25.6% | 25.7% |
| 0.3&ndash;0.4 | 11421 | 34.3% | 34.0% |
| 0.4&ndash;0.5 | 9281 | 44.9% | 45.7% |
| 0.5&ndash;0.6 | 6309 | 54.4% | 53.5% |
| 0.6&ndash;0.7 | 3846 | 64.7% | 64.7% |
| 0.7&ndash;0.8 | 2293 | 74.4% | 75.2% |
| 0.8&ndash;0.9 | 813 | 83.9% | 83.4% |
| 0.9&ndash;1.0 | 58 | 91.5% | 91.4% |

Across 79,398 pooled outcome probabilities the largest gap in any band with at least 500 predictions is 1.0 percentage points (54.4% predicted against 53.5% observed). In short, a probability quoted by this system behaves close to its face value over a large enough sample - which is what calibration is for, and the reason the confidence label is reported separately rather than folded into the probability.

## 4. Classification metrics

Reported because they were asked for. They are less informative than the
scoring rules above: a model can gain accuracy while getting worse at
estimating probabilities, which is what the system is actually for.

| Model | Precision (macro) | Recall (macro) | F1 (macro) |
| --- | ---: | ---: | ---: |
| Naive base rates | 0.149 | 0.333 | 0.206 |
| Elo (ordered logit) | 0.351 | 0.440 | 0.380 |
| Poisson | 0.419 | 0.448 | 0.388 |
| Dixon-Coles | 0.431 | 0.448 | 0.390 |
| Logistic regression | 0.470 | 0.453 | 0.405 |
| Random forest | 0.383 | 0.445 | 0.385 |
| XGBoost | 0.454 | 0.449 | 0.398 |
| LightGBM | 0.452 | 0.448 | 0.406 |
| CatBoost | 0.464 | 0.449 | 0.391 |
| LightGBM goal model | 0.348 | 0.447 | 0.387 |
| **Ensemble** | 0.422 | 0.448 | 0.388 |

Binary markets, where ROC-AUC is meaningful:

| Market | ROC-AUC | Log loss | Brier | Accuracy |
| --- | ---: | ---: | ---: | ---: |
| BTTS (ensemble) | 0.5535 | 0.6861 | 0.2465 | 54.6% |
| Over/under 2.5 (ensemble) | 0.5920 | 0.6773 | 0.2422 | 57.0% |
| BTTS (Dixon-Coles) | 0.5444 | 0.6923 | 0.2493 | 54.2% |

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
| Dixon-Coles | 0.6923 | 54.2% | 0.6843 | 56.6% | 1.0510 | 44.4% | 12.3% |
| Poisson | 0.6930 | 54.0% | 0.6843 | 56.5% | 1.0510 | 44.4% | 12.2% |
| LightGBM goal model | 0.6863 | 54.4% | 0.6788 | 56.7% | &mdash; | &mdash; | 12.5% |
| BTTS ensemble | 0.6861 | 54.6% | &mdash; | &mdash; | &mdash; | &mdash; | &mdash; |
| BTTS ensemble (calibrated) | 0.6861 | 54.6% | &mdash; | &mdash; | &mdash; | &mdash; | &mdash; |
| O/U 2.5 ensemble | &mdash; | &mdash; | 0.6773 | 57.0% | &mdash; | &mdash; | &mdash; |
| O/U 2.5 ensemble (calibrated) | &mdash; | &mdash; | 0.6773 | 57.0% | &mdash; | &mdash; | &mdash; |

### Over/under ladder

| Line | Log loss | Brier | Accuracy | ECE |
| --- | ---: | ---: | ---: | ---: |
| Over/under 0.5 | 0.2422 | 0.0615 | 93.4% | 0.0118 |
| Over/under 1.5 | 0.5328 | 0.1748 | 77.0% | 0.0271 |
| Over/under 2.5 | 0.6843 | 0.2453 | 56.6% | 0.0383 |
| Over/under 3.5 | 0.6130 | 0.2109 | 68.8% | 0.0305 |
| Over/under 4.5 | 0.4276 | 0.1301 | 84.2% | 0.0204 |
| Over/under 5.5 | 0.2451 | 0.0633 | 93.1% | 0.0110 |

### Expected-goals accuracy

| Model | Home goals MAE | Home RMSE | Home Poisson dev. | Away goals MAE | Away RMSE | Away Poisson dev. |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dixon-Coles | 0.977 | 1.238 | 1.126 | 0.874 | 1.119 | 1.147 |
| Poisson | 0.977 | 1.238 | 1.126 | 0.874 | 1.120 | 1.147 |
| LightGBM goal model | 0.974 | 1.230 | 1.110 | 0.863 | 1.112 | 1.133 |

## 6. Half-time and second-half markets

Fitted as separate first-half and second-half goal models, not derived by
halving the full-time numbers.

| Market | Log loss | Accuracy |
| --- | ---: | ---: |
| Half-time HUB | 1.0510 | 44.4% |
| First-half BTTS | 0.5041 | 80.1% |
| First half over 0.5 | 0.6007 | 70.8% |
| First half over 1.5 | 0.6499 | 64.3% |
| First half over 2.5 | 0.3847 | 87.1% |
| Second half over 0.5 | 0.4984 | 80.2% |
| Second half over 1.5 | 0.6938 | 54.7% |
| Second half over 2.5 | 0.5111 | 79.1% |

## 7. Per competition

The shipped ensemble, across all test seasons. ECE here is pooled over every
prediction in the group; the ECE column in section 2 averages per-fold values,
so the two are not directly comparable with each other.

| Competition | Matches | Log loss | Brier | RPS | Accuracy | ECE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Premier League | 4180 | 0.9713 | 0.5769 | 0.1992 | 53.4% | 0.0080 |
| La Liga | 4180 | 0.9754 | 0.5806 | 0.1957 | 53.2% | 0.0175 |
| Ligue 1 | 3857 | 0.9993 | 0.5969 | 0.2046 | 51.3% | 0.0106 |
| Bundesliga | 3366 | 0.9907 | 0.5910 | 0.2033 | 51.4% | 0.0171 |
| Serie A | 4180 | 0.9663 | 0.5742 | 0.1935 | 54.2% | 0.0232 |
| Eliteserien | 2154 | 1.0070 | 0.6021 | 0.2089 | 50.8% | 0.0160 |
| Süper Lig | 3052 | 1.0013 | 0.5980 | 0.2059 | 51.6% | 0.0179 |
| UEFA Champions League | 1497 | 0.9178 | 0.5402 | 0.1910 | 58.2% | 0.0222 |
| **All** | 26466 | 0.9810 | 0.5842 | 0.2001 | 52.8% | 0.0063 |

## 8. Per season

Log loss on the HUB market.

| Season | naive | elo | dixon_coles | ensemble | ensemble_calibrated |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2015/16 | 1.0665 | 0.9933 | 0.9895 | 0.9824 | 0.9824 |
| 2016/17 | 1.0557 | 0.9648 | 0.9692 | 0.9590 | 0.9590 |
| 2017/18 | 1.0630 | 0.9706 | 0.9697 | 0.9654 | 0.9654 |
| 2018/19 | 1.0704 | 0.9944 | 0.9934 | 0.9875 | 0.9875 |
| 2019/20 | 1.0764 | 1.0017 | 0.9957 | 0.9911 | 0.9911 |
| 2020/21 | 1.0907 | 1.0113 | 0.9982 | 0.9975 | 0.9975 |
| 2021/22 | 1.0768 | 1.0014 | 1.0032 | 0.9946 | 0.9946 |
| 2022/23 | 1.0630 | 0.9829 | 0.9956 | 0.9807 | 0.9807 |
| 2023/24 | 1.0748 | 0.9796 | 0.9860 | 0.9727 | 0.9727 |
| 2024/25 | 1.0791 | 0.9850 | 0.9775 | 0.9725 | 0.9725 |
| 2025/26 | 1.0706 | 0.9967 | 0.9888 | 0.9858 | 0.9858 |

## 9. Ensemble weights

Refitted every fold on the validation window. Spread across folds shows how
stable each member's contribution is.

| Member | Mean weight | Min | Max |
| --- | ---: | ---: | ---: |
| dixon_coles | 0.217 | 0.028 | 0.432 |
| catboost | 0.173 | 0.008 | 0.292 |
| random_forest | 0.157 | 0.011 | 0.415 |
| lightgbm_goals | 0.128 | 0.016 | 0.335 |
| logistic | 0.098 | 0.036 | 0.267 |
| xgboost | 0.091 | 0.018 | 0.171 |
| poisson | 0.066 | 0.008 | 0.261 |
| elo | 0.042 | 0.004 | 0.105 |
| lightgbm | 0.028 | 0.001 | 0.175 |

## 10. What the backtest selected

These are conclusions drawn from the tables above, not preferences.

**Architecture: the weighted logarithmic ensemble, uncalibrated.** It records
the lowest log loss of anything tested (0.9810), which is
8.5% better than the naive base rates (1.0716) and
0.20% better than the best single model
(`catboost`, 0.9830). The margin over the
best single model is small - which is itself the finding: no individual model
is far ahead, and the blend's advantage comes from averaging different kinds
of error rather than from any member being strong.

**No post-hoc calibration**, for the reason measured in section 3.

**Ensemble composition is genuinely mixed.** The heaviest members by mean
weight are dixon_coles (0.22), catboost (0.17), random_forest (0.16). Both statistical and learned models earn weight, and
the per-fold minima and maxima in section 9 show the blend moving year to
year rather than settling on one member - another reason to keep the search
rather than fix the weights.

**Accuracy sits where the literature says it should.**
52.8% on the three-way market, inside the ~50-55%
range reported in peer-reviewed work (see [RESEARCH.md](RESEARCH.md) §4.1).
Any football system reporting materially more than this on out-of-sample data
is worth checking for leakage.

**Competition differences are real, and worth reading carefully.**
Section 7 puts UEFA Champions League best (0.9178) and
Eliteserien worst (1.0070) - a spread of 0.089 in
log loss across the eight. The best score is not the model being cleverer
there: a competition whose fixtures include many severe mismatches is simply
easier to call, which flatters any forecaster. The weakest scores belong to
the competitions with the thinnest inputs - no shot data, and in Eliteserien's
case no half-time data and only thirteen seasons of history - which is what
the data-quality panel is for. Every competition still beats the naive
baseline comfortably.

**Caveats on these numbers.** They cover 26,466 matches in six
competitions over 11 seasons, with no odds data, no
lineups and no true xG. They are not a claim about profitability - no betting
simulation was run, and none should be inferred from a log loss.
