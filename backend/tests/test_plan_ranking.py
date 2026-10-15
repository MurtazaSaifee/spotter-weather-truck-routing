"""The recommendation, through the plan API (seam 1).

Two straight 100 mi routes run side by side, 85 km apart: the fast one (6,000 s) up 90.0 W and
the slow one (7,200 s) up 89.0 W. The recorded Open-Meteo answer is calmed to zero everywhere
and then storms are placed on one line at a time, so which route should win is clear by hand.
The ranking rules themselves are tested one by one in test_ranking.py.
"""

import httpx
import pytest
import time_machine

from api.risk import MILES_DECIMALS
from tests.test_checkpoints import NOW, answer_with, straight_route
from tests.test_weather import HUNDRED_MILES_M, post_plan

FAST_LNG = -90.0
SLOW_LNG = -89.0
# On the fast route the five checkpoints read wind at 13:00 GMT, 13:00, 14:00, 14:00 and 15:00
# (see test_plan_risk.py): a storm at 14:00 alone hits the middle two.
MIDDLE_HOUR = "2026-10-15T14:00"


@pytest.fixture(autouse=True)
def now():
    with time_machine.travel(NOW, tick=False) as traveller:
        yield traveller


@pytest.fixture(autouse=True)
def two_routes(outbound_http, open_meteo):
    answer_with(
        outbound_http,
        straight_route((HUNDRED_MILES_M, 6_000), longitude=FAST_LNG),
        straight_route((HUNDRED_MILES_M, 7_200), longitude=SLOW_LNG),
    )
    # Fair weather: nothing at any hour.
    times = open_meteo.recording[0]["hourly"]["time"]
    for variable in ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall"):
        open_meteo.edit(variable, dict.fromkeys(times, 0.0))


def weather_along(open_meteo, longitude, variable, value, hours=None):
    """Set ``variable`` to ``value`` for places near ``longitude``, at ``hours`` (all if none)."""
    normal = open_meteo.route.side_effect

    def answer(request):
        results = normal(request).json()
        for result in results:
            if abs(result["longitude"] - longitude) < 0.1:
                hourly = result["hourly"]
                for index, stamp in enumerate(hourly["time"]):
                    if hours is None or stamp in hours:
                        hourly[variable][index] = value
        return httpx.Response(200, json=results)

    open_meteo.route.side_effect = answer


def plan(client, **overrides):
    response = post_plan(client, **overrides)
    assert response.status_code == 200
    return response.json()


def route(body, route_id):
    return next(route for route in body["routes"] if route["id"] == route_id)


def test_in_fair_weather_the_fastest_route_is_recommended_and_the_other_loses_on_time(client):
    body = plan(client)

    assert body["recommended_route_id"] == "route-1"
    assert body["all_blocked_warning"] is None
    fast, slow = route(body, "route-1"), route(body, "route-2")
    assert (fast["rank"], slow["rank"]) == (1, 2)
    assert (fast["blocked"], slow["blocked"]) == (False, False)
    assert fast["deciding"] is None
    assert slow["deciding"] == {
        "criterion": "travel_time",
        "recommended_value": 6_000,
        "alternative_value": 7_200,
        "best_average_risk": None,
    }
    assert fast["risk_miles"] == {
        "low": 100.0,
        "moderate": 0.0,
        "high": 0.0,
        "severe": 0.0,
        "no_travel": 0.0,
        "unassessed": 0.0,
    }
    assert fast["average_risk"] == 0.0


def test_a_storm_on_the_fastest_route_moves_the_recommendation_to_the_slower_one(
    client, open_meteo
):
    # 50 mph is Severe for a 30,000 lb load, all day, along the fast route only.
    weather_along(open_meteo, FAST_LNG, "wind_speed_10m", 50.0)

    body = plan(client)

    assert body["recommended_route_id"] == "route-2"
    fast, slow = route(body, "route-1"), route(body, "route-2")
    assert (slow["rank"], fast["rank"]) == (1, 2)
    assert fast["risk_miles"]["severe"] == 100.0
    assert fast["average_risk"] == 3.0
    assert slow["risk_miles"]["severe"] == 0.0
    assert fast["deciding"] == {
        "criterion": "severe_miles",
        "recommended_value": 0.0,
        "alternative_value": 100.0,
        "best_average_risk": None,
    }
    assert slow["deciding"] is None


def test_risk_miles_are_the_covered_miles_of_the_checkpoints_at_each_level(client, open_meteo):
    # Only the 14:00 reading is Severe wind: checkpoints 2 and 3 of the fast route (miles 50 and
    # 75), which cover 25 mi each.
    weather_along(open_meteo, FAST_LNG, "wind_speed_10m", 50.0, hours={MIDDLE_HOUR})

    fast = route(plan(client), "route-1")

    assert fast["risk_miles"]["severe"] == 50.0
    assert fast["risk_miles"]["low"] == 50.0
    # (50 mi at score 3 and 50 mi at 0) over the 100 assessed miles.
    assert fast["average_risk"] == 1.5
    assert sum(fast["risk_miles"].values()) == pytest.approx(fast["distance_miles"], abs=0.1)


