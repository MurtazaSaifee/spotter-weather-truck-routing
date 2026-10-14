"""Planning module: turns one trip request into the plan the API returns.

``plan_trip`` orchestrates a plan. Each feature has its own step, so tickets add to one
place each:

- routes come from ``routing.find_routes`` (which routes to offer is decided there);
- ``_plan_route`` turns each route into what the response carries (per-route features such
  as checkpoints are added to ``PlannedRoute`` and filled in here);
- ``notices`` collects plan-level messages for the driver.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from . import places, routing
from .geo import encode_polyline, simplify
from .routing import Route, TripRequest

METRES_PER_MILE = 1609.344
# The browser only draws the route, so 100 m of straightening is invisible on any map it
# can show a whole trip on, and it cuts a route from ~10,000 vertices to a few hundred.
GEOMETRY_TOLERANCE_M = 100


@dataclass
class Notice:
    """A plan-level message for the driver, e.g. that fewer than three routes exist."""

    code: str
    message: str


@dataclass
class PlannedRoute:
    id: str
    distance_miles: float
    duration_seconds: int
    arrival: datetime
    geometry: str


@dataclass
class Plan:
    origin_time_zone: str
    departure: datetime
    routes: list[PlannedRoute]
    notices: list[Notice] = field(default_factory=list)


def plan_trip(trip: TripRequest) -> Plan:
    time_zone = ZoneInfo(places.time_zone_at(*trip.origin))
    routes = routing.find_routes(trip)
    notices: list[Notice] = []
    return Plan(
        origin_time_zone=str(time_zone),
        departure=trip.departure_minute.astimezone(time_zone),
        routes=[_plan_route(route, trip, time_zone) for route in routes],
        notices=notices,
    )


def _plan_route(route: Route, trip: TripRequest, time_zone: ZoneInfo) -> PlannedRoute:
    points = route.points
    kept = simplify(points, GEOMETRY_TOLERANCE_M)
    arrival = trip.departure_minute + timedelta(seconds=route.duration_s)
    return PlannedRoute(
        id=route.id,
        distance_miles=round(route.distance_m / METRES_PER_MILE, 2),
        duration_seconds=route.duration_s,
        arrival=arrival.astimezone(time_zone),
        geometry=encode_polyline([points[index] for index in kept]),
    )
