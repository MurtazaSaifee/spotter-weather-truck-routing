"""Places adapter: address suggestions from HERE Autosuggest, with Photon as the fallback.

``suggest`` is the whole interface. Both providers are normalised to the same ``Place``
shape, for places anywhere in the world. A place's time zone is resolved offline from its
coordinates, so choosing a place never costs another API call.
"""

import logging
from dataclasses import dataclass
from typing import Any, Literal

import httpx
from django.conf import settings
from tzfpy import get_tz

from .errors import ApiError
from .providers import PROVIDER_ERRORS, describe_error

logger = logging.getLogger(__name__)

MIN_QUERY_LENGTH = 3
MAX_QUERY_LENGTH = 200
MAX_SUGGESTIONS = 8

HERE_AUTOSUGGEST_URL = "https://autosuggest.search.hereapi.com/v1/autosuggest"
# Autosuggest needs a search centre when it has no country filter. Latitude 0, longitude 0
# favours no country or continent; it only biases the ranking, and restricts nothing.
HERE_SEARCH_CENTRE = "0,0"
HERE_TIMEOUT = httpx.Timeout(3.0)

PHOTON_URL = "https://photon.komoot.io/api/"
# Photon rejects requests without a User-Agent.
PHOTON_USER_AGENT = "spotter-truck-routing-takehome/0.1"
# Photon is a free public service whose latency swings from 100 ms to 20 s. The driver is
# typing, so give up quickly.
PHOTON_TIMEOUT = httpx.Timeout(4.0)

Provider = Literal["here", "photon"]


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
    """Up to ``MAX_SUGGESTIONS`` places, anywhere in the world, matching ``query``.

    HERE answers first. If it errors or times out, Photon answers instead, in the same
    shape. If both fail the caller gets ``PlacesUnavailableError``.
    """
    try:
        return Suggestions("here", _here_places(query))
    except PROVIDER_ERRORS as error:
        # Never log the exception itself: httpx puts the request URL, and with it the
        # HERE key, in its message.
        logger.warning(
            "HERE Autosuggest failed (%s); falling back to Photon", describe_error(error)
        )
    try:
        return Suggestions("photon", _photon_places(query))
    except PROVIDER_ERRORS as error:
        logger.error("Photon failed too (%s)", describe_error(error))
    raise PlacesUnavailableError()


def _here_places(query: str) -> list[Place]:
    response = httpx.get(
        HERE_AUTOSUGGEST_URL,
        params={
            "q": query,
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
        params={"q": query, "limit": MAX_SUGGESTIONS},
        headers={"User-Agent": PHOTON_USER_AGENT},
        timeout=PHOTON_TIMEOUT,
    )
    response.raise_for_status()
    features: list[dict[str, Any]] = response.json()["features"]
    return [
        _place(_photon_label(feature["properties"]), lat, lng)
        for feature in features[:MAX_SUGGESTIONS]
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
