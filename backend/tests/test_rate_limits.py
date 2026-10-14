"""Per-visitor rate limits, through the API.

The limits are counted per hour and per endpoint. The visitor is the address the trusted
proxies saw: with Vercel in front of Cloud Run, the entry two from the end of
``X-Forwarded-For`` (see ``api.ratelimit``). Requests the endpoints would reject with a 400
count too, so most tests use those: they cost no provider call.
"""

import logging

import pytest
import time_machine

from tests.fake_redis_cache import counting_round_trips, fake_redis_server  # noqa: F401
from tests.test_checkpoints import DEPARTURE
from tests.test_heatmap import east_west
from tests.test_places import HERE_URL
from tests.test_plan import HERE_ROUTES_URL, PLAN_URL, trip

SUGGEST_URL = "/api/places/suggest"
HEATMAP_URL = "/api/heatmap"
# Twenty minutes into an hour: the limits reset in forty.
NOW = "2026-10-14T15:20:00Z"
PROXY_HOP = "10.0.0.1"


@pytest.fixture(autouse=True)
def now():
    with time_machine.travel(NOW, tick=False) as traveller:
        yield traveller


@pytest.fixture(autouse=True)
def two_trusted_proxies(settings):
    settings.TRUSTED_PROXY_HOPS = 2


def visitor(ip: str, *earlier: str) -> dict[str, str]:
    """Request headers as the proxies deliver them: the visitor's address, then the proxy's.
    ``earlier`` entries are what the visitor claimed to the first proxy."""
    return {"HTTP_X_FORWARDED_FOR": ", ".join([*earlier, ip, PROXY_HOP])}


def plan_as(client, headers):
    return client.post(PLAN_URL, {}, content_type="application/json", **headers)


def suggest_as(client, headers):
    return client.get(SUGGEST_URL, **headers)


def heatmap_as(client, headers):
    return client.post(HEATMAP_URL, {}, content_type="application/json", **headers)


# --- The limits ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("endpoint", "limit"),
    [(plan_as, 60), (heatmap_as, 60), (suggest_as, 300)],
    ids=["plan", "heatmap", "suggestions"],
)
def test_each_endpoint_allows_its_hourly_limit_and_no_more(client, endpoint, limit):
    headers = visitor("203.0.113.7")

    statuses = {endpoint(client, headers).status_code for _ in range(limit)}
    assert 429 not in statuses

    assert endpoint(client, headers).status_code == 429


def test_exceeding_a_limit_gives_the_code_and_the_seconds_until_it_resets(client, settings):
    settings.RATE_LIMITS = {"plan": 1, "heatmap": 1, "suggest": 1}
    headers = visitor("203.0.113.7")
    plan_as(client, headers)

    response = plan_as(client, headers)

    assert response.status_code == 429
    body = response.json()
    assert body["code"] == "rate_limit_exceeded"
    assert body["message"]
    # 15:20 into the hour 15:00-16:00.
    assert body["details"] == {"retry_after_seconds": 40 * 60}


def test_the_limits_start_again_with_the_next_hour(client, settings, now):
    settings.RATE_LIMITS = {"plan": 1, "heatmap": 1, "suggest": 1}
    headers = visitor("203.0.113.7")
    plan_as(client, headers)
    assert plan_as(client, headers).status_code == 429

    now.move_to("2026-10-14T16:00:00Z")

    assert plan_as(client, headers).status_code == 400


def test_each_endpoint_counts_on_its_own(client, settings):
    settings.RATE_LIMITS = {"plan": 1, "heatmap": 1, "suggest": 1}
    headers = visitor("203.0.113.7")
    plan_as(client, headers)

    assert plan_as(client, headers).status_code == 429
    assert heatmap_as(client, headers).status_code == 400
    assert suggest_as(client, headers).status_code == 400


# --- Whose requests they are ---------------------------------------------------------------


def test_each_visitor_has_their_own_limit(client, settings):
    settings.RATE_LIMITS = {"plan": 2, "heatmap": 2, "suggest": 2}
    first, second = visitor("203.0.113.7"), visitor("198.51.100.20")
    for _ in range(2):
        plan_as(client, first)

    assert plan_as(client, first).status_code == 429
    assert plan_as(client, second).status_code == 400


