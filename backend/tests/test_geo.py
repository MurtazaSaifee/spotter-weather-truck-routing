"""Geometry helpers used by every route feature."""

from itertools import pairwise

import pytest

from api.geo import (
    RouteIndex,
    bearing_deg,
    decode_polyline,
    encode_polyline,
    haversine_m,
    move,
    point_along,
    sample_along,
    simplify,
)

METRES_PER_MILE = 1609.344

# The worked example from Google's encoded polyline documentation.
GOOGLE_EXAMPLE_POINTS = [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
GOOGLE_EXAMPLE_ENCODED = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"


def test_polyline_encoding_matches_the_published_example():
    assert encode_polyline(GOOGLE_EXAMPLE_POINTS) == GOOGLE_EXAMPLE_ENCODED


def test_polyline_decoding_matches_the_published_example():
    assert decode_polyline(GOOGLE_EXAMPLE_ENCODED) == pytest.approx(GOOGLE_EXAMPLE_POINTS)


def test_an_empty_polyline_round_trips():
    assert encode_polyline([]) == ""
    assert decode_polyline("") == []


def test_haversine_distance_between_chicago_and_dallas():
    # Great-circle distance, about 1,290 km.
    chicago, dallas = (41.88425, -87.63245), (32.77657, -96.79699)
    assert haversine_m(chicago, dallas) == pytest.approx(1_290_000, rel=0.01)


def test_simplify_drops_points_within_tolerance_and_keeps_the_ends():
    # A line along the equator with a 20 m bump (0.00018 degrees of latitude).
    line = [(0.0, 0.0), (0.00018, 0.01), (0.0, 0.02), (0.0, 0.03)]

    assert simplify(line, tolerance_m=100) == [0, 3]


def test_simplify_keeps_a_corner_larger_than_the_tolerance():
    # A 1 km bump (0.009 degrees of latitude) in the middle of the line.
    line = [(0.0, 0.0), (0.009, 0.01), (0.0, 0.02)]

    assert simplify(line, tolerance_m=100) == [0, 1, 2]


def test_simplify_leaves_short_lines_alone():
    assert simplify([(1.0, 1.0)], tolerance_m=100) == [0]
    assert simplify([(1.0, 1.0), (2.0, 2.0)], tolerance_m=100) == [0, 1]
    assert simplify([], tolerance_m=100) == []


# --- Sampling, bearings and the route index -------------------------------------------

# Three points on the equator, 0.1 degrees of longitude (11.1 km) from end to end.
EQUATOR_LINE = [(0.0, 0.0), (0.0, 0.05), (0.0, 0.1)]


def test_sampling_a_line_gives_a_point_at_the_start_and_one_per_step():
    samples = sample_along(EQUATOR_LINE, step_m=METRES_PER_MILE)

    # 11,119 m is 6.9 miles: samples at miles 0 to 6.
    assert len(samples) == 7
    assert samples[0] == (0.0, 0.0)
    for previous, current in pairwise(samples):
        assert haversine_m(previous, current) == pytest.approx(METRES_PER_MILE, rel=0.001)


def test_sampling_follows_the_line_round_a_corner():
    corner = [(0.0, 0.0), (0.0, 0.01), (0.01, 0.01)]  # 1.1 km east, then 1.1 km north

    samples = sample_along(corner, step_m=1000)

    assert len(samples) == 3
    assert samples[1] == pytest.approx((0.0, 0.00899), abs=0.0001)
    assert samples[2][0] == pytest.approx(0.00799, abs=0.0001)
    assert samples[2][1] == pytest.approx(0.01, abs=0.0001)


def test_sampling_a_line_shorter_than_one_step_gives_just_its_start():
    assert sample_along([(0.0, 0.0), (0.0, 0.001)], step_m=METRES_PER_MILE) == [(0.0, 0.0)]
    assert sample_along([], step_m=METRES_PER_MILE) == []


def test_the_point_half_way_along_a_line():
    middle = point_along(EQUATOR_LINE, haversine_m(EQUATOR_LINE[0], EQUATOR_LINE[-1]) / 2)

    assert middle == pytest.approx((0.0, 0.05), abs=1e-6)


def test_a_point_beyond_the_end_of_a_line_is_its_end():
    assert point_along(EQUATOR_LINE, 1_000_000) == (0.0, 0.1)


@pytest.mark.parametrize(
    ("target", "bearing"),
    [((1.0, 0.0), 0), ((0.0, 1.0), 90), ((-1.0, 0.0), 180), ((0.0, -1.0), 270)],
    ids=["north", "east", "south", "west"],
)
def test_bearing_is_degrees_clockwise_from_north(target, bearing):
    assert bearing_deg((0.0, 0.0), target) == pytest.approx(bearing, abs=0.01)


def test_moving_a_distance_along_a_bearing():
    east = move((0.0, 0.0), bearing=90, distance_m=11_119.5)  # 0.1 degrees at the equator
    north = move((40.0, -90.0), bearing=0, distance_m=111_195)  # 1 degree of latitude

    assert east == pytest.approx((0.0, 0.1), abs=1e-4)
    assert north == pytest.approx((41.0, -90.0), abs=1e-3)


def test_the_route_index_finds_points_within_its_radius_of_a_segment_not_just_a_vertex():
    # The line's vertices are 5.5 km apart; 300 m north of the middle of a segment is near it.
    index = RouteIndex(EQUATOR_LINE, radius_m=500)

    assert index.is_near((0.0027, 0.025))  # 300 m
    assert not index.is_near((0.0054, 0.025))  # 600 m
    assert not index.is_near((0.0, 0.2))  # beyond the end of the line
    assert index.is_near((0.0, 0.1))  # on the last vertex


def test_the_route_index_accounts_for_longitude_shrinking_with_latitude():
    # At 60 degrees north a degree of longitude is half as long: 0.006 degrees is 334 m.
    line = [(60.0, -100.0), (60.0, -99.9)]
    index = RouteIndex(line, radius_m=500)

    assert index.is_near((60.0027, -99.95))  # 300 m
    assert index.is_near((60.0, -100.006))  # 334 m before the start
    assert not index.is_near((60.0, -100.012))  # 667 m before the start


def test_the_route_index_works_for_a_line_of_a_single_point():
    index = RouteIndex([(10.0, 10.0)], radius_m=500)

    assert index.is_near((10.001, 10.0))
    assert not index.is_near((10.01, 10.0))
