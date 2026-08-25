"""Leakage guards.

These are the tests that matter most. A football model that peeks at the
match it is predicting looks excellent in backtest and is worthless in use,
and the failure is silent. Each test here attacks one route by which future
information could reach a feature row.
"""
import numpy as np
import pandas as pd
import pytest

from football_predictor.features.builder import (
    CONTEXT_COLUMNS, TARGET_COLUMNS, FeatureBuilder, feature_columns,
)
from football_predictor.features.elo import EloRatings
from football_predictor.models.dixon_coles import DixonColesModel, GoalModelConfig


def test_features_do_not_change_when_the_future_changes(synthetic_matches):
    """The decisive test.

    Build features for the whole table, then rewrite every match after a
    cut-off to an absurd scoreline and rebuild. Rows before the cut-off must
    be byte-for-byte identical: if any later match reached them, they cannot be.
    """
    df = synthetic_matches
    cutoff = df["date"].quantile(0.6)

    original = FeatureBuilder().transform(df)

    tampered = df.copy()
    future = tampered["date"] > cutoff
    tampered.loc[future, "home_goals"] = 9
    tampered.loc[future, "away_goals"] = 0
    tampered.loc[future, "ht_home_goals"] = 5
    tampered.loc[future, "ht_away_goals"] = 0
    rebuilt = FeatureBuilder().transform(tampered)

    past = df["date"] <= cutoff
    columns = feature_columns(original)
    pd.testing.assert_frame_equal(
        original.loc[past, columns], rebuilt.loc[past, columns], check_exact=True
    )


def test_dropping_future_matches_leaves_past_features_untouched(synthetic_matches):
    """Truncation is the other direction of the same guarantee."""
    df = synthetic_matches
    cutoff = df["date"].quantile(0.5)
    full = FeatureBuilder().transform(df)
    truncated = FeatureBuilder().transform(df[df["date"] <= cutoff])

    columns = feature_columns(full)
    past = df["date"] <= cutoff
    pd.testing.assert_frame_equal(
        full.loc[past, columns].reset_index(drop=True),
        truncated[columns].reset_index(drop=True),
        check_exact=True,
    )


def test_a_teams_first_match_has_no_form(synthetic_matches):
    """Before a team has played, its rolling statistics must be missing."""
    df = synthetic_matches
    features = FeatureBuilder().transform(df)
    first = features.iloc[0]
    assert first["home_history"] == 0
    assert first["away_history"] == 0
    for column in ("home_last5_gf", "away_last5_gf", "home_attack_decayed"):
        assert pd.isna(first[column]), f"{column} should be missing on debut"


def test_rolling_form_excludes_the_current_match(synthetic_matches):
    """A last-3 average after N matches must equal the mean of matches N-2..N."""
    df = synthetic_matches
    features = FeatureBuilder().transform(df)

    team = "Team A"
    played = df[(df["home_team"] == team) | (df["away_team"] == team)].sort_values("date")
    goals_for = [
        int(row["home_goals"]) if row["home_team"] == team else int(row["away_goals"])
        for _, row in played.iterrows()
    ]

    target_index = played.index[6]
    row = features.loc[target_index]
    prefix = "home" if df.loc[target_index, "home_team"] == team else "away"
    assert row[f"{prefix}_last3_gf"] == pytest.approx(np.mean(goals_for[3:6]))
    # The seventh match's own goals must not be in there.
    assert row[f"{prefix}_last3_gf"] != pytest.approx(np.mean(goals_for[4:7]))


def test_elo_ratings_are_pre_match(synthetic_matches):
    """rate_frame must report the rating before the result is applied."""
    df = synthetic_matches
    streaming = EloRatings()
    features = streaming.rate_frame(df)

    replay = EloRatings()
    for i, row in enumerate(df.itertuples(index=False)):
        home_rating, away_rating = replay.pre_match_ratings(
            row.home_team, row.away_team, row.competition
        )
        assert features.iloc[i]["elo_home"] == pytest.approx(home_rating)
        assert features.iloc[i]["elo_away"] == pytest.approx(away_rating)
        replay.update(row.home_team, row.away_team,
                      int(row.home_goals), int(row.away_goals),
                      competition=row.competition, season=row.season)