def test_entries_before_the_trusted_hops_are_ignored(client, settings):
    """Whatever the visitor puts at the front of ``X-Forwarded-For`` is theirs to forge: it
    can't pick the bucket, and can't escape the one the proxies put them in."""
    settings.RATE_LIMITS = {"plan": 2, "heatmap": 2, "suggest": 2}
    plan_as(client, visitor("203.0.113.7", "8.8.8.8"))
    plan_as(client, visitor("203.0.113.7", "9.9.9.9", "1.2.3.4"))

    assert plan_as(client, visitor("203.0.113.7", "5.5.5.5")).status_code == 429
    assert plan_as(client, visitor("203.0.113.7")).status_code == 429
    # Claiming to be someone with room left doesn't help.
    assert plan_as(client, visitor("203.0.113.7", "198.51.100.20")).status_code == 429


@pytest.mark.parametrize(
    "header",
    ["HTTP_X_REAL_IP", "HTTP_X_VERCEL_FORWARDED_FOR", "HTTP_FORWARDED"],
)
def test_headers_the_proxies_pass_through_unchecked_are_not_trusted(client, settings, header):
    settings.RATE_LIMITS = {"plan": 1, "heatmap": 1, "suggest": 1}
    headers = visitor("203.0.113.7")
    plan_as(client, {**headers, header: "for=1.1.1.1" if header == "HTTP_FORWARDED" else "1.1.1.1"})

    response = plan_as(client, {**headers, header: "2.2.2.2"})

    assert response.status_code == 429


def test_a_request_that_skipped_a_proxy_is_counted_under_its_own_address(client, settings):
    """With fewer entries than trusted hops, the first is the nearest to the visitor there is."""
    settings.RATE_LIMITS = {"plan": 1, "heatmap": 1, "suggest": 1}
    direct = {"HTTP_X_FORWARDED_FOR": "203.0.113.7"}
    plan_as(client, direct)

    assert plan_as(client, direct).status_code == 429
    assert plan_as(client, visitor("198.51.100.20")).status_code == 400


def test_the_number_of_trusted_hops_is_configurable(client, settings):
    settings.TRUSTED_PROXY_HOPS = 1
    settings.RATE_LIMITS = {"plan": 1, "heatmap": 1, "suggest": 1}
    # One proxy, which appends the visitor's address: the last entry.
    plan_as(client, {"HTTP_X_FORWARDED_FOR": "8.8.8.8, 203.0.113.7"})

    assert plan_as(client, {"HTTP_X_FORWARDED_FOR": "9.9.9.9, 203.0.113.7"}).status_code == 429
    assert plan_as(client, {"HTTP_X_FORWARDED_FOR": "9.9.9.9, 198.51.100.20"}).status_code == 400


def test_without_a_forwarding_header_the_visitor_is_the_connection(client, settings):
    settings.RATE_LIMITS = {"plan": 1, "heatmap": 1, "suggest": 1}
    plan_as(client, {"REMOTE_ADDR": "203.0.113.7"})

    assert plan_as(client, {"REMOTE_ADDR": "203.0.113.7"}).status_code == 429
    assert plan_as(client, {"REMOTE_ADDR": "198.51.100.20"}).status_code == 400


def test_a_forwarded_entry_that_is_not_an_address_falls_back_to_the_connection(client, settings):
    settings.RATE_LIMITS = {"plan": 1, "heatmap": 1, "suggest": 1}
    garbage = {"HTTP_X_FORWARDED_FOR": f"not-an-ip, {PROXY_HOP}", "REMOTE_ADDR": "203.0.113.7"}
    plan_as(client, garbage)

    different_garbage = {**garbage, "HTTP_X_FORWARDED_FOR": f"also-not, {PROXY_HOP}"}
    assert plan_as(client, different_garbage).status_code == 429


def test_one_visitor_cannot_use_a_whole_ipv6_network_to_dodge_the_limit(client, settings):
    settings.RATE_LIMITS = {"plan": 1, "heatmap": 1, "suggest": 1}
    plan_as(client, visitor("2001:db8:1:2:aaaa::1"))

    assert plan_as(client, visitor("2001:db8:1:2:bbbb::9")).status_code == 429
    assert plan_as(client, visitor("2001:db8:1:3::1")).status_code == 400


