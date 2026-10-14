"""The API describes itself: an OpenAPI document plus an interactive page that renders it."""

from datetime import UTC, datetime

import jsonschema
import pytest
import time_machine


def test_schema_is_an_openapi_document_listing_health(client):
    response = client.get("/api/schema?format=json")

    assert response.status_code == 200
    schema = response.json()
    assert schema["openapi"].startswith("3.")
    assert schema["info"]["title"] == "Weather-Aware Truck Routing API"
    assert schema["info"]["version"] == "1.0.0"
    health = schema["paths"]["/api/health"]["get"]
    ok_schema = health["responses"]["200"]["content"]["application/json"]["schema"]
    assert ok_schema == {"$ref": "#/components/schemas/Health"}
    components = schema["components"]["schemas"]
    assert components["Health"]["required"] == ["status"]
    assert components["StatusEnum"]["enum"] == ["ok"]


def test_schema_does_not_describe_itself(client):
    schema = client.get("/api/schema?format=json").json()

    assert "/api/schema" not in schema["paths"]
    assert "/api/docs" not in schema["paths"]


def test_docs_page_is_swagger_ui_pointed_at_the_schema(client):
    response = client.get("/api/docs")

    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/html")
    html = response.content.decode()
    assert "swagger-ui" in html
    assert "/api/schema" in html
    assert "@latest" not in html, "the Swagger UI assets must be pinned to a version"


# --- The error responses and examples each endpoint documents ---------------------------------

ENDPOINTS = {
    ("/api/places/suggest", "get"): {"400", "429", "503"},
    ("/api/plan", "post"): {"400", "422", "429", "503"},
    ("/api/heatmap", "post"): {"400", "429", "503"},
}


def _operation(client, path, method):
    return client.get("/api/schema?format=json").json()["paths"][path][method]


def _example_values(content):
    """Every example attached to a media type, whether written as ``example`` or ``examples``."""
    media = content["application/json"]
    values = [example["value"] for example in media.get("examples", {}).values()]
    return values + ([media["example"]] if "example" in media else [])


@pytest.mark.parametrize(("path", "method"), ENDPOINTS)
def test_every_endpoint_documents_its_error_responses(client, path, method):
    operation = _operation(client, path, method)

    assert operation["description"]
    assert ENDPOINTS[path, method] <= set(operation["responses"])
    for status in ENDPOINTS[path, method]:
        response = operation["responses"][status]
        assert response["description"]
        ref = response["content"]["application/json"]["schema"]
        assert ref == {"$ref": "#/components/schemas/Error"}


@pytest.mark.parametrize(("path", "method"), ENDPOINTS)
def test_every_error_response_has_an_example_in_the_error_shape(client, path, method):
    operation = _operation(client, path, method)

    for status in ENDPOINTS[path, method]:
        examples = _example_values(operation["responses"][status]["content"])
        assert examples, f"{path} {status} has no example"
        for body in examples:
            assert set(body) <= {"code", "message", "details"}
            assert body["code"]
            assert body["message"]


@pytest.mark.parametrize(("path", "method"), ENDPOINTS)
def test_every_success_response_has_an_example(client, path, method):
    operation = _operation(client, path, method)

    assert _example_values(operation["responses"]["200"]["content"])


@pytest.mark.parametrize(("path", "method"), [("/api/plan", "post"), ("/api/heatmap", "post")])
def test_request_bodies_have_examples(client, path, method):
    operation = _operation(client, path, method)

    assert _example_values(operation["requestBody"]["content"])


def _as_json_schema(node):
    """OpenAPI 3.0 marks a nullable value with ``nullable: true``; JSON Schema wants a type
    list, so rewrite it for the validator."""
    if isinstance(node, list):
        return [_as_json_schema(item) for item in node]
    if not isinstance(node, dict):
        return node
    node = {key: _as_json_schema(value) for key, value in node.items()}
    if node.pop("nullable", False):
        node = {"anyOf": [node, {"type": "null"}]}
    return node


@pytest.mark.parametrize(("path", "method"), ENDPOINTS)
def test_success_examples_fit_the_published_response_schema(client, path, method):
    schema = client.get("/api/schema?format=json").json()
    media = schema["paths"][path][method]["responses"]["200"]["content"]["application/json"]
    validator = jsonschema.Draft202012Validator(
        _as_json_schema({**media["schema"], "components": schema["components"]})
    )

    for example in _example_values({"application/json": media}):
        validator.validate(example)


REQUEST_PATHS = ["/api/plan", "/api/heatmap"]


@pytest.mark.parametrize("path", REQUEST_PATHS)
def test_request_examples_are_accepted_by_the_endpoint(client, outbound_http, path):
    outbound_http.get("https://router.hereapi.com/v8/routes").respond(500)

    with time_machine.travel(datetime(2026, 10, 15, 12, 0, tzinfo=UTC), tick=False):
        schema = client.get("/api/schema?format=json").json()
        media = schema["paths"][path]["post"]["requestBody"]["content"]["application/json"]
        (example,) = _example_values({"application/json": media})
        response = client.post(path, example, content_type="application/json")

    # Valid input gets past validation: the plan then fails on the blocked provider.
    assert response.status_code in {200, 503}, response.json()


@pytest.mark.parametrize(
    ("now", "departure"),
    [
        (datetime(2026, 10, 15, 12, 20, tzinfo=UTC), "2026-10-15T14:00:00+00:00"),
        (datetime(2027, 3, 2, 23, 59, tzinfo=UTC), "2027-03-03T01:00:00+00:00"),
    ],
)
@pytest.mark.parametrize("path", REQUEST_PATHS)
def test_request_examples_depart_an_hour_after_the_next_full_hour(client, path, now, departure):
    """The example in Swagger UI is ready to Try it out, whenever the docs are opened."""
    with time_machine.travel(now, tick=False):
        schema = client.get("/api/schema?format=json").json()

    media = schema["paths"][path]["post"]["requestBody"]["content"]["application/json"]
    (example,) = _example_values({"application/json": media})
    assert example["departure"] == departure


def test_error_examples_cover_every_code_the_api_raises(client):
    schema = client.get("/api/schema?format=json").json()
    codes = set()
    for (path, method), statuses in ENDPOINTS.items():
        responses = schema["paths"][path][method]["responses"]
        for status in statuses:
            codes |= {body["code"] for body in _example_values(responses[status]["content"])}

    assert codes == {
        "validation_error",
        "no_route_found",
        "routing_unavailable",
        "weather_rate_limited",
        "weather_unavailable",
        "rate_limit_exceeded",
        "places_unavailable",
    }
