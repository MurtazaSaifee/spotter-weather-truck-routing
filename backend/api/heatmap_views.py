"""The trip heatmap endpoint: its request's validation rules, its response's shape and the view."""

from datetime import datetime

from drf_spectacular.utils import OpenApiResponse, extend_schema, extend_schema_field
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import heatmap
from .geo import Point, decode_polyline
from .serializers import (
    NORTH_AMERICA_LAT,
    NORTH_AMERICA_LNG,
    ErrorSerializer,
    LoadWeightField,
    OffsetDateTimeField,
    check_departure_window,
)

MAX_GEOMETRIES = 3
# Routes are simplified to about 100 m before they reach the browser: a coast-to-coast one is
# a few thousand vertices. An encoded vertex takes a handful of characters.
MAX_VERTICES = 5_000
MAX_GEOMETRY_CHARS = 60_000


class HeatmapRequestSerializer(serializers.Serializer):
    geometries = serializers.ListField(
        child=serializers.CharField(max_length=MAX_GEOMETRY_CHARS),
        min_length=1,
        max_length=MAX_GEOMETRIES,
        help_text=(
            "The routes on screen, each as the encoded polyline (precision 5) the plan "
            f"returned. At most {MAX_GEOMETRIES}, each of at most {MAX_VERTICES:,} vertices "
            "and inside North America."
        ),
    )
    departure = OffsetDateTimeField(
        help_text=(
            "When the truck leaves, as ISO-8601 with a UTC offset. From 15 minutes ago "
            "to 48 hours ahead. The frames run from here to 48 hours after."
        )
    )
    load_weight_lb = LoadWeightField()

    def validate_geometries(self, value: list[str]) -> list[list[Point]]:
        return [_decode(encoded) for encoded in value]

    def validate_departure(self, value: datetime) -> datetime:
        return check_departure_window(value)


def _decode(encoded: str) -> list[Point]:
    try:
        route = decode_polyline(encoded)
    except (IndexError, ValueError):
        raise serializers.ValidationError("Not an encoded polyline.") from None
    if len(route) < 2:
        raise serializers.ValidationError("A route needs at least two vertices.")
    if len(route) > MAX_VERTICES:
        raise serializers.ValidationError(f"A route can have at most {MAX_VERTICES:,} vertices.")
    south, north = NORTH_AMERICA_LAT
    west, east = NORTH_AMERICA_LNG
    if not all(south <= lat <= north and west <= lng <= east for lat, lng in route):
        raise serializers.ValidationError("This route is outside North America.")
    return route


class GridSerializer(serializers.Serializer):
    origin_lat = serializers.FloatField(help_text="Latitude of the grid's south west point.")
    origin_lng = serializers.FloatField(help_text="Longitude of the grid's south west point.")
    spacing_deg = serializers.FloatField(
        help_text=(
            "Degrees between neighbouring points, both ways: 0.1, or a coarser multiple of 0.05."
        )
    )
    rows = serializers.IntegerField(help_text="Points from south to north.")
    cols = serializers.IntegerField(help_text="Points from west to east.")


@extend_schema_field({"type": "array", "items": {"type": "array", "items": {"type": "integer"}}})
class FramesField(serializers.Field):
    """Lists of whole numbers, written as they are: running a serializer over a hundred
    thousand of them would cost more than the forecast."""

    def to_representation(self, value: list[list[int]]) -> list[list[int]]:
        return value


class FramesSerializer(serializers.Serializer):
    risk = FramesField(
        help_text=(
            "Risk level at each corridor point, one list per hour: 0 Low, 1 Moderate, "
            "2 High, 3 Severe, 4 No Travel; -1 is No data. The combined-conditions bonus "
            "is left out, so the bands match the checkpoint colours."
        )
    )
    wind = FramesField(help_text="Sustained wind in tenths of a mile per hour; -1 is missing.")
    rain = FramesField(
        help_text="Rain plus showers in thousandths of an inch per hour; -1 is missing."
    )
    snow = FramesField(help_text="Snowfall in thousandths of an inch per hour; -1 is missing.")


class ScalesSerializer(serializers.Serializer):
    wind = serializers.IntegerField()
    rain = serializers.IntegerField()
    snow = serializers.IntegerField()


class HeatmapSerializer(serializers.Serializer):
    grid = GridSerializer()
    indices = serializers.ListField(
        child=serializers.IntegerField(),
        help_text=(
            "The corridor's points as `row * cols + col`, ascending. Each frame has one "
            "value per index, in this order."
        ),
    )
    timestamps = serializers.ListField(
        child=OffsetDateTimeField(),
        help_text="The time of each frame: the departure, then every hour to 48 hours later.",
    )
    scales = ScalesSerializer(help_text="What one unit of each variable's integers is worth.")
    frames = FramesSerializer()


class HeatmapView(APIView):
    @extend_schema(
        summary="Weather heatmap over the routes on screen",
        description=(
            "The forecast and its risk, hour by hour for 48 hours after departure, at points "
            "up to 25 miles either side of the given routes. Built only from the geometries "
            "sent: the routing provider is never asked. Returned as a regular grid with the "
            "indices of the points inside the corridor, and one list of whole numbers per "
            "variable per hour."
        ),
        request=HeatmapRequestSerializer,
        responses={
            200: HeatmapSerializer,
            400: OpenApiResponse(ErrorSerializer, description="`validation_error`"),
            429: OpenApiResponse(
                ErrorSerializer,
                description=(
                    "`weather_rate_limited`: `details.retry_after_seconds` says how long to wait."
                ),
            ),
            503: OpenApiResponse(ErrorSerializer, description="`weather_unavailable`"),
        },
    )
    def post(self, request: Request) -> Response:
        params = HeatmapRequestSerializer(data=request.data)
        params.is_valid(raise_exception=True)
        built = heatmap.build_heatmap(
            params.validated_data["geometries"],
            params.validated_data["departure"],
            params.validated_data["load_weight_lb"],
        )
        body = {
            "grid": built.grid,
            "indices": built.indices,
            "timestamps": built.timestamps,
            "scales": {
                "wind": heatmap.WIND_SCALE,
                "rain": heatmap.PRECIPITATION_SCALE,
                "snow": heatmap.PRECIPITATION_SCALE,
            },
            "frames": built.frames,
        }
        return Response(HeatmapSerializer(body).data)
