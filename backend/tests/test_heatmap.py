"""The trip heatmap, through its API, with Open-Meteo answered by a recorded response.

The heatmap is a function of the route geometries it is given, so the routes here are plain
straight lines. A grid point's place is read back from the response the way the browser does:
``grid.origin`` plus its row and column, which come from the point's index.
"""

import gzip
import json
import random
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs

import httpx
import pytest
import time_machine

from api.geo import encode_polyline, haversine_m
from tests.conftest import OPEN_METEO_URL
from tests.test_checkpoints import DEPARTURE, NOW

HEATMAP_URL = "/api/heatmap"
MILE_M = 1609.344
# 13:00 GMT: the departure above, to the minute.
FIRST_FRAME = datetime(2026, 10, 15, 13, tzinfo=UTC)


@pytest.fixture(autouse=True)
def now():
    with time_machine.travel(NOW, tick=False) as traveller:
        yield traveller


def east_west(lat=40.0, west=-100.0, east=-98.0, vertices=2):
    """A straight line along a parallel, as an encoded polyline."""
    step = (east - west) / (vertices - 1)
    return encode_polyline([(lat, west + step * number) for number in range(vertices)])


def post_heatmap(client, geometries=None, **overrides):
    body = {
        "geometries": [east_west()] if geometries is None else geometries,
        "departure": DEPARTURE,
        "load_weight_lb": 30_000,
        **overrides,
    }
    return client.post(HEATMAP_URL, body, content_type="application/json")


def heatmap(client, geometries=None, **overrides):
    response = post_heatmap(client, geometries, **overrides)
    assert response.status_code == 200, response.content
    return response.json()


