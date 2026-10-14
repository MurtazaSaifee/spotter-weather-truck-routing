"""The risk rules, one table at a time.

The module under test is pure, so these tests call it directly: the checkpoint's sustained wind,
gust, rain and snow rates and the load go in, the classification comes out. The expected levels are
read off the brief's tables (docs/assignment.md) with the one reading decision the spec makes:
a value exactly on a band edge belongs to the higher band.
"""

import pytest

from api.risk import Level, classify

LOW, MODERATE, HIGH, SEVERE, NO_TRAVEL = (
    Level.LOW,
    Level.MODERATE,
    Level.HIGH,
    Level.SEVERE,
    Level.NO_TRAVEL,
)

LIGHT = 10_000  # no load rule applies at or below 30,000 lb


def classify_one(*, wind=0.0, gust=None, rain=0.0, snow=0.0, load=LIGHT):
    return classify(wind_mph=wind, gust_mph=gust, rain_in_hr=rain, snow_in_hr=snow, load_lb=load)


# --- Band edges ----------------------------------------------------------------------------
# Each row: value, level. The values straddle every edge: just under, exactly on, just over.

WIND_EDGES = [
    (0.0, LOW),
    (24.9, LOW),
    (25.0, MODERATE),
    (25.1, MODERATE),
    (34.9, MODERATE),
    (35.0, HIGH),
    (44.9, HIGH),
    (45.0, SEVERE),
    (54.9, SEVERE),
    (55.0, NO_TRAVEL),
    (80.0, NO_TRAVEL),
]

RAIN_EDGES = [
    (0.0, LOW),
    (0.099, LOW),
    (0.10, MODERATE),
    (0.249, MODERATE),
    (0.25, HIGH),
    (0.499, HIGH),
    (0.50, SEVERE),
    (0.999, SEVERE),
    # The brief writes "> 1.00"; on the edge the higher band wins, so exactly 1.00 is No Travel.
    (1.00, NO_TRAVEL),
    (1.001, NO_TRAVEL),
    (3.0, NO_TRAVEL),
]

SNOW_EDGES = [
    (0.0, LOW),
    (0.4, LOW),
    (0.5, MODERATE),
    (0.9, MODERATE),
    (1.0, HIGH),
    (1.9, HIGH),
    (2.0, SEVERE),
    (2.9, SEVERE),
    # "> 3.0" in the brief; exactly 3.0 is No Travel by the higher-band rule.
    (3.0, NO_TRAVEL),
    (3.1, NO_TRAVEL),
    (6.0, NO_TRAVEL),
]


@pytest.mark.parametrize(("wind", "level"), WIND_EDGES)
def test_wind_bands(wind, level):
    result = classify_one(wind=wind)
    assert result.conditions["wind"] == level
    assert result.level == level


@pytest.mark.parametrize(("rain", "level"), RAIN_EDGES)
def test_rain_bands(rain, level):
    result = classify_one(rain=rain)
    assert result.conditions["rain"] == level
    assert result.level == level


@pytest.mark.parametrize(("snow", "level"), SNOW_EDGES)
def test_snow_bands(snow, level):
    result = classify_one(snow=snow)
    assert result.conditions["snow"] == level
    assert result.level == level


# --- Load rules on wind ---------------------------------------------------------------------
# Each row: wind, load (lb), the wind level once the load rules are applied.

LOAD_RULES = [
    # 45-54 mph is Severe by the table, No Travel above 30,000 lb. The comparison is strict:
    # exactly 30,000 lb does not escalate.
    (45.0, 30_000, SEVERE),
    (45.0, 30_001, NO_TRAVEL),
    (54.9, 30_000, SEVERE),
    (54.9, 30_001, NO_TRAVEL),
    (54.9, 50_000, NO_TRAVEL),
    # 35-44 mph is High by the table, Severe above 40,000 lb; exactly 40,000 lb does not escalate.
    (35.0, 40_000, HIGH),
    (35.0, 40_001, SEVERE),
    (44.9, 40_000, HIGH),
    (44.9, 40_001, SEVERE),
    (44.9, 50_000, SEVERE),
    # A heavy load is not enough to escalate a wind below 35 mph...
    (34.9, 50_000, MODERATE),
    (25.0, 50_000, MODERATE),
    (24.9, 50_000, LOW),
    # ...and 45-54 mph at 40,000 lb is already No Travel, not capped at Severe.
    (45.0, 40_000, NO_TRAVEL),
    # 55 mph and above is No Travel for any load.
    (55.0, 1, NO_TRAVEL),
    (55.0, 10_000, NO_TRAVEL),
    (70.0, 30_000, NO_TRAVEL),
]


