from django.urls import path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from .views import HealthView, PlaceSuggestionsView

urlpatterns = [
    path("health", HealthView.as_view(), name="health"),
    path("places/suggest", PlaceSuggestionsView.as_view(), name="place-suggestions"),
    path("schema", SpectacularAPIView.as_view(), name="schema"),
    path("docs", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]