def points(body):
    """The ``(lat, lng)`` of every corridor point, from the grid and the indices."""
    grid = body["grid"]
    return [
        (
            round(grid["origin_lat"] + (index // grid["cols"]) * grid["spacing_deg"], 4),
            round(grid["origin_lng"] + (index % grid["cols"]) * grid["spacing_deg"], 4),
        )
        for index in body["indices"]
    ]


# --- Frames ---------------------------------------------------------------------------


def test_there_is_a_frame_for_every_hour_from_the_departure_to_48_hours_later(client):
    body = heatmap(client)

    assert body["timestamps"] == [
        (FIRST_FRAME + timedelta(hours=hour)).isoformat() for hour in range(49)
    ]
    assert len(body["timestamps"]) == 49
    for variable in ("risk", "wind", "rain", "snow"):
        frames = body["frames"][variable]
        assert len(frames) == 49
        assert all(len(frame) == len(body["indices"]) for frame in frames)


def test_a_departure_is_taken_to_the_minute(client):
    body = heatmap(client, departure="2026-10-15T08:00:41-05:00")

    assert body["timestamps"][0] == FIRST_FRAME.isoformat()


def test_frames_hold_the_forecast_and_the_risk_of_each_point_as_scaled_integers(client, open_meteo):
    # Frame 24 is 13:00 GMT on the 16th. Sustained wind is read at the nearest hour, the rest
    # from the bucket ending at the first whole hour: both are 13:00 here.
    hour = {"2026-10-16T13:00": 40.0}
    open_meteo.edit("wind_speed_10m", hour)
    open_meteo.edit("rain", {"2026-10-16T13:00": 0.3})
    open_meteo.edit("showers", {"2026-10-16T13:00": 0.0})
    open_meteo.edit("snowfall", {"2026-10-16T13:00": 0.55})

    body = heatmap(client, load_weight_lb=30_000)

    count = len(body["indices"])
    assert body["frames"]["wind"][24] == [400] * count  # tenths of a mile per hour
    assert body["frames"]["rain"][24] == [300] * count  # thousandths of an inch per hour
    assert body["frames"]["snow"][24] == [550] * count
    # 40 mph is High, 0.3 in/hr of rain is High, 0.55 in/hr of snow is Moderate: High, 2.
    assert body["frames"]["risk"][24] == [2] * count
    assert body["scales"] == {"wind": 10, "rain": 1000, "snow": 1000}


def test_the_load_weight_raises_the_risk_of_wind(client, open_meteo):
    open_meteo.edit("wind_speed_10m", {"2026-10-16T13:00": 40.0})
    open_meteo.edit("rain", {"2026-10-16T13:00": 0.0})
    open_meteo.edit("showers", {"2026-10-16T13:00": 0.0})
    open_meteo.edit("snowfall", {"2026-10-16T13:00": 0.0})

    light = heatmap(client, load_weight_lb=40_000)["frames"]["risk"][24]
    heavy = heatmap(client, load_weight_lb=40_001)["frames"]["risk"][24]

    assert set(light) == {2}  # High
    assert set(heavy) == {3}  # 35-44 mph above 40,000 lb is Severe


def test_the_combined_conditions_bonus_is_left_out_of_the_risk(client, open_meteo):
    # Moderate wind (30 mph) and Moderate snow (0.6 in/hr): the checkpoint score would be 1.5.
    open_meteo.edit("wind_speed_10m", {"2026-10-16T13:00": 30.0})
    open_meteo.edit("snowfall", {"2026-10-16T13:00": 0.6})
    open_meteo.edit("rain", {"2026-10-16T13:00": 0.0})
    open_meteo.edit("showers", {"2026-10-16T13:00": 0.0})

    body = heatmap(client)

    assert set(body["frames"]["risk"][24]) == {1}


def test_a_point_with_no_forecast_is_marked_missing_never_low(client, open_meteo):
    # Neither the hour nor the ones beside it have snowfall, so there is no snow rate.
    gap = {f"2026-10-16T{hour}:00": None for hour in (12, 13, 14)}
    open_meteo.edit("snowfall", gap)

    body = heatmap(client)

    count = len(body["indices"])
    assert body["frames"]["snow"][24] == [-1] * count
    assert body["frames"]["risk"][24] == [-1] * count
    assert set(body["frames"]["wind"][24]) != {-1}  # wind is still known


# --- Where it comes from ----------------------------------------------------------------


def test_it_is_built_from_the_submitted_geometries_and_never_calls_the_routing_provider(
    client, outbound_http
):
    here = outbound_http.get("https://router.hereapi.com/v8/routes")
    here.respond(500)

    north = heatmap(client, [east_west(lat=40.0)])
    south = heatmap(client, [east_west(lat=30.0)])

    assert not here.called
    assert max(lat for lat, _ in points(south)) < min(lat for lat, _ in points(north))


def test_it_covers_every_displayed_route_and_only_those(client):
    both = heatmap(client, [east_west(lat=40.0), east_west(lat=42.0, west=-99.0, east=-97.0)])

    covered = points(both)
    assert min(lat for lat, _ in covered) < 40.0
    assert max(lat for lat, _ in covered) > 42.0
    assert min(lng for _, lng in covered) < -100.0
    assert max(lng for _, lng in covered) > -97.0


# --- The corridor ---------------------------------------------------------------------


def test_the_corridor_reaches_25_miles_either_side_of_the_route_and_no_further(client):
    # On a route along 40.0N, 0.1 degree grid rows are 6.9 mi apart: the row at 40.3 is 20.7 mi
    # off the route and the row at 40.4 is 27.6 mi off.
    body = heatmap(client, [east_west(lat=40.0)])

    lats = {lat for lat, _ in points(body)}
    assert body["grid"]["spacing_deg"] == 0.1
    assert max(lats) == 40.3
    assert min(lats) == 39.7


def test_every_point_of_the_corridor_is_within_25_miles_of_the_route(client):
    route = [(40.0, -100.0 + 0.01 * step) for step in range(201)]
    body = heatmap(client, [encode_polyline(route)])

    for point in points(body):
        assert min(haversine_m(point, vertex) for vertex in route) <= 25 * MILE_M + 1_000


# --- The resolution -------------------------------------------------------------------


def test_a_short_trip_gets_the_finest_grid_allowed_not_a_finer_one(client):
    body = heatmap(client, [east_west(west=-100.0, east=-99.8)])

    assert body["grid"]["spacing_deg"] == 0.1
    assert len(body["indices"]) < 500


def corridor_size(route, spacing_deg):
    """How many points of a grid of this spacing lie within 25 miles of the route, counted
    by brute force over the route's own vertices (many, so a vertex is always close)."""
    step = round(spacing_deg * 20)
    lats = [lat for lat, _ in route]
    lngs = [lng for _, lng in route]
    pad = 0.5
    count = 0
    for north in range(
        int((min(lats) - pad) * 20) // step * step, int((max(lats) + pad) * 20), step
    ):
        for east in range(
            int((min(lngs) - pad) * 20) // step * step, int((max(lngs) + pad) * 20), step
        ):
            point = (north / 20, east / 20)
            if min(haversine_m(point, vertex) for vertex in route) <= 25 * MILE_M:
                count += 1
    return count


def test_a_long_trip_gets_the_finest_grid_that_keeps_the_corridor_to_500_points(client):
    route = [(40.0, -110.0 + 0.02 * step) for step in range(401)]  # 8 degrees: about 420 mi
    body = heatmap(client, [encode_polyline(route)])

    spacing = body["grid"]["spacing_deg"]
    assert spacing > 0.1
    assert round(spacing * 20) / 20 == spacing  # a multiple of 0.05
    assert len(body["indices"]) <= 500
    # One notch finer would have gone over the budget.
    assert corridor_size(route, spacing - 0.05) > 500


def test_the_weather_of_the_whole_corridor_is_one_provider_request(client, open_meteo):
    route = [(40.0, -110.0 + 0.02 * step) for step in range(401)]

    body = heatmap(client, [encode_polyline(route)])

    assert open_meteo.locations_requested() == [len(body["indices"])]


def test_a_repeated_heatmap_is_answered_from_the_cache(client, open_meteo):
    heatmap(client)
    requests = len(open_meteo.requests)
    open_meteo.route.side_effect = httpx.ConnectError("down")

    again = post_heatmap(client)

    assert again.status_code == 200
    assert len(open_meteo.requests) == requests


# --- The payload ----------------------------------------------------------------------


def test_the_largest_corridor_stays_under_150_kb_compressed(client, outbound_http, open_meteo):
    """A corridor of nearly 500 points with stormy, noisy weather everywhere, hour by hour:
    the worst case for compression."""
    rng = random.Random(7)

    def answer(request):
        count = len(parse_qs(request.content.decode())["latitude"][0].split(","))
        times = [
            (datetime(2026, 10, 14, tzinfo=UTC) + timedelta(hours=hour)).strftime("%Y-%m-%dT%H:%M")
            for hour in range(192)
        ]
        results = [
            {
                "hourly": {
                    "time": times,
                    "wind_speed_10m": [round(rng.uniform(0, 60), 1) for _ in times],
                    "wind_gusts_10m": [round(rng.uniform(0, 80), 1) for _ in times],
                    "rain": [round(rng.uniform(0, 1.2), 3) for _ in times],
                    "showers": [round(rng.uniform(0, 0.3), 3) for _ in times],
                    "snowfall": [round(rng.uniform(0, 3.5), 3) for _ in times],
                }
            }
            for _ in range(count)
        ]
        return httpx.Response(200, json=results)

    outbound_http.post(OPEN_METEO_URL).side_effect = answer
    # The corridor of this 1,500 mile line is coarse enough to stay near the cap.
    route = [(40.0, -120.0 + 0.1 * step) for step in range(0, 400)]
    response = post_heatmap(client, [encode_polyline(route)])

    assert response.status_code == 200
    body = response.json()
    assert 400 <= len(body["indices"]) <= 500
    assert len(gzip.compress(json.dumps(body).encode())) < 150 * 1024


# --- Validation -----------------------------------------------------------------------


def error_of(response, field=None):
    assert response.status_code == 400, response.content
    body = response.json()
    assert body["code"] == "validation_error"
    if field:
        assert field in body["details"]["fields"]
    return body


def test_it_takes_one_to_three_geometries(client):
    error_of(post_heatmap(client, []), "geometries")
    error_of(post_heatmap(client, [east_west(lat=40.0 + n) for n in range(4)]), "geometries")
    assert post_heatmap(client, [east_west(lat=40.0 + n) for n in range(3)]).status_code == 200


def test_a_geometry_that_is_not_a_polyline_is_refused(client):
    error_of(post_heatmap(client, ["not a polyline!"]), "geometries")
    error_of(post_heatmap(client, [east_west()[:-3]]), "geometries")


def test_a_geometry_needs_at_least_two_vertices(client):
    error_of(post_heatmap(client, [encode_polyline([(40.0, -100.0)])]), "geometries")


def test_a_geometry_on_another_continent_is_accepted(client):
    london_to_paris = encode_polyline([(51.51, -0.13), (48.86, 2.35)])

    body = heatmap(client, [london_to_paris])

    # The grid's south west corner lies just beyond Paris, the route's southern end, and London.
    assert body["grid"]["origin_lat"] == pytest.approx(48.86, abs=0.5)
    assert body["grid"]["origin_lng"] == pytest.approx(-0.13, abs=1.0)
    assert body["indices"]


def test_a_geometry_with_coordinates_that_are_not_on_earth_is_refused(client):
    error_of(post_heatmap(client, [encode_polyline([(40.0, -100.0), (95.0, -99.0)])]), "geometries")
    error_of(post_heatmap(client, [encode_polyline([(40.0, -100.0), (41.0, 181.0)])]), "geometries")


def test_a_geometry_with_too_many_vertices_is_refused(client):
    huge = encode_polyline([(40.0 + 0.00001 * n, -100.0) for n in range(6_000)])

    error_of(post_heatmap(client, [huge]), "geometries")


def test_the_departure_must_be_in_the_planning_window(client):
    error_of(post_heatmap(client, departure="2026-10-14T08:00:00-05:00"), "departure")  # 2 h ago
    error_of(post_heatmap(client, departure="2026-10-17T09:00:00-05:00"), "departure")
    error_of(post_heatmap(client, departure="2026-10-15T08:00:00"), "departure")


def test_the_heatmap_still_takes_a_departure_the_plan_accepted_up_to_an_hour_ago(client):
    # The plan takes 15 minutes of grace; the browser sends its departure again later, after a
    # rate-limit wait or a long-open page, and must not be refused for the delay.
    def minutes_from_now(minutes):
        return (datetime.fromisoformat(NOW) + timedelta(minutes=minutes)).isoformat()

    assert post_heatmap(client, departure=minutes_from_now(-60)).status_code == 200
    assert post_heatmap(client, departure=minutes_from_now(48 * 60)).status_code == 200
    late = post_heatmap(client, departure=minutes_from_now(-61))
    error_of(late, "departure")
    assert "1 hour ago" in late.json()["details"]["fields"]["departure"][0]
    error_of(post_heatmap(client, departure=minutes_from_now(48 * 60 + 1)), "departure")


def test_the_load_weight_must_be_positive_and_at_most_50000_lb(client):
    error_of(post_heatmap(client, load_weight_lb=0), "load_weight_lb")
    error_of(post_heatmap(client, load_weight_lb=50_001), "load_weight_lb")


# --- Failures --------------------------------------------------------------------------


def test_a_rate_limited_weather_service_gives_a_retryable_error(client, open_meteo):
    open_meteo.route.side_effect = None
    open_meteo.route.respond(429, headers={"Retry-After": "17"})

    response = post_heatmap(client)

    assert response.status_code == 429
    assert response.json()["code"] == "weather_rate_limited"
    assert response.json()["details"] == {"retry_after_seconds": 17}


def test_an_unavailable_weather_service_gives_weather_unavailable(client, open_meteo):
    open_meteo.route.side_effect = httpx.ConnectError("down")

    response = post_heatmap(client)

    assert response.status_code == 503
    assert response.json()["code"] == "weather_unavailable"