@pytest.mark.parametrize(("wind", "load", "level"), LOAD_RULES)
def test_load_rules_on_wind(wind, load, level):
    result = classify_one(wind=wind, load=load)
    assert result.conditions["wind"] == level
    assert result.level == level


def test_load_rules_do_not_touch_rain_or_snow():
    result = classify_one(rain=0.3, snow=0.6, load=50_000)
    assert result.conditions == {"wind": LOW, "rain": HIGH, "snow": MODERATE}


@pytest.mark.parametrize(
    ("wind", "load", "raised"),
    [
        (45.0, 30_001, True),
        (35.0, 40_001, True),
        (45.0, 30_000, False),
        (35.0, 40_000, False),
        (55.0, 50_000, False),  # No Travel by the table alone
        (20.0, 50_000, False),
    ],
)
def test_it_says_when_the_load_rules_raised_the_wind_level(wind, load, raised):
    assert classify_one(wind=wind, load=load).wind_raised_by_load is raised


# --- Worst-of and the driving condition ---------------------------------------------------

WORST_OF = [
    # wind, rain, snow -> overall level, driving conditions
    ((10.0, 0.0, 0.0), LOW, ()),  # nothing drove a Low level
    ((30.0, 0.0, 0.0), MODERATE, ("wind",)),
    ((10.0, 0.3, 0.0), HIGH, ("rain",)),
    ((10.0, 0.0, 2.5), SEVERE, ("snow",)),
    ((30.0, 0.3, 0.0), HIGH, ("rain",)),
    ((40.0, 0.3, 2.5), SEVERE, ("snow",)),
    ((40.0, 0.3, 0.0), HIGH, ("wind", "rain")),  # tied: both drive it
    ((30.0, 0.15, 0.6), MODERATE, ("wind", "rain", "snow")),
    ((56.0, 1.0, 3.0), NO_TRAVEL, ("wind", "rain", "snow")),
    ((10.0, 1.0, 0.0), NO_TRAVEL, ("rain",)),
]


@pytest.mark.parametrize(("weather", "level", "driving"), WORST_OF)
def test_overall_level_is_the_worst_condition_and_names_what_drove_it(weather, level, driving):
    wind, rain, snow = weather

    result = classify_one(wind=wind, rain=rain, snow=snow)

    assert result.level == level
    assert result.driving == driving


def test_the_driving_condition_is_judged_after_the_load_rules():
    # Wind 40 is High by the table and the same as rain 0.3; at 41,000 lb the wind is Severe, so
    # it alone drives the level.
    result = classify_one(wind=40.0, rain=0.3, load=41_000)

    assert result.level == SEVERE
    assert result.driving == ("wind",)


# --- Combined conditions and the score -----------------------------------------------------

COMBINED = [
    # wind, rain, snow -> conditions flagged as stacked, score
    ((10.0, 0.0, 0.0), (), 0.0),
    ((30.0, 0.0, 0.0), (), 1.0),  # one condition alone is not "combined"
    ((10.0, 0.3, 0.0), (), 2.0),
    ((30.0, 0.1, 0.0), ("wind", "rain"), 1.5),  # Moderate + Moderate
    ((30.0, 0.0, 0.5), ("wind", "snow"), 1.5),
    ((10.0, 0.1, 0.5), ("rain", "snow"), 1.5),
    ((30.0, 0.1, 0.5), ("wind", "rain", "snow"), 1.5),
    ((24.9, 0.099, 0.4), (), 0.0),  # all just below Moderate
    ((24.9, 0.3, 0.5), ("rain", "snow"), 2.5),  # High + Moderate
    ((45.0, 0.0, 1.0), ("wind", "snow"), 3.5),  # Severe + High
    ((56.0, 1.0, 3.0), ("wind", "rain", "snow"), 4.5),
    ((10.0, 1.0, 0.0), (), 4.0),
]


@pytest.mark.parametrize(("weather", "combined", "score"), COMBINED)
def test_combined_flag_and_score(weather, combined, score):
    wind, rain, snow = weather

    result = classify_one(wind=wind, rain=rain, snow=snow)

    assert result.combined == combined
    assert result.score == score


