"""End-to-end: train on a synthetic league, then serve predictions."""
import numpy as np
import pandas as pd
import pytest

from football_predictor.confidence import assess_confidence, assess_data_quality
from football_predictor.explain import explain
from football_predictor.features.builder import FeatureBuilder


@pytest.fixture(scope="module")
def trained(synthetic_matches_module, tmp_path_factory, monkeypatch_module):
    from football_predictor.train import train
    return train(synthetic_matches_module, validation_seasons=1, save=False)


@pytest.fixture(scope="module")
def synthetic_matches_module():
    """Module-scoped copy of the synthetic league (training is slow)."""
    from tests.conftest import synthetic_matches as _factory  # noqa: F401
    import numpy as np
    from football_predictor.schema import coerce_dtypes, make_match_id

    rng = np.random.default_rng(7)
    teams = [f"Team {c}" for c in "ABCDEFGH"]
    strength = {t: 0.25 * (len(teams) - i) for i, t in enumerate(teams)}
    rows, date = [], pd.Timestamp("2021-08-07")
    for season in ["2021/22", "2022/23", "2023/24"]:
        for home in teams:
            for away in teams:
                if home == away:
                    continue
                lam = float(np.exp(-0.15 + 0.45 * strength[home] - 0.35 * strength[away]))
                mu = float(np.exp(-0.35 + 0.45 * strength[away] - 0.35 * strength[home]))
                hg, ag = int(rng.poisson(lam)), int(rng.poisson(mu))
                rows.append({
                    "date": date, "competition": "TEST_L", "season": season,
                    "stage": "league", "home_team": home, "away_team": away,
                    "neutral_venue": False, "home_goals": hg, "away_goals": ag,
                    "ht_home_goals": int(rng.binomial(hg, 0.44)),
                    "ht_away_goals": int(rng.binomial(ag, 0.44)),
                    "home_shots_on_target": int(rng.integers(1, 9)),
                    "away_shots_on_target": int(rng.integers(1, 8)),
                })
                date += pd.Timedelta(days=3)
        date += pd.Timedelta(days=40)
    df = coerce_dtypes(pd.DataFrame(rows))
    df["match_id"] = make_match_id(df["competition"], df["date"],
                                   df["home_team"], df["away_team"])
    return df.sort_values("date").reset_index(drop=True)


@pytest.fixture(scope="module")
def monkeypatch_module():
    from _pytest.monkeypatch import MonkeyPatch
    patch = MonkeyPatch()
    yield patch
    patch.undo()


@pytest.fixture(scope="module")
def engine(trained, monkeypatch_module):
    """A prediction engine over a competition the config does not know about."""
    from football_predictor import config as config_module
    from football_predictor.config import Competition
    from football_predictor.predict import PredictionEngine

    fake = Competition(
        code="TEST_L", name="Test League", country="Testland", tier=1,
        format="league", source="", source_key=None, enabled=True,
    )
    original = config_module.load_competitions()
    merged = {**original, "TEST_L": fake}
    monkeypatch_module.setattr(config_module, "load_competitions", lambda: merged)
    import football_predictor.predict as predict_module
    monkeypatch_module.setattr(predict_module, "load_competitions", lambda: merged)
    monkeypatch_module.setattr(predict_module, "get_competition", lambda code: merged[code])
    return PredictionEngine(trained)


def test_training_produces_a_usable_bundle(trained):
    assert trained.dixon_coles is not None
    assert trained.poisson is not None
    assert trained.elo_outcome is not None
    assert trained.ml_members, "no ML members were fitted"
    assert trained.ensemble is not None
    assert trained.feature_names
    assert trained.trained_through is not None


def test_prediction_covers_every_documented_market(engine):
    out = engine.predict(
        competition="TEST_L", home_team="Team A", away_team="Team D",
        date="2024-08-01", season="2024/25",
    )
    for key in ("fixture", "expected_goals", "hub", "btts", "totals",
                "team_goals", "halves", "most_likely_scores", "confidence",
                "data_quality", "factors", "model"):
        assert key in out, f"missing {key}"


