"""Routing adapter: truck routes from HERE Routing v8.

``find_routes`` is the whole interface. It returns normalised ``Route`` objects, never HERE's
response, and caches them per trip. The steps are kept separate so later features slot in
without rewriting each other:

- ``_request_routes`` talks to HERE and parses its answer;
- ``_select_routes`` chooses which of HERE's alternatives to keep (the seam for
  near-duplicate removal and the detour fallback);
- ``find_routes`` caches the selected routes under ``TripRequest.cache_key``.
"""

import functools
import logging
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any

import flexpolyline
import httpx
from django.conf import settings
from django.core.cache import cache

from .errors import ApiError
from .geo import Point

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

# Weight HERE needs is the whole vehicle's. The driver enters the load; the empty
# tractor-trailer is an assumption (a typical Class 8 tractor with a 53 ft dry van).
EMPTY_TRUCK_WEIGHT_LB = 35_000
KG_PER_LB = 0.45359237

ROUTE_CACHE_SECONDS = 15 * 60
_CACHE_KEY_VERSION = "v1"

# HERE failed when the request errors or times out, or when its answer isn't the shape we parse.
_PROVIDER_ERRORS = (httpx.HTTPError, ValueError, KeyError, TypeError)


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
    """Up to ``MAX_ROUTES`` truck routes for ``trip``, numbered ``route-1``, ``route-2``…

    Raises ``NoRouteFoundError`` when HERE finds none and ``RoutingUnavailableError`` when
    HERE fails. Answers are cached for ``ROUTE_CACHE_SECONDS``.
    """
    key = trip.cache_key()
    cached: list[Route] | None = cache.get(key)
    if cached is not None:
        return cached

    routes = _select_routes(_request_routes(trip))
    routes = [replace(route, id=f"route-{number}") for number, route in enumerate(routes, 1)]
    cache.set(key, routes, ROUTE_CACHE_SECONDS)
    return routes


def _select_routes(candidates: Sequence[Route]) -> list[Route]:
    """The routes to offer the driver, from HERE's alternatives (fastest first)."""
    return list(candidates[:MAX_ROUTES])


def _request_routes(trip: TripRequest) -> list[Route]:
    try:
        response = httpx.get(
            HERE_ROUTING_URL,
            params={
                "transportMode": "truck",
                "origin": _coordinate(trip.origin),
                "destination": _coordinate(trip.destination),
                "departureTime": trip.departure_minute.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "alternatives": HERE_ALTERNATIVES,
                "return": "polyline,summary",
                "spans": HERE_SPANS,
                "vehicle[grossWeight]": gross_weight_kg(trip.load_weight_lb),
                "apiKey": settings.HERE_API_KEY,
            },
            timeout=HERE_ROUTING_TIMEOUT,
        )
        response.raise_for_status()
        items: list[dict[str, Any]] = response.json()["routes"]
        routes = [_parse_route(item) for item in items]
    except _PROVIDER_ERRORS as error:
        # Never log the exception itself: httpx puts the request URL, and with it the
        # HERE key, in its message.
        logger.error("HERE routing failed (%s)", _describe(error))
        raise RoutingUnavailableError() from None
    if not routes:
        raise NoRouteFoundError()
    return routes


def _describe(error: Exception) -> str:
    if isinstance(error, httpx.HTTPStatusError):
        return f"HTTP {error.response.status_code}"
    return type(error).__name__


def _parse_route(item: dict[str, Any]) -> Route:
    """Normalise one HERE route.

    A route has one section unless it has stops; the trip has none (detour via-points are
    pass-through), so anything else is an answer we don't understand.
    """
    (section,) = item["sections"]
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


def _coordinate(point: Point) -> str:
    return f"{point[0]:.5f},{point[1]:.5f}"
