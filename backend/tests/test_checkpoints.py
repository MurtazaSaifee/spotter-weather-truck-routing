"""Checkpoints, their ETAs and the sampling interval, through the plan API.

Routes are either the recorded Chicago to Dallas answer from HERE (tests/fixtures/routing/)
or small straight routes built here, whose positions and times can be worked out by hand.
"""

import math
from datetime import datetime

import flexpolyline
import httpx
import pytest
import time_machine
from django.core.cache import cache

from api.geo import decode_polyline

HERE_ROUTES_URL = "https://router.hereapi.com/v8/routes"
PLAN_URL = "/api/plan"

NOW = "2026-10-14T15:00:00Z"
DEPARTURE = "2026-10-15T08:00:00-05:00"

CHICAGO = {"label": "Chicago, IL, United States", "lat": 41.88425, "lng": -87.63245}
DALLAS = {"label": "Dallas, TX, United States", "lat": 32.77657, "lng": -96.79699}

METRES_PER_MILE = 1609.344
# One degree of latitude along a meridian, on the sphere the app measures distance on.
METRES_PER_DEGREE = math.pi * 6_371_008.8 / 180


@pytest.fixture(autouse=True)
def _frozen_now():
    with time_machine.travel(NOW, tick=False):
        yield


@pytest.fixture
def here(outbound_http, load_fixture):
    route = outbound_http.get(HERE_ROUTES_URL)
    route.respond(json=load_fixture("routing/here_chicago_dallas_truck.json"))
    return route


def straight_route(*spans, geometry_scale=1.0):
    """A HERE answer for one route running due north from 40.0N 90.0W.

    Each span is ``(length_m, duration_s)`` or ``(length_m, duration_s, segments)``: how far
    the span goes, how long it takes, and how many line segments its polyline has. The
    polyline covers ``geometry_scale`` times each span's length.
    """
    points = [(40.0, -90.0)]
    offsets = []
    for length_m, _duration_s, *rest in spans:
        segments = rest[0] if rest else 4
        offsets.append(len(points) - 1)
        step = length_m * geometry_scale / METRES_PER_DEGREE / segments
        for _ in range(segments):
            points.append((points[-1][0] + step, -90.0))
    return {
        "id": "straight",
        "sections": [
            {
                "summary": {
                    "length": sum(s[0] for s in spans),
                    "duration": sum(s[1] for s in spans),
                },
                "spans": [
                    {"offset": offset, "length": length_m, "duration": duration_s}
                    for offset, (length_m, duration_s, *_) in zip(offsets, spans, strict=True)
                ],
                "polyline": flexpolyline.encode(points),
            }
        ],
    }


def answer_with(outbound_http, *routes):
    """Make HERE answer with just ``routes``."""
    outbound_http.get(HERE_ROUTES_URL).respond(json={"routes": list(routes)})


def trip(**overrides):
    body = {
        "origin": CHICAGO,
        "destination": DALLAS,
        "departure": DEPARTURE,
        "load_weight_lb": 42_000,
    }
    return {**body, **overrides}


def post_plan(client, body):
    return client.post(PLAN_URL, body, content_type="application/json")


def plan(client, **overrides):
    response = post_plan(client, trip(**overrides))
    assert response.status_code == 200
    return response.json()


def miles(route):
    return [checkpoint["mile"] for checkpoint in route["checkpoints"]]


def seconds_after_departure(iso):
    return (datetime.fromisoformat(iso) - datetime.fromisoformat(DEPARTURE)).total_seconds()


# --- The sampling interval ------------------------------------------------------------


def test_a_plan_reports_the_interval_it_chose_automatically(client, here):
    body = plan(client)

    # The shortest of the three routes is 926.83 mi.
    assert body["interval_miles"] == 25
    assert body["interval_automatic"] is True


@pytest.mark.parametrize(
    ("length_m", "interval"),
    [
        (80_467, 10),  # 50 mi
        (482_803, 10),  # 299.9998 mi: just under 300
        (482_804, 25),  # 300.0004 mi
        (1_609_344, 25),  # exactly 1,000 mi stays in the middle tier
        (1_609_345, 50),  # just over
        (4_000_000, 50),
    ],
)
def test_the_interval_follows_the_length_of_the_trip(client, outbound_http, length_m, interval):
    answer_with(outbound_http, straight_route((length_m, 3_600 * 10)))

    body = plan(client)

    assert body["interval_miles"] == interval
    assert body["interval_automatic"] is True


def test_every_route_uses_the_interval_of_the_shortest_one(client, outbound_http):
    longer = straight_route((600_000, 30_000))  # 373 mi on its own: 25 mi
    shorter = straight_route((400_000, 20_000))  # 249 mi: 10 mi
    answer_with(outbound_http, longer, shorter)

    body = plan(client)

    assert body["interval_miles"] == 10
    for route in body["routes"]:
        assert miles(route)[:3] == pytest.approx([0, 10, 20])


