"""Every API error, expected or not, has the shape {code, message, details?}."""

import pytest
from django.test import Client

pytestmark = pytest.mark.urls("tests.error_urls")


def test_validation_errors_name_each_invalid_field(client):
    response = client.post(
        "/api/test/validate", {"load_weight_lb": 60_000}, content_type="application/json"
    )

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "validation_error"
    assert body["message"] == "load_weight_lb: Ensure this value is less than or equal to 50000."
    assert body["details"] == {
        "fields": {"load_weight_lb": ["Ensure this value is less than or equal to 50000."]}
    }


def test_malformed_json_is_a_validation_error(client):
    response = client.post("/api/test/validate", "{not json", content_type="application/json")

    assert response.status_code == 400
    assert response.json()["code"] == "validation_error"


def test_api_errors_keep_their_code_status_and_details(client):
    response = client.get("/api/test/provider-down")

    assert response.status_code == 503
    assert response.json() == {
        "code": "routing_unavailable",
        "message": "The routing provider is unavailable.",
        "details": {"provider": "here"},
    }


def test_unknown_endpoint_is_not_found(client):
    response = client.get("/api/no-such-endpoint")

    assert response.status_code == 404
    assert response.json() == {"code": "not_found", "message": "No API endpoint at this address."}


def test_wrong_method_is_reported(client):
    response = client.post("/api/health")

    assert response.status_code == 405
    assert response.json() == {
        "code": "method_not_allowed",
        "message": 'Method "POST" not allowed.',
    }


@pytest.mark.parametrize("url", ["/api/test/crash", "/api/test/crash-outside-drf"])
def test_unhandled_exceptions_hide_internals(url):
    client = Client(raise_request_exception=False)

    response = client.get(url)

    assert response.status_code == 500
    assert response.json() == {
        "code": "internal_error",
        "message": "Something went wrong on our side. Please try again.",
    }
