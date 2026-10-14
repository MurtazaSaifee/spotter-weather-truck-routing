"""Pure geometry helpers: polyline encoding, great-circle distance and line simplification.

Points are ``(lat, lng)`` tuples in degrees. Nothing here does I/O or touches Django.
"""

import math
from collections.abc import Sequence
from itertools import pairwise

Point = tuple[float, float]

EARTH_RADIUS_M = 6_371_008.8
METRES_PER_DEGREE = math.pi * EARTH_RADIUS_M / 180

# Google's encoded polyline format, which the browser decodes. Five decimals is about 1 m.
POLYLINE_PRECISION = 5


def encode_polyline(points: Sequence[Point], precision: int = POLYLINE_PRECISION) -> str:
    """Google encoded polyline of ``points``."""
    factor = 10**precision
    chunks: list[str] = []
    previous_lat = previous_lng = 0
    for lat, lng in points:
        lat_e, lng_e = round(lat * factor), round(lng * factor)
        chunks.append(_encode_number(lat_e - previous_lat))
        chunks.append(_encode_number(lng_e - previous_lng))
        previous_lat, previous_lng = lat_e, lng_e
    return "".join(chunks)


def decode_polyline(encoded: str, precision: int = POLYLINE_PRECISION) -> list[Point]:
    """The points of a Google encoded polyline."""
    factor = 10**precision
    points: list[Point] = []
    index = lat = lng = 0
    while index < len(encoded):
        delta_lat, index = _decode_number(encoded, index)
        delta_lng, index = _decode_number(encoded, index)
        lat += delta_lat
        lng += delta_lng
        points.append((lat / factor, lng / factor))
    return points


def _encode_number(value: int) -> str:
    value = ~(value << 1) if value < 0 else value << 1
    chars: list[str] = []
    while value >= 0x20:
        chars.append(chr((0x20 | (value & 0x1F)) + 63))
        value >>= 5
    chars.append(chr(value + 63))
    return "".join(chars)