def test_the_health_check_is_never_limited(client, settings):
    settings.RATE_LIMITS = {"plan": 0, "heatmap": 0, "suggest": 0}

    assert client.get("/api/health", **visitor("203.0.113.7")).status_code == 200


# --- When the cache is down ----------------------------------------------------------------


@pytest.fixture
def dead_cache(settings):
    settings.CACHES = {"default": {"BACKEND": "tests.failing_cache.DeadCache"}}


def test_with_the_cache_down_the_limits_are_skipped_and_plans_still_work(
    client, dead_cache, settings, outbound_http, load_fixture, caplog
):
    outbound_http.get(HERE_ROUTES_URL).respond(
        json=load_fixture("routing/here_chicago_dallas_truck.json")
    )
    settings.RATE_LIMITS = {"plan": 1, "heatmap": 1, "suggest": 1}
    headers = visitor("203.0.113.7")

    with caplog.at_level(logging.WARNING):
        responses = [
            client.post(PLAN_URL, trip(), content_type="application/json", **headers)
            for _ in range(3)
        ]

    assert [response.status_code for response in responses] == [200, 200, 200]
    body = responses[0].json()
    assert len(body["routes"]) == 3
    assert all(
        checkpoint["weather"] is not None
        for route in body["routes"]
        for checkpoint in route["checkpoints"]
    )
    assert "Rate limit counter failed" in caplog.text
    assert "Route cache read failed" in caplog.text


def test_with_the_cache_down_the_heatmap_is_correct_and_unlimited(
    client, dead_cache, settings, caplog
):
    settings.RATE_LIMITS = {"plan": 1, "heatmap": 1, "suggest": 1}
    body = {"geometries": [east_west()], "departure": DEPARTURE, "load_weight_lb": 30_000}

    with caplog.at_level(logging.WARNING):
        responses = [
            client.post(
                HEATMAP_URL, body, content_type="application/json", **visitor("203.0.113.7")
            )
            for _ in range(3)
        ]

    assert [response.status_code for response in responses] == [200, 200, 200]
    assert len(responses[-1].json()["frames"]["risk"]) == 49
    assert "Weather cache read failed" in caplog.text
    assert "Rate limit counter failed" in caplog.text


def test_with_the_cache_down_suggestions_are_unlimited(
    client, dead_cache, settings, outbound_http, load_fixture
):
    outbound_http.get(HERE_URL).respond(json=load_fixture("places/here_autosuggest_chicago.json"))
    settings.RATE_LIMITS = {"plan": 1, "heatmap": 1, "suggest": 1}

    statuses = [
        client.get(SUGGEST_URL, {"q": "Chicago"}, **visitor("203.0.113.7")).status_code
        for _ in range(3)
    ]

    assert statuses == [200, 200, 200]


# --- On Redis ------------------------------------------------------------------------------


@pytest.fixture
def redis(settings, counting_round_trips):  # noqa: F811
    settings.CACHES = {
        "default": {"BACKEND": "tests.fake_redis_cache.FakeRedisCache", "LOCATION": "redis://fake"}
    }
    return counting_round_trips


def test_on_redis_a_request_costs_one_round_trip_whether_or_not_its_counter_exists(
    client, redis, settings
):
    """Production Redis is about 50 ms a command away, so the counter must be one pipeline."""
    headers = visitor("203.0.113.7")

    plan_as(client, headers)
    assert redis == ["pipeline"]

    redis.clear()
    plan_as(client, headers)
    assert redis == ["pipeline"]


def test_on_redis_the_limit_holds_and_the_counter_expires(client, redis, settings):
    settings.RATE_LIMITS = {"plan": 2, "heatmap": 2, "suggest": 2}
    headers = visitor("203.0.113.7")
    plan_as(client, headers)
    plan_as(client, headers)

    assert plan_as(client, headers).status_code == 429
    assert plan_as(client, visitor("198.51.100.20")).status_code == 400
    counters = fake_redis_server()
    keys = counters.keys()
    assert len(keys) == 2
    assert all(0 < counters.ttl(key) <= 3600 for key in keys)
