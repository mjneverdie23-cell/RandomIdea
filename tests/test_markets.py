"""Market derivation from the score distribution."""
import numpy as np
import pytest

from football_predictor.models.score_matrix import (
    ScoreMatrix, blend_matrices, reconcile_to_result,
)


@pytest.fixture
def matrix():
    return ScoreMatrix.from_rates(1.72, 1.31, rho=-0.05)


def test_the_distribution_is_normalised(matrix):
    assert matrix.matrix.sum() == pytest.approx(1.0)
    assert (matrix.matrix >= 0).all()


def test_hub_is_exhaustive(matrix):
    hub = matrix.result_probabilities()
    assert sum(hub.values()) == pytest.approx(1.0)
    assert set(hub) == {"H", "U", "B"}


def test_expected_goals_recover_the_input_rates():
    plain = ScoreMatrix.from_rates(1.72, 1.31)
    assert plain.expected_home_goals == pytest.approx(1.72, abs=1e-3)
    assert plain.expected_away_goals == pytest.approx(1.31, abs=1e-3)


def test_over_under_pairs_are_complementary(matrix):
    for line, book in matrix.over_under().items():
        assert book["over"] + book["under"] == pytest.approx(1.0)


def test_over_probabilities_decrease_with_the_line(matrix):
    overs = [matrix.over_under()[f"{line}"]["over"] for line in (0.5, 1.5, 2.5, 3.5, 4.5)]
    assert overs == sorted(overs, reverse=True)


def test_btts_agrees_with_the_scorelines_that_make_it_up(matrix):
    direct = sum(
        matrix.exact_score(h, a)
        for h in range(1, matrix.max_goals + 1)
        for a in range(1, matrix.max_goals + 1)
    )
    assert matrix.btts()["yes"] == pytest.approx(direct)


def test_clean_sheet_is_the_opponent_failing_to_score(matrix):
    assert matrix.clean_sheet("home") == pytest.approx(
        1.0 - matrix.team_to_score("away")
    )


def test_dixon_coles_lifts_the_low_score_draws():
    """With a negative rho, 0-0 and 1-1 must gain mass and 1-0 / 0-1 lose it."""
    plain = ScoreMatrix.from_rates(1.5, 1.2, rho=0.0)
    corrected = ScoreMatrix.from_rates(1.5, 1.2, rho=-0.08)
    assert corrected.exact_score(0, 0) > plain.exact_score(0, 0)
    assert corrected.exact_score(1, 1) > plain.exact_score(1, 1)
    assert corrected.exact_score(1, 0) < plain.exact_score(1, 0)
    assert corrected.exact_score(0, 1) < plain.exact_score(0, 1)


def test_halves_convolve_to_the_full_match():
    first = ScoreMatrix.from_rates(0.75, 0.55, max_goals=8)
    second = ScoreMatrix.from_rates(0.95, 0.75, max_goals=8)
    full = first.convolve(second)
    assert full.expected_home_goals == pytest.approx(0.75 + 0.95, abs=1e-4)
    assert full.expected_away_goals == pytest.approx(0.55 + 0.75, abs=1e-4)
    assert full.matrix.sum() == pytest.approx(1.0)


def test_top_scores_are_ordered_and_real(matrix):
    scores = matrix.top_scores(5)
    probabilities = [s["probability"] for s in scores]
    assert probabilities == sorted(probabilities, reverse=True)
    for entry in scores:
        assert entry["probability"] == pytest.approx(
            matrix.exact_score(entry["home_goals"], entry["away_goals"])
        )


def test_reconciliation_hits_the_target_hub(matrix):
    target = {"H": 0.48, "U": 0.26, "B": 0.26}
    out = ScoreMatrix(reconcile_to_result(matrix.matrix, target))
    for key, value in target.items():
        assert out.result_probabilities()[key] == pytest.approx(value)
    assert out.matrix.sum() == pytest.approx(1.0)


def test_reconciliation_preserves_shape_within_each_outcome(matrix):
    """Rescaling a region must not reorder the scorelines inside it."""
    out = ScoreMatrix(reconcile_to_result(matrix.matrix, {"H": 0.5, "U": 0.25, "B": 0.25}))
    before = matrix.exact_score(2, 0) / matrix.exact_score(3, 1)
    after = out.exact_score(2, 0) / out.exact_score(3, 1)
    assert before == pytest.approx(after)


def test_blending_matrices_of_different_sizes():
    blended = blend_matrices(
        [ScoreMatrix.from_rates(1.7, 1.3).matrix,
         ScoreMatrix.from_rates(1.5, 1.5, max_goals=8).matrix],
        [0.6, 0.4],
    )
    assert blended.sum() == pytest.approx(1.0)
    assert blended.shape[0] == 13


def test_a_stronger_home_side_gets_a_higher_home_probability():
    weak = ScoreMatrix.from_rates(1.0, 1.5).result_probabilities()
    strong = ScoreMatrix.from_rates(2.5, 0.8).result_probabilities()
    assert strong["H"] > weak["H"]
    assert strong["B"] < weak["B"]
