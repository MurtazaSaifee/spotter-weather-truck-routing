"""Planning a trip through the API, with HERE Routing answered by recorded responses
(tests/fixtures/routing/)."""

import logging
from datetime import datetime, timedelta

import httpx
import pytest
import time_machine

from api.geo import decode_polyline

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


def test_a_plan_returns_the_first_three_here_routes_in_the_origin_time_zone(client, here):
    response = post_plan(client, trip())

    assert response.status_code == 200
    body = response.json()
    assert body["origin_time_zone"] == "America/Chicago"
    assert body["departure"] == DEPARTURE
    assert body["notices"] == []
    assert [r["id"] for r in body["routes"]] == ["route-1", "route-2", "route-3"]
    first = body["routes"][0]
    # HERE's own summary for its first route: 1,491,588 m, 53,684 s, arriving 22:54:44 CDT.
    assert first["distance_miles"] == 926.83
    assert first["duration_seconds"] == 53_684
    assert first["arrival"] == "2026-10-15T22:54:44-05:00"
    assert [r["duration_seconds"] for r in body["routes"]] == [53_684, 53_300, 58_366]


def test_each_route_geometry_is_a_simplified_encoded_polyline_between_the_two_places(client, here):
    body = post_plan(client, trip()).json()

    for route in body["routes"]:
        points = decode_polyline(route["geometry"])
        # HERE returns 8,000 to 11,000 vertices per route; a 100 m tolerance keeps a fraction.
        assert 100 < len(points) < 3_000
        assert points[0] == pytest.approx((CHICAGO["lat"], CHICAGO["lng"]), abs=0.001)
        assert points[-1] == pytest.approx((DALLAS["lat"], DALLAS["lng"]), abs=0.001)


def test_a_plan_with_fewer_routes_from_here_returns_just_those(client, here, load_fixture):
    payload = load_fixture("routing/here_chicago_dallas_truck.json")
    payload["routes"] = payload["routes"][:2]
    here.respond(json=payload)

    body = post_plan(client, trip()).json()

    assert [r["id"] for r in body["routes"]] == ["route-1", "route-2"]


def test_the_time_zone_comes_from_the_origin_coordinates_not_from_the_request(client, here):
    denver = {"label": "Denver, CO", "lat": 39.7392, "lng": -104.9903, "time_zone": "Asia/Tokyo"}

    body = post_plan(client, trip(origin=denver)).json()

    assert body["origin_time_zone"] == "America/Denver"
    # The same instant, written in Denver's offset.
    assert body["departure"] == "2026-10-15T07:00:00-06:00"
    assert body["routes"][0]["arrival"] == "2026-10-15T21:54:44-06:00"


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
        ({"origin": {**CHICAGO, "lat": 51.5, "lng": -0.12}}, "origin"),
        ({"destination": {**DALLAS, "lat": -33.9, "lng": 151.2}}, "destination"),
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
        "origin overseas",
        "destination overseas",
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
    overseas = {**CHICAGO, "lat": 51.5, "lng": -0.12}
    body = post_plan(
        client, trip(origin=overseas, departure=minutes_from_now(-60), load_weight_lb=0)
    ).json()

    assert set(body["details"]["fields"]) == {"origin", "departure", "load_weight_lb"}


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
