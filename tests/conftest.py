import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))


@pytest.fixture
def synthetic_matches() -> pd.DataFrame:
    """A small deterministic league: 8 teams, three seasons, home advantage.

    Team strength is baked in, so tests can assert that models recover an
    ordering they were never told about.
    """
    from football_predictor.schema import coerce_dtypes, make_match_id

    rng = np.random.default_rng(7)
    teams = [f"Team {c}" for c in "ABCDEFGH"]
    strength = {t: 0.25 * (len(teams) - i) for i, t in enumerate(teams)}

    rows = []
    date = pd.Timestamp("2021-08-07")
    for season_index, season in enumerate(["2021/22", "2022/23", "2023/24"]):
        for home in teams:
            for away in teams:
                if home == away:
                    continue
                lam = float(np.exp(-0.15 + 0.45 * strength[home] - 0.35 * strength[away]))
                mu = float(np.exp(-0.35 + 0.45 * strength[away] - 0.35 * strength[home]))
                hg, ag = int(rng.poisson(lam)), int(rng.poisson(mu))
                ht_h = int(rng.binomial(hg, 0.44))
                ht_a = int(rng.binomial(ag, 0.44))
                rows.append({
                    "date": date, "competition": "TEST_L", "season": season,
                    "stage": "league", "home_team": home, "away_team": away,
                    "neutral_venue": False,
                    "home_goals": hg, "away_goals": ag,
                    "ht_home_goals": ht_h, "ht_away_goals": ht_a,
                    "home_shots": int(rng.integers(5, 22)),
                    "away_shots": int(rng.integers(4, 19)),
                    "home_shots_on_target": int(rng.integers(1, 9)),
                    "away_shots_on_target": int(rng.integers(1, 8)),
                })
                date += pd.Timedelta(days=3)
        date += pd.Timedelta(days=40)

    df = coerce_dtypes(pd.DataFrame(rows))
    df["match_id"] = make_match_id(
        df["competition"], df["date"], df["home_team"], df["away_team"]
    )
    return df.sort_values("date").reset_index(drop=True)


@pytest.fixture
def team_strength_order():
    return [f"Team {c}" for c in "ABCDEFGH"]