def test_the_combined_bonus_never_changes_the_level():
    result = classify_one(wind=30.0, snow=0.5)

    assert result.level == MODERATE
    assert result.score == 1.5


def test_the_score_uses_the_wind_level_after_the_load_rules():
    # 40 mph is High by the table and Severe at this load, so the score starts from 3.
    result = classify_one(wind=40.0, rain=0.1, load=45_000)

    assert result.combined == ("wind", "rain")
    assert result.score == 3.5  # Severe 3 + 0.5


@pytest.mark.parametrize(
    ("level", "score"), [(LOW, 0), (MODERATE, 1), (HIGH, 2), (SEVERE, 3), (NO_TRAVEL, 4)]
)
def test_levels_score_zero_to_four(level, score):
    assert level.score == score


# --- Gust warning ---------------------------------------------------------------------------

GUST_WARNING = [
    # sustained wind, gust, load -> warning level, or None
    (20.0, 38.0, LIGHT, HIGH),  # gusts alone reach High, sustained is Low
    (20.0, 35.0, LIGHT, HIGH),  # exactly on the High edge counts
    (20.0, 45.0, LIGHT, SEVERE),
    (20.0, 55.0, LIGHT, NO_TRAVEL),
    (30.0, 40.0, LIGHT, HIGH),  # above the Moderate sustained level
    (20.0, 34.9, LIGHT, None),  # a breezy day: gusts only Moderate
    (20.0, 29.0, LIGHT, None),
    (5.0, 10.0, LIGHT, None),
    (40.0, 42.0, LIGHT, None),  # High gusts, but sustained is already High: nothing above it
    (40.0, 44.9, LIGHT, None),
    (40.0, 50.0, LIGHT, SEVERE),  # gusts a band above sustained High
    (50.0, 50.0, LIGHT, None),  # same band as sustained
    (20.0, None, LIGHT, None),  # no gust forecast: no warning
    # Gusts run through the load rules too: 40 mph gusts are Severe for a 41,000 lb load.
    (20.0, 40.0, 41_000, SEVERE),
    (20.0, 40.0, 40_000, HIGH),
    (20.0, 50.0, 30_001, NO_TRAVEL),
    (20.0, 50.0, 30_000, SEVERE),
    # Sustained wind at 36 mph with 41,000 lb is already Severe; 41 mph gusts reach no higher.
    (36.0, 41.0, 41_000, None),
    (36.0, 46.0, 41_000, NO_TRAVEL),  # 46 mph gusts at that load are No Travel (> 30,000 lb)
]


@pytest.mark.parametrize(("wind", "gust", "load", "level"), GUST_WARNING)
def test_gust_warning(wind, gust, load, level):
    result = classify_one(wind=wind, gust=gust, load=load)

    if level is None:
        assert result.gust_warning is None
    else:
        assert result.gust_warning is not None
        assert result.gust_warning.gust_mph == gust
        assert result.gust_warning.level == level


def test_the_gust_warning_changes_neither_level_nor_score():
    with_gusts = classify_one(wind=20.0, gust=60.0)
    without = classify_one(wind=20.0, gust=None)

    assert with_gusts.gust_warning is not None
    assert (with_gusts.level, with_gusts.score, with_gusts.driving) == (
        without.level,
        without.score,
        without.driving,
    )
    assert with_gusts.level == LOW


# --- No data --------------------------------------------------------------------------------


def test_missing_sustained_wind_rain_or_snow_is_no_data_never_low():
    for missing in ("wind", "rain", "snow"):
        values = {"wind": 5.0, "rain": 0.0, "snow": 0.0, missing: None}

        result = classify_one(**values)

        assert result.level is None, missing
        assert result.score is None
        assert result.driving == ()
        assert result.combined == ()
        assert result.gust_warning is None
        assert result.conditions[missing] is None


def test_no_data_still_reports_the_conditions_that_are_known():
    result = classify_one(wind=60.0, rain=None)

    assert result.level is None
    assert result.conditions == {"wind": NO_TRAVEL, "rain": None, "snow": LOW}


def test_everything_missing_is_no_data():
    result = classify(wind_mph=None, gust_mph=None, rain_in_hr=None, snow_in_hr=None, load_lb=1)

    assert result.level is None
    assert result.conditions == {"wind": None, "rain": None, "snow": None}


def test_a_missing_gust_does_not_make_the_checkpoint_no_data():
    result = classify_one(wind=5.0, gust=None)

    assert result.level == LOW
    assert result.score == 0.0
    assert result.gust_warning is None
