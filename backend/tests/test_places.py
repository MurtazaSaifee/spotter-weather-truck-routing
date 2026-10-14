"""Place suggestions through the API, with HERE Autosuggest and Photon answered by recorded
responses (tests/fixtures/places/)."""

import logging

import httpx
import pytest

HERE_URL = "https://autosuggest.search.hereapi.com/v1/autosuggest"
PHOTON_URL = "https://photon.komoot.io/api/"
SUGGEST_URL = "/api/places/suggest"


@pytest.fixture
def here(outbound_http, load_fixture):
    route = outbound_http.get(HERE_URL)
    route.respond(json=load_fixture("places/here_autosuggest_chicago.json"))
    return route


def test_suggestions_come_from_here_with_label_coordinates_and_time_zone(client, here):
    response = client.get(SUGGEST_URL, {"q": "Chicago"})

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "here"
    assert body["suggestions"][0] == {
        "label": "Chicago, IL, United States",
        "lat": 41.88425,
        "lng": -87.63245,
        "time_zone": "America/Chicago",
    }
    assert [s["label"] for s in body["suggestions"]] == [
        "Chicago, IL, United States",
        "Wrigley Field, 1060 W Addison St, Chicago, IL 60613, United States",
        "Chicago, Athol, KS 66932, United States",
    ]


def test_here_is_asked_for_eight_us_canada_and_mexico_places(client, here):
    client.get(SUGGEST_URL, {"q": "Chicago"})

    params = here.calls.last.request.url.params
    assert params["q"] == "Chicago"
    assert params["in"] == "countryCode:USA,CAN,MEX"
    assert params["limit"] == "8"
    assert params["apiKey"] == "test-here-key"


def test_here_items_without_a_position_are_dropped(client, here, load_fixture):
    payload = load_fixture("places/here_autosuggest_chicago.json")
    payload["items"].insert(
        1, {"title": "Chicago pizza", "id": "here:cq:1", "resultType": "chainQuery"}
    )
    here.respond(json=payload)

    body = client.get(SUGGEST_URL, {"q": "Chicago"}).json()

    assert [s["label"] for s in body["suggestions"]] == [
        "Chicago, IL, United States",
        "Wrigley Field, 1060 W Addison St, Chicago, IL 60613, United States",
        "Chicago, Athol, KS 66932, United States",
    ]


def test_at_most_eight_suggestions_are_returned(client, here, load_fixture):
    payload = load_fixture("places/here_autosuggest_chicago.json")
    payload["items"] = payload["items"] * 4
    here.respond(json=payload)

    body = client.get(SUGGEST_URL, {"q": "Chicago"}).json()

    assert len(body["suggestions"]) == 8


@pytest.fixture
def photon(outbound_http, load_fixture):
    route = outbound_http.get(PHOTON_URL)
    route.respond(json=load_fixture("places/photon_chicago.json"))
    return route


HERE_FAILURES = {
    "server error": {"return_value": httpx.Response(500, json={"error": "boom"})},
    "bad key": {"return_value": httpx.Response(401, json={"error": "Unauthorized"})},
    "rate limited": {"return_value": httpx.Response(429, json={"error": "Too many"})},
    "timeout": {"side_effect": httpx.ReadTimeout("slow")},
    "connection error": {"side_effect": httpx.ConnectError("down")},
    "malformed body": {"return_value": httpx.Response(200, text="<html>gateway</html>")},
    "unexpected shape": {"return_value": httpx.Response(200, json={"results": []})},
}


@pytest.mark.parametrize("failure", HERE_FAILURES.values(), ids=HERE_FAILURES.keys())
def test_photon_answers_in_the_same_shape_when_here_fails(client, outbound_http, photon, failure):
    outbound_http.get(HERE_URL).mock(**failure)

    response = client.get(SUGGEST_URL, {"q": "Chicago"})

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "photon"
    assert body["suggestions"][0] == {
        "label": "Chicago, Illinois, United States",
        "lat": 41.8755616,
        "lng": -87.6244212,
        "time_zone": "America/Chicago",
    }
    assert set(body["suggestions"][0]) == {"label", "lat", "lng", "time_zone"}


