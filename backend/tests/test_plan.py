"""Planning a trip through the API, with HERE Routing answered by recorded responses
(tests/fixtures/routing/)."""

import copy
import itertools
import logging
from datetime import datetime, timedelta

import flexpolyline
import httpx
import pytest
import time_machine

from api.geo import decode_polyline, haversine_m

HERE_ROUTES_URL = "https://router.hereapi.com/v8/routes"
PLAN_URL = "/api/plan"

# 10:00 in Chicago, five hours before the recorded departure below.
NOW = "2026-10-14T15:00:00Z"
DEPARTURE = "2026-10-15T08:00:00-05:00"

CHICAGO = {"label": "Chicago, IL, United States", "lat": 41.88425, "lng": -87.63245}
DALLAS = {"label": "Dallas, TX, United States", "lat": 32.77657, "lng": -96.79699}


@pytest.fixture(autouse=True)
def now():
    with time_machine.travel(NOW, tick=False) as traveller:
        yield traveller


@pytest.fixture
def here(outbound_http, load_fixture):
    route = outbound_http.get(HERE_ROUTES_URL)
    route.respond(json=load_fixture("routing/here_chicago_dallas_truck.json"))
    return route


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


def minutes_from_now(minutes):
    return (datetime.fromisoformat(NOW) + timedelta(minutes=minutes)).isoformat()


def here_params(route):
    return route.calls.last.request.url.params


# --- The plan -------------------------------------------------------------------------


def test_a_plan_returns_three_routes_fastest_first_in_the_origin_time_zone(client, here):
    response = post_plan(client, trip())

    assert response.status_code == 200
    body = response.json()
    assert body["origin_time_zone"] == "America/Chicago"
    assert body["departure"] == DEPARTURE
    assert body["notices"] == []
    assert [r["id"] for r in body["routes"]] == ["route-1", "route-2", "route-3"]
    # HERE lists its 53,684 s route before its 53,300 s one; the plan puts the faster first.
    # HERE's summary for the 53,684 s route: 1,491,588 m, arriving 22:54:44 CDT.
    # The three fastest of HERE's seven, none a near-duplicate of another: its 55,538 s route
    # (4th) comes before its 58,366 s one (3rd).
    assert [r["duration_seconds"] for r in body["routes"]] == [53_300, 53_684, 55_538]
    second = body["routes"][1]
    assert second["distance_miles"] == 926.83
    assert second["arrival"] == "2026-10-15T22:54:44-05:00"


def test_each_route_geometry_is_a_simplified_encoded_polyline_between_the_two_places(client, here):
    body = post_plan(client, trip()).json()

    for route in body["routes"]:
        points = decode_polyline(route["geometry"])
        # HERE returns 8,000 to 11,000 vertices per route; a 100 m tolerance keeps a fraction.
        assert 100 < len(points) < 3_000
        assert points[0] == pytest.approx((CHICAGO["lat"], CHICAGO["lng"]), abs=0.001)
        assert points[-1] == pytest.approx((DALLAS["lat"], DALLAS["lng"]), abs=0.001)


def test_the_time_zone_comes_from_the_origin_coordinates_not_from_the_request(client, here):
    denver = {"label": "Denver, CO", "lat": 39.7392, "lng": -104.9903, "time_zone": "Asia/Tokyo"}

    body = post_plan(client, trip(origin=denver)).json()

    assert body["origin_time_zone"] == "America/Denver"
    # The same instant, written in Denver's offset.
    assert body["departure"] == "2026-10-15T07:00:00-06:00"
    assert body["routes"][1]["arrival"] == "2026-10-15T21:54:44-06:00"


# --- The request HERE receives --------------------------------------------------------


def test_here_is_asked_for_truck_routes_with_alternatives_and_fine_grained_spans(client, here):
    post_plan(client, trip())

    params = here_params(here)
    assert params["transportMode"] == "truck"
    assert params["origin"] == "41.88425,-87.63245"
    assert params["destination"] == "32.77657,-96.79699"
    assert params["alternatives"] == "6"
    assert params["return"] == "polyline,summary"
    assert params["spans"] == "dynamicSpeedInfo,length,duration"
    assert params["apiKey"] == "test-here-key"


