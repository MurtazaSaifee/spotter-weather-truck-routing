from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from . import places


class HealthSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["ok"])


class HealthView(APIView):
    @extend_schema(summary="Service health", responses=HealthSerializer)
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
    @extend_schema(
        summary="Suggest North American places",
        description=(
            f"Up to {places.MAX_SUGGESTIONS} suggestions from HERE Autosuggest. If HERE fails, "
            "Photon answers in the same shape."
        ),
        parameters=[PlaceSuggestionQuerySerializer],
        responses=PlaceSuggestionsSerializer,
    )
    def get(self, request: Request) -> Response:
        query = PlaceSuggestionQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = places.suggest(query.validated_data["q"])
        body = {"provider": result.provider, "suggestions": result.places}
        return Response(PlaceSuggestionsSerializer(body).data)
