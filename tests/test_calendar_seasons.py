"""Competitions whose season is a calendar year.

Eliteserien runs March to November, so its season is "2023" rather than
"2023/24". Mixing such a competition with split-season ones is the case that
breaks label-based reasoning about time, and these tests pin the places that
had to change for it.
"""
import pandas as pd
import pytest

from football_predictor.clean import clean_matches
from football_predictor.config import get_competition, load_sources
from football_predictor.ingest.footballcsv import FootballCsvAdapter, _split_score
from football_predictor.ingest.registry import competition_seasons
from football_predictor.normalize import seasons as S
from football_predictor.schema import coerce_dtypes

CSV_WITH_HALVES = (
    "Date,Team 1,FT,HT,Team 2\n"
    "Fri Aug 11 2023,Trabzonspor,1-0,1-0,Antalyaspor\n"
    "Sat Aug 12 2023,Kasimpasa,3-2,1-0,Ankaragucu\n"
)
CSV_WITHOUT_HALVES = (
    "Date,Team 1,FT,HT,Team 2\n"
    "Mon Apr 10 2023,Rosenborg,1-0,?,Viking\n"
    "Mon Apr 10 2023,Aalesund,0-1,?,Valerenga\n"
)


# -- season labels -----------------------------------------------------------
def test_a_calendar_year_is_not_read_as_a_split_season():
    """"2021" is a real Eliteserien season and also reads as 2020/21."""
    assert S.canonical_season("2021") == "2020/21"
    assert S.canonical_season("2021", S.CALENDAR) == "2021"


def test_calendar_season_ranges_and_dates():
    assert S.season_range("2012", "2015", S.CALENDAR) == ["2012", "2013", "2014", "2015"]
    # A March kickoff belongs to that year, not to the previous autumn's season.
    assert S.season_from_date("2023-04-10", S.CALENDAR) == "2023"
    assert S.season_from_date("2023-04-10") == "2022/23"


def test_calendar_seasons_keep_their_directory_name():
    assert S.season_long("2023", S.CALENDAR) == "2023"
    assert S.season_long("2023/24") == "2023-24"


def test_configured_competitions_generate_the_right_seasons():
    norway = competition_seasons(get_competition("NOR_EL"))
    turkey = competition_seasons(get_competition("TUR_SL"))
    assert norway[0] == "2012" and norway[-1] == "2024"
    assert all("/" not in s for s in norway)
    assert turkey[0] == "1994/95" and turkey[-1] == "2023/24"
    assert all("/" in s for s in turkey)


def test_cleaning_does_not_relabel_a_calendar_season():
    """The regression that mislabelled Eliteserien 2021 as 2020/21.

    Cleaning re-canonicalises season labels, and doing that without the
    competition's style silently rewrote a whole season.
    """
    frame = coerce_dtypes(pd.DataFrame([{
        "date": pd.Timestamp("2021-05-09"), "competition": "NOR_EL",
        "season": "2021", "home_team": "Rosenborg", "away_team": "Molde",
        "home_goals": 2, "away_goals": 1, "neutral_venue": False,
    }]))
    out, _ = clean_matches(frame)
    assert out.iloc[0]["season"] == "2021"


def test_cleaning_still_canonicalises_split_seasons():
    frame = coerce_dtypes(pd.DataFrame([{
        "date": pd.Timestamp("2023-08-12"), "competition": "ENG_PL",
        "season": "2324", "home_team": "Arsenal", "away_team": "Chelsea",
        "home_goals": 2, "away_goals": 1, "neutral_venue": False,
    }]))
    out, _ = clean_matches(frame)
    assert out.iloc[0]["season"] == "2023/24"


# -- the footballcsv adapter -------------------------------------------------
@pytest.mark.parametrize("raw,expected", [
    ("1-0", (1, 0)), ("3-2", (3, 2)), ("10-2", (10, 2)),
    ("?", (None, None)), ("", (None, None)), (None, (None, None)),
])
def test_score_strings(raw, expected):
    assert _split_score(raw) == expected


def test_adapter_parses_a_split_season_file():
    comp = get_competition("TUR_SL")
    frame = FootballCsvAdapter().parse(CSV_WITH_HALVES, comp, "2023/24", "test")
    assert len(frame) == 2
    first = frame.iloc[0]
    assert first["home_team"] == "Trabzonspor"
    assert (first["home_goals"], first["away_goals"]) == (1, 0)
    assert (first["ht_home_goals"], first["ht_away_goals"]) == (1, 0)
    assert first["season"] == "2023/24"
    assert first["date"] == pd.Timestamp("2023-08-11")