def test_the_departure_is_sent_to_the_minute_in_utc(client, here):
    post_plan(client, trip(departure="2026-10-15T08:00:42-05:00"))

    assert here_params(here)["departureTime"] == "2026-10-15T13:00:00Z"


@pytest.mark.parametrize(
    ("load_lb", "gross_kg"),
    [
        # (35,000 lb empty truck + load) x 0.45359237 kg/lb, to the whole kilogram.
        (1, "15876"),
        (42_000, "34927"),
        (50_000, "38555"),
    ],
)
def test_the_vehicle_weight_is_the_empty_truck_plus_the_load_in_kilograms(
    client, here, load_lb, gross_kg
):
    post_plan(client, trip(load_weight_lb=load_lb))

    assert here_params(here)["vehicle[grossWeight]"] == gross_kg


# --- Validation -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"origin": DALLAS, "destination": DALLAS}, "destination"),
        (
            {"destination": {**DALLAS, "lat": DALLAS["lat"] + 0.000001}, "origin": DALLAS},
            "destination",
        ),
        ({"origin": {**CHICAGO, "lat": 90.5}}, "origin"),
        ({"destination": {**DALLAS, "lng": -180.5}}, "destination"),
        ({"destination": {"label": "Nowhere"}}, "destination"),
        ({"departure": minutes_from_now(-16)}, "departure"),
        ({"departure": minutes_from_now(48 * 60 + 1)}, "departure"),
        ({"departure": "2026-10-15T08:00:00"}, "departure"),
        ({"departure": "tomorrow morning"}, "departure"),
        ({"load_weight_lb": 0}, "load_weight_lb"),
        ({"load_weight_lb": -1}, "load_weight_lb"),
        ({"load_weight_lb": 50_001}, "load_weight_lb"),
        ({"load_weight_lb": "heavy"}, "load_weight_lb"),
    ],
    ids=[
        "same place",
        "same place to 5 decimals",
        "origin latitude beyond 90",
        "destination longitude beyond -180",
        "destination without coordinates",
        "departure 16 minutes ago",
        "departure just over 48 hours ahead",
        "departure without an offset",
        "departure not a date",
        "zero weight",
        "negative weight",
        "weight over 50,000 lb",
        "weight not a number",
    ],
)
def test_invalid_trips_are_rejected_with_a_message_for_the_field_and_never_reach_here(
    client, here, overrides, field
):
    response = post_plan(client, trip(**overrides))

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "validation_error"
    assert field in body["details"]["fields"]
    assert not here.called


def test_a_trip_on_another_continent_is_accepted(client, here):
    london = {"label": "London, United Kingdom", "lat": 51.5074, "lng": -0.1278}
    paris = {"label": "Paris, France", "lat": 48.8566, "lng": 2.3522}

    response = post_plan(client, trip(origin=london, destination=paris))

    assert response.status_code == 200
    assert response.json()["origin_time_zone"] == "Europe/London"
    assert here_params(here)["origin"] == "51.50740,-0.12780"
    assert here_params(here)["destination"] == "48.85660,2.35220"


@pytest.mark.parametrize(
    "overrides",
    [
        {"departure": minutes_from_now(-15)},
        {"departure": minutes_from_now(48 * 60)},
        {"load_weight_lb": 1},
        {"load_weight_lb": 50_000},
    ],
    ids=[
        "departure exactly 15 minutes ago",
        "departure exactly 48 hours ahead",
        "lightest load",
        "heaviest load",
    ],
)
def test_the_edges_of_the_allowed_ranges_are_accepted(client, here, overrides):
    assert post_plan(client, trip(**overrides)).status_code == 200


def test_validation_messages_say_what_to_fix(client, here):
    body = post_plan(client, trip(load_weight_lb=50_001, departure=minutes_from_now(-20))).json()

    assert body["details"]["fields"] == {
        "departure": ["Departure can't be more than 15 minutes ago."],
        "load_weight_lb": ["Load weight can be at most 50,000 lb."],
    }


