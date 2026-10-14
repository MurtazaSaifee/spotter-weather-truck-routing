"""The forecast at each checkpoint, through the plan API, with Open-Meteo answered by a recorded
response (tests/fixtures/weather/).

The routes are small straight ones (see ``straight_route``), so each checkpoint's ETA is known
to the minute and the weather it should read can be worked out by hand.
"""

import logging
import threading
import time
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs

import httpx
import pytest
import time_machine

from api import weather
from tests.test_checkpoints import DEPARTURE, NOW, answer_with, straight_route

PLAN_URL = "/api/plan"

# Where a straight route from 40.0N 90.0W ends up, 100 miles north. Only the end points matter
# for the request; the route in between is a straight line.
START = {"label": "Start", "lat": 40.0, "lng": -90.0}
END = {"label": "End", "lat": 41.45, "lng": -90.0}
HUNDRED_MILES_M = 160_934.4
# 13:00 GMT on the departure day: the hour the first checkpoint leaves at.
FIRST_HOUR = datetime(2026, 10, 15, 13, tzinfo=UTC)


@pytest.fixture(autouse=True)
def now():
    with time_machine.travel(NOW, tick=False) as traveller:
        yield traveller


def post_plan(client, **overrides):
    body = {
        "origin": START,
        "destination": END,
        "departure": DEPARTURE,
        "load_weight_lb": 30_000,
        "interval_miles": 25,
        **overrides,
    }
    return client.post(PLAN_URL, body, content_type="application/json")


def hundred_mile_route(outbound_http, duration_s=6_000):
    """A route whose 25-mile checkpoints are 1,500 s apart, leaving at 13:00 GMT: 13:00, 13:25,
    13:50, 14:15 and 14:40."""
    answer_with(outbound_http, straight_route((HUNDRED_MILES_M, duration_s)))


def weather_of(response):
    (route,) = response.json()["routes"]
    return [checkpoint["weather"] for checkpoint in route["checkpoints"]]


def mark_hours(open_meteo):
    """Give each variable a different value in each of the hours 13:00 to 15:00 GMT, so
    the weather a checkpoint reports says which hour it came from."""
    hours = ["2026-10-15T13:00", "2026-10-15T14:00", "2026-10-15T15:00"]
    open_meteo.edit("wind_speed_10m", dict(zip(hours, [13.0, 14.0, 15.0], strict=True)))
    open_meteo.edit("wind_gusts_10m", dict(zip(hours, [23.0, 24.0, 25.0], strict=True)))
    open_meteo.edit("rain", dict(zip(hours, [0.013, 0.014, 0.015], strict=True)))
    open_meteo.edit("showers", dict(zip(hours, [0.1, 0.2, 0.3], strict=True)))
    open_meteo.edit("snowfall", dict(zip(hours, [0.4, 0.5, 0.6], strict=True)))


# --- Which hour a checkpoint reads -----------------------------------------------------


def test_sustained_wind_is_the_nearest_hour_and_the_rest_the_hour_ending_after_the_eta(
    client, outbound_http, open_meteo
):
    mark_hours(open_meteo)
    hundred_mile_route(outbound_http)

    response = post_plan(client)

    assert response.status_code == 200
    # ETA 13:00 sharp: wind is the 13:00 reading, and the 13:00 value (covering 12:00 to 13:00)
    #   is the bucket the ETA falls at the end of.
    # ETA 13:25: wind 13:00 (nearest); the bucket ending 14:00.
    # ETA 13:50: wind 14:00 (nearest); the same bucket, ending 14:00.
    # ETA 14:15: wind 14:00; the bucket ending 15:00.
    # ETA 14:40: wind 15:00; the same bucket, ending 15:00.
    assert [(w["wind_mph"], w["gust_mph"]) for w in weather_of(response)] == [
        (13.0, 23.0),
        (13.0, 24.0),
        (14.0, 24.0),
        (14.0, 25.0),
        (15.0, 25.0),
    ]