@pytest.mark.parametrize("interval", [10, 25, 50])
def test_the_driver_can_override_the_interval(client, here, interval):
    body = plan(client, interval_miles=interval)

    assert body["interval_miles"] == interval
    assert body["interval_automatic"] is False
    for route in body["routes"]:
        assert miles(route)[:3] == pytest.approx([0, interval, 2 * interval])


@pytest.mark.parametrize("interval", [0, 5, 30, "fast", None])
def test_other_intervals_are_rejected_and_never_reach_here(client, here, interval):
    response = post_plan(client, trip(interval_miles=interval))

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "validation_error"
    assert "interval_miles" in body["details"]["fields"]
    assert not here.called


def test_changing_the_interval_succeeds_with_here_unreachable(client, here, outbound_http):
    auto = plan(client)
    outbound_http.get(HERE_ROUTES_URL).mock(side_effect=httpx.ConnectError("down"))

    finer = post_plan(client, trip(interval_miles=10))

    assert finer.status_code == 200
    assert finer.json()["interval_miles"] == 10
    assert len(finer.json()["routes"][0]["checkpoints"]) > len(auto["routes"][0]["checkpoints"])
    assert here.call_count == 1


# --- Checkpoint placement -------------------------------------------------------------


def test_checkpoints_sit_at_the_origin_every_interval_and_the_destination(client, here):
    # Routes are fastest first; the 926.83 mi route is the second.
    route = plan(client)["routes"][1]

    # 926.83 mi at 25 mi: mile 0, 25 ... 925, then the destination.
    expected = [*range(0, 926, 25), 926.83]
    assert miles(route) == pytest.approx(expected, abs=0.001)


def test_a_short_final_gap_is_kept_as_it_is(client, outbound_http):
    answer_with(outbound_http, straight_route((150_000, 7_200)))  # 93.2 mi at 10 mi

    route = plan(client)["routes"][0]

    assert miles(route) == pytest.approx([*range(0, 91, 10), 93.206], abs=0.001)


def test_no_extra_checkpoint_when_the_route_ends_on_an_interval(client, outbound_http):
    answer_with(outbound_http, straight_route((804_672, 36_000), (804_672, 36_000)))

    route = plan(client, interval_miles=50)["routes"][0]

    assert miles(route) == pytest.approx(list(range(0, 1001, 50)))


def test_checkpoints_are_placed_along_the_route(client, outbound_http):
    answer_with(outbound_http, straight_route((150_000, 7_200, 10)))

    route = plan(client)["routes"][0]

    for checkpoint in route["checkpoints"]:
        expected_lat = 40.0 + checkpoint["mile"] * METRES_PER_MILE / METRES_PER_DEGREE
        assert checkpoint["lat"] == pytest.approx(expected_lat, abs=3e-5)
        assert checkpoint["lng"] == pytest.approx(-90.0, abs=1e-5)


def test_a_position_inside_a_span_follows_the_spans_length_not_the_geometrys(client, outbound_http):
    # The span says 100 km but its polyline is only 50 km long, so a position a fraction of
    # the way along the span is the same fraction of the way along the polyline.
    answer_with(outbound_http, straight_route((100_000, 5_000), geometry_scale=0.5))

    route = plan(client)["routes"][0]

    tenth = route["checkpoints"][1]  # at mile 10
    fraction = 10 * METRES_PER_MILE / 100_000
    assert tenth["lat"] == pytest.approx(40.0 + fraction * 50_000 / METRES_PER_DEGREE, abs=3e-5)
    assert route["checkpoints"][-1]["lat"] == pytest.approx(
        40.0 + 50_000 / METRES_PER_DEGREE, abs=3e-5
    )


def test_the_first_and_last_checkpoints_are_the_origin_and_the_destination(client, here):
    for route in plan(client)["routes"]:
        first, last = route["checkpoints"][0], route["checkpoints"][-1]
        assert first["mile"] == 0
        assert (first["lat"], first["lng"]) == pytest.approx((41.88, -87.63), abs=0.05)
        assert last["mile"] == pytest.approx(route["distance_miles"], abs=0.01)  # rounded to 0.01
        assert (last["lat"], last["lng"]) == pytest.approx((32.78, -96.80), abs=0.05)


# --- ETAs -----------------------------------------------------------------------------


def test_etas_follow_the_speed_of_each_span(client, outbound_http):
    # 80 km in one hour, then 120 km in four: a truck at 80 km/h and then 30 km/h.
    answer_with(outbound_http, straight_route((80_000, 3_600), (120_000, 14_400, 6)))

    route = plan(client)["routes"][0]

    by_mile = {c["mile"]: c for c in route["checkpoints"]}
    assert seconds_after_departure(by_mile[0]["eta"]) == 0
    # Mile 10 is 16,093.44 m in, inside the first span: 16,093.44 / 80,000 x 3,600 s.
    assert seconds_after_departure(by_mile[10]["eta"]) == pytest.approx(724.2, abs=1)
    # Mile 60 is 96,560.64 m in: all of span one, then 16,560.64 m of the 120,000 m span two.
    assert seconds_after_departure(by_mile[60]["eta"]) == pytest.approx(5_587.3, abs=1)
    assert seconds_after_departure(route["checkpoints"][-1]["eta"]) == 18_000