def test_probabilities_are_coherent(engine):
    out = engine.predict(
        competition="TEST_L", home_team="Team A", away_team="Team D",
        date="2024-08-01", season="2024/25",
    )
    hub = out["hub"]
    assert hub["home"] + hub["draw"] + hub["away"] == pytest.approx(1.0, abs=1e-3)
    assert out["btts"]["yes"] + out["btts"]["no"] == pytest.approx(1.0, abs=1e-3)
    for book in out["totals"].values():
        assert book["over"] + book["under"] == pytest.approx(1.0, abs=1e-3)
    assert all(0.0 <= v <= 1.0 for v in hub.values())


def test_markets_agree_with_the_scoreline_probabilities(engine):
    """Every market is read off one distribution, so they must not contradict."""
    out = engine.predict(
        competition="TEST_L", home_team="Team A", away_team="Team D",
        date="2024-08-01", season="2024/25",
    )
    # Over 0.5 must be at least as likely as over 1.5, and so on down the ladder.
    overs = [out["totals"][line]["over"] for line in ("0.5", "1.5", "2.5", "3.5")]
    assert overs == sorted(overs, reverse=True)
    # A team scoring at all is exactly "over 0.5" for that team.
    assert out["team_goals"]["home"]["to_score"] == pytest.approx(
        out["team_goals"]["home"]["over"]["0.5"], abs=1e-3
    )


def test_the_stronger_side_is_favoured(engine):
    strong = engine.predict(competition="TEST_L", home_team="Team A",
                            away_team="Team H", date="2024-08-01", season="2024/25")
    weak = engine.predict(competition="TEST_L", home_team="Team H",
                          away_team="Team A", date="2024-08-01", season="2024/25")
    assert strong["hub"]["home"] > weak["hub"]["home"]
    assert strong["expected_goals"]["home"] > weak["expected_goals"]["home"]


def test_half_markets_are_present_and_not_a_halved_full_time(engine):
    out = engine.predict(competition="TEST_L", home_team="Team A",
                         away_team="Team D", date="2024-08-01", season="2024/25")
    halves = out["halves"]
    assert halves["available"] is True
    first = halves["first_half"]["expected_goals"]["total"]
    full = out["expected_goals"]["total"]
    assert first < full
    # A first half is not half a match: the share should sit near the
    # measured 40-50%, not at exactly 50%.
    assert 0.30 < first / full < 0.52
    assert halves["first_half"]["hub"]["draw"] > out["hub"]["draw"]


def test_the_two_halves_add_up_to_the_full_match(engine):
    """A panel showing 1.26 + 1.47 next to a total of 2.96 would be a bug.

    The half models supply the split between the periods; the full-time
    distribution supplies the level. Their expected goals must reconcile.
    """
    out = engine.predict(competition="TEST_L", home_team="Team A",
                         away_team="Team F", date="2024-08-01", season="2024/25")
    halves = out["halves"]
    assert halves["available"] is True
    first = halves["first_half"]["expected_goals"]
    second = halves["second_half"]["expected_goals"]
    assert first["total"] + second["total"] == pytest.approx(
        out["expected_goals"]["total"], abs=0.01
    )
    # And per side, not just in aggregate.
    assert first["home"] + second["home"] == pytest.approx(
        out["expected_goals"]["home"], abs=0.01
    )
    assert first["away"] + second["away"] == pytest.approx(
        out["expected_goals"]["away"], abs=0.01
    )
    shares = halves["goal_split"]
    assert shares["first_half_share"] + shares["second_half_share"] == pytest.approx(1.0)
    # The split is the half models' own, not an assumed 50/50.
    assert shares["first_half_share"] != pytest.approx(0.5, abs=1e-6)


def test_a_past_date_is_replayed_rather_than_fitted_in_hindsight(engine):
    out = engine.predict(competition="TEST_L", home_team="Team A",
                         away_team="Team D", date="2023-01-15", season="2022/23")
    assert out["model"]["mode"] == "historical_replay"
    # Only replay-safe members may contribute.
    assert set(out["model"]["members"]) <= {"poisson", "dixon_coles", "elo"}


def test_a_future_date_uses_the_full_ensemble(engine):
    out = engine.predict(competition="TEST_L", home_team="Team A",
                         away_team="Team D", date="2030-01-15", season="2029/30")
    assert out["model"]["mode"] == "forecast"
    assert len(out["model"]["members"]) > 3


def test_unknown_teams_and_self_matches_are_rejected(engine):
    from football_predictor.predict import UnknownTeamError

    with pytest.raises(UnknownTeamError):
        engine.predict(competition="TEST_L", home_team="Nowhere United",
                       away_team="Team A", date="2024-08-01", season="2024/25")
    with pytest.raises(ValueError):
        engine.predict(competition="TEST_L", home_team="Team A",
                       away_team="Team A", date="2024-08-01", season="2024/25")


