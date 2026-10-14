"""Serializers for the plan endpoint: the request's validation rules and the response's shape."""

from datetime import datetime, timedelta

from django.utils import timezone
from rest_framework import serializers

from .checkpoints import INTERVAL_CHOICES
from .routing import TripRequest

# A box around the US, Canada and Mexico, as (south, north) and (west, east). It also takes in a
# little ocean and the Caribbean; place search and routing do the finer filtering.
NORTH_AMERICA_LAT = (14.0, 72.0)
NORTH_AMERICA_LNG = (-170.0, -50.0)

# A driver who took a moment to submit has a departure a few minutes in the past; the
# default "next full hour" must never be rejected for that.
DEPARTURE_GRACE = timedelta(minutes=15)
DEPARTURE_HORIZON = timedelta(hours=48)

MAX_LOAD_WEIGHT_LB = 50_000


class OffsetDateTimeField(serializers.DateTimeField):
    """An ISO-8601 date-time that must carry its UTC offset, and keeps it on output."""

    def enforce_timezone(self, value: datetime) -> datetime:
        if timezone.is_naive(value):
            raise serializers.ValidationError(
                "Include the UTC offset, e.g. 2026-10-15T08:00:00-05:00."
            )
        return value

    def to_representation(self, value: datetime) -> str:
        return value.isoformat()


class TripPlaceSerializer(serializers.Serializer):
    """One end of the trip: what place search returned, less the time zone.

    The plan works out the origin's time zone from its coordinates, so a ``time_zone`` sent
    along with a place is accepted but not used.
    """

    label = serializers.CharField(max_length=300)
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    time_zone = serializers.CharField(required=False, write_only=True)

    def validate(self, attrs: dict) -> dict:
        south, north = NORTH_AMERICA_LAT
        west, east = NORTH_AMERICA_LNG
        if not (south <= attrs["lat"] <= north and west <= attrs["lng"] <= east):
            raise serializers.ValidationError("This place is outside North America.")
        return attrs


class PlanRequestSerializer(serializers.Serializer):
    origin = TripPlaceSerializer()
    destination = TripPlaceSerializer()
    departure = OffsetDateTimeField(
        help_text=(
            "When the truck leaves, as ISO-8601 with a UTC offset. From 15 minutes ago "
            "to 48 hours ahead."
        )
    )
    load_weight_lb = serializers.IntegerField(
        min_value=1,
        max_value=MAX_LOAD_WEIGHT_LB,
        error_messages={
            "min_value": "Load weight must be greater than 0 lb.",
            "max_value": f"Load weight can be at most {MAX_LOAD_WEIGHT_LB:,} lb.",
        },
        help_text="Weight of the cargo in pounds. The empty truck's weight is added for routing.",
    )

    interval_miles = serializers.ChoiceField(
        choices=INTERVAL_CHOICES,
        required=False,
        help_text=(
            "Miles between checkpoints. Left out, it is chosen from the length of the "
            "shortest route: 10 under 300 mi, 25 up to 1,000 mi, 50 beyond."
        ),
    )

    def validate_departure(self, value: datetime) -> datetime:
        now = timezone.now()
        if value < now - DEPARTURE_GRACE:
            raise serializers.ValidationError("Departure can't be more than 15 minutes ago.")
        if value > now + DEPARTURE_HORIZON:
            raise serializers.ValidationError("Departure can't be more than 48 hours ahead.")
        return value

    def validate(self, attrs: dict) -> dict:
        if _coordinates(attrs["origin"]) == _coordinates(attrs["destination"]):
            raise serializers.ValidationError(
                {"destination": "Destination must be different from the origin."}
            )
        return attrs

    def to_trip(self) -> TripRequest:
        """The validated request as the routing adapter's input. Call after ``is_valid``."""
        data = self.validated_data
        return TripRequest(
            origin=_coordinates(data["origin"]),
            destination=_coordinates(data["destination"]),
            departure=data["departure"],
            load_weight_lb=data["load_weight_lb"],
        )

    @property
    def interval_miles_override(self) -> int | None:
        """The driver's chosen interval, if any. Call after ``is_valid``."""
        return self.validated_data.get("interval_miles")