def test_goal_model_ignores_matches_at_or_after_the_reference_date(synthetic_matches):
    """A model fitted 'as of' a date must give identical parameters whether or
    not later matches are present in the frame it was handed."""
    df = synthetic_matches
    reference = pd.Timestamp("2023-01-01")
    config = GoalModelConfig.from_config("dixon_coles")

    with_future = DixonColesModel(config).fit(df, reference_date=reference)
    without_future = DixonColesModel(config).fit(
        df[df["date"] < reference], reference_date=reference
    )
    assert with_future.rho == pytest.approx(without_future.rho, abs=1e-6)
    assert with_future.home_advantage == pytest.approx(
        without_future.home_advantage, abs=1e-6
    )
    for team in with_future.teams:
        assert with_future.attack[team] == pytest.approx(
            without_future.attack[team], abs=1e-6
        )


def test_inference_features_match_training_features(synthetic_matches):
    """features_for_fixture must reproduce the training row for the same
    fixture, or a prediction would be built from a different definition."""
    df = synthetic_matches
    cutoff = df["date"].quantile(0.7)
    history = df[df["date"] < cutoff]
    upcoming = df[df["date"] >= cutoff].iloc[0]

    builder = FeatureBuilder()
    builder.transform(history)
    inference = builder.features_for_fixture(
        date=upcoming["date"], competition=upcoming["competition"],
        season=upcoming["season"], home_team=upcoming["home_team"],
        away_team=upcoming["away_team"], neutral_venue=False,
    )

    training_builder = FeatureBuilder()
    training = training_builder.transform(df)
    row = training.loc[upcoming.name]

    for column in feature_columns(training):
        expected, got = row[column], inference.get(column)
        if pd.isna(expected) and pd.isna(got):
            continue
        assert got == pytest.approx(expected), f"{column} differs at inference time"


def test_inference_does_not_mutate_builder_state(synthetic_matches):
    """Asking for a prediction must not teach the model anything."""
    df = synthetic_matches
    builder = FeatureBuilder()
    builder.transform(df)
    before = dict(builder.elo.snapshot())
    counts = {t: s.n_matches for t, s in builder.teams.items()}

    builder.features_for_fixture(
        date=pd.Timestamp("2024-06-01"), competition="TEST_L", season="2023/24",
        home_team="Team A", away_team="Team B",
    )
    assert builder.elo.snapshot() == before
    assert {t: s.n_matches for t, s in builder.teams.items()} == counts


def test_targets_are_never_offered_as_features(synthetic_matches):
    """Nothing named target_* may end up in the model input columns."""
    features = FeatureBuilder().transform(synthetic_matches)
    columns = set(feature_columns(features))
    assert columns.isdisjoint(TARGET_COLUMNS)
    assert columns.isdisjoint(CONTEXT_COLUMNS)
    # And no post-match statistic leaked in under its raw name.
    for name in ("home_goals", "away_goals", "home_shots", "ht_home_goals"):
        assert name not in columns


def test_snapshot_replay_reproduces_a_full_rebuild(synthetic_matches):
    """The serving-time rewind must land on exactly the state a full pass gives.

    Replaying from a season snapshot is an optimisation. If it double-counted
    or skipped a match, historical predictions would quietly differ from what
    the model would have said at the time.
    """
    import copy

    df = synthetic_matches
    ordered = df.sort_values(["date", "competition", "home_team"], kind="mergesort")
    as_of = pd.Timestamp(ordered["date"].quantile(0.75))

    # Full rebuild: observe every match before the cutoff.
    full = FeatureBuilder()
    for _, row in ordered[ordered["date"] < as_of].iterrows():
        full._observe(row)

    # Snapshot rebuild: stop at a season boundary, then resume by position.
    snapshot_season, snapshot, position = None, None, 0
    streaming = FeatureBuilder()
    current = None
    for index, (_, row) in enumerate(ordered.iterrows()):
        if str(row["season"]) != current:
            current = str(row["season"])
            if pd.Timestamp(row["date"]) < as_of:
                snapshot_season, snapshot, position = current, copy.deepcopy(streaming), index
        streaming._observe(row)

    assert snapshot is not None, "fixture produced no usable snapshot"
    resumed = ordered.iloc[position:]
    for _, row in resumed[resumed["date"] < as_of].iterrows():
        snapshot._observe(row)

    assert snapshot.elo.snapshot() == pytest.approx(full.elo.snapshot())
    assert {t: s.n_matches for t, s in snapshot.teams.items()} == \
           {t: s.n_matches for t, s in full.teams.items()}
    for team, state in full.teams.items():
        assert snapshot.teams[team].season_points == state.season_points
        assert snapshot.teams[team].attack.mean() == pytest.approx(state.attack.mean())
