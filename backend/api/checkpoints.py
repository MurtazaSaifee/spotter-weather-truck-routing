"""Checkpoints along a route: where they sit, when the truck gets there, what they cover.

Pure functions over a route's geometry and spans. The interface is ``RouteProfile``, which
knows the distance and elapsed time of every vertex of a route, and ``automatic_interval``.
"""

import bisect
from collections.abc import Sequence
from dataclasses import dataclass
from fractions import Fraction

from .geo import METRES_PER_MILE, Point, haversine_m
from .routing import Span

# Exact metres per mile as a fraction, so the tier edges below are not at the mercy of floats.
# Going through the text gives the decimal as written (1609.344), not its float approximation.
_METRES_PER_MILE = Fraction(str(METRES_PER_MILE))

INTERVAL_CHOICES = (10, 25, 50)
# Trips shorter than this get the finest interval, trips up to the next one the middle one,
# and anything longer the coarsest. 1,000 mi itself is still the middle tier.
SHORT_TRIP_MILES = 300
LONG_TRIP_MILES = 1_000

# Positions closer than this are the same place; it keeps a destination that falls exactly
# on an interval from being listed twice because of floating-point noise.
_SAME_POSITION_M = 1e-6


def automatic_interval(shortest_route_m: int) -> int:
    """The sampling interval, in miles, for a trip whose shortest route is this long."""
    miles = Fraction(shortest_route_m) / _METRES_PER_MILE
    if miles < SHORT_TRIP_MILES:
        return INTERVAL_CHOICES[0]
    if miles <= LONG_TRIP_MILES:
        return INTERVAL_CHOICES[1]
    return INTERVAL_CHOICES[2]


@dataclass(frozen=True)
class Checkpoint:
    distance_m: float
    point: Point
    elapsed_s: float
    # The stretch of road this checkpoint stands for: half the gap to each neighbour.
    covered_m: float


class RouteProfile:
    """How far along the route, and how long after departure, each vertex is.

    Span lengths are authoritative for distance. A span's vertices share its length in
    proportion to the straight-line distances between them, and its travel time in
    proportion to that distance, so time is linear inside a span. Everything between two
    vertices is then linear too, which is all a position or an ETA needs.
    """

    def __init__(self, points: Sequence[Point], spans: Sequence[Span]) -> None:
        self.points = points
        self.vertex_distance_m, self.vertex_elapsed_s = _vertex_profile(points, spans)

    @property
    def length_m(self) -> float:
        return self.vertex_distance_m[-1]

    def place_checkpoints(self, interval_m: float) -> list[Checkpoint]:
        """Checkpoints at the start, every ``interval_m`` and the end.

        A final gap shorter than the interval is kept as it is.
        """
        length = self.length_m
        distances = [0.0]
        while (next_distance := distances[-1] + interval_m) < length - _SAME_POSITION_M:
            distances.append(next_distance)
        if length > 0:
            distances.append(length)

        checkpoints = []
        for index, distance in enumerate(distances):
            before = distance - distances[index - 1] if index > 0 else 0.0
            after = distances[index + 1] - distance if index + 1 < len(distances) else 0.0
            point, elapsed = self._at(distance)
            checkpoints.append(Checkpoint(distance, point, elapsed, (before + after) / 2))
        return checkpoints

    def _at(self, distance_m: float) -> tuple[Point, float]:
        distances = self.vertex_distance_m
        last = len(distances) - 1
        # The vertex at or before the distance; the last segment ends at the last vertex.
        index = min(bisect.bisect_right(distances, distance_m) - 1, last - 1)
        index = max(index, 0)
        gap = distances[index + 1] - distances[index]
        fraction = min(max((distance_m - distances[index]) / gap, 0.0), 1.0) if gap > 0 else 0.0
        (lat_a, lng_a), (lat_b, lng_b) = self.points[index], self.points[index + 1]
        elapsed_a, elapsed_b = self.vertex_elapsed_s[index], self.vertex_elapsed_s[index + 1]
        return (
            (lat_a + (lat_b - lat_a) * fraction, lng_a + (lng_b - lng_a) * fraction),
            elapsed_a + (elapsed_b - elapsed_a) * fraction,
        )


def _vertex_profile(
    points: Sequence[Point], spans: Sequence[Span]
) -> tuple[list[float], list[float]]:
    """Distance and elapsed time at every vertex, accumulated span by span."""
    distance = [0.0] * len(points)
    elapsed = [0.0] * len(points)
    run_distance = run_elapsed = 0.0
    for number, span in enumerate(spans):
        first = span.offset
        last = spans[number + 1].offset if number + 1 < len(spans) else len(points) - 1
        segments = [haversine_m(points[i], points[i + 1]) for i in range(first, last)]
        geometry_m = sum(segments)
        covered = 0.0
        for index, segment in zip(range(first + 1, last + 1), segments, strict=True):
            covered += segment
            # A span whose polyline has no length (a stop on one spot) shares evenly instead.
            share = covered / geometry_m if geometry_m > 0 else (index - first) / (last - first)
            distance[index] = run_distance + span.length_m * share
            elapsed[index] = run_elapsed + span.duration_s * share
        run_distance += span.length_m
        run_elapsed += span.duration_s
    # Spans that end on the same vertex they start on leave nothing to interpolate; the
    # last vertex still carries the full totals.
    distance[-1], elapsed[-1] = run_distance, run_elapsed
    return distance, elapsed
