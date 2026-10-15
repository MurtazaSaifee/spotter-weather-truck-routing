"""Routing adapter: truck routes from HERE Routing v8.

``find_routes`` is the whole interface. It returns normalised ``Route`` objects, never HERE's
response, and caches them per trip. The steps are kept separate so later features slot in
without rewriting each other:

- ``_request_routes`` talks to HERE and parses its answer;
- ``_add_distinct`` chooses which routes to keep: fastest first, skipping near-duplicates;
- ``_request_detours`` asks HERE for routes through via-points when its own alternatives
  were not distinct enough;
- ``find_routes`` caches the final routes under ``TripRequest.cache_key``.
"""

import functools
import logging
from collections.abc import Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any

import flexpolyline
import httpx
from django.conf import settings
from django.core.cache import cache

from .errors import ApiError
from .geo import (
    METRES_PER_MILE,
    Point,
    RouteIndex,
    bearing_deg,
    move,
    point_along,
    sample_along,
)
from .providers import PROVIDER_ERRORS, describe_error

logger = logging.getLogger(__name__)

HERE_ROUTING_URL = "https://router.hereapi.com/v8/routes"
# Seven routes with fine-grained spans come back as about 1.4 MB, so allow for a slow read.
HERE_ROUTING_TIMEOUT = httpx.Timeout(20.0, connect=5.0)
# HERE returns the best route plus up to this many alternatives.
HERE_ALTERNATIVES = 6
# The spans give the route's distance/time profile: dynamicSpeedInfo is what makes them
# fine-grained (a Chicago to Dallas route has 1,300 of them instead of one).
HERE_SPANS = "dynamicSpeedInfo,length,duration"

MAX_ROUTES = 3

# Two routes are near-duplicates when this share of the shorter route's samples (one every
# mile) lies within the radius of the other.
SAMPLE_STEP_M = METRES_PER_MILE
NEAR_DUPLICATE_RADIUS_M = 500
NEAR_DUPLICATE_SHARE = 0.9

# Detour via-points: these fractions of the trip's length, to either side of its midpoint.
DETOUR_OFFSETS = (0.1, 0.2)
HERE_DETOUR_TIMEOUT = httpx.Timeout(10.0, connect=5.0)

# Weight HERE needs is the whole vehicle's. The driver enters the load; the empty
# tractor-trailer is an assumption (a typical Class 8 tractor with a 53 ft dry van).
EMPTY_TRUCK_WEIGHT_LB = 35_000
KG_PER_LB = 0.45359237

ROUTE_CACHE_SECONDS = 15 * 60
# Bumped when what is cached under "routes:" changes shape. Each adapter versions its own keys.
_CACHE_KEY_VERSION = "v1"


class NoRouteFoundError(ApiError):
    status_code = 422
    code = "no_route_found"
    message = (
        "No truck route was found between these places. Try a different origin or destination."
    )


class RoutingUnavailableError(ApiError):
    status_code = 503
    code = "routing_unavailable"
    message = "Route planning is unavailable right now. Please try again."


@dataclass(frozen=True)
class TripRequest:
    """What the routing provider needs to know: where, when and how heavy."""

    origin: Point
    destination: Point
    departure: datetime
    load_weight_lb: int

    @property
    def departure_minute(self) -> datetime:
        """The departure in UTC, to the minute. Traffic predictions don't change faster."""
        return self.departure.astimezone(UTC).replace(second=0, microsecond=0)

    def cache_key(self) -> str:
        """Equal for trips that HERE would answer identically: coordinates to 5 decimals
        (about 1 m), departure to the minute, and weight."""
        return ":".join(
            [
                "routes",
                _CACHE_KEY_VERSION,
                _coordinate(self.origin),
                _coordinate(self.destination),
                self.departure_minute.strftime("%Y%m%dT%H%MZ"),
                str(self.load_weight_lb),
            ]
        )


@dataclass(frozen=True)
class Span:
    """A stretch of road with a known length and traffic-aware travel time.

    ``offset`` is the index in ``Route.points`` of the vertex where the span begins; it ends
    where the next one begins, and the last span ends at the final vertex.
    """

    offset: int
    length_m: int
    duration_s: int