def test_rain_rate_is_rain_plus_showers_and_snowfall_is_inches_per_hour(
    client, outbound_http, open_meteo
):
    mark_hours(open_meteo)
    hundred_mile_route(outbound_http)

    weather = weather_of(post_plan(client))

    # Checkpoint 2 reads the bucket ending 14:00: rain 0.014 + showers 0.2, snowfall 0.5.
    assert weather[2]["rain_in_hr"] == 0.214
    assert weather[2]["snow_in_hr"] == 0.5


# --- Missing values ------------------------------------------------------------------------


def test_a_missing_value_falls_back_to_the_neighbouring_hour_nearer_the_eta(
    client, outbound_http, open_meteo
):
    mark_hours(open_meteo)
    # Checkpoint 1 is at 13:25. Its wind is the 13:00 reading, its gust the bucket ending 14:00;
    # knock both out. Wind's nearer neighbour is 14:00 (13:25 is 35 minutes from it, 85 from
    # 12:00). The gust bucket's nearer neighbour is the one ending 13:00 (13:25 is 25 minutes
    # after it, and 35 before the next bucket starts).
    open_meteo.edit("wind_speed_10m", {"2026-10-15T13:00": None})
    open_meteo.edit("wind_gusts_10m", {"2026-10-15T14:00": None})
    hundred_mile_route(outbound_http)

    second = weather_of(post_plan(client))[1]

    assert second["wind_mph"] == 14.0
    assert second["gust_mph"] == 23.0


def knock_out(open_meteo, variable, hours=(13, 14, 15)):
    open_meteo.edit(variable, {f"2026-10-15T{hour}:00": None for hour in hours})


def test_sustained_wind_missing_in_its_hour_and_both_neighbours_is_no_data(
    client, outbound_http, open_meteo
):
    mark_hours(open_meteo)
    # Checkpoints 2 (13:50) and 3 (14:15) read the 14:00 wind, and 13:00 and 15:00 are gone
    # too. The others can still reach 12:00 or 16:00.
    knock_out(open_meteo, "wind_speed_10m")
    hundred_mile_route(outbound_http)

    weather = weather_of(post_plan(client))

    assert [w is None for w in weather] == [False, False, True, True, False]


@pytest.mark.parametrize("variable", ["rain", "showers", "snowfall"])
def test_rain_or_snow_missing_in_its_bucket_and_both_neighbours_is_no_data(
    client, outbound_http, open_meteo, variable
):
    mark_hours(open_meteo)
    # Checkpoints 1 (13:25) and 2 (13:50) read the bucket ending 14:00, and the buckets ending
    # 13:00 and 15:00 are gone too. The others can still reach 12:00 or 16:00.
    knock_out(open_meteo, variable)
    hundred_mile_route(outbound_http)

    weather = weather_of(post_plan(client))

    assert [w is None for w in weather] == [False, True, True, False, False]


def test_a_missing_gust_alone_does_not_make_a_checkpoint_no_data(client, outbound_http, open_meteo):
    mark_hours(open_meteo)
    knock_out(open_meteo, "wind_gusts_10m")
    hundred_mile_route(outbound_http)

    weather = weather_of(post_plan(client))

    # Checkpoints 1 and 2 have no gust to read, and keep everything else.
    assert [w["gust_mph"] is None for w in weather] == [False, True, True, False, False]
    assert [w["wind_mph"] for w in weather] == [13.0, 13.0, 14.0, 14.0, 15.0]


# --- What Open-Meteo is asked ------------------------------------------------------------


def test_open_meteo_is_asked_by_form_post_for_the_five_variables_in_us_units(
    client, outbound_http, open_meteo
):
    hundred_mile_route(outbound_http)

    post_plan(client)

    # The checkpoints' request, and the heatmap's head start beside it: both are asked the same.
    assert len(open_meteo.route.calls) == 2
    for call in open_meteo.route.calls:
        assert call.request.headers["content-type"] == "application/x-www-form-urlencoded"
    for form in open_meteo.requests:
        assert form["hourly"] == ["wind_speed_10m,wind_gusts_10m,rain,showers,snowfall"]
        assert form["wind_speed_unit"] == ["mph"]
        assert form["precipitation_unit"] == ["inch"]
        assert form["timezone"] == ["GMT"]
        assert "models" not in form  # The default model.
        # The same window whatever the trip needs: today (GMT) and the days after, 192 hours.
        assert form["forecast_days"] == ["8"]
        assert "start_date" not in form


