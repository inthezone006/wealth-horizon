from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from flask import Flask, jsonify, request
from flask_cors import CORS


SERVICE_NAME = "wealth-horizon-backend"
API_VERSION = "1.0.0"

RISK_BASE_RETURN = {
    "conservative": 0.056,
    "balanced": 0.074,
    "growth": 0.094,
}

STRATEGY_MODES = {"market-probabilities", "historical-average", "compare-both"}
RISK_LEVELS = set(RISK_BASE_RETURN.keys())

DEFAULT_PROFILE = {
    "displayName": "Wealth Horizon User",
    "ageRange": "26-35",
    "primaryGoal": "Financial independence",
    "monthlyContribution": 700.0,
    "targetHorizonYears": 20,
    "riskLevel": "balanced",
    "strategyMode": "compare-both",
}

DEFAULT_MARKET_PROBABILITIES = {
    "recessionProbability": 42.0,
    "rateCutProbability": 58.0,
    "spUpProbability": 54.0,
}

EXPECTED_RETURN_TREND_PROBS = [0.40, 0.35, 0.25]
EXPECTED_RETURN_TREND_VALUES = [0.12, 0.07, -0.15]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_error(message: str, status_code: int = 400):
    response = jsonify(error={"message": message})
    response.status_code = status_code
    return response


def _coerce_string(value: Any, default: str) -> str:
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or default

    return default


def _coerce_float(value: Any, default: float) -> float:
    try:
        if value is None:
            return default

        parsed = float(value)
        if parsed != parsed:
            return default

        return parsed
    except (TypeError, ValueError):
        return default


def _coerce_int(value: Any, default: int) -> int:
    try:
        if value is None:
            return default

        parsed = int(float(value))
        return parsed
    except (TypeError, ValueError):
        return default


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(min(value, maximum), minimum)


def _normalize_profile(payload: dict[str, Any]) -> dict[str, Any]:
    profile = payload.get("profile") if isinstance(payload.get("profile"), dict) else payload

    normalized = {
        "displayName": _coerce_string(profile.get("displayName"), DEFAULT_PROFILE["displayName"]),
        "ageRange": _coerce_string(profile.get("ageRange"), DEFAULT_PROFILE["ageRange"]),
        "primaryGoal": _coerce_string(profile.get("primaryGoal"), DEFAULT_PROFILE["primaryGoal"]),
        "monthlyContribution": _coerce_float(profile.get("monthlyContribution"), DEFAULT_PROFILE["monthlyContribution"]),
        "targetHorizonYears": _coerce_int(profile.get("targetHorizonYears"), DEFAULT_PROFILE["targetHorizonYears"]),
        "riskLevel": _coerce_string(profile.get("riskLevel"), DEFAULT_PROFILE["riskLevel"]),
        "strategyMode": _coerce_string(profile.get("strategyMode"), DEFAULT_PROFILE["strategyMode"]),
    }

    errors: list[str] = []

    if len(normalized["displayName"]) < 2:
        errors.append("displayName must contain at least 2 characters.")

    if normalized["monthlyContribution"] <= 0:
        errors.append("monthlyContribution must be greater than 0.")

    if not 3 <= normalized["targetHorizonYears"] <= 45:
        errors.append("targetHorizonYears must be between 3 and 45.")

    if normalized["riskLevel"] not in RISK_LEVELS:
        errors.append("riskLevel must be one of conservative, balanced, or growth.")

    if normalized["strategyMode"] not in STRATEGY_MODES:
        errors.append("strategyMode must be one of market-probabilities, historical-average, or compare-both.")

    if errors:
        raise ValueError(" ".join(errors))

    return normalized


def _normalize_market_probabilities(payload: dict[str, Any]) -> dict[str, float]:
    market_probabilities = payload.get("marketProbabilities")
    if not isinstance(market_probabilities, dict):
        market_probabilities = {}

    normalized = {
        "recessionProbability": _clamp(
            _coerce_float(market_probabilities.get("recessionProbability"), DEFAULT_MARKET_PROBABILITIES["recessionProbability"]),
            0,
            100,
        ),
        "rateCutProbability": _clamp(
            _coerce_float(market_probabilities.get("rateCutProbability"), DEFAULT_MARKET_PROBABILITIES["rateCutProbability"]),
            0,
            100,
        ),
        "spUpProbability": _clamp(
            _coerce_float(market_probabilities.get("spUpProbability"), DEFAULT_MARKET_PROBABILITIES["spUpProbability"]),
            0,
            100,
        ),
    }

    return normalized