@dataclass(frozen=True)
class Route:
    id: str
    distance_m: int
    duration_s: int
    spans: tuple[Span, ...]
    # HERE's flexible polyline, kept encoded: it is about a tenth the size of the points,
    # which matters when the route sits in the cache.
    polyline: str

    @property
    def points(self) -> tuple[Point, ...]:
        """The full-resolution geometry as ``(lat, lng)`` points."""
        return _decode_here_polyline(self.polyline)


@functools.lru_cache(maxsize=32)
def _decode_here_polyline(polyline: str) -> tuple[Point, ...]:
    return tuple((lat, lng) for lat, lng in flexpolyline.decode(polyline))


def gross_weight_kg(load_weight_lb: float) -> int:
    """Vehicle weight for HERE, in whole kilograms: the load plus the empty truck."""
    return round((EMPTY_TRUCK_WEIGHT_LB + load_weight_lb) * KG_PER_LB)


def find_routes(trip: TripRequest) -> list[Route]:
    """Up to ``MAX_ROUTES`` distinct truck routes for ``trip``, fastest first, numbered
    ``route-1``, ``route-2``…

    HERE's alternatives are used when three of them are distinct. Otherwise detours through
    via-points are tried to make up the number, so there can be fewer than three routes.

    Raises ``NoRouteFoundError`` when HERE finds none and ``RoutingUnavailableError`` when
    HERE fails. The final routes are cached for ``ROUTE_CACHE_SECONDS``, detours included.
    """
    key = trip.cache_key()
    try:
        cached: list[Route] | None = cache.get(key)
    except Exception as error:
        _cache_failed("read", error)
        cached = None
        cache_working = False
    else:
        cache_working = True
    if cached is not None:
        return cached

    alternatives = _request_routes(trip)
    if not alternatives:
        raise NoRouteFoundError()
    footprints = _Footprints()
    routes = _add_distinct([], alternatives, footprints)
    if len(routes) < MAX_ROUTES:
        routes = _add_distinct(routes, _request_detours(trip, routes[0]), footprints)
    routes.sort(key=lambda route: route.duration_s)
    routes = [replace(route, id=f"route-{number}") for number, route in enumerate(routes, 1)]
    if cache_working:
        try:
            cache.set(key, routes, ROUTE_CACHE_SECONDS)
        except Exception as error:
            _cache_failed("write", error)
    return routes


def _cache_failed(action: str, error: Exception) -> None:
    """A cache that fails only costs a HERE request. After a failed read the write is skipped,
    so a dead Redis costs one timeout, not two."""
    # Not the exception itself: a Redis error message can carry the connection URL.
    logger.warning("Route cache %s failed (%s); using HERE", action, type(error).__name__)


def _add_distinct(
    kept: Sequence[Route], candidates: Iterable[Route], footprints: "_Footprints"
) -> list[Route]:
    """``kept`` plus the fastest candidates that are not near-duplicates of a route already
    kept, up to ``MAX_ROUTES`` in all."""
    routes = list(kept)
    for candidate in sorted(candidates, key=lambda route: route.duration_s):
        if len(routes) == MAX_ROUTES:
            break
        if not any(footprints.near_duplicates(candidate, route) for route in routes):
            routes.append(candidate)
    return routes


class _Footprints:
    """Compares routes' shapes. Samples and spatial indexes are built once per route."""

    def __init__(self) -> None:
        self._samples: dict[int, list[Point]] = {}
        self._indexes: dict[int, RouteIndex] = {}

    def near_duplicates(self, a: Route, b: Route) -> bool:
        shorter, longer = (a, b) if a.distance_m <= b.distance_m else (b, a)
        index = self._index(longer)
        samples = self._sample(shorter)
        near = sum(index.is_near(point) for point in samples)
        return near >= NEAR_DUPLICATE_SHARE * len(samples)

    def _sample(self, route: Route) -> list[Point]:
        if id(route) not in self._samples:
            self._samples[id(route)] = sample_along(route.points, SAMPLE_STEP_M)
        return self._samples[id(route)]

    def _index(self, route: Route) -> RouteIndex:
        if id(route) not in self._indexes:
            self._indexes[id(route)] = RouteIndex(route.points, NEAR_DUPLICATE_RADIUS_M)
        return self._indexes[id(route)]