def test_several_invalid_fields_are_all_reported_at_once(client, here):
    off_the_map = {**CHICAGO, "lat": 95.0}
    body = post_plan(
        client, trip(origin=off_the_map, departure=minutes_from_now(-60), load_weight_lb=0)
    ).json()

    assert set(body["details"]["fields"]) == {"origin", "departure", "load_weight_lb"}


# --- Three distinct routes ------------------------------------------------------------

# HERE's seven recorded Chicago to Dallas routes last (in HERE's order, by number):
#   1: 53,684 s   2: 53,300 s   3: 58,366 s   4: 55,538 s   5: 58,255 s   6: 59,390 s   7: 61,868 s
# Routes 1, 2 and 3 share almost no road. Route 4 shares about 70% of its miles with route 1.
#
# When a trip has fewer than three distinct routes, detours go through four via-points: 10% and
# 20% of the fastest route's length (route 2, 1,559 km) either side of its midpoint
# (35.69, -90.06), at right angles to the Chicago to Dallas heading (222 degrees). One real
# HERE answer was recorded for each. The names say which side of the heading and how far.
VIA_POINTS = {
    "left_10": (34.754, -88.778),
    "right_10": (36.613, -91.363),
    "left_20": (33.804, -87.530),
    "right_20": (37.522, -92.702),
}
# What those recorded detours take, in seconds. right_20 runs along route 1: a duplicate of it.
DETOUR_SECONDS = {"left_10": 66_371, "right_10": 61_347, "left_20": 76_269, "right_20": 54_976}

NOTICE_CODE = "fewer_than_three_routes"


def main_routes(load_fixture, *numbers):
    """The recorded Chicago to Dallas answer, cut down to HERE's routes with these numbers."""
    payload = load_fixture("routing/here_chicago_dallas_truck.json")
    payload["routes"] = [payload["routes"][number - 1] for number in numbers]
    return payload


def recorded_detours(load_fixture, *labels):
    return {
        label: load_fixture(f"routing/here_chicago_dallas_via_{label}.json")
        for label in labels or VIA_POINTS
    }


def via_label(via):
    """Which recorded via-point a request's ``via`` parameter is (within 5 km)."""
    lat, lng = (float(part) for part in via.split("!")[0].split(","))
    label, nearest = min(
        ((name, haversine_m((lat, lng), point)) for name, point in VIA_POINTS.items()),
        key=lambda pair: pair[1],
    )
    assert nearest < 5_000, f"unexpected via-point {via}"
    return label


def here_answers(outbound_http, main, detours=None):
    """HERE answers the plan request with ``main``. A detour request gets what ``detours`` holds
    for its via-point: a payload (HTTP 200), a status code, or an exception to raise. A detour
    that isn't listed fails with HTTP 500."""
    detours = detours or {}

    def answer(request):
        via = request.url.params.get("via")
        if via is None:
            return httpx.Response(200, json=main)
        outcome = detours.get(via_label(via), 500)
        if isinstance(outcome, Exception):
            raise outcome
        if isinstance(outcome, int):
            return httpx.Response(outcome, json={"error": "failed"})
        return httpx.Response(200, json=outcome)

    route = outbound_http.get(HERE_ROUTES_URL)
    route.mock(side_effect=answer)
    return route


def durations(body):
    return [route["duration_seconds"] for route in body["routes"]]


def variant_of(route, *, shift, share=1.0, extra_seconds=60):
    """A copy of a HERE route that wanders: the middle ``share`` of its miles is moved
    ``shift`` degrees north and ``shift`` degrees west. It is a few seconds slower."""
    variant = copy.deepcopy(route)
    variant["id"] = "variant"
    section = variant["sections"][0]
    section["summary"]["duration"] += extra_seconds
    points = flexpolyline.decode(section["polyline"])
    total = sum(haversine_m(a, b) for a, b in itertools.pairwise(points))
    start = (1 - share) / 2 * total
    moved, travelled = [], 0.0
    for number, (lat, lng) in enumerate(points):
        if number:
            travelled += haversine_m(points[number - 1], (lat, lng))
        wandering = start <= travelled <= start + share * total
        moved.append((lat + shift, lng - shift) if wandering else (lat, lng))
    section["polyline"] = flexpolyline.encode(moved, precision=6)
    return variant


