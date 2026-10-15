"""The trip heatmap endpoint: its request's validation rules, its response's shape and the view."""

from datetime import datetime
from typing import ClassVar

from drf_spectacular.utils import extend_schema, extend_schema_field
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import heatmap
from .geo import Point, decode_polyline
from .ratelimit import HeatmapRateLimit, limit_text
from .schema_examples import (
    HEATMAP_400,
    HEATMAP_503,
    HEATMAP_OK,
    HEATMAP_REQUEST,
    RATE_LIMIT_429,
)
from .serializers import (
    HEATMAP_DEPARTURE_GRACE,
    LoadWeightField,
    OffsetDateTimeField,
    check_departure_window,
    departure_window_text,
)

FRAME_SPAN_HOURS = heatmap.FRAME_HOURS - 1  # the frames run from the departure to this far on
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
            f"returned. At most {MAX_GEOMETRIES}, each of at most {MAX_VERTICES:,} vertices."
        ),
    )
    departure = OffsetDateTimeField(
        help_text=(
            "When the truck leaves, as ISO-8601 with a UTC offset. "
            f"From {departure_window_text(HEATMAP_DEPARTURE_GRACE)}: the plan's departure is "
            "sent again, possibly after a wait, so this takes a longer delay than the plan. "
            f"The frames run from here to {FRAME_SPAN_HOURS} hours after."
        )
    )
    load_weight_lb = LoadWeightField()

    def validate_geometries(self, value: list[str]) -> list[list[Point]]:
        return [_decode(encoded) for encoded in value]

    def validate_departure(self, value: datetime) -> datetime:
        return check_departure_window(value, HEATMAP_DEPARTURE_GRACE)


def _decode(encoded: str) -> list[Point]:
    try:
        route = decode_polyline(encoded)
    except (IndexError, ValueError):
        raise serializers.ValidationError("Not an encoded polyline.") from None
    if len(route) < 2:
        raise serializers.ValidationError("A route needs at least two vertices.")
    if len(route) > MAX_VERTICES:
        raise serializers.ValidationError(f"A route can have at most {MAX_VERTICES:,} vertices.")
    if not all(-90 <= lat <= 90 and -180 <= lng <= 180 for lat, lng in route):
        raise serializers.ValidationError(
            "A route needs latitudes within 90 and longitudes within 180."
        )
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
        help_text=(
            "The time of each frame: the departure, then every hour to "
            f"{FRAME_SPAN_HOURS} hours later."
        ),
    )
    scales = ScalesSerializer(help_text="What one unit of each variable's integers is worth.")
    frames = FramesSerializer()


class HeatmapView(APIView):
    throttle_classes: ClassVar = [HeatmapRateLimit]

    @extend_schema(
        summary="Weather heatmap over the routes on screen",
        description=(
            f"The forecast and its risk, hour by hour for {FRAME_SPAN_HOURS} hours after "
            f"departure, at points up to {heatmap.CORRIDOR_RADIUS_MILES} miles either side of "
            "the given routes. Built only from the geometries sent: the routing provider is "
            "never asked. Returned as a regular grid with the indices of the points inside the "
            "corridor, and "
            f"one list of whole numbers per variable per hour. {limit_text('heatmap')}"
        ),
        request=HeatmapRequestSerializer,
        examples=[HEATMAP_REQUEST, HEATMAP_OK],
        responses={
            200: HeatmapSerializer,
            400: HEATMAP_400,
            429: RATE_LIMIT_429,
            503: HEATMAP_503,
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