CHECKPOINT_LATITUDES = ["40.00,40.35,40.70,41.10,41.45"]


def test_each_checkpoint_is_looked_up_at_its_nearest_point_on_the_0_05_degree_lattice(
    client, outbound_http, open_meteo
):
    hundred_mile_route(outbound_http)

    post_plan(client)

    # The five checkpoints are at 40.0, 40.3618, 40.7237, 41.0855 and 41.4473 N, all at 90.0 W.
    (form,) = [form for form in open_meteo.requests if form["latitude"] == CHECKPOINT_LATITUDES]
    assert form["longitude"] == ["-90.00,-90.00,-90.00,-90.00,-90.00"]


def test_places_on_the_same_lattice_point_are_looked_up_once(open_meteo):
    cell = [(40.0, -90.0), (40.01, -90.01), (39.98, -89.98), (40.024, -90.024), (40.0, -90.0)]

    forecast = weather.load_forecast(cell, [datetime(2026, 10, 15, 13, tzinfo=UTC)])

    assert open_meteo.locations_requested() == [1]
    assert forecast.conditions_at(cell[0], FIRST_HOUR) == forecast.conditions_at(
        cell[3], FIRST_HOUR
    )


def test_a_thousand_locations_go_in_one_request_and_more_are_split(open_meteo):
    # 1,500 distinct lattice points: 50 rows of 30, 0.05 degrees apart.
    grid = [(30.0 + 0.05 * (i // 30), -100.0 + 0.05 * (i % 30)) for i in range(1_500)]

    weather.load_forecast(grid, [FIRST_HOUR])

    assert open_meteo.locations_requested() == [1_000, 500]


# --- Forecasts are cached ------------------------------------------------------------------


def test_a_forecast_is_fetched_once_and_then_served_from_the_cache(open_meteo):
    grid = [(30.0 + 0.05 * (i // 30), -100.0 + 0.05 * (i % 30)) for i in range(450)]
    first = weather.load_forecast(grid, [FIRST_HOUR])

    open_meteo.route.side_effect = httpx.ConnectError("Open-Meteo is unreachable")
    second = weather.load_forecast(grid, [FIRST_HOUR])

    # Every point comes back as it was fetched, after being packed into the cache.
    assert [second.conditions_at(point, FIRST_HOUR) for point in grid] == [
        first.conditions_at(point, FIRST_HOUR) for point in grid
    ]
    assert first.conditions_at(grid[0], FIRST_HOUR).wind_mph is not None


def test_only_the_places_not_already_cached_are_fetched(open_meteo):
    weather.load_forecast([(40.0, -90.0), (40.0, -89.95)], [FIRST_HOUR])

    weather.load_forecast([(40.0, -89.95), (40.0, -89.90), (40.0, -89.85)], [FIRST_HOUR])

    assert open_meteo.locations_requested() == [2, 2]
    assert open_meteo.requests[1]["longitude"] == ["-89.90,-89.85"]


def test_a_forecast_is_good_for_an_hour(open_meteo, now):
    weather.load_forecast([(40.0, -90.0)], [FIRST_HOUR])

    now.shift(timedelta(minutes=59))
    weather.load_forecast([(40.0, -90.0)], [FIRST_HOUR])
    assert open_meteo.locations_requested() == [1]

    now.shift(timedelta(minutes=2))
    weather.load_forecast([(40.0, -90.0)], [FIRST_HOUR])
    assert open_meteo.locations_requested() == [1, 1]


def test_a_cached_forecast_that_does_not_reach_the_times_needed_is_fetched_again(open_meteo, now):
    # Cached late on the 14th, when its window (the 14th to the 21st) still reaches Oct 21 23:00.
    now.move_to("2026-10-14T23:50:00Z")
    weather.load_forecast([(40.0, -90.0)], [FIRST_HOUR])

    # Twenty minutes later it is the 15th, and a trip that ends on the 22nd needs more.
    now.move_to("2026-10-15T00:10:00Z")
    weather.load_forecast([(40.0, -90.0)], [datetime(2026, 10, 22, 5, tzinfo=UTC)])

    assert open_meteo.locations_requested() == [1, 1]


def test_a_cached_forecast_is_not_refetched_for_times_even_a_fresh_one_would_not_reach(
    open_meteo,
):
    weather.load_forecast([(40.0, -90.0)], [datetime(2026, 10, 25, 5, tzinfo=UTC)])

    forecast = weather.load_forecast([(40.0, -90.0)], [datetime(2026, 10, 25, 5, tzinfo=UTC)])

    # Today's window is the newest there is: asking again could not do better, so it doesn't.
    assert open_meteo.locations_requested() == [1]
    assert not forecast.conditions_at((40.0, -90.0), datetime(2026, 10, 25, 5, tzinfo=UTC)).complete


def test_a_repeated_plan_succeeds_with_open_meteo_unreachable(client, outbound_http, open_meteo):
    mark_hours(open_meteo)
    hundred_mile_route(outbound_http)
    first = post_plan(client)

    open_meteo.route.side_effect = httpx.ConnectError("Open-Meteo is unreachable")
    second = post_plan(client)

    assert second.status_code == 200
    assert weather_of(second) == weather_of(first)
    assert weather_of(second)[0] is not None


def test_a_failing_cache_backend_still_gives_a_correct_plan(
    client, outbound_http, open_meteo, settings, caplog
):
    settings.CACHES = {"default": {"BACKEND": "tests.failing_cache.BatchFailingCache"}}
    mark_hours(open_meteo)
    hundred_mile_route(outbound_http)

    with caplog.at_level(logging.WARNING):
        response = post_plan(client)

    assert response.status_code == 200
    assert [w["wind_mph"] for w in weather_of(response)] == [13.0, 13.0, 14.0, 14.0, 15.0]
    assert "Weather cache read failed" in caplog.text
    # One failure is logged and the cache is left alone for the rest of the request.
    assert "Weather cache write failed" not in caplog.text


# --- When Open-Meteo fails -----------------------------------------------------------------

OPEN_METEO_FAILURES = {
    "timeout": httpx.ReadTimeout("slow"),
    "connection": httpx.ConnectError("down"),
    "server error": httpx.Response(500, text="Internal Server Error"),
    "bad request": httpx.Response(400, json={"error": True, "reason": "Invalid parameter"}),
    "not JSON": httpx.Response(200, text="<html>Bad gateway</html>"),
    "unexpected shape": httpx.Response(200, json=[{"error": True}] * 5),
    "wrong number of locations": httpx.Response(200, json=[]),
}


@pytest.mark.parametrize("failure", OPEN_METEO_FAILURES.values(), ids=OPEN_METEO_FAILURES.keys())
def test_an_open_meteo_failure_is_weather_unavailable(client, outbound_http, open_meteo, failure):
    hundred_mile_route(outbound_http)
    if isinstance(failure, Exception):
        open_meteo.route.side_effect = failure
    else:
        open_meteo.route.side_effect = None
        open_meteo.route.respond(
            failure.status_code, content=failure.content, headers=failure.headers
        )

    response = post_plan(client)

    assert response.status_code == 503
    assert response.json()["code"] == "weather_unavailable"


def test_a_failed_forecast_is_not_cached(client, outbound_http, open_meteo):
    hundred_mile_route(outbound_http)
    open_meteo.route.side_effect = httpx.ConnectError("down")
    assert post_plan(client).status_code == 503

    open_meteo.answer_normally()

    assert post_plan(client).status_code == 200


def rate_limited(open_meteo, **headers):
    open_meteo.route.side_effect = None
    open_meteo.route.respond(
        429, json={"error": True, "reason": "Too many requests"}, headers=headers
    )


def test_a_429_is_weather_rate_limited_with_the_retry_after_the_provider_gave(
    client, outbound_http, open_meteo
):
    hundred_mile_route(outbound_http)
    rate_limited(open_meteo, **{"Retry-After": "7"})

    response = post_plan(client)

    assert response.status_code == 429
    body = response.json()
    assert body["code"] == "weather_rate_limited"
    assert body["details"] == {"retry_after_seconds": 7}


def test_a_retry_after_date_is_converted_to_seconds(client, outbound_http, open_meteo):
    hundred_mile_route(outbound_http)
    rate_limited(open_meteo, **{"Retry-After": "Wed, 14 Oct 2026 15:00:30 GMT"})

    response = post_plan(client)

    assert response.json()["details"] == {"retry_after_seconds": 30}


def test_a_429_without_retry_after_waits_for_the_next_full_minute(
    client, outbound_http, open_meteo, now
):
    hundred_mile_route(outbound_http)
    rate_limited(open_meteo)
    now.move_to("2026-10-14T15:00:20Z")

    response = post_plan(client)

    assert response.status_code == 429
    assert response.json()["details"] == {"retry_after_seconds": 40}


# --- The heatmap's head start ------------------------------------------------------------


def lattice_points_requested(open_meteo):
    return [
        point
        for form in open_meteo.requests
        for point in zip(
            form["latitude"][0].split(","), form["longitude"][0].split(","), strict=True
        )
    ]


def test_the_heatmap_of_a_plan_finds_its_weather_already_loaded(client, outbound_http, open_meteo):
    hundred_mile_route(outbound_http)
    geometries = [route["geometry"] for route in post_plan(client).json()["routes"]]
    requests = len(open_meteo.requests)
    open_meteo.route.side_effect = httpx.ConnectError("down")

    heatmap = client.post(
        "/api/heatmap",
        {"geometries": geometries, "departure": DEPARTURE, "load_weight_lb": 30_000},
        content_type="application/json",
    )

    assert heatmap.status_code == 200
    assert len(open_meteo.requests) == requests


def test_no_place_is_asked_for_twice_while_planning(client, outbound_http, open_meteo):
    hundred_mile_route(outbound_http)

    post_plan(client)

    asked = lattice_points_requested(open_meteo)
    assert len(asked) == len(set(asked))


def test_a_failing_plan_does_not_wait_for_the_heatmap_head_start(client, outbound_http, open_meteo):
    hundred_mile_route(outbound_http)
    corridor_requested = threading.Event()
    release_corridor = threading.Event()

    def respond(request):
        asked = len(parse_qs(request.content.decode())["latitude"][0].split(","))
        if asked > 5:  # the heatmap's head start: slow, and in flight when the plan fails
            corridor_requested.set()
            release_corridor.wait(timeout=10)
            return httpx.Response(429, headers={"Retry-After": "60"})
        corridor_requested.wait(timeout=10)
        return httpx.Response(429, headers={"Retry-After": "7"})

    open_meteo.route.side_effect = respond

    started = time.monotonic()
    response = post_plan(client)
    waited = time.monotonic() - started
    release_corridor.set()

    assert response.status_code == 429
    assert response.json()["details"] == {"retry_after_seconds": 7}
    assert waited < 3


def test_a_plan_is_not_held_back_by_a_heatmap_head_start_that_fails(
    client, outbound_http, open_meteo
):
    hundred_mile_route(outbound_http)
    answer = open_meteo.route.side_effect

    def fail_for_the_corridor(request):
        if len(parse_qs(request.content.decode())["latitude"][0].split(",")) > 5:
            return httpx.Response(429, headers={"Retry-After": "60"})
        return answer(request)

    open_meteo.route.side_effect = fail_for_the_corridor

    response = post_plan(client)

    assert response.status_code == 200
    assert all(weather is not None for weather in weather_of(response))
