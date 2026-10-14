"""The API describes itself: an OpenAPI document plus an interactive page that renders it."""


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
