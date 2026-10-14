from django.urls import include, path

urlpatterns = [
    path("api/", include("api.urls")),
]

handler400 = "api.errors.bad_request"
handler403 = "api.errors.permission_denied"
handler404 = "api.errors.not_found"
handler500 = "api.errors.server_error"
