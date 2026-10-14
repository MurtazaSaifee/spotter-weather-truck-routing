from typing import ClassVar

from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import places, planning
from .ratelimit import PlanRateLimit, SuggestionRateLimit
from .schema_examples import (
    PLAN_400,
    PLAN_422,
    PLAN_503,
    PLAN_OK,
    PLAN_REQUEST,
    RATE_LIMIT_429,
    RATE_LIMIT_429_SUGGEST,
    SUGGEST_400,
    SUGGEST_503,
    SUGGEST_OK,
)
from .serializers import PlanRequestSerializer, PlanSerializer


class HealthSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["ok"])


class HealthView(APIView):
    @extend_schema(
        summary="Service health",
        description=(
            'Answers `{"status": "ok"}` without calling any provider or the cache. '
            "For uptime checks and the keep-warm ping."
        ),
        responses=HealthSerializer,
    )
    def get(self, request: Request) -> Response:
        return Response({"status": "ok"})


class PlaceSuggestionQuerySerializer(serializers.Serializer):
    q = serializers.CharField(
        min_length=places.MIN_QUERY_LENGTH,
        max_length=places.MAX_QUERY_LENGTH,
        help_text=f"Text typed so far, at least {places.MIN_QUERY_LENGTH} characters.",
    )


class PlaceSerializer(serializers.Serializer):
    label = serializers.CharField(help_text="Display text, e.g. an address or city.")
    lat = serializers.FloatField()
    lng = serializers.FloatField()
    time_zone = serializers.CharField(help_text="IANA time zone at the place.")


class PlaceSuggestionsSerializer(serializers.Serializer):
    provider = serializers.ChoiceField(
        choices=["here", "photon"], help_text="Which service answered, for attribution."
    )
    suggestions = PlaceSerializer(many=True)


class PlaceSuggestionsView(APIView):
    throttle_classes: ClassVar = [SuggestionRateLimit]

    @extend_schema(
        summary="Suggest North American places",
        description=(
            f"Up to {places.MAX_SUGGESTIONS} suggestions from HERE Autosuggest, limited to the "
            "United States, Canada and Mexico. If HERE fails, Photon answers in the same shape; "
            "`provider` says which one did. Each suggestion carries the IANA time zone at its "
            "coordinates, resolved offline. Limited to 300 requests per visitor per hour."
        ),
        parameters=[PlaceSuggestionQuerySerializer],
        examples=[SUGGEST_OK],
        responses={
            200: PlaceSuggestionsSerializer,
            400: SUGGEST_400,
            429: RATE_LIMIT_429_SUGGEST,
            503: SUGGEST_503,
        },
    )
    def get(self, request: Request) -> Response:
        query = PlaceSuggestionQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = places.suggest(query.validated_data["q"])
        body = {"provider": result.provider, "suggestions": result.places}
        return Response(PlaceSuggestionsSerializer(body).data)


class PlanView(APIView):
    throttle_classes: ClassVar = [PlanRateLimit]

    @extend_schema(
        summary="Plan a truck trip",
        description=(
            "Up to three distinct truck routes between two North American places, fastest "
            "first, with travel times that account for the truck's weight and the traffic "
            "expected at departure. Every route has checkpoints at the chosen interval, each "
            "with the truck's ETA, the forecast for that hour and a risk level for the load. "
            "Routes are ranked (fewest Severe miles, fewest High miles, lowest average risk "
            "within 0.25, shortest time) and one is recommended unless every route is blocked "
            "by a No Travel checkpoint. Limited to 60 requests per visitor per hour."
        ),
        request=PlanRequestSerializer,
        examples=[PLAN_REQUEST, PLAN_OK],
        responses={
            200: PlanSerializer,
            400: PLAN_400,
            422: PLAN_422,
            429: RATE_LIMIT_429,
            503: PLAN_503,
        },
    )
    def post(self, request: Request) -> Response:
        trip = PlanRequestSerializer(data=request.data)
        trip.is_valid(raise_exception=True)
        plan = planning.plan_trip(trip.to_trip(), trip.interval_miles_override)
        return Response(PlanSerializer(plan).data)
