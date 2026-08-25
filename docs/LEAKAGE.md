# Data leakage: how it is prevented, and how that is proved

Leakage is the failure mode that matters most in match forecasting, because it
is silent. A model that sees any part of the match it is predicting looks
excellent in backtest and is worthless in use, and nothing in the metrics says
so — the numbers just get better.

The approach here is structural rather than procedural: the pipeline is built
so that the leaking version is difficult to write, and tests exist that fail
if someone writes it anyway.

## 1. Features are produced by a streaming state machine

`FeatureBuilder.transform` makes exactly one chronological pass. For each
fixture it:

1. **reads** the current state of both teams, the competition and the
   head-to-head record, and writes that out as the feature row;
2. **then** folds the match result into state.

A rolling average therefore cannot contain the match it describes — not
because a window was carefully offset, but because the value did not exist yet
when the row was written. There is no `shift(1)` to get wrong.

The same applies to Elo: `EloRatings.rate_frame` reports the ratings each side
carried *into* the match, then applies the result.

## 2. Targets live in their own namespace

Prediction targets are written as `target_*` columns, and `feature_columns()`
excludes both those and the context columns (`match_id`, `date`, team names).
The raw post-match fields — `home_goals`, `home_shots`, `ht_home_goals` — are
not in the feature frame at all under their own names.

## 3. Statistical models apply their own cutoff

`DixonColesModel.fit(df, reference_date=...)` filters to `date < reference`
*inside* the model rather than trusting the caller to pass a clean frame. A
model fitted "as of" a date gives identical parameters whether or not later
matches were present in the frame it was handed.

## 4. Derived quantities use only prior information

The shot-based xG proxy needs a goals-per-shot-on-target conversion rate.
That rate is maintained as a running competition average and read *before*
the current match updates it — so a match never contributes to the constant
used to describe itself.

The same holds for competition baselines (average home goals, draw rate,
first-half share) and for the newcomer Elo seeding quantile.

## 5. Validation is chronological, and three-way

Every split is by time. Never random, never shuffled.

For each test season:

```
[========= inner train =========][== validation ==][== test ==]
                                  ^                 ^
                                  |                 |
        ensemble weights and calibrators fitted here |
                                                    |
                        base models refitted on everything before test
```

The test season is seen by nothing that was fitted — not the models, not the
blend weights, not the calibrators. Fitting a calibrator on the test fold is
a subtle and common way to leak, and the two-stage structure exists to make it
impossible rather than merely discouraged.

## 6. Statistical models are refitted inside the test season

Fitting once at the start of a season and predicting through to May would make
the model progressively staler, which understates it. Goal models are refitted
every 30 days, each time on matches strictly before the refit date.

## 7. Historical predictions in the UI are replayed, not fitted in hindsight

This one is easy to get wrong in a serving layer. If a user asks for a match
date inside the training period, naively using the current model state would
answer with a model that has already seen that match and everything after it.

Instead `PredictionEngine`:

- rewinds team state to the nearest season-start snapshot and replays only the
  matches before the requested date;
- refits the goal models with `reference_date` set to that date;
- uses **only replay-safe members** — Poisson, Dixon-Coles and Elo, all of
  which are refitted from scratch — and drops the ML members, which were
  trained on data spanning that period and cannot be honestly rewound;
- reports `"mode": "historical_replay"` in the response, which the UI shows.

Predictions for dates after the training cutoff use the full ensemble and
report `"mode": "forecast"`.

## 8. The tests

`tests/test_leakage.py`. The decisive one:

```python
def test_features_do_not_change_when_the_future_changes(synthetic_matches):
    original = FeatureBuilder().transform(df)

    tampered = df.copy()
    tampered.loc[df["date"] > cutoff, "home_goals"] = 9    # rewrite the future
    rebuilt = FeatureBuilder().transform(tampered)

    pd.testing.assert_frame_equal(          # rows before the cutoff must be
        original.loc[past], rebuilt.loc[past], check_exact=True
    )
```

Every match after a cut-off is rewritten to an absurd 9-0, and every feature
row before that cut-off must be bit-for-bit identical. If any future
information reached a past row — through a rolling window, a rating, a
competition average or a conversion rate — the frames differ and the test
fails.

The rest of the file covers the remaining routes:

| Test | Guards against |
|---|---|
| `test_dropping_future_matches_leaves_past_features_untouched` | truncation changing past rows |
| `test_a_teams_first_match_has_no_form` | form appearing before any was played |
| `test_rolling_form_excludes_the_current_match` | an off-by-one in the window |
| `test_elo_ratings_are_pre_match` | ratings reported after the update |
| `test_goal_model_ignores_matches_at_or_after_the_reference_date` | the cutoff being the caller's job |
| `test_inference_features_match_training_features` | serving using a different feature definition |
| `test_inference_does_not_mutate_builder_state` | a prediction teaching the model |
| `test_targets_are_never_offered_as_features` | a target column reaching the model |

And in `tests/test_predict.py`:

| Test | Guards against |
|---|---|
| `test_a_past_date_is_replayed_rather_than_fitted_in_hindsight` | hindsight predictions in the UI |
| `test_a_future_date_uses_the_full_ensemble` | the replay path silently applying to real forecasts |

## What is still not modelled

Honest gaps, listed because they matter more than the ones that are closed:

- **Lineups and injuries.** Not in any wired source. Team-strength features
  therefore assume a roughly typical XI. A late injury to a key player is
  invisible to the model.
- **Transfers.** Absorbed slowly through form and the between-season Elo
  regression, not modelled directly. Predictions in the opening weeks of a
  season after heavy squad turnover are the weakest the system produces.
- **Managerial changes.** Not modelled.
- **Motivation.** A dead rubber on the final matchday is scored the same as a
  title decider.

None of these leak — they are simply absent, and the data-quality panel says
what a given fixture rests on.
