"""The examples and error responses shown in the OpenAPI docs, in one place.

The views attach these with ``extend_schema``. Tests check that each example fits the published
schema and that the error examples cover every code the API raises, so the docs can't drift
from the code unnoticed.
"""

from datetime import UTC, datetime, timedelta

from drf_spectacular.utils import OpenApiExample, OpenApiResponse

from .checkpoints import INTERVAL_CHOICES
from .serializers import (
    DEPARTURE_HORIZON,
    MAX_LOAD_WEIGHT_LB,
    ErrorSerializer,
    departure_window_text,
    duration_text,
)

# The requests that carry a departure, which an example must keep inside the accepted window.
_DEPARTING_REQUESTS = ("/api/plan", "/api/heatmap")


def example_departure() -> str:
    """An hour after the next full hour, in UTC: always in the future and inside the window."""
    next_hour = datetime.now(UTC).replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    return (next_hour + timedelta(hours=1)).isoformat()


def set_example_departures(result, generator, request, public):
    """drf-spectacular postprocessing hook: dates the request examples when the schema is built.

    A departure written into an example goes stale, and the API rejects a departure in the
    past, so "Try it out" in Swagger UI would fail within a day. The examples below carry a
    placeholder that this replaces on every schema request.
    """
    departure = example_departure()
    for path in _DEPARTING_REQUESTS:
        content = result["paths"][path]["post"]["requestBody"]["content"]["application/json"]
        for example in content["examples"].values():
            example["value"]["departure"] = departure
    return result


def document_retry_after(result, generator, request, public):
    """drf-spectacular postprocessing hook: every 429 documents its ``Retry-After`` header.

    ``errors.exception_handler`` sends the header with any error that carries
    ``details.retry_after_seconds``; this keeps the docs from needing it spelled out per endpoint.
    """
    for operations in result["paths"].values():
        for operation in operations.values():
            too_many = operation["responses"].get("429")
            if too_many is not None:
                too_many["headers"] = {"Retry-After": RETRY_AFTER_HEADER}
    return result


RETRY_AFTER_HEADER = {
    "description": "Whole seconds to wait before asking again: `details.retry_after_seconds`.",
    "required": True,
    "schema": {"type": "integer"},
}


def error_response(description: str, *examples: OpenApiExample) -> OpenApiResponse:
    return OpenApiResponse(ErrorSerializer, description=description, examples=list(examples))


def _error_example(name: str, code: str, message: str, status: str, details=None) -> OpenApiExample:
    body = {"code": code, "message": message}
    if details is not None:
        body["details"] = details
    return OpenApiExample(name, value=body, response_only=True, status_codes=[status])


# --- Errors shared by several endpoints -------------------------------------------------------

RATE_LIMIT_EXCEEDED = _error_example(
    "Visitor over the hourly limit",
    "rate_limit_exceeded",
    "You've made a lot of requests. Please try again in about 42 minutes.",
    "429",
    {"retry_after_seconds": 2520},
)
WEATHER_RATE_LIMITED = _error_example(
    "Weather service limiting requests",
    "weather_rate_limited",
    "The weather service is busy. Please try again in a moment.",
    "429",
    {"retry_after_seconds": 30},
)
WEATHER_UNAVAILABLE = _error_example(
    "Weather service down",
    "weather_unavailable",
    "The weather forecast is unavailable right now. Please try again.",
    "503",
)

RATE_LIMIT_429 = error_response(
    "Too many requests. `rate_limit_exceeded`: this visitor's hourly allowance for the endpoint "
    "is used up, and `details.retry_after_seconds` is the time until the next clock hour. "
    "`weather_rate_limited`: the weather service is limiting requests; the same request works "
    "after `details.retry_after_seconds`.",
    RATE_LIMIT_EXCEEDED,
    WEATHER_RATE_LIMITED,
)
RATE_LIMIT_429_SUGGEST = error_response(
    "`rate_limit_exceeded`: this visitor's hourly allowance for suggestions is used up. "
    "`details.retry_after_seconds` is the time until the next clock hour.",
    RATE_LIMIT_EXCEEDED,
)

# --- Place suggestions ------------------------------------------------------------------------

SUGGEST_OK = OpenApiExample(
    "Chicago",
    value={
        "provider": "here",
        "suggestions": [
            {
                "label": "Chicago, IL, United States",
                "lat": 41.88425,
                "lng": -87.63245,
                "time_zone": "America/Chicago",
            },
            {
                "label": "Chicago Heights, IL, United States",
                "lat": 41.50614,
                "lng": -87.63532,
                "time_zone": "America/Chicago",
            },
        ],
    },
    response_only=True,
    status_codes=["200"],
)
SUGGEST_400 = error_response(
    "`validation_error`: `q` is missing or outside 3 to 200 characters.",
    _error_example(
        "Query too short",
        "validation_error",
        "q: Ensure this field has at least 3 characters.",
        "400",
        {"fields": {"q": ["Ensure this field has at least 3 characters."]}},
    ),
)
SUGGEST_503 = error_response(
    "`places_unavailable`: HERE and the Photon fallback both failed.",
    _error_example(
        "Both providers down",
        "places_unavailable",
        "Place search is unavailable right now. Please try again.",
        "503",
    ),
)

