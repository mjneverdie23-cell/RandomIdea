# Prediction markets

Every goal-based market on this page comes from **one object**: a matrix
`P[h][a]` giving the probability that the match ends with `h` home goals and
`a` away goals. HUB, BTTS, over/under, team totals and exact scores are the
same numbers summed differently, so they cannot contradict each other. The
probability of "over 2.5" always equals the total probability of the
scorelines that are over 2.5, because it *is* that sum.

## HUB — the three-way result

**H**jemmeseier / **U**avgjort / **B**orteseier — the Norwegian rendering of
the three-way match-result market. It is the same market as **1X2**:

| HUB | 1X2 | Outcome |
|---|---|---|
| H | 1 | home win |
| U | X | draw |
| B | 2 | away win |

Settled on **regulation time** — 90 minutes plus stoppage. A knockout tie that
finishes level after 90 and is decided in extra time or on penalties is a
**U** for this market. See [RESEARCH.md §0](RESEARCH.md) for the sources.

Because HUB *is* the full-time result market, it is quoted once under both
names rather than computed twice.

```
H = sum over h > a          U = sum over h == a          B = sum over h < a
```

The three-way probabilities come from the ensemble, which includes direct
classifiers that never see a score distribution. Post-hoc calibration is
applied only if the config asks for it; the measured default is none, for the
reason set out in [BENCHMARK.md](BENCHMARK.md) section 3. The consensus score
matrix is then **reconciled** to them: each of the three outcome regions is
scaled by a single factor to hit the ensemble's numbers. That leaves the shape
*within* each region untouched — the relative likelihood of 2-0 against 3-1 is
still the goal model's — while making every other market consistent with the
figures on screen.

## BTTS — both teams to score

```
P(yes) = sum over h >= 1 and a >= 1
```

Reported as Yes / No.

## Over / under total goals

Lines 0.5, 1.5, 2.5, 3.5, 4.5, 5.5. The total-goals distribution is the
anti-diagonal sum of the matrix, so

```
P(over L) = sum over (h + a) > L
```

Over and under are exact complements, and over probabilities are monotone
decreasing in the line — both asserted in `tests/test_markets.py`.

## Team goals

For each side, the marginal distribution (a row sum for home, a column sum for
away) gives:

- **over 0.5 / 1.5 / 2.5 / 3.5** for that team;
- **to score** — identical to over 0.5, and cross-checked against it;
- **clean sheet** — the probability the *opponent*'s marginal is 0;
- **expected goals** — the mean of the marginal.

## Half-time markets

Modelled separately, not derived by halving. Two Dixon-Coles models are
fitted: one on first-half goals, one on second-half goals (full time minus
half time). Each gets its own attack, defence and home-advantage parameters.

Measured on this dataset the split is about **44% first half / 56% second
half**, and the fitted home advantage differs between the halves. Halving the
full-time numbers would misprice every first-half line.

From the first-half distribution:

- **half-time HUB** — home / draw / away at the break. The draw probability is
  much higher than at full time, because fewer goals have been scored.
- **first-half over/under** at 0.5, 1.5, 2.5
- **first-half BTTS**
- **first-half team goals** — each side to score before the break
- **most likely half-time scores**

From the second-half distribution:

- **second-half over/under** at 0.5, 1.5, 2.5
- **second-half expected goals** per side

Plus the measured **goal split** for this fixture, shown rather than assumed.

Convolving the two halves gives an independent estimate of the full-time
distribution. The backtest compares that against the directly fitted full-time
model as a consistency check — see [BENCHMARK.md](BENCHMARK.md).

**Levels are reconciled with the full-time distribution.** The half models and
the reconciled full-time matrix would otherwise disagree slightly, and the
panel would show a first half of 1.26 and a second of 1.47 beside a match
total of 2.96. So each side's *split* between the periods comes from the half
models — the thing they are good at, and which varies by fixture — while the
*level* comes from the full-time distribution the rest of the page is built
on. Pinned by `test_the_two_halves_add_up_to_the_full_match`.

Half markets are only offered where the half models actually know both clubs
— which means the competition's source supplied half-time scores for them.
Eliteserien's source records none at all, so its fixtures get no half-time
markets. That gate matters: without it the half models would fall back to
league-average rates borrowed from other competitions and present them as a
prediction about a Norwegian match. The panel says why instead of guessing.

## Exact scores

Read directly off the matrix. The six most likely scorelines are returned with
their probabilities. Individually these are low — a typical most-likely
scoreline sits near 10-13% — and the UI shows them as a ranked list rather
than a prediction.

## What is not quoted

Deliberately absent, because the data does not support them honestly:

- **Asian handicap** — derivable from the matrix, but would need proper
  quarter-line handling and half-stake refunds to be worth quoting.
- **Correct score after extra time** — regulation only is stored.
- **Player markets** (goalscorer, cards, assists) — no player-level data in
  any wired source.
- **Corners and cards markets** — the raw counts are ingested and used as
  features, but no distributional model is fitted for them.
- **In-play / live markets** — the system forecasts pre-match only.