def test_routes_are_offered_fastest_first_whatever_order_here_lists_them(client, here):
    body = post_plan(client, trip()).json()

    assert durations(body) == sorted(durations(body))
    assert [route["id"] for route in body["routes"]] == ["route-1", "route-2", "route-3"]


def test_a_near_duplicate_route_is_merged_rather_than_taking_one_of_the_three_places(
    client, outbound_http, load_fixture
):
    payload = main_routes(load_fixture, 1, 2, 3)
    # Route 1 again, about 140 m away and a minute slower: the same road to anyone driving it.
    payload["routes"].insert(1, variant_of(payload["routes"][0], shift=0.001))
    here = here_answers(outbound_http, payload)

    body = post_plan(client, trip()).json()

    assert durations(body) == [53_300, 53_684, 58_366]
    assert body["notices"] == []
    assert here.call_count == 1  # three distinct routes were enough: no detours


@pytest.mark.parametrize(
    ("shift", "share", "duplicate"),
    [
        (0.002, 1.0, True),  # the whole route about 280 m off: closer than 0.5 km
        (0.015, 1.0, False),  # the whole route about 2 km off
        (0.03, 0.05, True),  # 95% of it is on the other route's road
        (0.03, 0.15, False),  # only 85% is
    ],
    ids=["within 0.5 km", "beyond 0.5 km", "95% shared", "85% shared"],
)
def test_a_route_is_a_near_duplicate_when_90_percent_of_it_lies_within_half_a_km_of_another(
    client, outbound_http, load_fixture, shift, share, duplicate
):
    payload = main_routes(load_fixture, 1, 2)
    payload["routes"].append(variant_of(payload["routes"][0], shift=shift, share=share))
    here_answers(outbound_http, payload)  # every detour fails

    body = post_plan(client, trip()).json()

    assert len(body["routes"]) == (2 if duplicate else 3)
    assert [n["code"] for n in body["notices"]] == ([NOTICE_CODE] if duplicate else [])


def test_detours_go_through_four_pass_through_via_points_either_side_of_the_midpoint(
    client, outbound_http, load_fixture
):
    here = here_answers(outbound_http, main_routes(load_fixture, 2))

    post_plan(client, trip())

    detours = [call.request.url.params for call in here.calls if "via" in call.request.url.params]
    assert len(detours) == 4
    # Each via-point is within 150 m of one of the four expected ones, and all four are used.
    for params in detours:
        assert params["via"].endswith("!passThrough=true")
    assert sorted(via_label(params["via"]) for params in detours) == sorted(VIA_POINTS)
    for params in detours:
        lat, lng = (float(part) for part in params["via"].split("!")[0].split(","))
        assert min(haversine_m((lat, lng), point) for point in VIA_POINTS.values()) < 150
    # The detours are otherwise the same truck, trip and time as the first request.
    (main,) = [
        call.request.url.params for call in here.calls if "via" not in call.request.url.params
    ]
    for params in detours:
        assert params["alternatives"] == "0"
        for name in (
            "transportMode",
            "origin",
            "destination",
            "departureTime",
            "return",
            "spans",
            "vehicle[grossWeight]",
        ):
            assert params[name] == main[name]


def test_detours_fill_the_plan_to_three_routes_and_drop_those_that_repeat_a_kept_route(
    client, outbound_http, load_fixture
):
    here = here_answers(
        outbound_http, main_routes(load_fixture, 1, 2), recorded_detours(load_fixture)
    )

    body = post_plan(client, trip()).json()

    # right_20 (54,976 s) runs along route 1, so the fastest detour that adds a road is
    # right_10.
    assert durations(body) == [53_300, 53_684, DETOUR_SECONDS["right_10"]]
    assert body["notices"] == []
    assert here.call_count == 5