# --- Plan -------------------------------------------------------------------------------------

_CHICAGO = {
    "label": "Chicago, IL, United States",
    "lat": 41.88425,
    "lng": -87.63245,
    "time_zone": "America/Chicago",
}
_DALLAS = {
    "label": "Dallas, TX, United States",
    "lat": 32.77657,
    "lng": -96.79699,
    "time_zone": "America/Chicago",
}


def _risk(level: str, score: float | None, conditions: dict, **overrides) -> dict:
    return {
        "level": level,
        "score": score,
        "conditions": conditions,
        "driving": [],
        "combined": [],
        "gust_warning": None,
        "wind_raised_by_load": False,
    } | overrides


_ALL_LOW = {"wind": "low", "rain": "low", "snow": "low"}

PLAN_REQUEST = OpenApiExample(
    "Chicago to Dallas, 38,000 lb",
    value={
        "origin": _CHICAGO,
        "destination": _DALLAS,
        "departure": "set when the schema is built",
        "load_weight_lb": 38000,
        "interval_miles": 25,
    },
    request_only=True,
)

PLAN_OK = OpenApiExample(
    "Two routes, abridged",
    summary="Two routes, abridged to a few checkpoints and vertices each",
    description=(
        "A real response has up to three routes, one checkpoint per interval along each, and "
        "a few hundred geometry vertices. Here route 1 is recommended; route 2 is slower and "
        "has 25 mi of High risk, which is why it lost."
    ),
    value={
        "origin_time_zone": "America/Chicago",
        "departure": "2026-10-15T08:00:00-05:00",
        "interval_miles": 25,
        "interval_automatic": False,
        "routes": [
            {
                "id": "route-1",
                "distance_miles": 926.83,
                "duration_seconds": 53684,
                "arrival": "2026-10-15T22:54:44-05:00",
                "geometry": "qos~FxuzuOxd{RljtNf_bNvojb@|srSda|C",
                "elapsed_seconds": [0, 15000, 33000, 53684],
                "checkpoints": [
                    {
                        "mile": 0.0,
                        "lat": 41.88425,
                        "lng": -87.63245,
                        "eta": "2026-10-15T08:00:00-05:00",
                        "covered_miles": 12.5,
                        "weather": {
                            "wind_mph": 9.8,
                            "gust_mph": 16.1,
                            "rain_in_hr": 0.0,
                            "snow_in_hr": 0.0,
                        },
                        "risk": _risk("low", 0.0, _ALL_LOW),
                    },
                    {
                        "mile": 25.0,
                        "lat": 41.55102,
                        "lng": -87.98844,
                        "eta": "2026-10-15T08:24:08-05:00",
                        "covered_miles": 25.0,
                        "weather": {
                            "wind_mph": 27.4,
                            "gust_mph": 33.0,
                            "rain_in_hr": 0.12,
                            "snow_in_hr": 0.0,
                        },
                        "risk": _risk(
                            "moderate",
                            1.5,
                            {"wind": "moderate", "rain": "moderate", "snow": "low"},
                            driving=["wind", "rain"],
                            combined=["wind", "rain"],
                        ),
                    },
                    {
                        "mile": 926.83,
                        "lat": 32.77657,
                        "lng": -96.79699,
                        "eta": "2026-10-15T22:54:44-05:00",
                        "covered_miles": 13.415,
                        "weather": None,
                        "risk": _risk("no_data", None, {"wind": None, "rain": None, "snow": None}),
                    },
                ],
                "risk_miles": {
                    "low": 888.4,
                    "moderate": 25.0,
                    "high": 0.0,
                    "severe": 0.0,
                    "no_travel": 0.0,
                    "unassessed": 13.4,
                },
                "average_risk": 0.04,
                "blocked": False,
                "rank": 1,
                "deciding": None,
            },
            {
                "id": "route-2",
                "distance_miles": 968.76,
                "duration_seconds": 55538,
                "arrival": "2026-10-15T23:25:38-05:00",
                "geometry": "qos~FxuzuO`g|Ku}~G~~fYjlidA|qlOiokC",
                "elapsed_seconds": [0, 14000, 36000, 55538],
                "checkpoints": [
                    {
                        "mile": 25.0,
                        "lat": 41.43711,
                        "lng": -87.21208,
                        "eta": "2026-10-15T08:25:10-05:00",
                        "covered_miles": 25.0,
                        "weather": {
                            "wind_mph": 38.0,
                            "gust_mph": 52.0,
                            "rain_in_hr": 0.0,
                            "snow_in_hr": 0.0,
                        },
                        "risk": _risk(
                            "high",
                            2.0,
                            {"wind": "high", "rain": "low", "snow": "low"},
                            driving=["wind"],
                            gust_warning={"gust_mph": 52.0, "level": "no_travel"},
                        ),
                    },
                ],
                "risk_miles": {
                    "low": 943.8,
                    "moderate": 0.0,
                    "high": 25.0,
                    "severe": 0.0,
                    "no_travel": 0.0,
                    "unassessed": 0.0,
                },
                "average_risk": 0.05,
                "blocked": False,
                "rank": 2,
                "deciding": {
                    "criterion": "high_miles",
                    "recommended_value": 0.0,
                    "alternative_value": 25.0,
                    "best_average_risk": None,
                },
            },
        ],
        "recommended_route_id": "route-1",
        "all_blocked_warning": None,
        "notices": [
            {
                "code": "fewer_than_three_routes",
                "message": "Only 2 distinct routes exist between these places, not three.",
            },
            {
                "code": "no_data_checkpoints",
                "message": (
                    "The forecast is missing at 1 checkpoint. It is marked No data and left out "
                    "of risk mileage and average risk; each route's unassessed miles are shown "
                    "on its card."
                ),
            },
        ],
    },
    response_only=True,
    status_codes=["200"],
)
_INTERVALS = ", ".join(map(str, INTERVAL_CHOICES[:-1])) + f" or {INTERVAL_CHOICES[-1]}"
_TOO_FAR_AHEAD = f"Departure can't be more than {duration_text(DEPARTURE_HORIZON)} ahead."
PLAN_400 = error_response(
    "`validation_error`: a field is missing or invalid, and `details.fields` names each one. "
    "Examples: a departure without a UTC offset or outside the window "
    f"({departure_window_text()}), a latitude or longitude out of range, the same origin "
    f"and destination, a load weight outside 1 to {MAX_LOAD_WEIGHT_LB:,} lb, or an interval "
    f"other than {_INTERVALS}.",
    _error_example(
        "Departure too far ahead",
        "validation_error",
        f"departure: {_TOO_FAR_AHEAD}",
        "400",
        {"fields": {"departure": [_TOO_FAR_AHEAD]}},
    ),
)
PLAN_422 = error_response(
    "`no_route_found`: HERE found no truck route between the places (for example, across water).",
    _error_example(
        "No route",
        "no_route_found",
        "No truck route was found between these places. Try a different origin or destination.",
        "422",
    ),
)
PLAN_503 = error_response(
    "`routing_unavailable`: HERE failed or timed out. `weather_unavailable`: Open-Meteo failed "
    "or timed out. Failures are not cached, so a retry works once the provider is back.",
    _error_example(
        "Routing down",
        "routing_unavailable",
        "Route planning is unavailable right now. Please try again.",
        "503",
    ),
    WEATHER_UNAVAILABLE,
)

