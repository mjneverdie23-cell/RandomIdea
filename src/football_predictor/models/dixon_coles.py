"""Poisson and Dixon-Coles goal models.

Both estimate a team attack strength, a team defence strength and a home
advantage by weighted maximum likelihood, giving two scoring rates per match::

    lambda_home = exp(attack_home + defence_away + gamma)   # gamma dropped at
    lambda_away = exp(attack_away + defence_home)           # a neutral venue

Dixon-Coles adds two things to plain Poisson:

* **rho**, a dependence parameter correcting the four low-scoring scorelines
  that independent Poisson gets wrong (0-0, 1-0, 0-1, 1-1);
* **exponential time decay**, ``w = exp(-xi * days_ago)``, so the fit reflects
  how good teams are now rather than their average over the sample.

Setting ``rho`` to zero and leaving decay on recovers the time-weighted
Poisson model, which is fitted as a separate baseline for the benchmark.

The likelihood and its gradient are both vectorised, which keeps a refit down
to well under a second and makes month-by-month refitting across a 30-season
walk-forward backtest affordable.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from ..config import load_model_config
from .score_matrix import DEFAULT_MAX_GOALS, ScoreMatrix

log = logging.getLogger(__name__)


@dataclass
class GoalModelConfig:
    xi: float = 0.0018
    max_history_days: int = 1460
    max_goals: int = DEFAULT_MAX_GOALS
    min_matches_per_team: int = 5
    use_rho: bool = True
    rho_bounds: tuple[float, float] = (-0.25, 0.25)

    @classmethod
    def from_config(cls, section: str = "dixon_coles") -> "GoalModelConfig":
        cfg = load_model_config().get(section, {}) or {}
        bounds = cfg.get("rho_bounds", [-0.25, 0.25])
        return cls(
            xi=float(cfg.get("xi", 0.0018)),
            max_history_days=int(cfg.get("max_history_days", 1460)),
            max_goals=int(cfg.get("max_goals", DEFAULT_MAX_GOALS)),
            min_matches_per_team=int(cfg.get("min_matches_per_team", 5)),
            use_rho=section == "dixon_coles",
            rho_bounds=(float(bounds[0]), float(bounds[1])),
        )


@dataclass
class DixonColesModel:
    """Fitted attack/defence/home-advantage model over one pool of matches."""

    config: GoalModelConfig = field(default_factory=GoalModelConfig)
    teams: list[str] = field(default_factory=list)
    attack: dict[str, float] = field(default_factory=dict)
    defence: dict[str, float] = field(default_factory=dict)
    home_advantage: float = 0.25
    rho: float = 0.0
    baseline_rate: float = 1.35
    n_matches: int = 0
    converged: bool = False
    reference_date: pd.Timestamp | None = None

    name: str = "dixon_coles"

    # -- fitting -----------------------------------------------------------
    def fit(
        self,
        df: pd.DataFrame,
        *,
        reference_date=None,
        home_col: str = "home_goals",
        away_col: str = "away_goals",
    ) -> "DixonColesModel":
        """Fit on matches strictly before ``reference_date``.

        The cutoff is applied here rather than by the caller so that the model
        cannot accidentally be fitted on the match it is about to predict.
        """
        reference = pd.Timestamp(reference_date) if reference_date is not None else \
            pd.Timestamp(df["date"].max()) + pd.Timedelta(days=1)
        self.reference_date = reference

        data = df[
            df["date"] < reference
            if reference_date is not None
            else np.ones(len(df), dtype=bool)
        ]
        data = data[data[home_col].notna() & data[away_col].notna()]
        cutoff = reference - pd.Timedelta(days=self.config.max_history_days)
        data = data[data["date"] >= cutoff]
        if data.empty:
            raise ValueError("no training matches within the history window")

        # Teams with too little history get no parameter of their own; they
        # fall back to league-average strength at prediction time.
        appearances = pd.concat([data["home_team"], data["away_team"]]).value_counts()
        keep = set(appearances[appearances >= self.config.min_matches_per_team].index)
        data = data[data["home_team"].isin(keep) & data["away_team"].isin(keep)]
        if data.empty:
            raise ValueError("no team has enough matches to fit")

        self.teams = sorted(set(data["home_team"]) | set(data["away_team"]))
        index = {team: i for i, team in enumerate(self.teams)}
        n = len(self.teams)

        home_idx = data["home_team"].map(index).to_numpy(dtype=np.int64)
        away_idx = data["away_team"].map(index).to_numpy(dtype=np.int64)
        home_goals = data[home_col].to_numpy(dtype=float)
        away_goals = data[away_col].to_numpy(dtype=float)
        at_home = (~data["neutral_venue"].fillna(False).to_numpy(dtype=bool)).astype(float)

        days = (reference - data["date"]).dt.days.to_numpy(dtype=float)
        weights = np.exp(-self.config.xi * np.maximum(days, 0.0))

        self.n_matches = len(data)
        self.baseline_rate = float(
            np.average(np.concatenate([home_goals, away_goals]),
                       weights=np.concatenate([weights, weights]))
        )

        params = self._optimise(
            n, home_idx, away_idx, home_goals, away_goals, at_home, weights
        )
        # Attack and defence are only identified up to a constant: adding m to
        # every attack and subtracting it from every defence leaves the rates
        # unchanged. Centre attack on zero and move the same constant into
        # defence, so recentring is a relabelling rather than a change of model.
        attack = params[:n]
        shift = attack.mean()
        attack = attack - shift
        defence = params[n:2 * n] + shift
        self.attack = dict(zip(self.teams, attack))
        self.defence = dict(zip(self.teams, defence))
        self.home_advantage = float(params[2 * n])
        self.rho = float(params[2 * n + 1]) if self.config.use_rho else 0.0
        return self

    def _optimise(self, n, home_idx, away_idx, home_goals, away_goals, at_home, weights):
        start = np.concatenate([
            np.zeros(n),                                   # attack
            np.zeros(n),                                   # defence
            [0.25],                                        # home advantage
            [0.0],                                         # rho
        ])
        start[:n] = 0.1 * np.random.default_rng(0).standard_normal(n) * 0.0
        base = np.log(max(self.baseline_rate, 0.05))
        start[:n] += base / 2.0
        start[n:2 * n] += base / 2.0

        low, high = self.config.rho_bounds
        bounds = [(-3.0, 3.0)] * (2 * n) + [(-1.0, 1.5)]
        bounds += [(low, high)] if self.config.use_rho else [(0.0, 0.0)]

        result = minimize(
            self._objective,
            start,
            args=(n, home_idx, away_idx, home_goals, away_goals, at_home, weights),
            jac=True,
            method="L-BFGS-B",
            bounds=bounds,
            options={"maxiter": 400, "ftol": 1e-10},
        )
        self.converged = bool(result.success)
        if not result.success:
            log.debug("goal model did not converge: %s", result.message)
        return result.x

    def _objective(self, params, n, home_idx, away_idx, home_goals, away_goals,
                   at_home, weights):
        """Negative weighted log-likelihood and its gradient."""
        attack, defence = params[:n], params[n:2 * n]
        gamma, rho = params[2 * n], params[2 * n + 1]

        log_lambda = attack[home_idx] + defence[away_idx] + gamma * at_home
        log_mu = attack[away_idx] + defence[home_idx]
        lam = np.exp(np.clip(log_lambda, -20, 5))
        mu = np.exp(np.clip(log_mu, -20, 5))

        # Poisson part (constant log factorial terms dropped).
        loglik = weights * (home_goals * log_lambda - lam + away_goals * log_mu - mu)
        d_lam = weights * (home_goals - lam)       # d/d(log lambda)
        d_mu = weights * (away_goals - mu)

        # Evaluated whenever rho is a free parameter, including at rho == 0:
        # tau is 1 there but its rho-derivative is not, and short-circuiting
        # this branch would pin rho to its starting value.
        if self.config.use_rho:
            tau, dtau_dlam, dtau_dmu, dtau_drho = _tau_terms(
                home_goals, away_goals, lam, mu, rho
            )
            loglik += weights * np.log(tau)
            # chain rule into log-rate space: d log tau / d log lambda = lambda * d/d lambda
            d_lam += weights * lam * dtau_dlam / tau
            d_mu += weights * mu * dtau_dmu / tau
            grad_rho = float((weights * dtau_drho / tau).sum())
        else:
            grad_rho = 0.0

        grad_attack = np.zeros(n)
        grad_defence = np.zeros(n)
        np.add.at(grad_attack, home_idx, d_lam)
        np.add.at(grad_attack, away_idx, d_mu)
        np.add.at(grad_defence, away_idx, d_lam)
        np.add.at(grad_defence, home_idx, d_mu)
        grad_gamma = float((d_lam * at_home).sum())

        grad = np.concatenate([grad_attack, grad_defence, [grad_gamma], [grad_rho]])
        return -float(loglik.sum()), -grad

    # -- prediction --------------------------------------------------------
    def rates(self, home_team: str, away_team: str, *, neutral: bool = False
              ) -> tuple[float, float]:
        """Expected goals for both sides.

        A team absent from the fit (newly promoted, first European campaign)
        is treated as league average rather than refused, and the data-quality
        layer flags the prediction as resting on limited history.
        """
        half_base = np.log(max(self.baseline_rate, 0.05)) / 2.0
        attack_home = self.attack.get(home_team, half_base)
        attack_away = self.attack.get(away_team, half_base)
        defence_home = self.defence.get(home_team, half_base)
        defence_away = self.defence.get(away_team, half_base)
        gamma = 0.0 if neutral else self.home_advantage
        lam = float(np.exp(attack_home + defence_away + gamma))
        mu = float(np.exp(attack_away + defence_home))
        return lam, mu

    def score_matrix(self, home_team: str, away_team: str, *, neutral: bool = False
                     ) -> ScoreMatrix:
        lam, mu = self.rates(home_team, away_team, neutral=neutral)
        return ScoreMatrix.from_rates(
            lam, mu, rho=self.rho, max_goals=self.config.max_goals
        )

    def predict_proba(self, fixtures: pd.DataFrame) -> np.ndarray:
        """HUB probabilities as an ``(n, 3)`` array ordered H, U, B."""
        out = np.zeros((len(fixtures), 3))
        for i, row in enumerate(fixtures.itertuples(index=False)):
            matrix = self.score_matrix(
                row.home_team, row.away_team,
                neutral=bool(getattr(row, "neutral_venue", False)),
            )
            probs = matrix.result_probabilities()
            out[i] = [probs["H"], probs["U"], probs["B"]]
        return out

    def knows(self, team: str) -> bool:
        return team in self.attack

    def team_strengths(self) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "team": self.teams,
                "attack": [self.attack[t] for t in self.teams],
                "defence": [self.defence[t] for t in self.teams],
            }
        ).sort_values("attack", ascending=False).reset_index(drop=True)


def _tau_terms(x, y, lam, mu, rho):
    """Dixon-Coles tau and its derivatives, evaluated per match."""
    tau = np.ones_like(lam)
    d_lam = np.zeros_like(lam)
    d_mu = np.zeros_like(lam)
    d_rho = np.zeros_like(lam)

    m00 = (x == 0) & (y == 0)
    m01 = (x == 0) & (y == 1)
    m10 = (x == 1) & (y == 0)
    m11 = (x == 1) & (y == 1)

    tau[m00] = 1.0 - lam[m00] * mu[m00] * rho
    d_lam[m00] = -mu[m00] * rho
    d_mu[m00] = -lam[m00] * rho
    d_rho[m00] = -lam[m00] * mu[m00]

    tau[m01] = 1.0 + lam[m01] * rho
    d_lam[m01] = rho
    d_rho[m01] = lam[m01]

    tau[m10] = 1.0 + mu[m10] * rho
    d_mu[m10] = rho
    d_rho[m10] = mu[m10]

    tau[m11] = 1.0 - rho
    d_rho[m11] = -1.0

    np.clip(tau, 1e-8, None, out=tau)
    return tau, d_lam, d_mu, d_rho


class PoissonModel(DixonColesModel):
    """Time-weighted Poisson: the same model with the rho correction removed."""

    name = "poisson"

    def __init__(self, config: GoalModelConfig | None = None) -> None:
        config = config or GoalModelConfig.from_config("poisson")
        config.use_rho = False
        super().__init__(config=config)
