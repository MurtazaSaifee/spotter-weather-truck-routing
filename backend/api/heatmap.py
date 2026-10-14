"""Heatmap module: the weather over a corridor around the routes on screen, hour by hour.

``build_heatmap`` is a pure function of the route geometries the browser is showing, the
departure and the load weight. It never asks the routing provider anything, so the heatmap
can't drift from the routes it is drawn over. The steps:

- the corridor is every lattice point within 25 miles of any route (``RouteIndex`` answers
  that without measuring every segment);
- the resolution is the finest multiple of 0.05 degrees, never finer than 0.1, at which the
  corridor holds at most 500 points, so one weather request covers it;
- the weather comes from the shared weather adapter, so the heatmap, the checkpoints and
  other trips reuse each other's cached forecasts;
- 49 frames, one per hour from the departure to 48 hours after it, are read off the forecast
  with the checkpoints' hour-selection rules, and each point's risk comes from the same
  classification a checkpoint gets.

Frames are flat lists aligned to ``Heatmap.indices`` and hold whole numbers, so the response
is compact: see ``FrameSet``.
"""

import math
from collections.abc import Collection, Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import cache

from . import risk, weather
from .geo import METRES_PER_DEGREE, METRES_PER_MILE, Point, RouteIndex, sample_along
from .lattice import POINTS_PER_DEGREE, LatticePoint, snap_unique

CORRIDOR_RADIUS_MILES = 25
CORRIDOR_RADIUS_M = CORRIDOR_RADIUS_MILES * METRES_PER_MILE
MAX_POINTS = 500
# The grid is every n-th lattice point. Two steps of 0.05 degrees is the finest allowed.
MIN_STEP = 2
FRAME_HOURS = 49  # departure + 0 h to departure + 48 h

# Candidate lattice points are looked for around samples of each route this far apart; a
# point within the radius of the route is then within the radius plus half of this of a sample.
_SAMPLE_STEP_M = 10 * METRES_PER_MILE
_CANDIDATE_REACH_M = CORRIDOR_RADIUS_M + _SAMPLE_STEP_M / 2

# The frames' integers. A missing forecast is ``MISSING`` in every array.
MISSING = -1
WIND_SCALE = 10  # tenths of a mile per hour
PRECIPITATION_SCALE = 1000  # thousandths of an inch per hour


@dataclass(frozen=True)
class Grid:
    """A regular grid of lattice points, ``rows`` by ``cols``, row 0 the southernmost.

    A point is addressed by its index ``row * cols + col``, and sits at
    ``origin + (row, col) * spacing_deg``.
    """

    origin_lat: float
    origin_lng: float
    spacing_deg: float
    rows: int
    cols: int


@dataclass(frozen=True)
class FrameSet:
    """Per-hour values at every corridor point, aligned to ``Heatmap.indices``.

    ``risk`` is the risk level, 0 (Low) to 4 (No Travel), without the combined-conditions
    bonus, so its bands are the checkpoint palette's. ``wind`` is in tenths of a mile per
    hour, ``rain`` and ``snow`` in thousandths of an inch per hour. ``MISSING`` marks a
    point with no forecast (for ``risk``, one the classification calls No data).
    """

    risk: list[list[int]]
    wind: list[list[int]]
    rain: list[list[int]]
    snow: list[list[int]]


@dataclass(frozen=True)
class Heatmap:
    grid: Grid
    indices: list[int]
    timestamps: list[datetime]
    frames: FrameSet


def build_heatmap(
    routes: Sequence[Sequence[Point]], departure: datetime, load_weight_lb: int
) -> Heatmap:
    """The heatmap over ``routes`` (each a list of ``(lat, lng)`` vertices) for a truck that
    leaves at ``departure`` carrying ``load_weight_lb``."""
    step, corridor = _corridor(routes)
    grid, indices = _grid(step, corridor)
    timestamps = _timestamps(departure)
    forecast = _load_forecast(corridor, timestamps)
    return Heatmap(
        grid=grid,
        indices=indices,
        timestamps=timestamps,
        frames=_frames(forecast, corridor, timestamps, load_weight_lb),
    )


def warm_forecast(
    routes: Sequence[Sequence[Point]], departure: datetime, loading_elsewhere: Collection[Point]
) -> None:
    """Load, and so cache, the forecast ``build_heatmap`` will need for these routes, apart
    from the points of ``loading_elsewhere`` (the caller is loading those itself).

    The plan does this alongside its own forecast, inside the request: the browser asks for
    the heatmap as soon as it has the plan, and finds the weather already here. A point is
    never loaded by both, so the two requests do not race to cache it.
    """
    _, corridor = _corridor(routes)
    skipped = set(snap_unique(loading_elsewhere))
    _load_forecast([point for point in corridor if point not in skipped], _timestamps(departure))


def _timestamps(departure: datetime) -> list[datetime]:
    start = departure.astimezone(UTC).replace(second=0, microsecond=0)
    return [start + timedelta(hours=hour) for hour in range(FRAME_HOURS)]


def _load_forecast(
    corridor: Sequence[LatticePoint], timestamps: Sequence[datetime]
) -> weather.Forecast:
    return weather.load_forecast(
        points=[point.coordinates for point in corridor], times=[timestamps[0], timestamps[-1]]
    )


# --- The corridor -------------------------------------------------------------------------