def test_detours_that_repeat_each_other_count_once(client, outbound_http, load_fixture):
    recorded = recorded_detours(load_fixture)
    detours = {"right_20": recorded["right_20"], "right_10": recorded["right_20"]}
    here_answers(outbound_http, main_routes(load_fixture, 2), detours)

    body = post_plan(client, trip()).json()

    assert durations(body) == [53_300, DETOUR_SECONDS["right_20"]]
    assert [n["code"] for n in body["notices"]] == [NOTICE_CODE]


DETOUR_FAILURES = {
    "no route (a via-point in water)": 200,
    "HTTP 400": 400,
    "HTTP 500": 500,
    "timeout": httpx.ReadTimeout("slow"),
    "unreachable": httpx.ConnectError("down"),
}


@pytest.mark.parametrize("failure", DETOUR_FAILURES.values(), ids=DETOUR_FAILURES.keys())
def test_a_failing_via_point_is_dropped_silently_and_the_others_still_fill_the_plan(
    client, outbound_http, load_fixture, caplog, failure
):
    if failure == 200:  # HERE's answer when it can't route: success, but no routes
        failure = load_fixture("routing/here_chicago_havana_truck.json")
    detours = recorded_detours(load_fixture, "right_10", "left_10", "left_20")
    here_answers(outbound_http, main_routes(load_fixture, 2), {**detours, "right_20": failure})

    response = post_plan(client, trip())

    # Without right_20 (54,976 s) the plan takes the next two fastest detours.
    assert response.status_code == 200
    body = response.json()
    assert durations(body) == [53_300, DETOUR_SECONDS["right_10"], DETOUR_SECONDS["left_10"]]
    assert body["notices"] == []
    assert "test-here-key" not in caplog.text


def test_fewer_than_three_distinct_routes_returns_what_exists_with_a_notice(
    client, outbound_http, load_fixture
):
    here_answers(outbound_http, main_routes(load_fixture, 1, 2))  # every detour fails

    response = post_plan(client, trip())

    assert response.status_code == 200
    body = response.json()
    assert durations(body) == [53_300, 53_684]
    assert body["notices"] == [
        {
            "code": NOTICE_CODE,
            "message": "Only 2 distinct routes exist between these places, not three.",
        }
    ]


def test_a_trip_with_a_single_route_says_so(client, outbound_http, load_fixture):
    here_answers(outbound_http, main_routes(load_fixture, 2))

    body = post_plan(client, trip()).json()

    assert durations(body) == [53_300]
    assert body["notices"] == [
        {
            "code": NOTICE_CODE,
            "message": "Only 1 distinct route exists between these places, not three.",
        }
    ]


def test_routes_are_fastest_first_even_when_a_detour_beats_the_routes_found_first(
    client, outbound_http, load_fixture
):
    payload = main_routes(load_fixture, 2, 3)
    payload["routes"][0]["sections"][0]["summary"]["duration"] += 3_000  # 56,300 s
    here_answers(outbound_http, payload, recorded_detours(load_fixture, "right_20", "left_10"))

    body = post_plan(client, trip()).json()

    # right_20 (54,976 s) beats both of HERE's routes, which take 56,300 s and 58,366 s.
    assert durations(body) == [DETOUR_SECONDS["right_20"], 56_300, 58_366]
    assert [route["id"] for route in body["routes"]] == ["route-1", "route-2", "route-3"]


def test_the_final_routes_are_cached_so_detours_are_not_requested_again(
    client, outbound_http, load_fixture
):
    here = here_answers(
        outbound_http, main_routes(load_fixture, 1, 2), recorded_detours(load_fixture)
    )
    first = post_plan(client, trip()).json()
    assert here.call_count == 5

    second = post_plan(client, trip()).json()

    assert here.call_count == 5
    assert second == first


def test_a_fallback_that_found_nothing_new_is_cached_too(client, outbound_http, load_fixture):
    here = here_answers(outbound_http, main_routes(load_fixture, 1, 2))
    post_plan(client, trip())
    assert here.call_count == 5

    body = post_plan(client, trip()).json()

    assert here.call_count == 5
    assert len(body["notices"]) == 1


# --- Provider errors ------------------------------------------------------------------


