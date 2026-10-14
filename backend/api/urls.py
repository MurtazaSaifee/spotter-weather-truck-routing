from django.urls import path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from .heatmap_views import HeatmapView
from .views import HealthView, PlaceSuggestionsView, PlanView

urlpatterns = [
    path("health", HealthView.as_view(), name="health"),
    path("places/suggest", PlaceSuggestionsView.as_view(), name="place-suggestions"),
    path("plan", PlanView.as_view(), name="plan"),
    path("heatmap", HeatmapView.as_view(), name="heatmap"),
    path("schema", SpectacularAPIView.as_view(), name="schema"),
    path("docs", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]
