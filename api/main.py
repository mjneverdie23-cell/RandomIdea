"""FastAPI service exposing the prediction engine.

Thin by design: it validates input, calls
:class:`football_predictor.predict.PredictionEngine` and serialises the
result. All modelling decisions live in the package, so the API cannot drift
away from what was trained and backtested.
"""
from __future__ import annotations

import logging
import sys
from datetime import date as date_type
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from football_predictor import __version__
from football_predictor.predict import PredictionEngine, UnknownTeamError

log = logging.getLogger(__name__)

app = FastAPI(
    title="Football Prediction API",
    version=__version__,
    description=(
        "Calibrated probability forecasts for football matches. "
        "HUB (Hjemmeseier / Uavgjort / Borteseier - the Scandinavian name for "
        "the three-way home / draw / away market) is the primary output, "
        "alongside BTTS, over/under, team goals and half-time markets."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_engine: PredictionEngine | None = None


def engine() -> PredictionEngine:
    global _engine
    if _engine is None:
        try:
            _engine = PredictionEngine()
        except FileNotFoundError as exc:
            raise HTTPException(
                status_code=503,
                detail=f"model not trained yet: {exc}",
            ) from exc
    return _engine


class PredictionRequest(BaseModel):
    competition: str = Field(..., examples=["ENG_PL"])
    home_team: str = Field(..., examples=["Liverpool"])
    away_team: str = Field(..., examples=["Arsenal"])
    date: date_type = Field(..., description="kickoff date (YYYY-MM-DD)")
    season: str | None = Field(None, examples=["2025/26"])
    stage: str | None = None
    neutral_venue: bool | None = None


@app.get("/health")
def health() -> dict:
    try:
        bundle = engine().bundle
    except HTTPException:
        return {"status": "no_model", "version": __version__}
    return {
        "status": "ok",
        "version": __version__,
        "trained_through": bundle.trained_through.strftime("%Y-%m-%d"),
        "n_matches": bundle.metadata.get("n_matches"),
        "competitions": len(bundle.competitions),
    }


@app.get("/competitions")
def competitions() -> dict:
    return {"competitions": engine().competitions()}


@app.get("/competitions/{code}/seasons")
def seasons(code: str) -> dict:
    values = engine().seasons(code)
    if not values:
        raise HTTPException(status_code=404, detail=f"unknown competition {code!r}")
    return {"competition": code, "seasons": values}


@app.get("/competitions/{code}/teams")
def teams(code: str, season: str | None = Query(None)) -> dict:
    values = engine().teams(code, season)
    if not values:
        raise HTTPException(
            status_code=404,
            detail=f"no teams for competition {code!r}"
                   + (f" in season {season!r}" if season else ""),
        )
    return {"competition": code, "season": season, "teams": values}


@app.post("/predict")
def predict(request: PredictionRequest) -> dict:
    try:
        return engine().predict(
            competition=request.competition,
            home_team=request.home_team,
            away_team=request.away_team,
            date=request.date,
            season=request.season,
            stage=request.stage,
            neutral_venue=request.neutral_venue,
        )
    except UnknownTeamError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/model")
def model_info() -> dict:
    """What was trained, how it scored, and what it rests on."""
    bundle = engine().bundle
    return {
        "version": bundle.version,
        "trained_at": bundle.trained_at.strftime("%Y-%m-%d %H:%M:%S")
        if bundle.trained_at else None,
        "trained_through": bundle.trained_through.strftime("%Y-%m-%d"),
        "seasons": bundle.seasons,
        "competitions": bundle.competitions,
        "n_features": len(bundle.feature_names),
        "metadata": bundle.metadata,
    }
