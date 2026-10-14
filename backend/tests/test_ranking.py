"""Ranking routes by risk: the pure part of the recommendation (seam 2).

Routes here are written as the numbers the ranking sees (miles at each level, average risk and
travel time), so each test names the one criterion it is about. The plan API test that puts a
real forecast through this is in test_plan_ranking.py.
"""

import pytest

from api.risk import (
    AVERAGE_RISK_TOLERANCE,
    Criterion,
    Level,
    RouteAssessment,
    assess_route,
    classify,
    rank_routes,
)

HOUR = 3_600


def route(
    route_id,
    *,
    severe=0.0,
    high=0.0,
    no_travel=0.0,
    average=0.0,
    hours=10.0,
    unassessed=0.0,
):
    return RouteAssessment(
        route_id=route_id,
        miles={Level.SEVERE: severe, Level.HIGH: high, Level.NO_TRAVEL: no_travel},
        unassessed_miles=unassessed,
        average_risk=average,
        travel_time_s=round(hours * HOUR),
    )


def order(ranking):
    return [ranked.route_id for ranked in ranking.routes]


def deciding(ranking, route_id):
    return next(ranked.deciding for ranked in ranking.routes if ranked.route_id == route_id)


# --- Eligible routes: the four criteria in order ---------------------------------------------


def test_one_severe_checkpoint_loses_to_none_even_when_hours_faster():
    fast = route("fast", severe=25.0, hours=8)
    slow = route("slow", severe=0.0, hours=20)

    ranking = rank_routes([fast, slow])

    assert order(ranking) == ["slow", "fast"]
    assert ranking.recommended_id == "slow"
    assert deciding(ranking, "fast").criterion is Criterion.SEVERE_MILES


def test_severe_miles_beat_everything_below_them():
    # Fewer Severe miles wins although the other has far fewer High miles and lower risk.
    a = route("a", severe=10.0, high=0.0, average=0.1, hours=5)
    b = route("b", severe=5.0, high=300.0, average=2.5, hours=30)

    assert order(rank_routes([a, b])) == ["b", "a"]


def test_high_miles_decide_when_severe_miles_tie():
    a = route("a", severe=10.0, high=50.0, average=0.1, hours=5)
    b = route("b", severe=10.0, high=25.0, average=2.0, hours=30)

    ranking = rank_routes([a, b])

    assert order(ranking) == ["b", "a"]
    decider = deciding(ranking, "a")
    assert decider.criterion is Criterion.HIGH_MILES
    assert (decider.recommended_value, decider.alternative_value) == (25.0, 50.0)


def test_miles_are_compared_exactly_after_rounding_to_a_tenth():
    # 12.04 and 11.96 are both 12.0 mi: a tie, so the next criterion (time) decides.
    a = route("a", severe=12.04, hours=9)
    b = route("b", severe=11.96, hours=8)
    assert order(rank_routes([a, b])) == ["b", "a"]
    assert deciding(rank_routes([a, b]), "a").criterion is Criterion.TRAVEL_TIME

    # 12.04 and 11.94 round to 12.0 and 11.9: not a tie, however slow the calmer one is.
    calmer = route("calmer", severe=11.94, hours=20)
    ranking = rank_routes([a, calmer])
    assert order(ranking) == ["calmer", "a"]
    assert deciding(ranking, "a").criterion is Criterion.SEVERE_MILES


def test_average_risk_within_the_tolerance_falls_through_to_travel_time():
    calm = route("calm", average=1.00, hours=14)
    quick = route("quick", average=1.00 + AVERAGE_RISK_TOLERANCE, hours=10)

    ranking = rank_routes([calm, quick])

    # Exactly 0.25 apart is still within it.
    assert order(ranking) == ["quick", "calm"]
    decider = deciding(ranking, "calm")
    assert decider.criterion is Criterion.TRAVEL_TIME
    assert (decider.recommended_value, decider.alternative_value) == (10 * HOUR, 14 * HOUR)


def test_average_risk_beyond_the_tolerance_decides():
    calm = route("calm", average=1.00, hours=14)
    quick = route("quick", average=1.26, hours=10)

    ranking = rank_routes([quick, calm])

    assert order(ranking) == ["calm", "quick"]
    decider = deciding(ranking, "quick")
    assert decider.criterion is Criterion.AVERAGE_RISK
    assert (decider.recommended_value, decider.alternative_value) == (1.00, 1.26)


