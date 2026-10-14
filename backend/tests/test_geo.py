"""Geometry helpers used by every route feature."""

import pytest

from api.geo import decode_polyline, encode_polyline, haversine_m, simplify

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