def test_photon_labels_read_like_an_address(client, outbound_http, photon):
    outbound_http.get(HERE_URL).respond(500)

    labels = [s["label"] for s in client.get(SUGGEST_URL, {"q": "Chicago"}).json()["suggestions"]]

    assert labels[:2] == [
        "Chicago, Illinois, United States",
        "Chicago, 300 West Chicago Avenue, Chicago, IL 60654, United States",
    ]


def test_photon_is_restricted_to_north_america_and_never_sees_the_here_key(
    client, outbound_http, photon
):
    outbound_http.get(HERE_URL).respond(500)

    client.get(SUGGEST_URL, {"q": "Chicago"})

    request = photon.calls.last.request
    assert request.url.params["q"] == "Chicago"
    assert request.url.params["limit"] == "8"
    assert request.url.params["bbox"] == "-170,14,-50,72"
    assert request.headers["User-Agent"].startswith("spotter-")
    assert "test-here-key" not in str(request.url)


def test_photon_results_outside_the_us_canada_and_mexico_are_dropped(
    client, outbound_http, photon, load_fixture
):
    payload = load_fixture("places/photon_chicago.json")
    havana = {
        "type": "Feature",
        "properties": {"name": "Chicago", "country": "Cuba", "countrycode": "CU"},
        "geometry": {"type": "Point", "coordinates": [-82.38, 23.13]},
    }
    payload["features"].insert(0, havana)
    photon.respond(json=payload)
    outbound_http.get(HERE_URL).respond(500)

    body = client.get(SUGGEST_URL, {"q": "Chicago"}).json()

    assert all("Cuba" not in s["label"] for s in body["suggestions"])
    assert body["suggestions"][0]["label"] == "Chicago, Illinois, United States"
    assert len(body["suggestions"]) == 8


def test_an_error_is_reported_when_here_and_photon_both_fail(client, outbound_http):
    outbound_http.get(HERE_URL).respond(500)
    outbound_http.get(PHOTON_URL).mock(side_effect=httpx.ReadTimeout("slow"))

    response = client.get(SUGGEST_URL, {"q": "Chicago"})

    assert response.status_code == 503
    assert response.json()["code"] == "places_unavailable"


@pytest.mark.parametrize("params", [{"q": "Ch"}, {"q": "  C "}, {"q": ""}, {}])
def test_queries_shorter_than_three_characters_are_rejected_without_calling_a_provider(
    client, outbound_http, params
):
    response = client.get(SUGGEST_URL, params)

    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "validation_error"
    assert "q" in body["details"]["fields"]
    assert outbound_http.calls.call_count == 0


def test_a_three_character_query_is_accepted(client, here):
    assert client.get(SUGGEST_URL, {"q": "Chi"}).status_code == 200


def test_the_here_key_is_never_logged(client, here, caplog):
    caplog.set_level(logging.DEBUG)

    client.get(SUGGEST_URL, {"q": "Chicago"})

    assert "test-here-key" not in caplog.text


def test_the_here_key_is_not_logged_when_here_fails_either(client, outbound_http, caplog, photon):
    caplog.set_level(logging.DEBUG)
    outbound_http.get(HERE_URL).respond(401)

    client.get(SUGGEST_URL, {"q": "Chicago"})

    assert "test-here-key" not in caplog.text


@pytest.mark.parametrize(
    ("lat", "lng", "time_zone"),
    [
        (34.05, -118.24, "America/Los_Angeles"),
        (19.43, -99.13, "America/Mexico_City"),
        (44.65, -63.58, "America/Halifax"),
        (61.22, -149.90, "America/Anchorage"),
        (21.31, -157.86, "Pacific/Honolulu"),
    ],
)
def test_time_zone_is_resolved_from_the_coordinates_without_another_api_call(
    client, outbound_http, lat, lng, time_zone
):
    route = outbound_http.get(HERE_URL)
    route.respond(
        json={
            "items": [
                {
                    "title": "Somewhere",
                    "resultType": "locality",
                    "address": {"label": "Somewhere"},
                    "position": {"lat": lat, "lng": lng},
                }
            ]
        }
    )

    body = client.get(SUGGEST_URL, {"q": "Somewhere"}).json()

    assert body["suggestions"][0]["time_zone"] == time_zone
    assert route.call_count == 1
    assert outbound_http.calls.call_count == 1
