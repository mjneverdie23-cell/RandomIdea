"""Model fitting behaviour."""
import numpy as np
import pandas as pd
import pytest

from football_predictor.evaluation.metrics import (
    binary_report, brier_multiclass, log_loss_multiclass, multiclass_report,
    naive_baseline, ranked_probability_score, to_index,
)
from football_predictor.features.elo import (
    EloConfig, EloRatings, expected_score, goal_difference_multiplier,
)
from football_predictor.models.calibration import (
    BinaryCalibrator, MulticlassCalibrator, expected_calibration_error,
)
from football_predictor.models.dixon_coles import (
    DixonColesModel, GoalModelConfig, PoissonModel,
)
from football_predictor.models.elo_model import EloOutcomeModel
from football_predictor.models.ensemble import ProbabilityEnsemble
from football_predictor.models.halves import HalvesModel


# -- Elo ---------------------------------------------------------------------
def test_equal_ratings_give_an_even_expectation():
    assert expected_score(0.0) == pytest.approx(0.5)


def test_goal_difference_multiplier_grows_with_the_margin():
    values = [goal_difference_multiplier(g) for g in (1, 2, 3, 4, 6)]
    assert values == sorted(values)
    assert values[0] == 1.0


def test_elo_is_zero_sum_and_rewards_the_winner():
    elo = EloRatings(EloConfig(k_factor=20, home_advantage=0, season_regression=0))
    elo.update("A", "B", 2, 0, competition="X", season="2023/24")
    assert elo.rating("A") > 1500 > elo.rating("B")
    assert elo.rating("A") + elo.rating("B") == pytest.approx(3000.0)


def test_elo_recovers_the_true_strength_order(synthetic_matches, team_strength_order):
    """Elo should rank teams the way the generator built them.

    Asserted as a rank correlation rather than exact positions: three seasons
    of Poisson-distributed scores is not enough to separate adjacent teams
    reliably, and demanding that would test the random seed, not the model.
    """
    from scipy.stats import spearmanr

    elo = EloRatings()
    elo.rate_frame(synthetic_matches)
    true_rank = list(range(len(team_strength_order)))          # strongest first
    elo_ratings = [elo.rating(t) for t in team_strength_order]
    correlation = spearmanr(true_rank, elo_ratings).statistic
    assert correlation < -0.8, f"Elo ordering only correlates {correlation:.2f}"
    assert elo.rating(team_strength_order[0]) > elo.rating(team_strength_order[-1])


def test_promoted_teams_do_not_enter_at_the_league_mean():
    """A debutant enters at a low quantile of the league, not the mean."""
    elo = EloRatings()
    # Give the league a spread: the first team beats everyone, the last loses.
    for round_index in range(6):
        for i in range(12):
            for j in range(i + 1, 12):
                elo.update(f"T{i}", f"T{j}", 3, 0, competition="L", season="2023/24")
    ratings = sorted(elo.ratings.values())
    assert ratings[-1] - ratings[0] > 100, "fixture failed to create a spread"

    entry = elo._seed_rating("Newcomer", "L")
    assert entry < np.mean(ratings)
    assert entry >= ratings[0]


def test_a_debutant_in_an_unknown_competition_starts_at_the_default():
    elo = EloRatings()
    assert elo._seed_rating("Newcomer", "Nowhere") == elo.config.start_rating


# -- goal models -------------------------------------------------------------
def test_dixon_coles_fits_and_recovers_strength(synthetic_matches, team_strength_order):
    model = DixonColesModel(GoalModelConfig.from_config("dixon_coles")).fit(
        synthetic_matches
    )
    assert model.converged
    assert model.n_matches > 0
    strongest = max(model.attack, key=model.attack.get)
    assert strongest in team_strength_order[:2]


def test_attack_parameters_are_centred(synthetic_matches):
    model = DixonColesModel(GoalModelConfig.from_config("dixon_coles")).fit(
        synthetic_matches
    )
    assert np.mean(list(model.attack.values())) == pytest.approx(0.0, abs=1e-9)