def test_a_route_through_a_no_travel_checkpoint_is_blocked_and_never_recommended(
    client, open_meteo
):
    weather_along(open_meteo, FAST_LNG, "wind_speed_10m", 60.0)

    body = plan(client)

    fast = route(body, "route-1")
    assert fast["blocked"] is True
    assert fast["risk_miles"]["no_travel"] == 100.0
    assert fast["rank"] == 2
    assert fast["deciding"]["criterion"] == "blocked"
    assert fast["deciding"]["alternative_value"] == 100.0
    assert body["recommended_route_id"] == "route-2"
    assert body["all_blocked_warning"] is None


def test_when_every_route_is_blocked_nothing_is_recommended_and_the_response_warns(
    client, open_meteo
):
    weather_along(open_meteo, FAST_LNG, "wind_speed_10m", 60.0)
    weather_along(open_meteo, SLOW_LNG, "wind_speed_10m", 60.0)

    body = plan(client)

    assert body["recommended_route_id"] is None
    assert body["all_blocked_warning"]["code"] == "all_routes_blocked"
    assert "Do not travel at this departure time" in body["all_blocked_warning"]["message"]
    assert all(route["blocked"] for route in body["routes"])
    # Still ranked (by No Travel miles, then time), but with nothing to explain.
    assert [route(body, id_)["rank"] for id_ in ("route-1", "route-2")] == [1, 2]
    assert [route["deciding"] for route in body["routes"]] == [None, None]


def test_no_data_is_a_notice_and_unassessed_miles_never_make_a_route_look_safe(client, open_meteo):
    weather_along(open_meteo, FAST_LNG, "wind_speed_10m", None)

    body = plan(client)

    fast = route(body, "route-1")
    assert fast["risk_miles"]["unassessed"] == 100.0
    assert fast["risk_miles"]["low"] == 0.0
    assert fast["average_risk"] is None
    (notice,) = [n for n in body["notices"] if n["code"] == "no_data_checkpoints"]
    assert "No data" in notice["message"]
    assert "5 checkpoints" in notice["message"]
    # The route with a forecast wins although the other is faster.
    assert body["recommended_route_id"] == "route-2"
    assert fast["deciding"]["criterion"] == "average_risk"
    assert fast["deciding"]["alternative_value"] is None


def test_there_is_no_no_data_notice_when_every_checkpoint_has_a_forecast(client):
    codes = [notice["code"] for notice in plan(client)["notices"]]

    assert "no_data_checkpoints" not in codes


def test_a_single_route_is_recommended_without_a_comparison(client, outbound_http):
    answer_with(outbound_http, straight_route((HUNDRED_MILES_M, 6_000)))

    body = plan(client)

    # The mocked detours return the same route, which is dropped as a duplicate.
    (only,) = body["routes"]
    assert body["recommended_route_id"] == only["id"]
    assert (only["rank"], only["deciding"]) == (1, None)


# --- Miles add up in every plan ----------------------------------------------------------------


def _storm_on_fast(open_meteo):
    weather_along(open_meteo, FAST_LNG, "wind_speed_10m", 50.0)


def _mixed_on_both(open_meteo):
    weather_along(open_meteo, FAST_LNG, "wind_speed_10m", 30.0, hours={MIDDLE_HOUR})
    weather_along(open_meteo, FAST_LNG, "rain", 0.3, hours={MIDDLE_HOUR})
    weather_along(open_meteo, SLOW_LNG, "snowfall", 2.5)


def _no_data_on_fast(open_meteo):
    weather_along(open_meteo, FAST_LNG, "wind_speed_10m", None)


def _no_travel_on_fast(open_meteo):
    weather_along(open_meteo, FAST_LNG, "wind_speed_10m", 60.0)


def _no_travel_on_both(open_meteo):
    weather_along(open_meteo, FAST_LNG, "wind_speed_10m", 60.0)
    weather_along(open_meteo, SLOW_LNG, "wind_speed_10m", 60.0)


@pytest.mark.parametrize(
    "scenario",
    [
        pytest.param(lambda open_meteo: None, id="fair"),
        pytest.param(_storm_on_fast, id="storm-on-fast"),
        pytest.param(_mixed_on_both, id="mixed-levels"),
        pytest.param(_no_data_on_fast, id="no-data-on-fast"),
        pytest.param(_no_travel_on_fast, id="no-travel-on-fast"),
        pytest.param(_no_travel_on_both, id="all-blocked"),
    ],
)
def test_every_route_risk_miles_add_up_to_its_distance_within_the_rounding(
    client, open_meteo, scenario
):
    scenario(open_meteo)

    body = plan(client)

    for route_body in body["routes"]:
        risk_miles = route_body["risk_miles"]
        # Six figures, each rounded to a tenth of a mile, and a distance rounded to a hundredth.
        slack = len(risk_miles) * 0.5 * 10**-MILES_DECIMALS + 0.005
        assert sum(risk_miles.values()) == pytest.approx(route_body["distance_miles"], abs=slack)