def test_adapter_leaves_unrecorded_half_times_null():
    """Norway's source has no half-time scores; "?" must not become 0-0."""
    comp = get_competition("NOR_EL")
    frame = FootballCsvAdapter().parse(CSV_WITHOUT_HALVES, comp, "2023", "test")
    assert len(frame) == 2
    assert frame["ht_home_goals"].isna().all()
    assert frame["ht_away_goals"].isna().all()
    assert frame.iloc[0]["season"] == "2023"


def test_adapter_urls_follow_the_season_style():
    source = load_sources()["footballcsv_cache"]
    adapter = FootballCsvAdapter()
    assert adapter.urls(get_competition("NOR_EL"), source, "2023")[0].endswith(
        "2023/no.1.csv"
    )
    assert adapter.urls(get_competition("TUR_SL"), source, "2023/24")[0].endswith(
        "2023-24/tr.1.csv"
    )


# -- team identity across the new competitions -------------------------------
def test_the_league_and_european_spellings_of_a_club_agree():
    """football-data files Başakşehir under its former name.

    Without this alias the club's Süper Lig form would not reach its
    Champions League fixtures - the whole point of normalising names.
    """
    from football_predictor.normalize.teams import TeamNormalizer

    normalizer = TeamNormalizer()
    assert normalizer.canonical("Buyuksehyr") == normalizer.canonical(
        "İstanbul Başakşehir"
    )
    assert normalizer.canonical("HamKam") == normalizer.canonical("Ham-Kam")
    assert normalizer.canonical("Antalya") == normalizer.canonical("Antalyaspor")


def test_similar_but_distinct_clubs_stay_apart():
    """Names that look like renames but are separate clubs."""
    from football_predictor.normalize.teams import TeamNormalizer

    normalizer = TeamNormalizer()
    for a, b in (("Gaziantep", "Gaziantepspor"),          # different clubs
                 ("Malatyaspor", "Yeni Malatyaspor"),     # different clubs
                 ("Ankaragucu", "Ankaraspor")):           # shared a season
        assert normalizer.canonical(a) != normalizer.canonical(b), f"{a} merged with {b}"


# -- walk-forward windows ----------------------------------------------------
def test_backtest_windows_never_train_on_the_future():
    """Folds are date ranges, so no training match can follow a test match.

    Season labels cannot guarantee this once calendars differ: Eliteserien's
    2015 (March-November 2015) overlaps the Premier League's 2015/16
    (August 2015 - May 2016), so a label-based fold would have trained on
    matches played after some of the ones it was scoring.
    """
    import numpy as np
    from football_predictor.evaluation.backtest import BacktestConfig, build_windows
    from football_predictor.schema import coerce_dtypes

    rows = []
    for year in range(2010, 2020):
        # a split-season competition and a calendar-year one, overlapping
        rows.append({"date": pd.Timestamp(f"{year}-09-15"), "competition": "ENG_PL",
                     "season": f"{year}/{str(year + 1)[2:]}", "home_team": "A",
                     "away_team": "B", "home_goals": 1, "away_goals": 0,
                     "neutral_venue": False})
        rows.append({"date": pd.Timestamp(f"{year}-04-20"), "competition": "NOR_EL",
                     "season": str(year), "home_team": "C", "away_team": "D",
                     "home_goals": 2, "away_goals": 2, "neutral_venue": False})
    matches = coerce_dtypes(pd.DataFrame(rows))

    config = BacktestConfig.from_config()
    config.first_test_season, config.last_test_season = "2015/16", "2018/19"
    windows = build_windows(matches, config)
    assert windows, "no windows built"

    for window in windows:
        assert window.validation_start < window.test_start < window.test_end
        train = matches[matches["date"] < window.test_start]
        test = matches[(matches["date"] >= window.test_start)
                       & (matches["date"] < window.test_end)]
        if len(train) and len(test):
            assert train["date"].max() < test["date"].min()