def test_recentring_does_not_move_the_predicted_rates(synthetic_matches):
    """Centring attack is a relabelling; the rates must be unaffected."""
    model = DixonColesModel(GoalModelConfig.from_config("dixon_coles")).fit(
        synthetic_matches
    )
    lam, mu = model.rates("Team A", "Team H")
    # A one-goal-a-side league should not produce absurd rates.
    assert 0.2 < lam < 6.0
    assert 0.1 < mu < 6.0
    assert lam > mu          # Team A is the stronger side and is at home


def test_rho_is_actually_estimated(synthetic_matches):
    """The correction is only worth having if it is fitted, not left at zero."""
    model = DixonColesModel(GoalModelConfig.from_config("dixon_coles")).fit(
        synthetic_matches
    )
    low, high = model.config.rho_bounds
    assert low <= model.rho <= high
    poisson = PoissonModel().fit(synthetic_matches)
    assert poisson.rho == 0.0


def test_home_advantage_is_positive_when_the_data_has_one(synthetic_matches):
    model = DixonColesModel(GoalModelConfig.from_config("dixon_coles")).fit(
        synthetic_matches
    )
    assert model.home_advantage > 0


def test_unknown_teams_fall_back_to_league_average(synthetic_matches):
    model = DixonColesModel(GoalModelConfig.from_config("dixon_coles")).fit(
        synthetic_matches
    )
    assert not model.knows("Newly Promoted")
    lam, mu = model.rates("Newly Promoted", "Team A")
    assert np.isfinite(lam) and np.isfinite(mu)
    assert lam > 0 and mu > 0


def test_halves_model_finds_a_second_half_bias(synthetic_matches):
    halves = HalvesModel.from_config().fit(synthetic_matches)
    shares = halves.half_shares()
    assert shares["first_half_share"] + shares["second_half_share"] == pytest.approx(1.0)
    # The fixture generates 44% of goals before the break.
    assert 0.30 < shares["first_half_share"] < 0.55


def test_halves_convolve_close_to_the_direct_full_time_fit(synthetic_matches):
    halves = HalvesModel.from_config().fit(synthetic_matches)
    direct = DixonColesModel(GoalModelConfig.from_config("dixon_coles")).fit(
        synthetic_matches
    )
    from_halves = halves.full_time_matrix("Team A", "Team D")
    from_direct = direct.score_matrix("Team A", "Team D")
    assert from_halves.expected_total_goals == pytest.approx(
        from_direct.expected_total_goals, rel=0.30
    )


# -- Elo outcome model -------------------------------------------------------
def test_elo_outcome_model_orders_the_outcomes():
    rng = np.random.default_rng(0)
    diff = rng.normal(0, 150, 4000)
    probability_home = 1 / (1 + np.exp(-diff / 120))
    draws = rng.random(4000) < 0.26
    results = np.where(draws, "U", np.where(rng.random(4000) < probability_home, "H", "B"))

    model = EloOutcomeModel().fit(diff, results)
    probs = model.predict_proba(np.array([-400.0, 0.0, 400.0]))
    assert np.allclose(probs.sum(axis=1), 1.0)
    assert probs[0, 0] < probs[1, 0] < probs[2, 0]      # home rises with rating
    assert probs[0, 2] > probs[1, 2] > probs[2, 2]      # away falls


# -- calibration -------------------------------------------------------------
def test_calibration_fixes_a_systematic_bias():
    rng = np.random.default_rng(3)
    truth = rng.random(6000) < 0.35
    # A model that is confidently too high.
    raw = np.clip(0.35 + 0.25 + rng.normal(0, 0.05, 6000), 0.01, 0.99)
    before = expected_calibration_error(raw, truth.astype(float))
    calibrator = BinaryCalibrator("isotonic", min_samples=100).fit(raw, truth.astype(int))
    after = expected_calibration_error(calibrator.transform(raw), truth.astype(float))
    assert calibrator.fitted
    assert after < before