def _coordinates(place: dict) -> tuple[float, float]:
    """A place's ``(lat, lng)``, to 5 decimals (about 1 m): closer than that is the same place."""
    return round(place["lat"], 5), round(place["lng"], 5)


class NoticeSerializer(serializers.Serializer):
    code = serializers.CharField(help_text="Machine-readable, e.g. `fewer_routes`.")
    message = serializers.CharField(help_text="Text to show the driver.")


class RoundedFloatField(serializers.FloatField):
    """A float written to a fixed number of decimals, so responses stay compact."""

    def __init__(self, places: int, **kwargs) -> None:
        self.places = places
        super().__init__(**kwargs)

    def to_representation(self, value: float) -> float:
        return round(super().to_representation(value), self.places)


class WeatherSerializer(serializers.Serializer):
    wind_mph = RoundedFloatField(
        1, help_text="Sustained wind at 10 m, at the hour nearest the ETA."
    )
    gust_mph = RoundedFloatField(
        1,
        allow_null=True,
        help_text="Strongest gust in the hour around the ETA. Null when the forecast has none.",
    )
    rain_in_hr = RoundedFloatField(
        3, help_text="Rain rate (rain plus showers) in the hour around the ETA, inches per hour."
    )
    snow_in_hr = RoundedFloatField(
        3, help_text="Snowfall rate in the hour around the ETA, inches of snow per hour."
    )


class CheckpointSerializer(serializers.Serializer):
    mile = RoundedFloatField(3, help_text="Miles from the origin along the route.")
    lat = RoundedFloatField(5)
    lng = RoundedFloatField(5)
    eta = OffsetDateTimeField(
        help_text="When the truck gets here, in the origin's time zone. No rest stops included."
    )
    covered_miles = RoundedFloatField(
        3,
        help_text=(
            "Miles of road this checkpoint stands for: half the gap to each neighbour. The "
            "first and last cover only their inner half. A route's checkpoints add up to its "
            "length."
        ),
    )
    weather = WeatherSerializer(
        allow_null=True,
        help_text=(
            "The forecast for the hour the truck is here. Null means No data: there is no "
            "forecast for the sustained wind, rain or snow at that hour or the one beside it."
        ),
    )


class PlannedRouteSerializer(serializers.Serializer):
    id = serializers.CharField(help_text="Stable within this plan, e.g. `route-1`.")
    distance_miles = serializers.FloatField()
    duration_seconds = serializers.IntegerField(
        help_text="Travel time including predicted traffic and truck speeds."
    )
    arrival = OffsetDateTimeField(help_text="In the origin's time zone.")
    geometry = serializers.CharField(
        help_text=(
            "The route as a Google encoded polyline (precision 5), simplified to about 100 m."
        )
    )
    elapsed_seconds = serializers.ListField(
        child=serializers.IntegerField(),
        help_text="Seconds after departure at each vertex of `geometry`, one per vertex.",
    )
    checkpoints = CheckpointSerializer(many=True, help_text="From the origin to the destination.")


class PlanSerializer(serializers.Serializer):
    origin_time_zone = serializers.CharField(help_text="IANA time zone at the origin.")
    departure = OffsetDateTimeField(help_text="To the minute, in the origin's time zone.")
    interval_miles = serializers.IntegerField(
        help_text="Miles between checkpoints, on every route."
    )
    interval_automatic = serializers.BooleanField(
        help_text="True when the interval was chosen from the trip's length, not by the driver."
    )
    routes = PlannedRouteSerializer(many=True, help_text="Up to three, fastest first.")
    notices = NoticeSerializer(many=True)


class ErrorSerializer(serializers.Serializer):
    """The body of every error response."""

    code = serializers.CharField(help_text="Machine-readable, e.g. `validation_error`.")
    message = serializers.CharField(help_text="Text to show the driver.")
    details = serializers.JSONField(
        required=False, help_text="Extra data, e.g. `fields` for validation errors."
    )
