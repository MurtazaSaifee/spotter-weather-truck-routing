"""Places adapter: address suggestions from HERE Autosuggest, with Photon as the fallback.

``suggest`` is the whole interface. Both providers are normalised to the same ``Place``
shape and restricted to North America. A place's time zone is resolved offline from its
coordinates, so choosing a place never costs another API call.
"""

import logging
from dataclasses import dataclass
from typing import Any, Literal

import httpx
from django.conf import settings
from tzfpy import get_tz

from .errors import ApiError

logger = logging.getLogger(__name__)

MIN_QUERY_LENGTH = 3
MAX_QUERY_LENGTH = 200
MAX_SUGGESTIONS = 8

HERE_AUTOSUGGEST_URL = "https://autosuggest.search.hereapi.com/v1/autosuggest"
HERE_COUNTRIES = "USA,CAN,MEX"
# Autosuggest needs a search centre. This is the middle of the continent; it only biases
# the ranking, because the country filter does the restricting.
HERE_SEARCH_CENTRE = "39.5,-98.5"
HERE_TIMEOUT = httpx.Timeout(3.0)

PHOTON_URL = "https://photon.komoot.io/api/"
# Photon takes west,south,east,north. It rejects requests without a User-Agent.
PHOTON_NORTH_AMERICA_BBOX = "-170,14,-50,72"
PHOTON_COUNTRY_CODES = {"US", "CA", "MX"}
PHOTON_USER_AGENT = "spotter-truck-routing-takehome/0.1"
# Photon is a free public service whose latency swings from 100 ms to 20 s. The driver is
# typing, so give up quickly.
PHOTON_TIMEOUT = httpx.Timeout(4.0)

Provider = Literal["here", "photon"]

# A provider "fails" when the request errors or times out, or when its answer isn't the
# shape we parse.
_PROVIDER_ERRORS = (httpx.HTTPError, ValueError, KeyError, TypeError)


@dataclass(frozen=True)
class Place:
    label: str
    lat: float
    lng: float
    time_zone: str


@dataclass(frozen=True)
class Suggestions:
    provider: Provider
    places: list[Place]


class PlacesUnavailableError(ApiError):
    status_code = 503
    code = "places_unavailable"
    message = "Place search is unavailable right now. Please try again."


def suggest(query: str) -> Suggestions:
    """Up to ``MAX_SUGGESTIONS`` North American places matching ``query``.

    HERE answers first. If it errors or times out, Photon answers instead, in the same
    shape. If both fail the caller gets ``PlacesUnavailableError``.
    """
    try:
        return Suggestions("here", _here_places(query))
    except _PROVIDER_ERRORS as error:
        # Never log the exception itself: httpx puts the request URL, and with it the
        # HERE key, in its message.
        logger.warning("HERE Autosuggest failed (%s); falling back to Photon", _describe(error))
    try:
        return Suggestions("photon", _photon_places(query))
    except _PROVIDER_ERRORS as error:
        logger.error("Photon failed too (%s)", _describe(error))
    raise PlacesUnavailableError()


def _describe(error: Exception) -> str:
    if isinstance(error, httpx.HTTPStatusError):
        return f"HTTP {error.response.status_code}"
    return type(error).__name__


def _here_places(query: str) -> list[Place]:
    response = httpx.get(
        HERE_AUTOSUGGEST_URL,
        params={
            "q": query,
            "in": f"countryCode:{HERE_COUNTRIES}",
            "at": HERE_SEARCH_CENTRE,
            "limit": MAX_SUGGESTIONS,
            "apiKey": settings.HERE_API_KEY,
        },
        timeout=HERE_TIMEOUT,
    )
    response.raise_for_status()
    items: list[dict[str, Any]] = response.json()["items"]
    # Autosuggest also returns search-term completions, which have no position.
    return [
        _place(_here_label(item), item["position"]["lat"], item["position"]["lng"])
        for item in items
        if "position" in item
    ][:MAX_SUGGESTIONS]


def _here_label(item: dict[str, Any]) -> str:
    return item.get("address", {}).get("label") or item["title"]


def _photon_places(query: str) -> list[Place]:
    response = httpx.get(
        PHOTON_URL,
        params={"q": query, "limit": MAX_SUGGESTIONS, "bbox": PHOTON_NORTH_AMERICA_BBOX},
        headers={"User-Agent": PHOTON_USER_AGENT},
        timeout=PHOTON_TIMEOUT,
    )
    response.raise_for_status()
    features: list[dict[str, Any]] = response.json()["features"]
    # The bounding box also covers the Caribbean and Central America.
    in_scope = [
        feature
        for feature in features
        if feature["properties"].get("countrycode") in PHOTON_COUNTRY_CODES
    ]
    return [
        _place(_photon_label(feature["properties"]), lat, lng)
        for feature in in_scope[:MAX_SUGGESTIONS]
        for lng, lat in [feature["geometry"]["coordinates"]]
    ]


def _photon_label(properties: dict[str, Any]) -> str:
    """Join name, street, city, state and country, e.g. ``Chicago, IL 60654, United States``."""
    street = " ".join(filter(None, [properties.get("housenumber"), properties.get("street")]))
    region = " ".join(filter(None, [properties.get("state"), properties.get("postcode")]))
    parts = [properties.get("name"), street, properties.get("city"), region]
    parts.append(properties.get("country"))
    label: list[str] = []
    for part in parts:
        if part and (not label or label[-1] != part):
            label.append(part)
    return ", ".join(label)


def time_zone_at(lat: float, lng: float) -> str:
    """The IANA time zone at a point, resolved offline."""
    return get_tz(lng, lat)


def _place(label: str, lat: float, lng: float) -> Place:
    return Place(label=label, lat=lat, lng=lng, time_zone=time_zone_at(lat, lng))
