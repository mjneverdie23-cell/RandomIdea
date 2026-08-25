"""Validation and cleaning rules."""
import pandas as pd

from football_predictor.clean import clean_matches, data_quality
from football_predictor.schema import coerce_dtypes


def _frame(rows):
    return coerce_dtypes(pd.DataFrame(rows))


BASE = {
    "date": pd.Timestamp("2023-08-12"), "competition": "ENG_PL", "season": "2023/24",
    "home_team": "Arsenal", "away_team": "Chelsea", "home_goals": 2, "away_goals": 1,
    "ht_home_goals": 1, "ht_away_goals": 0, "neutral_venue": False,
}


def test_identical_fixtures_are_deduplicated():
    df = _frame([BASE, dict(BASE)])
    out, report = clean_matches(df)
    assert len(out) == 1
    assert any(i.code == "duplicate_match" for i in report.issues)


def test_two_legs_are_not_duplicates():
    """Reversing home and away is a different fixture, not a repeat."""
    reverse = dict(BASE, home_team="Chelsea", away_team="Arsenal",
                   date=pd.Timestamp("2023-11-20"))
    out, _ = clean_matches(_frame([BASE, reverse]))
    assert len(out) == 2


def test_half_time_above_full_time_is_nulled_not_dropped():
    bad = dict(BASE, ht_home_goals=3)          # 3 at the break, 2 at the end
    out, report = clean_matches(_frame([bad]))
    assert len(out) == 1
    assert pd.isna(out.iloc[0]["ht_home_goals"])
    assert any(i.code == "halftime_exceeds_fulltime" for i in report.issues)


def test_out_of_range_statistics_are_nulled_but_the_result_survives():
    bad = dict(BASE, home_shots=500)
    out, report = clean_matches(_frame([bad]))
    assert len(out) == 1
    assert pd.isna(out.iloc[0]["home_shots"])
    assert out.iloc[0]["home_goals"] == 2
    assert any(i.code == "out_of_range" for i in report.issues)


def test_unplayable_rows_are_dropped():
    rows = [
        dict(BASE, home_team="Arsenal", away_team="Arsenal"),     # self match
        dict(BASE, home_goals=None, away_goals=None),             # unplayed
        dict(BASE, date=None),                                    # no date
        dict(BASE, home_team=""),                                 # no team
    ]
    out, report = clean_matches(_frame(rows))
    assert len(out) == 0
    codes = {i.code for i in report.issues}
    assert {"self_match", "no_result", "unparsable_date", "missing_team"} <= codes


def test_teams_are_normalised_during_cleaning():
    out, _ = clean_matches(_frame([dict(BASE, home_team="Manchester City FC")]))
    assert out.iloc[0]["home_team"] == "Man City"


def test_match_ids_are_deterministic():
    a, _ = clean_matches(_frame([BASE]))
    b, _ = clean_matches(_frame([BASE]))
    assert a.iloc[0]["match_id"] == b.iloc[0]["match_id"]


def test_data_quality_reports_coverage():
    out, _ = clean_matches(_frame([BASE]))
    quality = data_quality(out)
    assert quality["n_matches"] == 1
    assert quality["halftime_coverage"] == 1.0
    assert quality["xg_coverage"] == 0.0