def test_calibration_declines_to_fit_on_too_little_data():
    calibrator = BinaryCalibrator("isotonic", min_samples=800).fit(
        np.array([0.4, 0.6]), np.array([0, 1])
    )
    assert not calibrator.fitted
    assert calibrator.transform(np.array([0.4])) == pytest.approx([0.4])


def test_multiclass_calibration_keeps_probabilities_normalised():
    rng = np.random.default_rng(5)
    labels = rng.choice(["H", "U", "B"], 3000, p=[0.46, 0.26, 0.28])
    raw = rng.dirichlet([4, 3, 3], 3000)
    calibrator = MulticlassCalibrator("isotonic", min_samples=100).fit(raw, labels)
    out = calibrator.transform(raw)
    assert np.allclose(out.sum(axis=1), 1.0)


# -- ensemble ----------------------------------------------------------------
def test_ensemble_is_no_worse_than_its_worst_member():
    rng = np.random.default_rng(11)
    n = 3000
    labels = rng.choice(3, n, p=[0.45, 0.26, 0.29])
    def member(noise):
        probs = np.abs(rng.normal(0.33, noise, (n, 3)))
        probs[np.arange(n), labels] += 0.30
        return probs / probs.sum(axis=1, keepdims=True)

    members = {"sharp": member(0.03), "noisy": member(0.25)}
    ensemble = ProbabilityEnsemble(n_samples=400).fit(members, labels)
    blended = log_loss_multiclass(ensemble.predict_proba(members), labels)
    worst = max(log_loss_multiclass(m, labels) for m in members.values())
    assert blended <= worst
    assert sum(ensemble.weight_table().values()) == pytest.approx(1.0)


def test_ensemble_prefers_the_better_member():
    rng = np.random.default_rng(12)
    n = 2000
    labels = rng.choice(3, n, p=[0.45, 0.26, 0.29])
    good = np.full((n, 3), 0.05)
    good[np.arange(n), labels] = 0.90
    bad = np.full((n, 3), 1 / 3)
    ensemble = ProbabilityEnsemble(n_samples=600).fit({"good": good, "bad": bad}, labels)
    weights = ensemble.weight_table()
    assert weights["good"] > weights["bad"]


# -- metrics -----------------------------------------------------------------
def test_a_perfect_forecast_scores_zero():
    labels = np.array([0, 1, 2])
    perfect = np.eye(3)
    assert log_loss_multiclass(perfect, labels) == pytest.approx(0.0)
    assert brier_multiclass(perfect, labels) == pytest.approx(0.0)
    assert ranked_probability_score(perfect, labels) == pytest.approx(0.0)


def test_rps_punishes_the_ordering_mistake_harder():
    """Calling home when away wins is worse than calling a draw."""
    away_won = np.array([2])
    wrong_direction = ranked_probability_score(np.array([[0.9, 0.05, 0.05]]), away_won)
    adjacent = ranked_probability_score(np.array([[0.05, 0.9, 0.05]]), away_won)
    assert wrong_direction > adjacent


def test_naive_baseline_matches_the_observed_base_rates():
    labels = ["H"] * 46 + ["U"] * 26 + ["B"] * 28
    rates = naive_baseline(labels)[0]
    assert rates[0] == pytest.approx(0.46)
    assert rates.sum() == pytest.approx(1.0)


def test_reports_cover_the_documented_metrics():
    labels = np.array(["H", "U", "B", "H"])
    probs = np.tile([0.45, 0.27, 0.28], (4, 1))
    report = multiclass_report(probs, labels)
    assert {"log_loss", "brier", "rps", "accuracy", "ece", "f1_macro"} <= set(report)
    binary = binary_report(np.array([0.6, 0.4]), np.array([1, 0]))
    assert {"log_loss", "brier", "accuracy", "roc_auc", "ece"} <= set(binary)
