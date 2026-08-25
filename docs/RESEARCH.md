# Research: how football matches get forecast, and what we adopted

This document records what was reviewed before building, what each approach is
good for, and — for each — whether it is used here and why. It is a design
record, not a literature survey for its own sake: every "verdict" below
corresponds to a decision visible in the code.

Measured results for the approaches we implemented are in
[BENCHMARK.md](BENCHMARK.md). Nothing in this file is presented as a result;
where a number comes from a cited paper it is attributed to that paper.

---

## 0. "HUB" — resolving the term first

The brief listed **HUB** as the primary market without defining it. It is not
in English-language betting glossaries, and searching general betting
terminology returns nothing. It is **Scandinavian, specifically Norwegian**:

> **H** = *Hjemmeseier* (home win) · **U** = *Uavgjort* (draw) · **B** =
> *Borteseier* (away win)

It is the three-way match-result market — the same market English-language
books call **1X2** — under the labels used on Norsk Tipping's classic
*Tippekupongen* coupon and in Norwegian odds coverage. The mapping is exact:
`H = 1`, `U = X`, `B = 2`.

Sources:

- [Norsk Tipping — Om Tipping](https://www.norsk-tipping.no/sport/tipping/slik-spiller-du) — the coupon's own H/U/B columns.
- [tvkampen — HUB/1X2, innføring i oddsspillet](https://www.tvkampen.com/betting/oddsspill/hub/) — states directly that HUB and 1X2 are the same market.
- [FootyStats — Tippetips på HUB](https://footystats.org/no/predictions/1x2) — a prediction site serving its 1X2 page under the HUB name.

**Two consequences for the implementation.**

1. HUB settles on **regulation time** (90 minutes plus stoppage), not after
   extra time or penalties. This matters for knockout competitions: a
   Champions League tie that finishes 1-1 after 90 and is won on penalties is
   a **U** for this market. The openfootball ingestion adapter therefore
   parses `3-4 pen. 1-1 a.e.t. (1-1, 0-1)` down to the regulation score `1-1`
   and discards the shootout, and `tests/test_ingest.py` pins that behaviour.
2. Because HUB *is* the full-time result market, the brief's separate
   "full-time result" line is the same output, not an additional one. It is
   quoted once, under both names, rather than computed twice.

Internally the labels `H`, `U`, `B` are used everywhere — one vocabulary, no
translation layer that could drift.

---

## 1. Statistical goal models

### 1.1 Independent Poisson

**Predicts:** a scoring rate for each side, hence a full joint distribution
over scorelines and every market derived from it.
**Needs:** goals, teams, venue. Nothing else.

Model each side's goals as Poisson with
`lambda = exp(attack_home + defence_away + home_advantage)`. Maron (1956) and
Hill (1974) established that football scores are approximately Poisson; the
regression form used here is the standard modern treatment.

**Strengths.** Tiny parameter count (2 per team plus one), interpretable,
gives the whole market book from one fit, essentially cannot overfit.
**Weaknesses.** Assumes the two scores are independent, which they are not; it
under-predicts draws, and low-scoring scorelines in particular. Treats a
team's whole history as equally relevant.
**Overfitting risk:** very low.
**Suitable for BTTS / O-U / team goals / halves:** yes, all of them, directly
from the score matrix.
**Verdict: implemented**, as `PoissonModel` — as a baseline the more elaborate
models have to beat, not as the final answer.

### 1.2 Dixon-Coles

- Dixon, M.J. & Coles, S.G. (1997), *Modelling Association Football Scores and Inefficiencies in the Football Betting Market*, JRSS-C 46(2), 265-280. [Journal](https://rss.onlinelibrary.wiley.com/doi/abs/10.1111/1467-9876.00065) · [Record](https://academic.oup.com/jrsssc/article-abstract/46/2/265/6990546)

Two additions to Poisson, both of which we adopted:

**The low-score correction.** Independent Poisson misprices exactly four
scorelines. Dixon-Coles multiplies those cells by

```
tau(0,0) = 1 - lambda*mu*rho      tau(0,1) = 1 + lambda*rho
tau(1,0) = 1 + mu*rho             tau(1,1) = 1 - rho
```

With `rho < 0` this moves mass into 0-0 and 1-1 and out of 1-0 and 0-1. Dixon
and Coles estimated a negative `rho` on English data.

**Time decay.** Weight each match by `exp(-xi * days_ago)` in the likelihood,
so the fit describes current ability rather than a multi-year average.
[opisthokonta.net](https://opisthokonta.net/?p=1013) and
[dashee87](https://dashee87.github.io/football/python/predicting-football-results-with-statistical-modelling-dixon-coles-and-time-weighting/)
give clear practical treatments of choosing `xi`.

**Strengths.** Fixes the specific, well-documented failure of Poisson; still
tiny and interpretable; the decay parameter is a genuinely useful knob.
**Weaknesses.** The correction only touches four cells — it is a patch on the
dependence structure, not a model of it. `rho` is weakly identified on small
samples.
**Overfitting risk:** low (one extra parameter).
**Verdict: implemented** as `DixonColesModel`, fitted jointly by weighted MLE
with an analytic gradient. Our fitted `rho` varies by league and is mostly
negative, matching the literature — see [BENCHMARK.md](BENCHMARK.md).

> Implementation note worth recording: our first version evaluated the `tau`
> terms only when `rho != 0`, which zeroed `rho`'s own gradient at the
> starting point and pinned it at zero for every fit. The correction was
> silently absent while the model still reported "converged". `rho` is now
> always a free parameter, and `tests/test_models.py::test_rho_is_actually_estimated`
> exists specifically to stop that regressing.

### 1.3 Bivariate Poisson and diagonal inflation

- Karlis, D. & Ntzoufras, I. (2003), *Analysis of sports data by using bivariate Poisson models*, JRSS-D 52(3). [PDF](http://www2.stat-athens.aueb.gr/~jbn/papers2/08_Karlis_Ntzoufras_2003_RSSD.pdf)

Adds a shared covariance term so the two scores are genuinely correlated
rather than corrected after the fact, and — in the diagonally-inflated
variant — raises the probability of *every* draw rather than only the low
ones.

**Strengths.** A principled treatment of the dependence Dixon-Coles patches.
Handles draw frequency better than plain Poisson.
**Weaknesses.** The shared term can only model *positive* correlation, which
is the opposite of what football data often shows; slower to fit; empirically
the gain over Dixon-Coles is small.
**Overfitting risk:** low-moderate.
**Verdict: not implemented.** The extra parameters buy little over
Dixon-Coles for markets we actually quote, and the draw-frequency problem is
handled better here by ensembling with models that estimate the draw directly.
Recorded as the first thing to try if draw calibration proves weak.

### 1.4 Bayesian hierarchical models

- Baio, G. & Blangiardo, M. (2010), *Bayesian hierarchical model for the prediction of football results*, Journal of Applied Statistics 37(2), 253-264. [PDF](https://discovery.ucl.ac.uk/16040/1/16040.pdf)

Attack and defence parameters are drawn from common priors, shrinking weak or
rarely-seen teams toward the mean.

**Strengths.** Exactly the right treatment for newly promoted clubs and small
samples; gives credible intervals rather than point estimates.
**Weaknesses.** The authors themselves document *over*-shrinkage — the best
and worst teams get pulled too far toward the middle, and they needed a
mixture model to fix it. MCMC fitting is orders of magnitude slower, which
matters when refitting monthly across 11 backtested seasons.
**Overfitting risk:** low (that is the point).
**Verdict: not implemented**, but its central insight is used. The same
problem — a team with too little history — is handled by refusing to fit a
parameter for teams under a minimum appearance count, falling back to league
average, and telling the user through the data-quality panel. That is cruder
than shrinkage and much cheaper. A Bayesian variant is the natural upgrade
and is noted in the limitations.

---

## 2. Rating systems

### 2.1 Elo

- [World Football Elo Ratings](https://en.wikipedia.org/wiki/World_Football_Elo_Ratings) — the goal-difference index and importance weights.
- [ClubElo — System](http://clubelo.com/System) — a working club implementation.
- Hvattum, L.M. & Arntzen, H. (2010), *Using ELO ratings for match result prediction in association football*, International Journal of Forecasting 26(3), 460-470. [Record](https://www.sciencedirect.com/science/article/abs/pii/S0169207009001708)

Hvattum & Arntzen is the key reference: they show Elo difference is a useful
covariate for match forecasting and map it to outcome probabilities with
**ordered logistic regression**, which respects away < draw < home.

**Strengths.** One number per team, updates in O(1), needs only results, and
transfers across competitions — a club's league form informs its European
fixtures, which a per-league goal model cannot do. Robust to sparse data.
**Weaknesses.** Discards the scoreline beyond a goal-difference multiplier;
says nothing about *how many* goals, so it cannot quote BTTS or over/under on
its own. Needs a separate link function for probabilities.
**Overfitting risk:** very low (three fitted parameters in the link).
**Suitable for BTTS / O-U / team goals / halves:** no — result markets only.
**Verdict: implemented**, both as a feature (`elo_diff` feeds every ML model)
and as a standalone HUB model with a fitted ordered logit. It also turns out
to carry real ensemble weight — see [BENCHMARK.md](BENCHMARK.md).

Three football-specific adjustments were adopted: the goal-difference
multiplier (1, 1.5, 1.75, `(11+gd)/8`), a per-competition importance
multiplier on K, and between-season regression toward the mean. Debutant clubs
enter at the 25th percentile of their competition rather than the global mean,
because promoted sides are on average weaker than the teams already there.

### 2.2 pi-ratings

- Constantinou, A. & Fenton, N. (2013), *Determining the level of ability of football teams by dynamic ratings*, JQAS. [pi-football](https://www.semanticscholar.org/paper/211b8d8b7b5ed32873dfe817ad1306af153f300c)

Ratings from score *discrepancies*, with separate home and away ability. Won
the 2017 Soccer Prediction Challenge as a feature set.

**Verdict: not implemented as a distinct rating**, but its two ideas are
present: separate home and away form is tracked explicitly in the feature
builder, and goal difference (not just result) drives the Elo update.

---

## 3. Expected goals (xG)

- [Expected goals in football: improving model performance and demonstrating value](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0282295), PLOS ONE.
- [Bayes-xG: player and position correction using a Bayesian hierarchical approach](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11214280/).

A real xG model scores each shot by location, angle, body part and pressure.
The consensus is that xG is a better predictor of future goals than past goals,
because it is less noisy.

**Weaknesses.** Requires shot-level event data. That data is not freely
available for the competitions here, and inventing it is not an option.

**Verdict: partially implemented, and labelled as such.** No free shot-level
feed is reachable, so we derive a **shot-based proxy**:

```
xg_proxy = shots_on_target * (competition's running goals-per-shot-on-target)
```

The conversion rate is computed from matches *before* the one being described,
so the proxy is leak-free. It is named `xg_proxy` in the code and described as
"shot-based proxy" in the UI. It is **not** an Opta or StatsBomb xG and is
never presented as one. Where a real xG column exists in an input file, it is
used in preference. Coverage is ~68% of league matches and 0% of the
Champions League, and the data-quality panel says so per fixture.

---

## 4. Machine learning

### 4.1 The realistic ceiling

- Hubáček, O., Šourek, G. & Železný, F. (2019), *Learning to predict soccer results from relational data with gradient boosted trees*, Machine Learning. Their XGBoost-on-pi-ratings entry scored **52.4% accuracy / RPS 0.2063** in the 2017 Soccer Prediction Challenge.
- Constantinou, A. (2019), *Dolores: a model that predicts football match outcomes from all over the world*, Machine Learning 108. [Springer](https://link.springer.com/article/10.1007/s10994-018-5703-7)
- [Evaluating soccer match prediction models: a deep learning approach and feature optimization for gradient-boosted trees](https://link.springer.com/article/10.1007/s10994-024-06608-w), Machine Learning (2024).

The important, sobering finding across this literature: **football outcome
accuracy tops out around 50-55%**, and bookmaker odds remain hard to beat.
Hubáček & Šír's later paper is titled *Beating the market with a bad
predictive model* — the edge, where it exists, comes from bet selection, not
from forecasting skill. Any project claiming much more than this is either
leaking future information or reporting in-sample numbers. We used this range
as a sanity check on our own results, and our measured accuracy sits inside it.

### 4.2 Logistic regression

**Strengths.** Fast, stable, well-calibrated by construction, a natural
ensemble member because its errors differ in character from a tree's.
**Weaknesses.** Linear in the features; misses interactions unless built by hand.
**Overfitting risk:** low with regularisation.
**Verdict: implemented** (with median imputation and standardisation).

### 4.3 Random forest

**Strengths.** Captures interactions, needs little tuning, resistant to noise.
**Weaknesses.** Probabilities from vote-averaging are poorly calibrated and
biased toward the middle; large and slow relative to boosting.
**Overfitting risk:** moderate — controlled with `min_samples_leaf` and depth.
**Verdict: implemented**, mainly for ensemble diversity.

### 4.4 XGBoost / LightGBM / CatBoost

**Strengths.** The strongest family on tabular data, and the one the football
literature actually uses. All three handle missing values natively, which
matters here: shot data is absent from a third of league matches and all
Champions League matches, and imputing it would fabricate inputs.
**Weaknesses.** Will happily overfit a few thousand rows; probabilities need
calibrating; feature importance is easy to over-read.
**Overfitting risk:** moderate-to-high — controlled with shallow trees, low
learning rates, subsampling, and strictly chronological validation.
**Verdict: all three implemented.**

Beyond classifying the result, gradient boosting is also used a second way:
**two Poisson-objective regressors, one per side**, predicting expected goals
directly. Those rates feed the same score-matrix machinery the statistical
models use, so a boosted model can quote BTTS, over/under, team totals and
exact scores — consistently — without a separate classifier per line. In our
backtest this route scores better on HUB than the same library used as a
direct three-way classifier.

### 4.5 Neural networks and LSTMs

The 2024 *Machine Learning* paper above evaluates a deep-learning approach
against feature-optimised gradient-boosted trees and does not find the
uplift that would justify it on tabular football data of this size.

**Strengths.** Could in principle learn sequence structure (form as a
trajectory) that hand-built rolling windows only approximate.
**Weaknesses.** ~60k matches and ~170 features is small for a sequence model;
far more prone to overfitting; much harder to calibrate and to explain, and
explanation is a stated requirement here.
**Overfitting risk:** high.
**Verdict: not implemented.** The brief allows PyTorch "only if genuinely
justified", and on this data it is not. Adding a dependency and a training
loop to match what LightGBM already does would be complexity without a result.

---

## 5. Combination and calibration

### 5.1 Ensembles

**Verdict: implemented.** Three schemes are available — weighted linear,
weighted logarithmic (normalised geometric mean) and stacking — with weights
searched over the probability simplex against **validation** log loss. The
geometric mean is the default because it is the natural pooling rule for
probabilities and is less easily dragged by one confident, wrong member.

The blend is decided by walk-forward validation rather than preference, and
weights are refitted for every fold. Measured weights are in
[BENCHMARK.md](BENCHMARK.md).

### 5.2 Calibration

- More on verification of probability forecasts for football outcomes — [arXiv:2106.14345](https://arxiv.org/pdf/2106.14345), on Brier decomposition and reliability diagrams for football specifically.

**Isotonic regression** corrects any monotone distortion but needs data;
**Platt scaling** is one parameter and safer on small samples. Both are
implemented, applied one-vs-rest for the three-way market and renormalised,
and always fitted on a validation window strictly between train and test.

We did **not** assume calibration helps. Both methods are carried through
every backtest fold and scored against the uncalibrated ensemble; the measured
outcome is reported in [BENCHMARK.md](BENCHMARK.md) whichever way it fell.

### 5.3 Scoring rules

- Constantinou, A. & Fenton, N. (2012), *Solving the problem of inadequate scoring rules for assessing probabilistic football forecast models*, JQAS.

Log loss and Brier are both proper and punish different mistakes, so both are
reported. **Ranked Probability Score** is reported too, because football's
outcomes are ordered: predicting a home win when the away side wins is a worse
error than predicting a draw, and RPS is the standard rule that knows this.
Accuracy is reported but is the least informative of the four — a model can
gain accuracy while getting worse at the thing it is for.

---

## 6. Monte Carlo simulation

**What it is for:** propagating match-level probabilities into
tournament-level questions — who wins the group, who qualifies.

**Verdict: not implemented, deliberately.** For the single-match markets in
scope, simulation would be a slower and noisier way to compute numbers the
score matrix gives exactly. Summing an 13x13 matrix is exact; sampling it is
an approximation with variance. Monte Carlo becomes the right tool the moment
season or tournament projections are added, and is listed as future work.

---

## 7. Half-time markets: why they are modelled separately

The brief asked not to derive half markets by halving the full-time numbers,
and the data supports that instruction. Goal timing is not uniform: goals
cluster in the second half, and especially in its closing minutes
([goal-time analyses](https://playthepercentage.com/blog/what-time-are-goals-scored-in-football),
and academic work on scoring frequency by period).

Measured on our own data, the split is **≈44% first half / ≈56% second half** —
not 50/50. Halving would misprice every first-half line.

**Verdict: implemented as two separate Dixon-Coles fits**, one on first-half
goals and one on second-half goals (full time minus half time). Each half gets
its own attack, defence and home-advantage parameters — and the fitted
home advantage genuinely differs between halves. Convolving the two gives an
independent estimate of the full-time distribution, which the backtest
compares against the directly fitted full-time model as a consistency check.

---

## 8. What we took from open-source projects

- [penaltyblog](https://github.com/martineastwood/penaltyblog) (Martin Eastwood) — a mature Python package with Poisson, bivariate Poisson and Dixon-Coles. Its API shape and its documentation of the Dixon-Coles likelihood were useful for cross-checking our own derivation.
- [dashee87/blogScripts](https://github.com/dashee87/blogScripts) — clear worked examples of Dixon-Coles with time weighting.
- [opisthokonta.net](https://opisthokonta.net/?p=1013) — the clearest write-up of the time-decay weighting scheme.

**On credibility.** These were read and cross-checked, not copied — the
implementation here is written from the papers' formulations, and the tests
verify behaviour (that `rho` moves the right four cells in the right
direction, that halves convolve back to the full match) rather than matching
another library's output.

A general caution applied throughout: a large share of football-prediction
repositories and tip sites report accuracy or ROI figures with no
out-of-sample protocol, no calibration measurement, and often outright
temporal leakage. Claims of 70%+ accuracy on 1X2 contradict the peer-reviewed
ceiling of ~50-55% and were treated as unreliable. Only the peer-reviewed
sources above were used to set expectations.

---

## 9. Summary of decisions

| Approach | Verdict | Reason |
|---|---|---|
| Poisson | **Used** | baseline; whole market book from one fit |
| Dixon-Coles | **Used** | fixes Poisson's documented low-score failure; cheap |
| Time decay | **Used** | recency matters; one parameter |
| Bivariate Poisson | Not used | little gain over Dixon-Coles for these markets |
| Bayesian hierarchical | Not used | too slow to refit monthly; shrinkage approximated by a minimum-appearance rule |
| Elo | **Used** | cross-competition strength transfer; strong per parameter |
| pi-ratings | Not used directly | ideas absorbed into features and the Elo update |
| xG (true) | Not available | no free shot-level feed; documented gap |
| xG proxy | **Used** | shot-based, leak-free, explicitly labelled a proxy |
| Logistic regression | **Used** | calibrated, diverse ensemble member |
| Random forest | **Used** | interactions, ensemble diversity |
| XGBoost / LightGBM / CatBoost | **Used** | strongest tabular family; native missing-value handling |
| ML goal regressors | **Used** | lets ML quote every market consistently |
| Neural nets / LSTM | Not used | not justified at this data size; hurts explainability |
| Ensemble | **Used** | validated blend beats every member |
| Calibration | **Used, measured** | applied and reported honestly, not assumed to help |
| Monte Carlo | Not used | exact matrix summation is better for single matches |
| Separate half models | **Used** | measured 44/56 split; halving would misprice |
