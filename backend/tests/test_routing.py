"""A HERE route with a ferry or a car shuttle train comes back as several sections, which are
joined into one route. The integration test plans the recorded London to Paris answer
(tests/fixtures/routing/), whose routes all take a car shuttle train or a ferry."""

import itertools
from datetime import datetime

import flexpolyline
import pytest
import time_machine

from api.routing import Span, _parse_route

HERE_ROUTES_URL = "https://router.hereapi.com/v8/routes"
PLAN_URL = "/api/plan"

NOW = "2026-10-14T15:00:00Z"
LONDON = {"label": "London, UK", "lat": 51.5074, "lng": -0.1278, "time_zone": "Europe/London"}
PARIS = {"label": "Paris, France", "lat": 48.8566, "lng": 2.3522, "time_zone": "Europe/Paris"}
DEPARTURE = "2026-10-15T08:00:00+01:00"


@pytest.fixture(autouse=True)
def now():
    with time_machine.travel(NOW, tick=False) as traveller:
        yield traveller


@pytest.fixture
def here(outbound_http, load_fixture):
    route = outbound_http.get(HERE_ROUTES_URL)
    route.respond(json=load_fixture("routing/here_london_paris_truck_shuttle.json"))
    return route


def decoded(polyline):
    return [tuple(point) for point in flexpolyline.decode(polyline)]


def section(points, summary_length, summary_duration, spans=None):
    """A HERE section: its polyline at HERE's default precision, its summary and, for a
    vehicle section, its spans. ``spans`` is ``(offset, length, duration)`` triples."""
    item = {
        "polyline": flexpolyline.encode(points),
        "summary": {"length": summary_length, "duration": summary_duration},
    }
    if spans is not None:
        item["spans"] = [
            {"offset": offset, "length": length, "duration": duration}
            for offset, length, duration in spans
        ]
    return item


# --- One section ------------------------------------------------------------------------


def test_a_single_section_route_keeps_HERE_polyline_spans_and_totals_as_sent():
    # Precision 6, not HERE's 5: a re-encode at the default would change the string.
    points = [(51.5074, -0.1278), (51.5100, -0.1200), (51.5200, -0.1000)]
    polyline = flexpolyline.encode(points, precision=6)
    item = {
        "id": "route-x",
        "sections": [
            {
                "polyline": polyline,
                "summary": {"length": 1234.6, "duration": 300.4},
                "spans": [
                    {"offset": 0, "length": 500.4, "duration": 100.6},
                    {"offset": 2, "length": 734.2, "duration": 199.8},
                ],
            }
        ],
    }

    route = _parse_route(item)

    assert route.id == "route-x"
    assert route.polyline == polyline
    assert route.spans == (Span(0, 500, 101), Span(2, 734, 200))
    assert route.distance_m == 1235
    assert route.duration_s == 300


# --- Two sections that meet -------------------------------------------------------------


def test_two_sections_are_joined_at_their_shared_point_and_their_spans_follow_the_join():
    first = [(51.50, -0.10), (51.51, -0.09), (51.52, -0.08), (51.53, -0.07)]
    second = [(51.53, -0.07), (51.53, -0.05), (51.54, -0.04)]  # starts where the first ends
    item = {
        "id": "route-x",
        "sections": [
            section(first, 3100.4, 320.6, spans=[(0, 1000, 100), (2, 2000, 200)]),
            section(second, 800.2, 90.7),  # no spans: one span covers the section
        ],
    }

    route = _parse_route(item)

    joined = decoded(route.polyline)
    assert joined == first + second[1:]
    # Each span points at the coordinate it pointed at in its own section.
    assert [joined[span.offset] for span in route.spans] == [first[0], first[2], second[0]]
    assert route.spans == (Span(0, 1000, 100), Span(2, 2000, 200), Span(3, 800, 91))
    assert route.distance_m == round(3100.4 + 800.2)
    assert route.duration_s == round(320.6 + 90.7)


def test_two_sections_that_do_not_meet_keep_both_first_points_and_the_offsets_still_map():
    first = [(51.50, -0.10), (51.51, -0.09), (51.52, -0.08), (51.53, -0.07)]
    second = [(51.531, -0.069), (51.54, -0.05), (51.55, -0.04)]  # a gap after the first
    item = {
        "id": "route-x",
        "sections": [
            section(first, 3100.0, 320.0, spans=[(0, 1000, 100), (2, 2000, 200)]),
            section(second, 800.0, 90.0, spans=[(0, 300, 30), (1, 500, 60)]),
        ],
    }

    route = _parse_route(item)

    joined = decoded(route.polyline)
    assert joined == first + second
    assert [joined[span.offset] for span in route.spans] == [
        first[0],
        first[2],
        second[0],
        second[1],
    ]
    assert route.spans == (
        Span(0, 1000, 100),
        Span(2, 2000, 200),
        Span(4, 300, 30),
        Span(5, 500, 60),
    )


# --- The plan ---------------------------------------------------------------------------


def test_a_trip_with_a_car_shuttle_train_or_ferry_is_planned_with_three_routes(client, here):
    response = client.post(
        PLAN_URL,
        {
            "origin": LONDON,
            "destination": PARIS,
            "departure": DEPARTURE,
            "load_weight_lb": 20_000,
        },
        content_type="application/json",
    )

    assert response.status_code == 200
    routes = response.json()["routes"]
    assert len(routes) == 3
    for route in routes:
        checkpoints = route["checkpoints"]
        covered = sum(checkpoint["covered_miles"] for checkpoint in checkpoints)
        assert covered == pytest.approx(route["distance_miles"], abs=0.1)
        etas = [datetime.fromisoformat(checkpoint["eta"]) for checkpoint in checkpoints]
        assert all(earlier < later for earlier, later in itertools.pairwise(etas))
