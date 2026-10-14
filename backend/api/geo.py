"""Pure geometry helpers: polyline encoding, great-circle distance and line simplification.

Points are ``(lat, lng)`` tuples in degrees. Nothing here does I/O or touches Django.
"""

import math
from collections.abc import Sequence

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
