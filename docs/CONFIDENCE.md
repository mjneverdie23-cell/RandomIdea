# Confidence and data quality

Two separate readings accompany every prediction. Neither is a claim about the
outcome, and neither is folded into the probabilities.

## Confidence

Confidence answers: *how much can this forecast be relied on?* It combines two
things that are easy to conflate and shouldn't be.

**Evidence** — how much the model had to go on for this fixture:

| Component | What it measures |
|---|---|
| `model_agreement` | how tightly the ensemble members agree, as `exp(-6 · mean KL divergence from their mean)`. Members telling one story is worth more than a blend of arguments. |
| `sample_size` | matches of history for the less-established side, saturating at 30 |
| `calibration` | derived from the ensemble's measured out-of-sample calibration error, stored in the model bundle at training time — a real number, not a placeholder |

```
evidence = 0.40 · agreement + 0.35 · sample_size + 0.25 · calibration
```

**Sharpness** — how decided the forecast actually is, relative to knowing
nothing:

```
sharpness = (highest probability − base rate of a home win) / (1 − base rate)
```

A fixture the model calls 46/26/28 is barely more informative than the league's
own base rates, and scores near zero.

**Combined:**

```
score = 0.55 · evidence + 0.45 · sharpness
```

with a hard floor: if either side has fewer than 10 matches of history, the
score cannot reach the "High" band regardless of how decisive the forecast
looks. A confident-sounding call built on a promoted club's fourth match is
decisive about very little.

| Score | Label |
|---|---|
| ≥ 0.65 | High |
| ≥ 0.45 | Moderate |
| below | Low |

### Why sharpness is weighted so heavily

An earlier version weighted it at 0.30 alongside three evidence terms that are
near 1.0 for any well-covered fixture. The result was that essentially every
big-five league match with complete data read as "High" — including genuine
coin flips. The label carried no information.

Evidence and sharpness are different statements. A model can be perfectly well
grounded and still be telling you the match is close; calling that "High"
tells the user the opposite of what is true. So both have to be present:

| Fixture | Label |
|---|---|
| clear favourite, full history | High |
| moderate favourite, full history | Moderate |
| close call, full history | Moderate |
| clear favourite, thin history | Moderate (gated) |
| close call, thin history | Low |

Pinned by `test_a_close_fixture_is_not_reported_as_high_confidence` and
`test_thin_history_caps_confidence_even_for_a_clear_favourite`.

## Data quality

Data quality answers a different question: *what inputs did this prediction
actually have?* It runs six checks and reports each one:

| Check | Flags when |
|---|---|
| `match_history` | either side has fewer than 10 prior matches |
| `team_coverage` | a team is absent from the fitted goal model and treated as league average |
| `half_time_model` | the competition has no half-time data, so half markets are unavailable |
| `expected_goals` | no expected-goals input (informational) |
| `shot_data` | the competition has no shot data, so shot-derived features are absent (informational) |
| `competition_history` | fewer than 200 matches recorded for the competition |
| `historical_replay` | the date is in the past, so state was replayed to the day before kickoff (informational) |

Warnings cost a full point, informational notes a quarter, and the label falls
out of the total: **Good** (≥ 0.8), **Fair** (≥ 0.55), **Limited** below.

In practice a Champions League fixture reports *"no shot data for this
competition, so shot-derived features are absent"* — true, and worth knowing,
because that prediction rests on fewer inputs than a Premier League one.

## What neither of these is

They are not a probability of being right, and they do not adjust the
probabilities. A "High" confidence 70% forecast is still expected to be wrong
about three times in ten — the interface says so, on every prediction.