def test_shortest_travel_time_wins_when_everything_else_ties():
    slow = route("slow", hours=12)
    quick = route("quick", hours=11.5)

    assert order(rank_routes([slow, quick])) == ["quick", "slow"]


def test_identical_routes_keep_the_order_they_came_in():
    a, b, c = route("a"), route("b"), route("c")

    assert order(rank_routes([b, c, a])) == ["b", "c", "a"]


# --- The tolerance is not a pairwise "close enough" ---------------------------------------


def test_chained_near_ties_give_one_deterministic_order_whatever_the_input_order():
    # a-b and b-c are each within 0.25, a-c is not. Survivors are those within 0.25 of the best
    # (a, at 1.00): a and b. Time picks b (faster). Then of a and c: c is 0.50 above a, so a
    # wins on risk. Pairwise "close enough" could not give a consistent order here.
    a = route("a", average=1.00, hours=12)
    b = route("b", average=1.20, hours=9)
    c = route("c", average=1.40, hours=6)

    orders = {
        tuple(order(rank_routes(permutation)))
        for permutation in ([a, b, c], [c, b, a], [b, a, c], [c, a, b], [a, c, b], [b, c, a])
    }

    assert orders == {("b", "a", "c")}


def test_a_route_out_of_tolerance_of_the_best_is_not_saved_by_being_close_to_the_winner():
    a = route("a", average=1.00, hours=12)
    b = route("b", average=1.20, hours=9)
    c = route("c", average=1.40, hours=6)

    ranking = rank_routes([a, b, c])

    assert ranking.recommended_id == "b"
    # c is only 0.20 above b (within tolerance of it) and faster than it, yet it was out at the
    # average-risk step because it is 0.40 above the best: that is the deciding criterion.
    decider = deciding(ranking, "c")
    assert decider.criterion is Criterion.AVERAGE_RISK
    assert (decider.recommended_value, decider.alternative_value) == (1.20, 1.40)
    assert decider.best_average_risk == 1.00
    assert deciding(ranking, "a").criterion is Criterion.TRAVEL_TIME


# --- Blocked routes --------------------------------------------------------------------------


def test_a_blocked_route_ranks_after_every_eligible_one_however_good_its_numbers():
    blocked = route("blocked", no_travel=0.5, average=0.0, hours=1)
    worst_eligible = route("eligible", severe=400.0, high=300.0, average=3.0, hours=40)

    ranking = rank_routes([blocked, worst_eligible])

    assert order(ranking) == ["eligible", "blocked"]
    assert ranking.recommended_id == "eligible"
    assert [ranked.blocked for ranked in ranking.routes] == [False, True]
    decider = deciding(ranking, "blocked")
    assert decider.criterion is Criterion.BLOCKED
    assert (decider.recommended_value, decider.alternative_value) == (0.0, 0.5)


def test_blocked_routes_are_ordered_by_fewest_no_travel_miles_then_the_same_criteria():
    most = route("most", no_travel=30.0)
    least_slow = route("least_slow", no_travel=10.0, severe=5.0, hours=9)
    least_calm = route("least_calm", no_travel=10.0, severe=0.0, hours=20)
    middle = route("middle", no_travel=20.0)

    ranking = rank_routes([most, least_slow, middle, least_calm])

    assert order(ranking) == ["least_calm", "least_slow", "middle", "most"]


def test_blocked_routes_with_equal_no_travel_miles_fall_back_to_travel_time():
    slow = route("slow", no_travel=10.0, hours=12)
    quick = route("quick", no_travel=10.0, hours=9)

    assert order(rank_routes([slow, quick])) == ["quick", "slow"]


def test_all_blocked_gives_no_recommendation():
    ranking = rank_routes([route("a", no_travel=10.0), route("b", no_travel=5.0)])

    assert ranking.recommended_id is None
    assert ranking.all_blocked
    assert order(ranking) == ["b", "a"]
    assert [ranked.blocked for ranked in ranking.routes] == [True, True]
    # Nothing is recommended, so there is nothing to compare against.
    assert [ranked.deciding for ranked in ranking.routes] == [None, None]


def test_a_recommendation_exists_when_any_route_is_eligible():
    ranking = rank_routes([route("a", no_travel=10.0), route("b")])

    assert ranking.recommended_id == "b"
    assert not ranking.all_blocked


