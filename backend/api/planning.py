"""Planning module: turns one trip request into the plan the API returns.

``plan_trip`` orchestrates a plan. Each feature has its own step, so tickets add to one
place each:

- routes come from ``routing.find_routes`` (which routes to offer is decided there);
- the sampling interval is chosen from the shortest route, or taken from the driver;
- ``_plan_route`` turns each route into what the response carries (per-route features such
  as checkpoints are added to ``PlannedRoute`` and filled in here);
- the forecast for every route's checkpoints is loaded in one go, so places the routes share
  are looked up once;
- the routes are assessed from their checkpoints' risk and ranked (``risk.rank_routes``), which
  gives the recommendation;
- ``notices`` collects plan-level messages for the driver.
"""

from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from . import places, risk, routing, weather
from .checkpoints import METRES_PER_MILE, RouteProfile, automatic_interval
from .geo import encode_polyline, simplify
from .risk import (
    Classification,
    RankedRoute,
    Ranking,
    RouteAssessment,
    assess_route,
    rank_routes,
)
from .routing import Route, TripRequest
from .weather import Conditions

# The browser only draws the route, so 100 m of straightening is invisible on any map it
# can show a whole trip on, and it cuts a route from ~10,000 vertices to a few hundred.
GEOMETRY_TOLERANCE_M = 100


@dataclass
class Notice:
    """A plan-level message for the driver, e.g. that fewer than three routes exist."""

    code: str
    message: str


@dataclass
class PlannedCheckpoint:
    """A sampled point on a route: where it is, when the truck gets there, what it stands for."""

    mile: float
    lat: float
    lng: float
    eta: datetime
    covered_miles: float
    # The forecast for the hour the truck is here; ``None`` when there is none (No data).
    weather: Conditions | None = None
    # How risky that forecast is for the load; filled in with the forecast.
    risk: Classification | None = None


@dataclass
class PlannedRoute:
    id: str
    distance_miles: float
    duration_seconds: int
    arrival: datetime
    geometry: str
    # Seconds after departure at each vertex of ``geometry``.
    elapsed_seconds: list[int]
    checkpoints: list[PlannedCheckpoint]
    # Risk mileage and average risk from the checkpoints, and where the route ranks. Filled in
    # once every checkpoint has its risk.
    assessment: RouteAssessment | None = None
    ranked: RankedRoute | None = None


@dataclass
class Plan:
    origin_time_zone: str
    departure: datetime
    interval_miles: int
    interval_automatic: bool
    routes: list[PlannedRoute]
    # The route to take, or ``None`` when every route is blocked by No Travel.
    recommended_route_id: str | None = None
    all_blocked_warning: Notice | None = None
    notices: list[Notice] = field(default_factory=list)


def plan_trip(trip: TripRequest, interval_miles: int | None = None) -> Plan:
    """Plan ``trip``. ``interval_miles`` is the driver's choice of sampling interval; without
    it the interval comes from the length of the shortest route."""
    time_zone = ZoneInfo(places.time_zone_at(*trip.origin))
    routes = routing.find_routes(trip)
    automatic = interval_miles is None
    if interval_miles is None:
        interval_miles = automatic_interval(min(route.distance_m for route in routes))
    notices: list[Notice] = []
    if len(routes) < routing.MAX_ROUTES:
        notices.append(_fewer_routes_notice(len(routes)))
    planned = [_plan_route(route, trip, time_zone, interval_miles) for route in routes]
    ranked_routes, ranking = _ranked(_with_weather(planned, trip.load_weight_lb))
    if no_data := _no_data_notice(ranked_routes):
        notices.append(no_data)
    return Plan(
        origin_time_zone=str(time_zone),
        departure=trip.departure_minute.astimezone(time_zone),
        interval_miles=interval_miles,
        interval_automatic=automatic,
        routes=ranked_routes,
        recommended_route_id=ranking.recommended_id,
        all_blocked_warning=_ALL_BLOCKED_WARNING if ranking.all_blocked else None,
        notices=notices,
    )