def _request_detours(trip: TripRequest, fastest: Route) -> list[Route]:
    """Routes through each detour via-point, asked for in parallel. A via-point HERE can't
    route through (one in water, say) is dropped."""
    vias = _detour_via_points(trip, fastest)
    with ThreadPoolExecutor(max_workers=len(vias)) as pool:
        answers = pool.map(lambda via: _request_detour(trip, via), vias)
    return [route for answer in answers for route in answer]


def _detour_via_points(trip: TripRequest, fastest: Route) -> list[Point]:
    """Points at right angles to the direction of travel, through the middle of the fastest
    route, ``DETOUR_OFFSETS`` of the trip's length away on either side."""
    middle = point_along(fastest.points, fastest.distance_m / 2)
    heading = bearing_deg(trip.origin, trip.destination)
    return [
        move(middle, (heading + turn) % 360, fraction * fastest.distance_m)
        for fraction in DETOUR_OFFSETS
        for turn in (-90, 90)
    ]


def _request_detour(trip: TripRequest, via: Point) -> list[Route]:
    try:
        return _request_routes(trip, via=via)
    except RoutingUnavailableError:
        return []


def _request_routes(trip: TripRequest, via: Point | None = None) -> list[Route]:
    """HERE's routes for the trip (its alternatives, or one route through ``via``), possibly
    none."""
    params = {
        "transportMode": "truck",
        "origin": _coordinate(trip.origin),
        "destination": _coordinate(trip.destination),
        "departureTime": trip.departure_minute.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "alternatives": HERE_ALTERNATIVES if via is None else 0,
        "return": "polyline,summary",
        "spans": HERE_SPANS,
        "vehicle[grossWeight]": gross_weight_kg(trip.load_weight_lb),
        "apiKey": settings.HERE_API_KEY,
    }
    if via is not None:
        # Pass-through: the route goes by the point without stopping, so it keeps one section.
        params["via"] = f"{_coordinate(via)}!passThrough=true"
    try:
        response = httpx.get(
            HERE_ROUTING_URL,
            params=params,
            timeout=HERE_ROUTING_TIMEOUT if via is None else HERE_DETOUR_TIMEOUT,
        )
        response.raise_for_status()
        items: list[dict[str, Any]] = response.json()["routes"]
        return [_parse_route(item) for item in items]
    except PROVIDER_ERRORS as error:
        # Never log the exception itself: httpx puts the request URL, and with it the
        # HERE key, in its message.
        logger.error("HERE routing failed (%s)", describe_error(error))
        raise RoutingUnavailableError() from None


def _parse_route(item: dict[str, Any]) -> Route:
    """Normalise one HERE route.

    HERE splits a route into sections where it takes a ferry or a car shuttle train. The
    sections are joined into one route: each starts where the one before ends, and each
    section's spans are re-indexed onto the joined geometry. A route with no points to draw
    is an answer we don't understand.
    """
    sections = item["sections"]
    if len(sections) == 1:
        (section,) = sections
        return Route(
            id=item["id"],
            distance_m=round(section["summary"]["length"]),
            duration_s=round(section["summary"]["duration"]),
            spans=tuple(
                Span(span["offset"], round(span["length"]), round(span["duration"]))
                for span in section["spans"]
            ),
            polyline=section["polyline"],
        )
    points: list[Point] = []
    spans: list[Span] = []
    length_m = duration_s = 0.0
    for section in sections:
        decoded = [(lat, lng) for lat, lng in flexpolyline.decode(section["polyline"])]
        # A section starts on the point the one before it ended on; that point is kept once.
        shared = bool(points) and bool(decoded) and decoded[0] == points[-1]
        base = len(points) - 1 if shared else len(points)
        points.extend(decoded[1:] if shared else decoded)
        summary = section["summary"]
        if "spans" in section:
            spans.extend(
                Span(base + span["offset"], round(span["length"]), round(span["duration"]))
                for span in section["spans"]
            )
        else:
            spans.append(Span(base, round(summary["length"]), round(summary["duration"])))
        length_m += summary["length"]
        duration_s += summary["duration"]
    if len(points) < 2:
        raise ValueError("a route needs at least two points")
    return Route(
        id=item["id"],
        distance_m=round(length_m),
        duration_s=round(duration_s),
        spans=tuple(spans),
        polyline=flexpolyline.encode(points),
    )


def _coordinate(point: Point) -> str:
    return f"{point[0]:.5f},{point[1]:.5f}"