def _calculate_simulation(profile: dict[str, Any], market_probabilities: dict[str, float]) -> dict[str, Any]:
    base_return = RISK_BASE_RETURN[profile["riskLevel"]]

    recession_probability = market_probabilities["recessionProbability"] / 100
    rate_cut_probability = market_probabilities["rateCutProbability"] / 100
    sp_up_probability = market_probabilities["spUpProbability"] / 100

    probability_total = recession_probability + rate_cut_probability + sp_up_probability
    if probability_total > 0:
        normalized_probabilities = {
            "recession": recession_probability / probability_total,
            "disinflation": rate_cut_probability / probability_total,
            "riskOn": sp_up_probability / probability_total,
        }
    else:
        normalized_probabilities = {
            "riskOn": EXPECTED_RETURN_TREND_PROBS[0],
            "disinflation": EXPECTED_RETURN_TREND_PROBS[1],
            "recession": EXPECTED_RETURN_TREND_PROBS[2],
        }

    level1_expected_return = max(base_return * (1 - recession_probability * 0.35), 0.01)

    regime_returns = {
        "riskOn": EXPECTED_RETURN_TREND_VALUES[0],
        "disinflation": EXPECTED_RETURN_TREND_VALUES[1],
        "recession": EXPECTED_RETURN_TREND_VALUES[2],
    }

    level2_weighted_return = max(
        normalized_probabilities["riskOn"] * regime_returns["riskOn"]
        + normalized_probabilities["disinflation"] * regime_returns["disinflation"]
        + normalized_probabilities["recession"] * regime_returns["recession"],
        0.01,
    )

    historical_average_return = base_return
    market_probability_return = (level1_expected_return + level2_weighted_return) / 2

    if profile["strategyMode"] == "historical-average":
        preferred_return = historical_average_return
    elif profile["strategyMode"] == "market-probabilities":
        preferred_return = market_probability_return
    else:
        preferred_return = (historical_average_return + market_probability_return) / 2

    annual_contribution = profile["monthlyContribution"] * 12
    balance = 0.0
    projection = []

    for year in range(1, profile["targetHorizonYears"] + 1):
        starting_balance = balance
        contribution = annual_contribution
        gains = (starting_balance + contribution) * preferred_return
        balance = starting_balance + contribution + gains

        projection.append(
            {
                "year": year,
                "startingBalance": round(starting_balance, 2),
                "annualContribution": round(contribution, 2),
                "gains": round(gains, 2),
                "endingBalance": round(balance, 2),
            },
        )

    projected_final_balance = round(balance, 2)
    total_contributions = round(annual_contribution * profile["targetHorizonYears"], 2)

    return {
        "generatedAt": _now_iso(),
        "profile": profile,
        "marketProbabilities": market_probabilities,
        "outputs": {
            "baseReturn": round(base_return, 6),
            "level1ExpectedReturn": round(level1_expected_return, 6),
            "level2WeightedReturn": round(level2_weighted_return, 6),
            "historicalAverageReturn": round(historical_average_return, 6),
            "marketProbabilityReturn": round(market_probability_return, 6),
            "preferredReturn": round(preferred_return, 6),
            "projectedFinalBalance": projected_final_balance,
            "totalContributions": total_contributions,
            "projectedGain": round(projected_final_balance - total_contributions, 2),
        },
        "projection": projection,
    }


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)

    @app.get("/api/health")
    def health_check():
        return jsonify(status="ok", service=SERVICE_NAME, version=API_VERSION, timestamp=_now_iso())

    @app.get("/api/meta")
    def meta():
        return jsonify(
            service=SERVICE_NAME,
            version=API_VERSION,
            description="Simulation API for Wealth Horizon.",
            endpoints={
                "health": "/api/health",
                "meta": "/api/meta",
                "simulate": "/api/simulate",
            },
        )

    @app.post("/api/simulate")
    def simulate():
        payload = request.get_json(silent=True)

        if payload is None:
            return _json_error("Request body must be valid JSON.")

        if not isinstance(payload, dict):
            return _json_error("Request body must be a JSON object.")

        try:
            profile = _normalize_profile(payload)
            market_probabilities = _normalize_market_probabilities(payload)
        except ValueError as exc:
            return _json_error(str(exc))

        simulation = _calculate_simulation(profile, market_probabilities)

        return jsonify(simulation)

    @app.post("/api/simulation/placeholder")
    def simulation_placeholder():
        payload = request.get_json(silent=True) or {}
        return jsonify(
            message="Deprecated endpoint. Use /api/simulate instead.",
            received_keys=sorted(payload.keys()) if isinstance(payload, dict) else [],
        )

    @app.errorhandler(404)
    def not_found(_error):
        return _json_error("Route not found.", 404)

    @app.errorhandler(500)
    def internal_error(_error):
        return _json_error("An unexpected server error occurred.", 500)

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)