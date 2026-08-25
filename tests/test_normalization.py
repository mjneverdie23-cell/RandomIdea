"""Season, team and competition normalisation."""
import pytest

from football_predictor.normalize import seasons as S
from football_predictor.normalize.competitions import canonical_stage, is_knockout_stage
from football_predictor.normalize.teams import TeamNormalizer, clean_name


@pytest.mark.parametrize("raw,expected", [
    ("2324", "2023/24"), ("2023-24", "2023/24"), ("2023/2024", "2023/24"),
    ("9394", "1993/94"), ("9900", "1999/00"), ("2021", "2020/21"),
])
def test_season_labels_normalise(raw, expected):
    assert S.canonical_season(raw) == expected


def test_four_digit_calendar_year_is_not_a_season_code():
    # "2022" is the World Cup year, not the 2020/21 season: the halves are
    # not consecutive, which is what tells the two forms apart.
    assert S.canonical_season("2022") == "2022"
    assert S.canonical_season("2021") == "2020/21"


def test_season_round_trips_to_source_naming():
    assert S.season_short("2023/24") == "2324"
    assert S.season_long("2023/24") == "2023-24"


def test_season_from_date_rolls_over_in_july():
    assert S.season_from_date("2024-06-30") == "2023/24"
    assert S.season_from_date("2024-07-01") == "2024/25"


def test_season_range_is_inclusive():
    assert S.season_range("2021/22", "2023/24") == ["2021/22", "2022/23", "2023/24"]


def test_unparsable_season_raises():
    with pytest.raises(ValueError):
        S.canonical_season("not a season")


@pytest.mark.parametrize("raw,expected", [
    ("Manchester City FC", "Man City"),
    ("Man City", "Man City"),
    ("Club Atlético de Madrid", "Ath Madrid"),
    ("Atlético Madrid", "Ath Madrid"),
    ("FC Bayern München", "Bayern Munich"),
    ("Paris Saint-Germain FC", "Paris SG"),
    ("FC Internazionale Milano", "Inter"),
    ("Feyenoord Rotterdam", "Feyenoord"),
    ("Beşiktaş", "Besiktas"),
])
def test_aliases_resolve_across_sources(raw, expected):
    assert TeamNormalizer().canonical(raw) == expected


def test_distinct_clubs_are_not_merged():
    """The failure mode that made fuzzy matching unusable."""
    normalizer = TeamNormalizer()
    assert normalizer.canonical("Celtic FC") != normalizer.canonical("Celta")
    assert normalizer.canonical("FC Porto") != normalizer.canonical("Portsmouth")
    assert normalizer.canonical("PSV Eindhoven") != normalizer.canonical("Swindon")


def test_cleaning_never_empties_a_name():
    # Every token of "AC Milan" bar one is a corporate suffix.
    assert clean_name("AC Milan") == "Milan"
    assert clean_name("PSV") != ""
    assert clean_name("FC") != ""


def test_stage_labels_and_knockout_detection():
    assert canonical_stage("Finals, Round of 16") == "round_of_16"
    assert canonical_stage("Group, Matchday 3") == "group"
    assert is_knockout_stage("semi_final") is True
    assert is_knockout_stage("group") is False
