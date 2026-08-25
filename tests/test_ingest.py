"""Parsing of the two raw source formats."""
import pandas as pd
import pytest

from football_predictor.config import get_competition, load_sources
from football_predictor.ingest.football_data import FootballDataAdapter
from football_predictor.ingest.openfootball import OpenFootballAdapter, _parse_scores

CL_SAMPLE = """= UEFA Champions League 2023/24

# Matches 4

▪ Group, Matchday 1
  Tue Sep 19 2023
    18:45  AC Milan (ITA)          v Newcastle United FC (ENG)  0-0
           BSC Young Boys (SUI)    v RB Leipzig (GER)         1-3 (1-1)

▪ Finals, Quarterfinals
  Wed Apr 17
    21:00  Manchester City FC (ENG) v Real Madrid CF (ESP)     3-4 pen. 1-1 a.e.t. (1-1, 0-1)

▪ Finals, Final
  Sat Jun 1 2024
    21:00  Borussia Dortmund (GER) v Real Madrid CF (ESP)      0-2 (0-0)
"""

CSV_SAMPLE = (
    "Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,HTR,Referee,"
    "HS,AS,HST,AST,HF,AF,HC,AC,HY,AY,HR,AR\n"
    "2023-08-11,Burnley,Man City,0,3,A,0,2,A,C Pawson,7,15,2,7,10,8,3,6,2,1,0,0\n"
    "2023-08-12,Arsenal,Nott'm Forest,2,1,H,2,0,H,M Oliver,20,6,7,2,9,11,9,1,1,3,0,0\n"
)


def test_openfootball_parses_stages_dates_and_scores():
    comp = get_competition("UEFA_UCL")
    frame = OpenFootballAdapter().parse(CL_SAMPLE, comp, "2023/24", "test")
    assert len(frame) == 4
    assert list(frame["stage"]) == ["group", "group", "quarter_final", "final"]
    # The year is stated once and carried forward to later date lines.
    assert frame["date"].tolist()[2] == pd.Timestamp("2024-04-17")


def test_openfootball_uses_regulation_score_for_extra_time_ties():
    """HUB settles on 90 minutes, so extra time and shootouts are discarded."""
    comp = get_competition("UEFA_UCL")
    frame = OpenFootballAdapter().parse(CL_SAMPLE, comp, "2023/24", "test")
    tie = frame[frame["stage"] == "quarter_final"].iloc[0]
    assert (tie["home_goals"], tie["away_goals"]) == (1, 1)      # not 3-4 or the aet score
    assert (tie["ht_home_goals"], tie["ht_away_goals"]) == (0, 1)


def test_openfootball_marks_the_final_as_neutral():
    comp = get_competition("UEFA_UCL")
    frame = OpenFootballAdapter().parse(CL_SAMPLE, comp, "2023/24", "test")
    assert bool(frame[frame["stage"] == "final"].iloc[0]["neutral_venue"]) is True
    assert bool(frame[frame["stage"] == "group"].iloc[0]["neutral_venue"]) is False


def test_openfootball_leaves_missing_halftime_null():
    comp = get_competition("UEFA_UCL")
    frame = OpenFootballAdapter().parse(CL_SAMPLE, comp, "2023/24", "test")
    assert pd.isna(frame.iloc[0]["ht_home_goals"])


@pytest.mark.parametrize("text,expected", [
    ("1-3 (1-1)", ((1, 3), (1, 1))),
    ("0-0", ((0, 0), None)),
    ("3-4 pen. 1-1 a.e.t. (1-1, 0-1)", ((1, 1), (0, 1))),
    ("4-2 pen. 1-0 a.e.t. (1-0, 1-0)", ((1, 0), (1, 0))),
])
def test_score_notations(text, expected):
    assert _parse_scores(text) == expected


def test_football_data_csv_maps_to_canonical_columns():
    comp = get_competition("ENG_PL")
    source = load_sources()["football_data_mirror"]
    frame = FootballDataAdapter().parse(CSV_SAMPLE, comp, "2023/24", "test")
    assert len(frame) == 2
    first = frame.iloc[0]
    assert first["home_team"] == "Burnley"
    assert (first["home_goals"], first["away_goals"]) == (0, 3)
    assert (first["ht_home_goals"], first["ht_away_goals"]) == (0, 2)
    assert first["home_shots_on_target"] == 2
    assert first["competition"] == "ENG_PL"
    assert first["season"] == "2023/24"


def test_adapter_urls_use_the_source_template():
    comp = get_competition("ENG_PL")
    source = load_sources()["football_data_mirror"]
    urls = FootballDataAdapter().urls(comp, source, "2023/24")
    assert urls[0].endswith("premier-league/season-2324.csv")