# --- Ranks and the deciding criterion --------------------------------------------------------


def test_ranks_count_from_one_in_order_and_the_winner_has_no_deciding_criterion():
    ranking = rank_routes([route("a", severe=9.0), route("b"), route("c", severe=3.0)])

    assert [(ranked.route_id, ranked.rank) for ranked in ranking.routes] == [
        ("b", 1),
        ("c", 2),
        ("a", 3),
    ]
    assert deciding(ranking, "b") is None


def test_every_alternative_is_explained_by_the_step_where_it_dropped_out():
    best = route("best", average=0.5, hours=10)
    high = route("high", high=40.0, hours=7)
    severe = route("severe", severe=3.0, hours=6)
    slow = route("slow", average=0.6, hours=13)

    ranking = rank_routes([severe, high, slow, best])

    assert ranking.recommended_id == "best"
    assert deciding(ranking, "severe").criterion is Criterion.SEVERE_MILES
    assert deciding(ranking, "high").criterion is Criterion.HIGH_MILES
    assert deciding(ranking, "slow").criterion is Criterion.TRAVEL_TIME


def test_a_single_route_is_recommended_with_nothing_to_compare():
    ranking = rank_routes([route("only")])

    assert ranking.recommended_id == "only"
    assert deciding(ranking, "only") is None


def test_no_routes_gives_an_empty_ranking_without_a_recommendation():
    ranking = rank_routes([])

    assert ranking.routes == []
    assert ranking.recommended_id is None
    assert not ranking.all_blocked


def test_a_route_with_nothing_assessed_is_not_rewarded_for_missing_data():
    unknown = RouteAssessment(
        route_id="unknown",
        miles={},
        unassessed_miles=500.0,
        average_risk=None,
        travel_time_s=5 * HOUR,
    )
    known = route("known", average=2.0, hours=20)

    ranking = rank_routes([unknown, known])

    assert order(ranking) == ["known", "unknown"]
    assert deciding(ranking, "unknown").criterion is Criterion.AVERAGE_RISK


# --- Assessing a route from its checkpoints --------------------------------------------------


def checkpoint(covered_miles, **forecast):
    values = {"wind_mph": 5.0, "gust_mph": 5.0, "rain_in_hr": 0.0, "snow_in_hr": 0.0, **forecast}
    return covered_miles, classify(load_lb=20_000, **values)


NO_DATA = {"wind_mph": None}


def test_assessing_a_route_sums_covered_miles_by_level_and_counts_unassessed_miles():
    assessment = assess_route(
        "r",
        travel_time_s=HOUR,
        checkpoints=[
            checkpoint(5.0),  # Low
            checkpoint(10.0, wind_mph=50.0),  # Severe
            checkpoint(10.0, wind_mph=50.0),  # Severe
            checkpoint(7.5, rain_in_hr=0.3),  # High
            checkpoint(2.5, **NO_DATA),  # No data
            checkpoint(5.0, wind_mph=60.0),  # No Travel (any load)
        ],
    )

    assert assessment.severe_miles == 20.0
    assert assessment.high_miles == 7.5
    assert assessment.no_travel_miles == 5.0
    assert assessment.low_miles == 5.0
    assert assessment.moderate_miles == 0.0
    assert assessment.unassessed_miles == 2.5
    assert assessment.blocked


def test_average_risk_is_the_covered_miles_weighted_mean_of_the_assessed_scores():
    assessment = assess_route(
        "r",
        travel_time_s=HOUR,
        checkpoints=[
            checkpoint(10.0),  # score 0
            checkpoint(30.0, wind_mph=30.0),  # Moderate: score 1
            checkpoint(10.0, wind_mph=30.0, snow_in_hr=0.5),  # Moderate, combined: 1.5
            checkpoint(50.0, **NO_DATA),  # left out of the mean entirely
        ],
    )

    # (10 * 0 + 30 * 1 + 10 * 1.5) / 50
    assert assessment.average_risk == pytest.approx(0.9)
    assert not assessment.blocked


def test_a_route_with_no_assessed_checkpoint_has_no_average_risk():
    assessment = assess_route("r", travel_time_s=HOUR, checkpoints=[checkpoint(8.0, **NO_DATA)])

    assert assessment.average_risk is None
    assert assessment.unassessed_miles == 8.0