def test_windows_are_contiguous_and_ordered():
    from football_predictor.evaluation.backtest import BacktestConfig, build_windows
    from football_predictor.schema import coerce_dtypes

    matches = coerce_dtypes(pd.DataFrame([
        {"date": pd.Timestamp("2005-08-01"), "competition": "ENG_PL",
         "season": "2005/06", "home_team": "A", "away_team": "B",
         "home_goals": 0, "away_goals": 0, "neutral_venue": False},
        {"date": pd.Timestamp("2026-05-01"), "competition": "ENG_PL",
         "season": "2025/26", "home_team": "A", "away_team": "B",
         "home_goals": 0, "away_goals": 0, "neutral_venue": False},
    ]))
    windows = build_windows(matches, BacktestConfig.from_config())
    for earlier, later in zip(windows, windows[1:]):
        assert earlier.test_end == later.test_start


def test_a_fold_runs_end_to_end_over_mixed_calendars(synthetic_matches):
    """Actually execute run_fold.

    The suite previously exercised every part of the backtest except the
    function that drives it, which is how a stale variable name survived into
    a 70-minute run.
    """
    import numpy as np
    from football_predictor.evaluation.backtest import (
        BacktestConfig, Window, run_fold,
    )
    from football_predictor.features.builder import FeatureBuilder

    matches = synthetic_matches
    # Relabel a slice as a calendar-year competition sharing the same clubs,
    # so the fold sees both season styles at once.
    calendar = matches.copy()
    calendar["competition"] = "NOR_EL"
    calendar["season"] = calendar["date"].dt.year.astype(str)
    calendar["date"] = calendar["date"] + pd.Timedelta(days=45)
    calendar["match_id"] = calendar["match_id"] + "-cal"
    combined = pd.concat([matches, calendar], ignore_index=True)
    combined = combined.sort_values("date").reset_index(drop=True)

    features = FeatureBuilder().transform(combined)
    features = features[features["target_result"].notna()].copy()

    span = combined["date"]
    window = Window(
        label="test-window",
        test_start=pd.Timestamp(span.quantile(0.85)),
        test_end=pd.Timestamp(span.max()) + pd.Timedelta(days=1),
        validation_start=pd.Timestamp(span.quantile(0.65)),
    )
    config = BacktestConfig.from_config()
    config.ml_models = ("logistic",)

    fold = run_fold(features, combined, window, config, keep_predictions=True)
    assert fold is not None
    assert fold.n_test > 0
    assert fold.season == "test-window"

    # Both competitions are represented, which is the point of the fixture.
    assert set(fold.predictions["competition"]) == {"TEST_L", "NOR_EL"}
    assert len(fold.predictions) == fold.n_test

    # Every scored model produced usable numbers, and the statistical members
    # priced the goal markets rather than being dropped for partial coverage.
    for name in ("naive", "ensemble", "dixon_coles", "poisson", "elo"):
        assert name in fold.metrics, f"{name} was not scored"
        assert np.isfinite(fold.metrics[name]["log_loss"])
    assert "dixon_coles_markets" in fold.metrics
    assert np.isfinite(fold.metrics["dixon_coles_markets"]["btts_log_loss"])

    probabilities = fold.predictions[["p_H", "p_U", "p_B"]].to_numpy()
    assert np.allclose(probabilities.sum(axis=1), 1.0)
    assert (probabilities > 0).all()

    # This fixture is far too small to expect the ensemble to win - three
    # synthetic seasons split at 85% leaves the ML member almost nothing to
    # learn from. Whether the blend beats the baseline is settled by the real
    # backtest in docs/BENCHMARK.md, not here.


def test_a_bundle_from_an_older_layout_is_refused(tmp_path):
    """Serving a stale bundle would misread its stored state, not fail loudly.

    The snapshot keys changed from season labels to calendar-boundary dates;
    an older file loads fine and then produces wrong answers, so the version
    is checked instead.
    """
    import joblib
    from football_predictor.train import (
        MIN_BUNDLE_VERSION, StaleBundleError, TrainedBundle, load_bundle,
    )

    stale = TrainedBundle(version="1.0.0")
    stale.builder_snapshots = {"2023/24": None}
    path = tmp_path / "old.joblib"
    joblib.dump(stale, path)

    with pytest.raises(StaleBundleError) as excinfo:
        load_bundle(path)
    assert MIN_BUNDLE_VERSION in str(excinfo.value)
    assert "scripts/train.py" in str(excinfo.value)