def test_explanations_reference_real_features(engine, synthetic_matches_module):
    out = engine.predict(competition="TEST_L", home_team="Team A",
                         away_team="Team H", date="2024-08-01", season="2024/25")
    factors = out["factors"]
    assert factors, "no factors produced for a fixture with full history"
    names = {f["name"] for f in factors}
    assert "Elo rating difference" in names
    for factor in factors:
        assert factor["favours"] in ("home", "away", "neutral")
        assert 0.0 <= factor["weight"] <= 1.0
        assert factor["detail"]


def test_no_factors_are_invented_without_history():
    """A fixture with no history must produce no form-based explanations."""
    builder = FeatureBuilder()
    row = builder.features_for_fixture(
        date=pd.Timestamp("2024-01-01"), competition="TEST_L", season="2023/24",
        home_team="Brand New", away_team="Also New",
    )
    names = {f.name for f in explain(row, home_team="Brand New", away_team="Also New")}
    assert "Recent form (last 5)" not in names
    assert "Head to head" not in names


def test_confidence_and_quality_respond_to_evidence():
    thin = assess_confidence(np.array([0.4, 0.3, 0.3]), home_history=2, away_history=3)
    rich = assess_confidence(np.array([0.75, 0.15, 0.10]),
                             home_history=60, away_history=60)
    assert rich.score > thin.score
    assert thin.notes


def test_a_close_fixture_is_not_reported_as_high_confidence():
    """Good data plus an undecided forecast is Moderate, not High.

    Evidence and sharpness are different things. A model can be perfectly well
    grounded and still be telling you the match is a coin flip, and labelling
    that "High" would say the opposite of what is true.
    """
    members = [np.array([[0.29, 0.26, 0.45]]), np.array([[0.27, 0.27, 0.46]])]
    close = assess_confidence(np.array([0.28, 0.26, 0.46]), members,
                              home_history=60, away_history=60, calibration_ece=0.01)
    decisive = assess_confidence(np.array([0.78, 0.14, 0.08]), members,
                                 home_history=60, away_history=60, calibration_ece=0.01)
    assert close.label == "Moderate"
    assert decisive.label == "High"
    assert close.components["evidence"] > 0.9        # the evidence is fine
    assert close.components["sharpness"] < 0.15      # the forecast is not


def test_thin_history_caps_confidence_even_for_a_clear_favourite():
    decisive_thin = assess_confidence(np.array([0.80, 0.13, 0.07]),
                                      home_history=3, away_history=5)
    decisive_rich = assess_confidence(np.array([0.80, 0.13, 0.07]),
                                      home_history=60, away_history=60)
    assert decisive_thin.label != "High"
    assert decisive_rich.label == "High"
    assert decisive_thin.notes

    good = assess_data_quality(home_history=50, away_history=50,
                               has_half_time_model=True, has_xg=True, has_shots=True,
                               teams_known_to_goal_model=True, competition_matches=5000)
    poor = assess_data_quality(home_history=2, away_history=1,
                               has_half_time_model=False, has_xg=False, has_shots=False,
                               teams_known_to_goal_model=False, competition_matches=20)
    assert good.score > poor.score
    assert poor.warnings


def test_the_bundle_survives_a_save_and_reload(trained, tmp_path):
    """Training that cannot be saved is training that cannot be served.

    A defaultdict built with a lambda pickles fine in-process and fails at
    joblib.dump, so this has to exercise the real round trip.
    """
    import joblib

    path = tmp_path / "bundle.joblib"
    joblib.dump(trained, path, compress=3)
    reloaded = joblib.load(path)

    assert reloaded.trained_through == trained.trained_through
    assert reloaded.feature_names == trained.feature_names
    assert set(reloaded.ml_members) == set(trained.ml_members)
    assert reloaded.dixon_coles.rho == pytest.approx(trained.dixon_coles.rho)

    # The rebuilt state must still behave: default factories included.
    row = reloaded.builder.features_for_fixture(
        date=pd.Timestamp("2030-01-01"), competition="TEST_L", season="2029/30",
        home_team="Team A", away_team="Team B",
    )
    assert np.isfinite(row["elo_diff"])
