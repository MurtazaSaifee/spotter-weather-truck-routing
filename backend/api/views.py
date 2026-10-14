from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["ok"])


class HealthView(APIView):
    @extend_schema(summary="Service health", responses=HealthSerializer)
    def get(self, request: Request) -> Response:
        return Response({"status": "ok"})
