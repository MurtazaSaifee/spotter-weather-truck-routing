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
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from enum import IntEnum, StrEnum

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
    Low. The one exception is a known No Travel: it is the top level, so what is missing cannot
    change it, and the checkpoint is No Travel driven by the known conditions. Every lower known
    level stays No data, because the missing values could raise it. A missing gust only leaves
    out the gust warning.
    """
    wind = None if wind_mph is None else wind_level(wind_mph, load_lb)
    rain = None if rain_in_hr is None else _band(RAIN_EDGES_IN_HR, rain_in_hr)
    snow = None if snow_in_hr is None else _band(SNOW_EDGES_IN_HR, snow_in_hr)
    conditions = {"wind": wind, "rain": rain, "snow": snow}
    raised = wind_mph is not None and wind != _band(WIND_EDGES_MPH, wind_mph)

    known = {name: level for name, level in conditions.items() if level is not None}
    level = max(known.values(), default=None)
    if len(known) < len(conditions) and level != Level.NO_TRAVEL:
        return Classification(None, conditions, (), (), None, None, raised)

    assert level is not None  # some condition is known: all of them, or a No Travel
    driving = tuple(name for name in known if known[name] == level)
    stacked = tuple(name for name in known if known[name] >= Level.MODERATE)
    combined = stacked if len(stacked) >= 2 else ()
    return Classification(
        level=level,
        conditions=conditions,
        driving=driving if level > Level.LOW else (),
        combined=combined,
        score=level.score + (COMBINED_BONUS if combined else 0),
        gust_warning=_gust_warning(gust_mph, wind if wind is not None else Level.LOW, load_lb),
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


# --- Ranking routes ----------------------------------------------------------------------------
#
# Reading decisions for the recommendation (the README repeats them):
#
# - Eligible routes (no No Travel checkpoint) always rank above blocked ones; blocked routes are
#   ordered by fewest No Travel miles, then by the same criteria.
# - Severe and High miles are compared exactly after rounding to 0.1 mi.
# - Average risk keeps every route within ``AVERAGE_RISK_TOLERANCE`` of the best one (exactly
#   0.25 away is still within it) and travel time decides among them. The winner ranks first and
#   the procedure repeats on the rest, so the order is the same whatever order routes come in.
#   A pairwise "close enough" would not be transitive.
# - A route with nothing assessed has no average risk; it is never kept at the average-risk step
#   while any other route has one, so missing data is not rewarded.
# - Whatever ties through every criterion keeps the order the routes came in.
# - A route's deciding criterion is the step at which the winner's selection dropped it. That is
#   the first criterion separating it from the recommendation, except that a route dropped at
#   the average-risk step can be within 0.25 of the winner itself (and even faster); it is out
#   because it is more than 0.25 above the best route, whose value is reported with it.

# The largest gap in average risk that still counts as a tie.
AVERAGE_RISK_TOLERANCE = 0.25
MILES_DECIMALS = 1
# Float slack, so a gap that is 0.25 on paper is not lost to representation error.
_TOLERANCE_SLACK = 1e-9


class Criterion(StrEnum):
    """What separated a route from the recommendation, in the order the criteria apply."""

    BLOCKED = "blocked"
    SEVERE_MILES = "severe_miles"
    HIGH_MILES = "high_miles"
    AVERAGE_RISK = "average_risk"
    TRAVEL_TIME = "travel_time"


@dataclass(frozen=True)
class RouteAssessment:
    """What the ranking sees of a route: miles at each level, average risk and travel time."""

    route_id: str
    # Covered miles of the checkpoints at each assessed level (a missing level is 0 mi).
    miles: Mapping[Level, float]
    # Covered miles of the No data checkpoints.
    unassessed_miles: float
    # The covered-miles-weighted mean of the assessed scores; ``None`` if nothing was assessed.
    average_risk: float | None
    travel_time_s: int

    @property
    def low_miles(self) -> float:
        return self.miles.get(Level.LOW, 0.0)

    @property
    def moderate_miles(self) -> float:
        return self.miles.get(Level.MODERATE, 0.0)

    @property
    def high_miles(self) -> float:
        return self.miles.get(Level.HIGH, 0.0)

    @property
    def severe_miles(self) -> float:
        return self.miles.get(Level.SEVERE, 0.0)

    @property
    def no_travel_miles(self) -> float:
        return self.miles.get(Level.NO_TRAVEL, 0.0)

    @property
    def blocked(self) -> bool:
        """Any No Travel checkpoint blocks the route."""
        return self.no_travel_miles > 0


def assess_route(
    route_id: str,
    *,
    travel_time_s: int,
    checkpoints: Iterable[tuple[float, Classification]],
) -> RouteAssessment:
    """A route's risk mileage and average risk from its checkpoints, each given as the miles it
    covers and its classification. No data checkpoints count as unassessed miles only."""
    miles: dict[Level, float] = defaultdict(float)
    unassessed = 0.0
    weighted_score = 0.0
    assessed = 0.0
    for covered_miles, classification in checkpoints:
        if classification.level is None or classification.score is None:
            unassessed += covered_miles
            continue
        miles[classification.level] += covered_miles
        weighted_score += classification.score * covered_miles
        assessed += covered_miles
    return RouteAssessment(
        route_id=route_id,
        miles=dict(miles),
        unassessed_miles=unassessed,
        average_risk=weighted_score / assessed if assessed else None,
        travel_time_s=travel_time_s,
    )


@dataclass(frozen=True)
class Decider:
    """Why the recommendation beat one alternative, with both values.

    Miles are rounded to 0.1, the average risk is as computed and the time is in seconds. For
    ``BLOCKED`` the values are the No Travel miles. ``best_average_risk`` is set only for
    ``AVERAGE_RISK``: the lowest in the field, which the tolerance is measured from.
    """

    criterion: Criterion
    recommended_value: float | None
    alternative_value: float | None
    best_average_risk: float | None = None


@dataclass(frozen=True)
class RankedRoute:
    route_id: str
    rank: int
    blocked: bool
    # Against the recommended route; ``None`` for it and when nothing is recommended.
    deciding: Decider | None


@dataclass(frozen=True)
class Ranking:
    routes: list[RankedRoute]  # best first
    recommended_id: str | None

    @property
    def all_blocked(self) -> bool:
        return bool(self.routes) and self.recommended_id is None


def rank_routes(assessments: Sequence[RouteAssessment]) -> Ranking:
    """Order routes best first and recommend the first if it is eligible."""
    remaining_eligible = [a for a in assessments if not a.blocked]
    remaining_blocked = [a for a in assessments if a.blocked]
    ordered: list[RouteAssessment] = []
    deciding: dict[str, Decider] = {}

    first_round = True
    while remaining_eligible:
        winner, dropped = _winner(remaining_eligible, by_no_travel_first=False)
        if first_round:
            deciding = dropped
            first_round = False
        ordered.append(winner)
        remaining_eligible.remove(winner)
    recommended = ordered[0] if ordered else None

    while remaining_blocked:
        winner, _ = _winner(remaining_blocked, by_no_travel_first=True)
        ordered.append(winner)
        remaining_blocked.remove(winner)
    if recommended:
        for assessment in ordered:
            if assessment.blocked:
                deciding[assessment.route_id] = Decider(
                    Criterion.BLOCKED, 0.0, _tenth(assessment.no_travel_miles)
                )

    return Ranking(
        routes=[
            RankedRoute(a.route_id, rank, a.blocked, deciding.get(a.route_id))
            for rank, a in enumerate(ordered, start=1)
        ],
        recommended_id=recommended.route_id if recommended else None,
    )


def _tenth(miles: float) -> float:
    return round(miles, MILES_DECIMALS)


# The value each criterion compares: miles to a tenth, average risk as it is, time in seconds.
_VALUES: dict[Criterion, Callable[[RouteAssessment], float | None]] = {
    Criterion.BLOCKED: lambda a: _tenth(a.no_travel_miles),
    Criterion.SEVERE_MILES: lambda a: _tenth(a.severe_miles),
    Criterion.HIGH_MILES: lambda a: _tenth(a.high_miles),
    Criterion.AVERAGE_RISK: lambda a: a.average_risk,
    Criterion.TRAVEL_TIME: lambda a: a.travel_time_s,
}
# The criteria that keep only the routes equal to the best.
_EXACT_CRITERIA = (Criterion.SEVERE_MILES, Criterion.HIGH_MILES)


def _winner(
    pool: Sequence[RouteAssessment], *, by_no_travel_first: bool
) -> tuple[RouteAssessment, dict[str, Decider]]:
    """The best of ``pool``, and for each other route why the selection dropped it."""
    survivors = list(pool)
    # Route id -> (criterion it was dropped at, best average risk if that was the criterion).
    dropped: dict[str, tuple[Criterion, float | None]] = {}

    def keep_only(kept: list[RouteAssessment], criterion: Criterion, best: float | None = None):
        kept_ids = {a.route_id for a in kept}
        for assessment in survivors:
            if assessment.route_id not in kept_ids:
                dropped[assessment.route_id] = (criterion, best)
        return kept

    exact = (Criterion.BLOCKED, *_EXACT_CRITERIA) if by_no_travel_first else _EXACT_CRITERIA
    for criterion in exact:
        value = _VALUES[criterion]
        best = min(value(a) for a in survivors)  # type: ignore[type-var]
        survivors = keep_only([a for a in survivors if value(a) == best], criterion)

    assessed = [a.average_risk for a in survivors if a.average_risk is not None]
    if assessed:
        best_average = min(assessed)
        within = [
            a
            for a in survivors
            if a.average_risk is not None
            and a.average_risk <= best_average + AVERAGE_RISK_TOLERANCE + _TOLERANCE_SLACK
        ]
        survivors = keep_only(within, Criterion.AVERAGE_RISK, best_average)

    # ``min`` takes the first of equals: routes tied on everything keep their order.
    winner = min(survivors, key=lambda a: a.travel_time_s)
    keep_only([winner], Criterion.TRAVEL_TIME)

    by_id = {a.route_id: a for a in pool}
    return winner, {
        route_id: Decider(
            criterion,
            _VALUES[criterion](winner),
            _VALUES[criterion](by_id[route_id]),
            best_average,
        )
        for route_id, (criterion, best_average) in dropped.items()
    }