def test_etas_are_in_the_origin_time_zone_and_end_at_the_arrival(client, here):
    for route in plan(client)["routes"]:
        assert route["checkpoints"][0]["eta"] == "2026-10-15T08:00:00-05:00"
        assert route["checkpoints"][-1]["eta"] == route["arrival"]


def test_a_slow_span_delays_every_later_checkpoint(client, outbound_http, load_fixture):
    payload = load_fixture("routing/here_chicago_dallas_truck.json")
    # One route, so slowing it down can not change which route comes first.
    payload["routes"] = payload["routes"][:1]
    baseline_route = plan_with(client, outbound_http, payload)["routes"][0]

    # An hour of standstill in the span that is around the middle of the first route.
    section = payload["routes"][0]["sections"][0]
    start = 0
    for span in section["spans"]:
        if start + span["length"] > section["summary"]["length"] / 2:
            break
        start += span["length"]
    end = start + span["length"]
    span["duration"] += 3_600
    section["summary"]["duration"] += 3_600
    slow_route = plan_with(client, outbound_http, payload)["routes"][0]

    delays = [
        (
            c["mile"] * METRES_PER_MILE,
            seconds_after_departure(slow["eta"]) - seconds_after_departure(c["eta"]),
        )
        for c, slow in zip(baseline_route["checkpoints"], slow_route["checkpoints"], strict=True)
    ]
    before = [delay for position, delay in delays if position < start - 5]
    after = [delay for position, delay in delays if position > end + 5]
    assert len(before) > 5
    assert len(after) > 5
    assert set(before) == {0}
    assert set(after) == {3_600}
    assert slow_route["duration_seconds"] == baseline_route["duration_seconds"] + 3_600


def plan_with(client, outbound_http, payload):
    """Plan once HERE answers ``payload``, forgetting any routes cached from before."""
    cache.clear()
    outbound_http.get(HERE_ROUTES_URL).respond(json=payload)
    return plan(client)


# --- Covered miles --------------------------------------------------------------------


def test_covered_miles_split_each_gap_between_its_two_checkpoints(client, outbound_http):
    answer_with(outbound_http, straight_route((150_000, 7_200)))  # 93.2 mi at 10 mi

    covered = [c["covered_miles"] for c in plan(client)["routes"][0]["checkpoints"]]

    # The ends cover only the half-gap inside the route; the last gap is 3.206 mi.
    assert covered[0] == pytest.approx(5.0, abs=0.001)
    assert covered[1:9] == pytest.approx([10.0] * 8, abs=0.001)
    assert covered[9] == pytest.approx((10 + 3.206) / 2, abs=0.001)
    assert covered[10] == pytest.approx(3.206 / 2, abs=0.001)


def test_covered_miles_add_up_to_the_length_of_every_route(client, here):
    for route in plan(client)["routes"]:
        total = sum(c["covered_miles"] for c in route["checkpoints"])
        assert total == pytest.approx(route["distance_miles"], abs=0.01)


@pytest.mark.parametrize("interval", [10, 25, 50])
def test_covered_miles_add_up_at_every_interval(client, here, interval):
    for route in plan(client, interval_miles=interval)["routes"]:
        total = sum(c["covered_miles"] for c in route["checkpoints"])
        assert total == pytest.approx(route["distance_miles"], abs=0.01)


# --- The elapsed time of each vertex --------------------------------------------------


def test_every_vertex_of_the_geometry_carries_its_elapsed_seconds(client, here):
    for route in plan(client)["routes"]:
        vertices = decode_polyline(route["geometry"])
        elapsed = route["elapsed_seconds"]

        assert len(elapsed) == len(vertices)
        assert elapsed[0] == 0
        assert elapsed[-1] == route["duration_seconds"]
        assert elapsed == sorted(elapsed)
        assert all(isinstance(seconds, int) for seconds in elapsed)


def test_vertex_times_follow_the_speed_of_each_span(client, outbound_http):
    # The road runs north for 40 km, then east for 160 km, in 20 km segments. The turn is a
    # vertex of the simplified line, and it falls halfway through the first (80 km, 1 h) span.
    route = straight_route((80_000, 3_600), (120_000, 14_400, 6))
    turn = (40.0 + 40_000 / METRES_PER_DEGREE, -90.0)
    east_step = 20_000 / (METRES_PER_DEGREE * math.cos(math.radians(turn[0])))
    path = [(40.0, -90.0), (turn[0] - 20_000 / METRES_PER_DEGREE, -90.0), turn]
    path += [(turn[0], -90.0 + east_step * n) for n in range(1, 9)]
    route["sections"][0]["polyline"] = flexpolyline.encode(path)
    answer_with(outbound_http, route)

    planned = plan(client)["routes"][0]

    simplified = decode_polyline(planned["geometry"])
    assert len(simplified) == 3
    for got, want in zip(simplified, [path[0], path[2], path[-1]], strict=True):
        assert got == pytest.approx(want, abs=2e-5)
    assert planned["elapsed_seconds"] == pytest.approx([0, 1_800, 18_000], abs=3)