# --- Heatmap ----------------------------------------------------------------------------------

HEATMAP_REQUEST = OpenApiExample(
    "The routes a plan returned",
    value={
        "geometries": [
            "qos~FxuzuOxd{RljtNf_bNvojb@|srSda|C",
            "qos~FxuzuO`g|Ku}~G~~fYjlidA|qlOiokC",
        ],
        "departure": "set when the schema is built",
        "load_weight_lb": 38000,
    },
    request_only=True,
)
HEATMAP_OK = OpenApiExample(
    "Four points, two of 49 frames",
    summary="Four corridor points and two of the 49 frames",
    description=(
        "A real response has up to 500 corridor points and 49 frames, one per hour from the "
        "departure to 48 hours after. Divide `frames.wind` by `scales.wind` for mph and "
        "`frames.rain` by `scales.rain` for inches per hour. `-1` is missing."
    ),
    value={
        "grid": {
            "origin_lat": 41.8,
            "origin_lng": -87.7,
            "spacing_deg": 0.1,
            "rows": 2,
            "cols": 3,
        },
        "indices": [0, 1, 4, 5],
        "timestamps": ["2026-10-15T13:00:00+00:00", "2026-10-15T14:00:00+00:00"],
        "scales": {"wind": 10, "rain": 1000, "snow": 1000},
        "frames": {
            "risk": [[0, 0, 1, 2], [0, 1, 1, -1]],
            "wind": [[98, 120, 274, 380], [101, 266, 281, -1]],
            "rain": [[0, 0, 120, 0], [0, 110, 130, -1]],
            "snow": [[0, 0, 0, 0], [0, 0, 0, -1]],
        },
    },
    response_only=True,
    status_codes=["200"],
)
HEATMAP_400 = error_response(
    "`validation_error`: a geometry does not decode, has more than 5,000 vertices or has a "
    "latitude or longitude out of range; there are more than three geometries; or the "
    "departure or load weight is outside the same limits as the plan's.",
    _error_example(
        "Bad geometry",
        "validation_error",
        "geometries: Not an encoded polyline.",
        "400",
        {"fields": {"geometries": ["Not an encoded polyline."]}},
    ),
)
HEATMAP_503 = error_response(
    "`weather_unavailable`: Open-Meteo failed or timed out. The heatmap never calls HERE.",
    WEATHER_UNAVAILABLE,
)
