"""The risk level at each checkpoint, through the plan API.

The risk rules themselves are tested one by one in test_risk.py. Here the forecast comes from
Open-Meteo's recorded response, edited by hand at the hours the checkpoints read (see
test_weather.py: on the 100 mi route the five checkpoints read wind at 13:00, 13:00, 14:00,
14:00 and 15:00 GMT, and everything else from the buckets ending 13:00, 14:00, 14:00, 15:00
and 15:00).
"""

import pytest
import time_machine

from tests.test_checkpoints import NOW
from tests.test_weather import hundred_mile_route, post_plan

HOURS = ("2026-10-15T13:00", "2026-10-15T14:00", "2026-10-15T15:00")
# Those and the hours beside them, which a missing value falls back to.
ALL_HOURS = ("2026-10-15T12:00", *HOURS, "2026-10-15T16:00")


@pytest.fixture(autouse=True)
def now():
    with time_machine.travel(NOW, tick=False) as traveller:
        yield traveller


def forecast(open_meteo, *, wind=0.0, gust=0.0, rain=0.0, snow=0.0):
    """Set each variable at the three hours the route reads: one value for all three, or a
    value per hour as a tuple."""

    def per_hour(value):
        return dict(zip(HOURS, value if isinstance(value, tuple) else (value,) * 3, strict=True))

    open_meteo.edit("wind_speed_10m", per_hour(wind))
    open_meteo.edit("wind_gusts_10m", per_hour(gust))
    open_meteo.edit("rain", per_hour(rain))
    open_meteo.edit("showers", per_hour(0.0))
    open_meteo.edit("snowfall", per_hour(snow))


def risks(response):
    (route,) = response.json()["routes"]
    return [checkpoint["risk"] for checkpoint in route["checkpoints"]]


def plan(client, outbound_http, **overrides):
    hundred_mile_route(outbound_http)
    response = post_plan(client, **overrides)
    assert response.status_code == 200
    return response


def test_every_checkpoint_carries_its_level_conditions_and_score(client, outbound_http, open_meteo):
    # Wind per checkpoint is 20, 20, 30, 30, 50 mph; rain 0.3 in/hr only in the 14:00 bucket,
    # which checkpoints 1 and 2 read.
    forecast(open_meteo, wind=(20.0, 30.0, 50.0), rain=(0.0, 0.3, 0.0))

    first, second, third, fourth, fifth = risks(plan(client, outbound_http))

    assert first == {
        "level": "low",
        "score": 0.0,
        "conditions": {"wind": "low", "rain": "low", "snow": "low"},
        "driving": [],
        "combined": [],
        "gust_warning": None,
        "wind_raised_by_load": False,
    }
    # Rain is High, wind Low: rain drives it.
    assert (second["level"], second["driving"]) == ("high", ["rain"])
    # Moderate wind and High rain: the level is the worst of the two.
    assert (third["level"], third["driving"], third["score"]) == ("high", ["rain"], 2.5)
    assert third["combined"] == ["wind", "rain"]
    assert third["conditions"] == {"wind": "moderate", "rain": "high", "snow": "low"}
    assert (fourth["level"], fourth["combined"]) == ("moderate", [])
    # 50 mph is Severe for a 30,000 lb load (not above it).
    assert (fifth["level"], fifth["driving"]) == ("severe", ["wind"])


def test_a_heavy_load_raises_wind_that_a_light_one_gets_through(client, outbound_http, open_meteo):
    forecast(open_meteo, wind=40.0)

    at_40_000 = risks(plan(client, outbound_http, load_weight_lb=40_000))
    at_40_001 = risks(plan(client, outbound_http, load_weight_lb=40_001))

    # 40 mph is High; above 40,000 lb it is Severe.
    assert {risk["level"] for risk in at_40_000} == {"high"}
    assert {risk["wind_raised_by_load"] for risk in at_40_000} == {False}
    assert {risk["level"] for risk in at_40_001} == {"severe"}
    assert {risk["wind_raised_by_load"] for risk in at_40_001} == {True}
    assert {tuple(risk["driving"]) for risk in at_40_001} == {("wind",)}
    assert {risk["score"] for risk in at_40_001} == {3.0}


def test_a_load_over_30_000_lb_makes_45_to_54_mph_no_travel(client, outbound_http, open_meteo):
    forecast(open_meteo, wind=50.0)

    at_30_000 = risks(plan(client, outbound_http, load_weight_lb=30_000))
    at_30_001 = risks(plan(client, outbound_http, load_weight_lb=30_001))

    assert {risk["level"] for risk in at_30_000} == {"severe"}
    assert {risk["level"] for risk in at_30_001} == {"no_travel"}


def test_combined_conditions_are_flagged_with_their_names_and_add_half_a_point(
    client, outbound_http, open_meteo
):
    forecast(open_meteo, wind=30.0, snow=0.5)

    checkpoints = risks(plan(client, outbound_http))

    assert {risk["level"] for risk in checkpoints} == {"moderate"}
    assert {tuple(risk["combined"]) for risk in checkpoints} == {("wind", "snow")}
    assert {risk["score"] for risk in checkpoints} == {1.5}
    assert {tuple(risk["driving"]) for risk in checkpoints} == {("wind", "snow")}


def test_gusts_that_reach_high_above_the_sustained_wind_are_a_warning_not_a_level(
    client, outbound_http, open_meteo
):
    forecast(open_meteo, wind=20.0, gust=(30.0, 38.0, 48.0))

    # The gust at checkpoints 0..4 is 30, 38, 38, 48, 48 (the buckets they read).
    first, second, third, fourth, fifth = risks(plan(client, outbound_http))

    assert first["gust_warning"] is None  # breezy: only Moderate
    assert second["gust_warning"] == {"gust_mph": 38.0, "level": "high"}
    assert fourth["gust_warning"] == {"gust_mph": 48.0, "level": "severe"}
    assert {risk["level"] for risk in (first, second, third, fourth, fifth)} == {"low"}
    assert {risk["score"] for risk in (second, fourth)} == {0.0}


def test_no_gust_forecast_gives_no_warning_and_still_a_level(client, outbound_http, open_meteo):
    forecast(open_meteo, wind=20.0)
    open_meteo.edit("wind_gusts_10m", {hour: None for hour in ALL_HOURS})

    checkpoints = risks(plan(client, outbound_http))

    assert {risk["level"] for risk in checkpoints} == {"low"}
    assert {risk["gust_warning"] for risk in checkpoints} == {None}


def test_a_checkpoint_without_a_forecast_is_no_data_and_not_low(client, outbound_http, open_meteo):
    forecast(open_meteo, wind=5.0)
    open_meteo.edit("wind_speed_10m", {"2026-10-15T12:00": 5.0, "2026-10-15T16:00": 5.0})
    # Checkpoints 2 and 3 read the 14:00 wind; with 13:00 and 15:00 gone as well, no data.
    open_meteo.edit("wind_speed_10m", {hour: None for hour in HOURS})

    response = plan(client, outbound_http)

    levels = [risk["level"] for risk in risks(response)]
    assert levels == ["low", "low", "no_data", "no_data", "low"]
    no_data = risks(response)[2]
    assert no_data["score"] is None
    assert no_data["driving"] == [] and no_data["combined"] == []
    assert no_data["gust_warning"] is None
    assert no_data["conditions"]["wind"] is None
    (route,) = response.json()["routes"]
    assert route["checkpoints"][2]["weather"] is None
