"""The brief's risk rules: the single home of the thresholds, the load rules and the scoring.

Pure: no I/O and no Django. ``classify`` takes what the forecast says at one checkpoint and
the load, and says how risky that is and why.

Reading decisions (the README repeats them):

- Every band is a half-open interval and a value exactly on an edge goes to the higher band.
  The brief writes No Travel as "> 1.00" in/hr of rain and "> 3.0" in/hr of snow; under this
  rule exactly 1.00 and 3.0 are No Travel too.
- The load rules compare weight strictly ("more than" 30,000 / 40,000 lb), as the brief does.
- A condition that is Low did not drive anything: a Low checkpoint has no driving condition.
"""

from bisect import bisect_right
from dataclasses import dataclass
from enum import IntEnum

# Where each band starts, from Moderate up. A value at an edge is already in the band above it,
# which is what ``bisect_right`` gives.
WIND_EDGES_MPH = (25.0, 35.0, 45.0, 55.0)
RAIN_EDGES_IN_HR = (0.10, 0.25, 0.50, 1.00)
SNOW_EDGES_IN_HR = (0.5, 1.0, 2.0, 3.0)

# Load rules on wind (lb): above this weight, wind in the range is raised to the level.
HEAVY_LOAD_LB = 30_000  # 45-54 mph and above this: No Travel
VERY_HEAVY_LOAD_LB = 40_000  # 35-44 mph and above this: Severe

# Added to a checkpoint's score when two or more conditions are Moderate or worse.
COMBINED_BONUS = 0.5

CONDITIONS = ("wind", "rain", "snow")


class Level(IntEnum):
    """A risk level. The number is the level's score."""

    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def score(self) -> int:
        return int(self)


@dataclass(frozen=True)
class GustWarning:
    """Gusts alone would be this bad. Informational: it never changes the level or the score."""

    gust_mph: float
    level: Level


@dataclass(frozen=True)
class Classification:
    """How risky one checkpoint is. ``level`` is ``None`` for No data."""

    level: Level | None
    # Wind (after the load rules), rain and snow; ``None`` for one the forecast lacks.
    conditions: dict[str, Level | None]
    # The conditions at the overall level; empty for a Low or a No data checkpoint.
    driving: tuple[str, ...]
    # The conditions at Moderate or worse when two or more are; otherwise empty.
    combined: tuple[str, ...]
    # The overall level's number plus the combined bonus; ``None`` for No data.
    score: float | None
    gust_warning: GustWarning | None
    # Whether the load rules put the wind in a higher band than the table does.
    wind_raised_by_load: bool


def classify(
    *,
    wind_mph: float | None,
    gust_mph: float | None,
    rain_in_hr: float | None,
    snow_in_hr: float | None,
    load_lb: float,
) -> Classification:
    """Classify a checkpoint. ``None`` means the forecast has no value.

    Sustained wind, rain or snow missing makes the checkpoint No data: it is never taken as
    Low. A missing gust only leaves out the gust warning.
    """
    wind = None if wind_mph is None else wind_level(wind_mph, load_lb)
    rain = None if rain_in_hr is None else _band(RAIN_EDGES_IN_HR, rain_in_hr)
    snow = None if snow_in_hr is None else _band(SNOW_EDGES_IN_HR, snow_in_hr)
    conditions = {"wind": wind, "rain": rain, "snow": snow}
    raised = wind_mph is not None and wind != _band(WIND_EDGES_MPH, wind_mph)

    if wind is None or rain is None or snow is None:
        return Classification(None, conditions, (), (), None, None, raised)

    level = max(wind, rain, snow)
    driving = tuple(name for name in CONDITIONS if conditions[name] == level)
    stacked = tuple(name for name in CONDITIONS if conditions[name] >= Level.MODERATE)
    combined = stacked if len(stacked) >= 2 else ()
    return Classification(
        level=level,
        conditions=conditions,
        driving=driving if level > Level.LOW else (),
        combined=combined,
        score=level.score + (COMBINED_BONUS if combined else 0),
        gust_warning=_gust_warning(gust_mph, wind, load_lb),
        wind_raised_by_load=raised,
    )


def wind_level(mph: float, load_lb: float) -> Level:
    """The wind table's level for ``mph``, or the load rules', whichever is stricter."""
    level = _band(WIND_EDGES_MPH, mph)
    if level == Level.SEVERE and load_lb > HEAVY_LOAD_LB:
        return Level.NO_TRAVEL
    if level == Level.HIGH and load_lb > VERY_HEAVY_LOAD_LB:
        return Level.SEVERE
    return level


def _band(edges: tuple[float, ...], value: float) -> Level:
    return Level(bisect_right(edges, value))


def _gust_warning(gust_mph: float | None, sustained: Level, load_lb: float) -> GustWarning | None:
    """Gusts are put through the wind table and load rules like sustained wind. They warn only
    when that is High or worse and above what the sustained wind gives."""
    if gust_mph is None:
        return None
    level = wind_level(gust_mph, load_lb)
    if level >= Level.HIGH and level > sustained:
        return GustWarning(gust_mph, level)
    return None