def _corridor(routes: Sequence[Sequence[Point]]) -> tuple[int, list[LatticePoint]]:
    """The grid step and the lattice points within 25 miles of a route, at the finest step
    (in 0.05 degrees, from ``MIN_STEP``) where there are at most ``MAX_POINTS``."""
    indexes = [RouteIndex(route, CORRIDOR_RADIUS_M) for route in routes]
    samples = [sample for route in routes for sample in _samples(route)]
    step = MIN_STEP
    while True:
        found = _corridor_at(step, indexes, samples)
        if found is not None:
            return step, found
        step += 1


def _samples(route: Sequence[Point]) -> list[Point]:
    return [*sample_along(route, _SAMPLE_STEP_M), route[-1]]


def _corridor_at(
    step: int, indexes: Sequence[RouteIndex], samples: Sequence[Point]
) -> list[LatticePoint] | None:
    """The corridor's points on the grid of every ``step``-th lattice point, or ``None`` as
    soon as there are more than ``MAX_POINTS`` (so a fine grid over a long route costs little
    to rule out)."""
    tested: set[LatticePoint] = set()
    found: list[LatticePoint] = []
    for sample in samples:
        for candidate in _candidates_near(sample, step):
            if candidate in tested:
                continue
            tested.add(candidate)
            if any(index.is_near(candidate.coordinates) for index in indexes):
                found.append(candidate)
                if len(found) > MAX_POINTS:
                    return None
    return found


def _candidates_near(sample: Point, step: int) -> Iterator[LatticePoint]:
    """Every point of the ``step`` grid within reach of ``sample``, as a box around it."""
    lat, lng = sample
    d_lat = _CANDIDATE_REACH_M / METRES_PER_DEGREE
    # A degree of longitude is shorter further north, so the box is wider there.
    widest_lat = min(abs(lat) + d_lat, 89.0)
    d_lng = d_lat / math.cos(math.radians(widest_lat))
    for north in _multiples(lat - d_lat, lat + d_lat, step):
        for east in _multiples(lng - d_lng, lng + d_lng, step):
            yield LatticePoint(north, east)


def _multiples(low: float, high: float, step: int) -> range:
    """The lattice numbers divisible by ``step`` between two coordinates in degrees."""
    first = math.ceil(low * POINTS_PER_DEGREE / step)
    last = math.floor(high * POINTS_PER_DEGREE / step)
    return range(first * step, last * step + 1, step)


def _grid(step: int, corridor: Sequence[LatticePoint]) -> tuple[Grid, list[int]]:
    """The grid that holds ``corridor`` and the index of each point in it, in ascending order."""
    south = min(point.north for point in corridor)
    west = min(point.east for point in corridor)
    rows = (max(point.north for point in corridor) - south) // step + 1
    cols = (max(point.east for point in corridor) - west) // step + 1
    grid = Grid(
        origin_lat=south / POINTS_PER_DEGREE,
        origin_lng=west / POINTS_PER_DEGREE,
        spacing_deg=round(step / POINTS_PER_DEGREE, 2),
        rows=rows,
        cols=cols,
    )
    indices = sorted(
        (point.north - south) // step * cols + (point.east - west) // step for point in corridor
    )
    return grid, indices


# --- The frames ---------------------------------------------------------------------------


def _frames(
    forecast: weather.Forecast,
    corridor: Sequence[LatticePoint],
    timestamps: Sequence[datetime],
    load_weight_lb: int,
) -> FrameSet:
    # Frames follow the grid's index order, which is row-major from the south west.
    ordered = sorted(corridor, key=lambda point: (point.north, point.east))
    levels = cache(lambda wind, rain, snow: _level(wind, rain, snow, load_weight_lb))
    frames: dict[str, list[list[int]]] = {"risk": [], "wind": [], "rain": [], "snow": []}
    for when in timestamps:
        risk_row, wind_row, rain_row, snow_row = [], [], [], []
        for point in ordered:
            conditions = forecast.conditions_at(point.coordinates, when)
            wind = _scaled(conditions.wind_mph, WIND_SCALE)
            rain = _scaled(conditions.rain_in_hr, PRECIPITATION_SCALE)
            snow = _scaled(conditions.snow_in_hr, PRECIPITATION_SCALE)
            wind_row.append(wind)
            rain_row.append(rain)
            snow_row.append(snow)
            risk_row.append(levels(wind, rain, snow))
        frames["risk"].append(risk_row)
        frames["wind"].append(wind_row)
        frames["rain"].append(rain_row)
        frames["snow"].append(snow_row)
    return FrameSet(**frames)


def _scaled(value: float | None, scale: int) -> int:
    return MISSING if value is None else round(value * scale)


def _level(wind: int, rain: int, snow: int, load_weight_lb: int) -> int:
    """The risk level, 0 to 4, of values as the frames hold them; ``MISSING`` for No data.

    The same classification as a checkpoint's, without the gusts (they never change a level)
    and without the combined-conditions bonus, which is left out of the heatmap's bands.
    """
    classification = risk.classify(
        wind_mph=None if wind == MISSING else wind / WIND_SCALE,
        gust_mph=None,
        rain_in_hr=None if rain == MISSING else rain / PRECIPITATION_SCALE,
        snow_in_hr=None if snow == MISSING else snow / PRECIPITATION_SCALE,
        load_lb=load_weight_lb,
    )
    return MISSING if classification.level is None else classification.level.score
