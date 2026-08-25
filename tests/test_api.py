"""HTTP surface of the prediction service."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client(monkeypatch_module):
    """A TestClient wired to an engine trained on the synthetic league."""
    from football_predictor import config as config_module
    from football_predictor.config import Competition
    import football_predictor.predict as predict_module

    import numpy as np
    import pandas as pd
    from football_predictor.schema import coerce_dtypes, make_match_id
    from football_predictor.train import train
    from football_predictor.predict import PredictionEngine

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
                })
                date += pd.Timedelta(days=3)
        date += pd.Timedelta(days=40)
    matches = coerce_dtypes(pd.DataFrame(rows))
    matches["match_id"] = make_match_id(
        matches["competition"], matches["date"], matches["home_team"], matches["away_team"]
    )
    matches = matches.sort_values("date").reset_index(drop=True)

    fake = Competition(code="TEST_L", name="Test League", country="Testland",
                       tier=1, format="league", source="", source_key=None, enabled=True)
    merged = {**config_module.load_competitions(), "TEST_L": fake}
    monkeypatch_module.setattr(config_module, "load_competitions", lambda: merged)
    monkeypatch_module.setattr(predict_module, "load_competitions", lambda: merged)
    monkeypatch_module.setattr(predict_module, "get_competition", lambda code: merged[code])

    bundle = train(matches, validation_seasons=1, save=False)
    import api.main as api_module
    monkeypatch_module.setattr(api_module, "_engine", PredictionEngine(bundle))
    return TestClient(api_module.app)


@pytest.fixture(scope="module")
def monkeypatch_module():
    from _pytest.monkeypatch import MonkeyPatch
    patch = MonkeyPatch()
    yield patch
    patch.undo()


def test_health_reports_a_loaded_model(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["n_matches"] > 0


def test_competitions_lists_what_was_trained(client):
    body = client.get("/competitions").json()
    codes = [c["code"] for c in body["competitions"]]
    assert "TEST_L" in codes
    entry = next(c for c in body["competitions"] if c["code"] == "TEST_L")
    assert entry["n_teams"] == 8
    assert entry["seasons"]


def test_teams_endpoint_is_scoped_to_the_competition(client):
    body = client.get("/competitions/TEST_L/teams").json()
    assert len(body["teams"]) == 8
    assert all("display" in t for t in body["teams"])
    assert client.get("/competitions/NOPE/teams").status_code == 404


def test_seasons_endpoint(client):
    body = client.get("/competitions/TEST_L/seasons").json()
    assert "2023/24" in body["seasons"]
    assert client.get("/competitions/NOPE/seasons").status_code == 404


def test_predict_returns_a_full_market_book(client):
    response = client.post("/predict", json={
        "competition": "TEST_L", "home_team": "Team A", "away_team": "Team D",
        "date": "2024-08-01", "season": "2024/25",
    })
    assert response.status_code == 200
    body = response.json()
    assert set(body["hub"]) == {"home", "draw", "away"}
    assert sum(body["hub"].values()) == pytest.approx(1.0, abs=1e-3)
    assert body["most_likely_scores"]
    assert body["confidence"]["label"] in ("Low", "Moderate", "High")
    assert body["data_quality"]["label"] in ("Limited", "Fair", "Good")


def test_predict_rejects_bad_input(client):
    unknown = client.post("/predict", json={
        "competition": "TEST_L", "home_team": "Nowhere", "away_team": "Team A",
        "date": "2024-08-01",
    })
    assert unknown.status_code == 404

    same = client.post("/predict", json={
        "competition": "TEST_L", "home_team": "Team A", "away_team": "Team A",
        "date": "2024-08-01",
    })
    assert same.status_code == 400

    malformed = client.post("/predict", json={"competition": "TEST_L"})
    assert malformed.status_code == 422


def test_model_endpoint_exposes_provenance(client):
    body = client.get("/model").json()
    assert body["trained_through"]
    assert body["n_features"] > 0
    assert "ensemble_weights" in body["metadata"]
