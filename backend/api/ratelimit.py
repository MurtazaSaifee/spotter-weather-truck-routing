"""Per-visitor rate limits, counted in the cache, to protect the free-tier provider quotas.

Each endpoint allows ``settings.RATE_LIMITS[scope]`` requests per visitor per clock hour. A
request over the limit fails with ``rate_limit_exceeded`` and the seconds until the hour ends.
Requests are counted before they are validated, so a client can't probe for free either.

**Who the visitor is.** Behind Vercel and Cloud Run, ``REMOTE_ADDR`` is Google's front end for
everyone. Each proxy appends the address it received the request from to ``X-Forwarded-For``,
so with ``settings.TRUSTED_PROXY_HOPS`` proxies the visitor is that many entries from the end
and anything before it is whatever the visitor claimed, which is ignored. Through Vercel
(measured on the first deploy) the header is ``<visitor>, <Vercel's egress address>`` after
Google has appended its entry: two hops. ``X-Real-IP`` and ``x-vercel-forwarded-for`` are not
used because Vercel passes a client's own values through.

A caller who reaches the Cloud Run URL directly skips Vercel, so their last entry is theirs
and the one before it is whatever they sent: nothing in the headers tells the two paths apart.
The limit is a quota guard, not a security boundary; the shared weather cache bounds what a
caller who dodges it can spend.

**Cost.** Production Redis answers in about 50 ms per command, so a request is counted with
one pipelined increment-and-expire. Django's ``cache.incr`` is two commands (exists, then
incr), so the Redis backend is driven directly. If the cache fails, the request is not limited.
"""

import ipaddress
import logging
import math
import time

from django.conf import settings
from django.core.cache import cache
from rest_framework.request import Request
from rest_framework.throttling import BaseThrottle

from .errors import ApiError

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 3600
# IPv6 visitors are usually given a whole /64, so one is one visitor.
IPV6_PREFIX_BITS = 64


class RateLimitExceededError(ApiError):
    status_code = 429
    code = "rate_limit_exceeded"
    message = "You've made a lot of requests. Please wait a little before trying again."

    def __init__(self, retry_after_seconds: int):
        super().__init__(details={"retry_after_seconds": retry_after_seconds})


def client_ip(request: Request) -> str:
    """The visitor's address as the trusted proxies saw it, or the connection's if the
    forwarding header is missing or doesn't hold an address where it should."""
    entries = [
        entry.strip()
        for entry in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")
        if entry.strip()
    ]
    if entries:
        position = max(len(entries) - settings.TRUSTED_PROXY_HOPS, 0)
        address = _parse(entries[position])
        if address is not None:
            return _visitor(address)
    return _visitor(_parse(request.META.get("REMOTE_ADDR", "")))


def _parse(text: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(text)
    except ValueError:
        return None


def _visitor(address: ipaddress.IPv4Address | ipaddress.IPv6Address | None) -> str:
    if address is None:
        return "unknown"
    if address.version == 6:
        return str(ipaddress.ip_network((address, IPV6_PREFIX_BITS), strict=False))
    return str(address)


class RateLimit(BaseThrottle):
    """Counts the request against the visitor's hourly allowance for ``scope``."""

    scope: str

    def allow_request(self, request: Request, view: object) -> bool:
        now = time.time()
        window = int(now // WINDOW_SECONDS)
        key = f"ratelimit:{self.scope}:{client_ip(request)}:{window}"
        try:
            count = _increment(key, WINDOW_SECONDS)
        except Exception as error:
            # Not the exception itself: a Redis error message can carry the connection URL.
            logger.warning("Rate limit counter failed (%s); not limiting", type(error).__name__)
            return True
        if count > settings.RATE_LIMITS[self.scope]:
            raise RateLimitExceededError(math.ceil((window + 1) * WINDOW_SECONDS - now))
        return True


class PlanRateLimit(RateLimit):
    scope = "plan"


class HeatmapRateLimit(RateLimit):
    scope = "heatmap"


class SuggestionRateLimit(RateLimit):
    scope = "suggest"


def _increment(key: str, seconds: int) -> int:
    """Add one to the counter at ``key``, creating it if it is missing and making it expire
    ``seconds`` after the latest request. Returns the new count."""
    redis_backend = getattr(cache, "_cache", None)
    if hasattr(redis_backend, "get_client"):
        # Django's Redis cache. One MULTI/EXEC round trip, and the counter is a plain integer.
        redis_key = cache.make_and_validate_key(key)
        pipeline = redis_backend.get_client(redis_key, write=True).pipeline()
        pipeline.incr(redis_key)
        pipeline.expire(redis_key, seconds)
        count, _ = pipeline.execute()
        return count
    if cache.add(key, 1, seconds):
        return 1
    try:
        return cache.incr(key)
    except ValueError:  # it expired between the add and the incr
        cache.set(key, 1, seconds)
        return 1
