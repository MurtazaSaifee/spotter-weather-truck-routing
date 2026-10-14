"""The weather lattice: one 0.05 degree grid that every weather lookup snaps to.

A lookup for a checkpoint, a route or a heatmap cell lands on the same grid, so one
forecast is shared by all of them. 0.05 degrees is at most about 2.5 miles of displacement,
finer than the 0.11 degree grid of the weather model behind the forecasts. A heatmap uses a
coarser grid by taking every n-th lattice point.

Points are ``(lat, lng)`` tuples in degrees. Nothing here does I/O or touches Django.
"""

from collections.abc import Iterable
from typing import NamedTuple

from .geo import Point

# Lattice points per degree: the grid spacing is 1 / POINTS_PER_DEGREE = 0.05 degrees.
POINTS_PER_DEGREE = 20


class LatticePoint(NamedTuple):
    """A grid point, as whole steps of 0.05 degrees north of the equator and east of Greenwich.

    Whole numbers rather than degrees, so two points are the same point exactly when they are
    equal, and a point has no floating-point spelling to disagree about.
    """

    north: int
    east: int

    @property
    def lat(self) -> float:
        return self.north / POINTS_PER_DEGREE

    @property
    def lng(self) -> float:
        return self.east / POINTS_PER_DEGREE

    @property
    def coordinates(self) -> Point:
        return self.lat, self.lng


def snap(point: Point) -> LatticePoint:
    """The lattice point nearest ``point``."""
    lat, lng = point
    return LatticePoint(round(lat * POINTS_PER_DEGREE), round(lng * POINTS_PER_DEGREE))


def snap_unique(points: Iterable[Point]) -> list[LatticePoint]:
    """The distinct lattice points ``points`` land on, in the order they first appear."""
    return list(dict.fromkeys(snap(point) for point in points))
