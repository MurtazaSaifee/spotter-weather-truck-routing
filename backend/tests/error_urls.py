"""The real API routes plus views that fail in each way the error format must cover."""

from django.http import HttpRequest, HttpResponse
from django.urls import path
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.errors import ApiError
from config import urls as config_urls


class LoadSerializer(serializers.Serializer):
    load_weight_lb = serializers.FloatField(min_value=0.1, max_value=50_000)


class ValidatingView(APIView):
    def post(self, request: Request) -> Response:
        serializer = LoadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.validated_data)


class ProviderDownError(ApiError):
    status_code = 503
    code = "routing_unavailable"
    message = "The routing provider is unavailable."


class ProviderDownView(APIView):
    def get(self, request: Request) -> Response:
        raise ProviderDownError(details={"provider": "here"})


class CrashingApiView(APIView):
    def get(self, request: Request) -> Response:
        raise RuntimeError("secret internal detail")


def crashing_django_view(request: HttpRequest) -> HttpResponse:
    raise RuntimeError("secret internal detail")


urlpatterns = [
    *config_urls.urlpatterns,
    path("api/test/validate", ValidatingView.as_view()),
    path("api/test/provider-down", ProviderDownView.as_view()),
    path("api/test/crash", CrashingApiView.as_view()),
    path("api/test/crash-outside-drf", crashing_django_view),
]

handler400 = config_urls.handler400
handler403 = config_urls.handler403
handler404 = config_urls.handler404
handler500 = config_urls.handler500