def _decode_number(encoded: str, index: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        chunk = ord(encoded[index]) - 63
        index += 1
        result |= (chunk & 0x1F) << shift
        shift += 5
        if chunk < 0x20:
            break
    return (~result >> 1 if result & 1 else result >> 1), index


def haversine_m(a: Point, b: Point) -> float:
    """Great-circle distance in metres."""
    lat_a, lat_b = math.radians(a[0]), math.radians(b[0])
    d_lat = lat_b - lat_a
    d_lng = math.radians(b[1] - a[1])
    h = math.sin(d_lat / 2) ** 2 + math.cos(lat_a) * math.cos(lat_b) * math.sin(d_lng / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def simplify(points: Sequence[Point], tolerance_m: float) -> list[int]:
    """Indices of the points that survive Douglas-Peucker simplification.

    The first and last points are always kept, and no dropped point lies further than
    ``tolerance_m`` from the simplified line. Returning indices (not points) lets the caller
    carry per-vertex data, such as elapsed time, over to the simplified line.
    """
    count = len(points)
    if count <= 2:
        return list(range(count))

    # Distances are measured on a flat projection centred on the line. It is accurate to
    # well under the tolerance for any single route.
    lng_scale = math.cos(math.radians(sum(lat for lat, _ in points) / count))
    xy = [(lng * lng_scale * METRES_PER_DEGREE, lat * METRES_PER_DEGREE) for lat, lng in points]

    keep = [False] * count
    keep[0] = keep[-1] = True
    pending = [(0, count - 1)]
    while pending:
        first, last = pending.pop()
        farthest, farthest_distance = _farthest_from_chord(xy, first, last)
        if farthest_distance > tolerance_m:
            keep[farthest] = True
            pending.append((first, farthest))
            pending.append((farthest, last))
    return [index for index, kept in enumerate(keep) if kept]


def _farthest_from_chord(xy: Sequence[Point], first: int, last: int) -> tuple[int, float]:
    """The point strictly between ``first`` and ``last`` furthest from the chord joining them."""
    x1, y1 = xy[first]
    dx, dy = xy[last][0] - x1, xy[last][1] - y1
    length_squared = dx * dx + dy * dy
    farthest, farthest_distance = first, -1.0
    for index in range(first + 1, last):
        px, py = xy[index][0] - x1, xy[index][1] - y1
        if length_squared == 0:
            distance = math.hypot(px, py)
        else:
            t = max(0.0, min(1.0, (px * dx + py * dy) / length_squared))
            distance = math.hypot(px - t * dx, py - t * dy)
        if distance > farthest_distance:
            farthest, farthest_distance = index, distance
    return farthest, farthest_distance


def sample_along(points: Sequence[Point], step_m: float) -> list[Point]:
    """Points every ``step_m`` metres along the line, the first being its start.

    Positions between vertices are interpolated linearly in latitude and longitude, which is
    exact enough over the few hundred metres between a route's vertices.
    """
    if not points:
        return []
    samples = [points[0]]
    travelled = 0.0
    next_at = step_m
    for start, end in pairwise(points):
        length = haversine_m(start, end)
        while length > 0 and travelled + length >= next_at:
            samples.append(_between(start, end, (next_at - travelled) / length))
            next_at += step_m
        travelled += length
    return samples


def point_along(points: Sequence[Point], distance_m: float) -> Point:
    """The point ``distance_m`` metres along the line, or its end if it is shorter."""
    travelled = 0.0
    for start, end in pairwise(points):
        length = haversine_m(start, end)
        if length > 0 and travelled + length >= distance_m:
            return _between(start, end, (distance_m - travelled) / length)
        travelled += length
    return points[-1]


def _between(start: Point, end: Point, fraction: float) -> Point:
    return (
        start[0] + (end[0] - start[0]) * fraction,
        start[1] + (end[1] - start[1]) * fraction,
    )


def bearing_deg(start: Point, end: Point) -> float:
    """Initial great-circle bearing from ``start`` to ``end``, in degrees clockwise from north."""
    lat_a, lat_b = math.radians(start[0]), math.radians(end[0])
    d_lng = math.radians(end[1] - start[1])
    y = math.sin(d_lng) * math.cos(lat_b)
    x = math.cos(lat_a) * math.sin(lat_b) - math.sin(lat_a) * math.cos(lat_b) * math.cos(d_lng)
    return math.degrees(math.atan2(y, x)) % 360


def move(start: Point, bearing: float, distance_m: float) -> Point:
    """The point reached from ``start`` after ``distance_m`` metres along a great circle."""
    angle = distance_m / EARTH_RADIUS_M
    heading = math.radians(bearing)
    lat, lng = math.radians(start[0]), math.radians(start[1])
    new_lat = math.asin(
        math.sin(lat) * math.cos(angle) + math.cos(lat) * math.sin(angle) * math.cos(heading)
    )
    new_lng = lng + math.atan2(
        math.sin(heading) * math.sin(angle) * math.cos(lat),
        math.cos(angle) - math.sin(lat) * math.sin(new_lat),
    )
    return math.degrees(new_lat), math.degrees(new_lng)


class RouteIndex:
    """Answers "is this point within ``radius_m`` of the route?" without scanning every segment.

    The route's segments are filed under the cells of a grid (cells are one radius tall) that
    their bounding boxes touch, so a query only measures the few segments in the cells around
    the point. A route of 10,000 vertices is indexed once and queried thousands of times.
    """

    def __init__(self, points: Sequence[Point], radius_m: float):
        self._radius_m = radius_m
        self._cell_lat = radius_m / METRES_PER_DEGREE
        # Cells are at least one radius wide at the route's most poleward latitude.
        widest = max((abs(lat) for lat, _ in points), default=0.0)
        self._cell_lng = self._cell_lat / math.cos(math.radians(widest))
        self._segments = list(pairwise(points)) or [(p, p) for p in points]
        self._cells: dict[tuple[int, int], list[int]] = {}
        for number, (a, b) in enumerate(self._segments):
            rows = range(*self._span(min(a[0], b[0]), max(a[0], b[0]), self._cell_lat))
            cols = range(*self._span(min(a[1], b[1]), max(a[1], b[1]), self._cell_lng))
            for row in rows:
                for col in cols:
                    self._cells.setdefault((row, col), []).append(number)

    @staticmethod
    def _span(low: float, high: float, size: float) -> tuple[int, int]:
        return math.floor(low / size), math.floor(high / size) + 1

    def is_near(self, point: Point) -> bool:
        lat, lng = point
        lng_scale = math.cos(math.radians(lat))
        row, col = math.floor(lat / self._cell_lat), math.floor(lng / self._cell_lng)
        # A degree of longitude shrinks towards the poles, so the point may reach further
        # (in cells) than the route's own widest cell suggests.
        reach = math.ceil(self._radius_m / (METRES_PER_DEGREE * lng_scale * self._cell_lng))
        checked: set[int] = set()
        for r in range(row - 1, row + 2):
            for c in range(col - reach, col + reach + 1):
                for number in self._cells.get((r, c), ()):
                    if number in checked:
                        continue
                    checked.add(number)
                    a, b = self._segments[number]
                    if _distance_to_segment_m(point, a, b, lng_scale) <= self._radius_m:
                        return True
        return False


def _distance_to_segment_m(point: Point, a: Point, b: Point, lng_scale: float) -> float:
    """Distance from ``point`` to segment ``a``-``b`` on a flat plane centred on the point."""
    ax = (a[1] - point[1]) * lng_scale * METRES_PER_DEGREE
    ay = (a[0] - point[0]) * METRES_PER_DEGREE
    bx = (b[1] - point[1]) * lng_scale * METRES_PER_DEGREE
    by = (b[0] - point[0]) * METRES_PER_DEGREE
    dx, dy = bx - ax, by - ay
    length_squared = dx * dx + dy * dy
    t = 0.0 if length_squared == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / length_squared))
    return math.hypot(ax + t * dx, ay + t * dy)