def test_no_route_is_reported_as_no_route_found(client, outbound_http, load_fixture):
    outbound_http.get(HERE_ROUTES_URL).respond(
        json=load_fixture("routing/here_chicago_havana_truck.json")
    )

    response = post_plan(client, trip())

    assert response.status_code == 422
    assert response.json() == {
        "code": "no_route_found",
        "message": "No truck route was found between these places. "
        "Try a different origin or destination.",
    }


ROUTING_FAILURES = {
    "timeout": {"side_effect": httpx.ReadTimeout("slow")},
    "unreachable": {"side_effect": httpx.ConnectError("down")},
    "HTTP 500": {"return_value": httpx.Response(500, text="boom")},
    "HTTP 401": {"return_value": httpx.Response(401, json={"error": "Unauthorized"})},
    "HTTP 429": {"return_value": httpx.Response(429, json={"error": "Too many requests"})},
    "not JSON": {"return_value": httpx.Response(200, text="<html>")},
    "unexpected shape": {"return_value": httpx.Response(200, json={"routes": [{"id": "x"}]})},
}


@pytest.mark.parametrize("failure", ROUTING_FAILURES.values(), ids=ROUTING_FAILURES.keys())
def test_here_failing_is_reported_as_routing_unavailable(client, outbound_http, failure):
    outbound_http.get(HERE_ROUTES_URL).mock(**failure)

    response = post_plan(client, trip())

    assert response.status_code == 503
    assert response.json() == {
        "code": "routing_unavailable",
        "message": "Route planning is unavailable right now. Please try again.",
    }


def test_the_here_key_never_reaches_the_logs(client, outbound_http, caplog):
    caplog.set_level(logging.DEBUG)
    outbound_http.get(HERE_ROUTES_URL).respond(500)

    post_plan(client, trip())

    assert "test-here-key" not in caplog.text
    assert "HTTP 500" in caplog.text


# --- Caching --------------------------------------------------------------------------


def test_a_plan_succeeds_with_the_cache_down(client, here, outbound_http, settings):
    settings.CACHES = {"default": {"BACKEND": "tests.failing_cache.DeadCache"}}

    response = post_plan(client, trip())

    assert response.status_code == 200
    body = response.json()
    assert len(body["routes"]) == 3
    assert body["recommended_route_id"] is not None


def test_a_repeated_plan_succeeds_with_here_unreachable(client, here, outbound_http):
    first = post_plan(client, trip()).json()
    outbound_http.get(HERE_ROUTES_URL).mock(side_effect=httpx.ConnectError("down"))

    second = post_plan(client, trip())

    assert second.status_code == 200
    assert second.json() == first


def test_trips_that_differ_only_below_the_cache_resolution_share_an_answer(client, here):
    post_plan(client, trip())

    nudged = {**CHICAGO, "lat": CHICAGO["lat"] + 0.000001}
    post_plan(client, trip(origin=nudged, departure="2026-10-15T08:00:59-05:00"))

    assert here.call_count == 1


@pytest.mark.parametrize(
    "overrides",
    [
        {"load_weight_lb": 42_001},
        {"departure": "2026-10-15T08:01:00-05:00"},
        {"origin": {**CHICAGO, "lat": CHICAGO["lat"] + 0.00001}},
        {"destination": {**DALLAS, "lng": DALLAS["lng"] - 0.00001}},
    ],
    ids=["weight", "departure minute", "origin", "destination"],
)
def test_a_trip_that_differs_is_planned_afresh(client, here, overrides):
    post_plan(client, trip())

    post_plan(client, trip(**overrides))

    assert here.call_count == 2


def test_a_failed_plan_is_not_cached(client, outbound_http, load_fixture):
    route = outbound_http.get(HERE_ROUTES_URL)
    route.respond(500)
    assert post_plan(client, trip()).status_code == 503

    route.respond(json=load_fixture("routing/here_chicago_dallas_truck.json"))

    assert post_plan(client, trip()).status_code == 200


def test_routes_are_cached_for_fifteen_minutes(client, here, now):
    post_plan(client, trip())

    now.shift(timedelta(minutes=14))
    post_plan(client, trip())
    assert here.call_count == 1

    now.shift(timedelta(minutes=2))
    post_plan(client, trip())
    assert here.call_count == 2