def _with_weather(routes: list[PlannedRoute], load_weight_lb: int) -> list[PlannedRoute]:
    """``routes`` with the forecast at each checkpoint, for the hour the truck is there, and
    the risk that forecast means for a truck carrying ``load_weight_lb``."""
    checkpoints = [checkpoint for route in routes for checkpoint in route.checkpoints]
    forecast = weather.load_forecast(
        points=[(checkpoint.lat, checkpoint.lng) for checkpoint in checkpoints],
        times=[checkpoint.eta for checkpoint in checkpoints],
    )

    def forecast_at(checkpoint: PlannedCheckpoint) -> PlannedCheckpoint:
        conditions = forecast.conditions_at((checkpoint.lat, checkpoint.lng), checkpoint.eta)
        classification = risk.classify(
            wind_mph=conditions.wind_mph,
            gust_mph=conditions.gust_mph,
            rain_in_hr=conditions.rain_in_hr,
            snow_in_hr=conditions.snow_in_hr,
            load_lb=load_weight_lb,
        )
        return replace(
            checkpoint,
            weather=conditions if conditions.complete else None,
            risk=classification,
        )

    return [
        replace(route, checkpoints=[forecast_at(checkpoint) for checkpoint in route.checkpoints])
        for route in routes
    ]


def _ranked(routes: list[PlannedRoute]) -> tuple[list[PlannedRoute], Ranking]:
    """``routes`` with their risk mileage and rank, in the order given (ids stay fixed), and the
    ranking they came from."""
    assessments = [
        assess_route(
            route.id,
            travel_time_s=route.duration_seconds,
            checkpoints=[
                (checkpoint.covered_miles, checkpoint.risk) for checkpoint in route.checkpoints
            ],
        )
        for route in routes
    ]
    ranking = rank_routes(assessments)
    ranked_by_id = {ranked.route_id: ranked for ranked in ranking.routes}
    return [
        replace(route, assessment=assessment, ranked=ranked_by_id[route.id])
        for route, assessment in zip(routes, assessments, strict=True)
    ], ranking


_ALL_BLOCKED_WARNING = Notice(
    code="all_routes_blocked",
    message=(
        "Do not travel at this departure time. Every route passes through No Travel "
        "conditions; try another departure time."
    ),
)


def _no_data_notice(routes: list[PlannedRoute]) -> Notice | None:
    count = sum(
        checkpoint.risk.level is None for route in routes for checkpoint in route.checkpoints
    )
    if not count:
        return None
    noun = "checkpoint" if count == 1 else "checkpoints"
    return Notice(
        code="no_data_checkpoints",
        message=(
            f"The forecast is missing at {count} {noun}. {'It is' if count == 1 else 'They are'} "
            "marked No data and left out of risk mileage and average risk; each route's "
            "unassessed miles are shown on its card."
        ),
    )


def _fewer_routes_notice(count: int) -> Notice:
    noun = "route" if count == 1 else "routes"
    verb = "exists" if count == 1 else "exist"
    return Notice(
        code="fewer_than_three_routes",
        message=f"Only {count} distinct {noun} {verb} between these places, not three.",
    )


def _plan_route(
    route: Route, trip: TripRequest, time_zone: ZoneInfo, interval_miles: int
) -> PlannedRoute:
    points = route.points
    profile = RouteProfile(points, route.spans)
    kept = simplify(points, GEOMETRY_TOLERANCE_M)
    departure = trip.departure_minute.astimezone(time_zone)
    arrival = trip.departure_minute + timedelta(seconds=route.duration_s)
    return PlannedRoute(
        id=route.id,
        distance_miles=round(route.distance_m / METRES_PER_MILE, 2),
        duration_seconds=route.duration_s,
        arrival=arrival.astimezone(time_zone),
        geometry=encode_polyline([points[index] for index in kept]),
        elapsed_seconds=[round(profile.vertex_elapsed_s[index]) for index in kept],
        checkpoints=[
            PlannedCheckpoint(
                mile=checkpoint.distance_m / METRES_PER_MILE,
                lat=checkpoint.point[0],
                lng=checkpoint.point[1],
                eta=departure + timedelta(seconds=round(checkpoint.elapsed_s)),
                covered_miles=checkpoint.covered_m / METRES_PER_MILE,
            )
            for checkpoint in profile.place_checkpoints(interval_miles * METRES_PER_MILE)
        ],
    )
