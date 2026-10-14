"""Weather adapter: hourly forecasts from Open-Meteo, for any set of places and times.

The interface is two things:

- ``load_forecast(points, times)`` gets the forecast for ``points`` ready for ``times``;
- ``Forecast.conditions_at(point, when)`` answers what the weather is at a place and time.

Checkpoints and the heatmap both go through it, so they share one cache and one set of
hour-selection rules. The steps behind it are kept separate:

- places are snapped to the 0.05 degree lattice (``lattice``) and deduplicated, so a
  forecast is fetched once however many routes or checkpoints land on it;
- every lattice point is fetched for the same fixed window (the current UTC day and the
  seven after), whatever the request needs, so any cached forecast fits any trip;
- a lattice point's forecast is cached as a few hundred bytes (``_encode``), and the cache
  is read and written in batches, because on a hosted Redis every command is a round trip.
"""

import logging
import math
import struct
import zlib
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Any

import httpx
from django.core.cache import cache
from django.utils import timezone

from .errors import ApiError
from .geo import Point
from .lattice import LatticePoint, snap_unique
from .providers import PROVIDER_ERRORS, describe_error

logger = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
# Up to a thousand lattice points hold a few MB of JSON, so allow for a slow read.
OPEN_METEO_TIMEOUT = httpx.Timeout(20.0, connect=5.0)
# Open-Meteo refuses more locations than this in one request.
MAX_LOCATIONS_PER_REQUEST = 1000
# ``rain`` is large-scale rain only; convective rain is ``showers``, and the rain rate is both.
HOURLY_VARIABLES = "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall"
# Today (GMT) and seven more days: 192 hourly values. With at most 10 variables and 14 days,
# a location costs one call against Open-Meteo's quota however many hours it returns.
WINDOW_DAYS = 8

CACHE_SECONDS = 60 * 60
# A Redis request carries at most 10 MB; 200 entries of under 1 KB are far inside that.
CACHE_READ_CHUNK = 200
CACHE_WRITE_CHUNK = 200
# Bumped when what is cached under "weather:" changes shape. Each adapter versions its own keys.
_CACHE_KEY_VERSION = "v1"

# Entries hold whole numbers: wind and gusts in tenths of a mile per hour, rain and snow in
# thousandths of an inch per hour. A signed 16-bit integer reaches 3,276 mph and 32 in/hr.
_WIND_SCALE = 10
_PRECIPITATION_SCALE = 1000
_MISSING = -32768
_MAX_STORED = 32767


class WeatherUnavailableError(ApiError):
    status_code = 503
    code = "weather_unavailable"
    message = "The weather forecast is unavailable right now. Please try again."


class WeatherRateLimitedError(ApiError):
    """Open-Meteo is limiting our requests; the same request succeeds after a short wait."""

    status_code = 429
    code = "weather_rate_limited"
    message = "The weather service is busy. Please try again in a moment."

    def __init__(self, retry_after_seconds: int):
        super().__init__(details={"retry_after_seconds": retry_after_seconds})


@dataclass(frozen=True)
class Conditions:
    """The weather a truck meets at one place and time. ``None`` means no forecast."""

    wind_mph: float | None
    gust_mph: float | None
    rain_in_hr: float | None
    snow_in_hr: float | None

    @property
    def complete(self) -> bool:
        """Whether sustained wind, rain and snow are known. A missing gust alone doesn't
        stop a place being assessed; it only leaves out the gust warning."""
        return None not in (self.wind_mph, self.rain_in_hr, self.snow_in_hr)


@dataclass(frozen=True)
class Series:
    """One lattice point's forecast: hourly values from ``start`` (a whole GMT hour).

    Values are the stored whole numbers (see ``_WIND_SCALE``), ``_MISSING`` where the
    provider had none. The four series have the same length.
    """

    start: datetime
    wind: tuple[int, ...]
    gusts: tuple[int, ...]
    rain: tuple[int, ...]
    snow: tuple[int, ...]

    @property
    def hours(self) -> int:
        return len(self.wind)

    def covers(self, first: datetime, last: datetime) -> bool:
        return self.start <= first and last <= self.start + timedelta(hours=self.hours - 1)


class Forecast:
    """The forecast for a set of lattice points, as loaded by ``load_forecast``."""

    def __init__(self, series: dict[LatticePoint, Series]):
        self._series = series

    def conditions_at(self, point: Point, when: datetime) -> Conditions:
        """The weather at ``point`` (snapped to the lattice) for a truck there at ``when``.

        The provider stamps each hourly value at time T. Sustained wind is an instant reading
        at T, so it comes from the hour nearest ``when``. Gusts, rain, showers and snowfall
        are the maximum or total over the hour before T, (T-1h, T], so they come from the
        value stamped at the first whole hour at or after ``when``: the one whose hour
        contains it. A value that is missing is replaced by the neighbouring hour's, the one
        nearer ``when`` first; if both are missing too, so is the condition.

        Needs the point to have been loaded; anything outside the loaded window is missing.
        """
        series = self._series.get(snap_unique([point])[0])
        if series is None:
            raise KeyError(f"No forecast was loaded for {point}")
        hours_in = (when - series.start).total_seconds() / 3600
        nearest = math.floor(hours_in + 0.5)
        bucket = math.ceil(hours_in)
        return Conditions(
            wind_mph=_read(series.wind, nearest, hours_in > nearest, _WIND_SCALE),
            gust_mph=_read(series.gusts, bucket, hours_in > bucket - 0.5, _WIND_SCALE),
            rain_in_hr=_read(series.rain, bucket, hours_in > bucket - 0.5, _PRECIPITATION_SCALE),
            snow_in_hr=_read(series.snow, bucket, hours_in > bucket - 0.5, _PRECIPITATION_SCALE),
        )


def load_forecast(points: Iterable[Point], times: Iterable[datetime]) -> Forecast:
    """The forecast at ``points``, good for ``conditions_at`` any of ``times``.

    ``points`` may repeat or land on the same lattice point; each lattice point is loaded
    once. A cached forecast is used if it covers ``times`` (with an hour either side for the
    missing-value fallback); the rest are fetched together in as few requests as possible.

    Raises ``WeatherRateLimitedError`` or ``WeatherUnavailableError`` when Open-Meteo
    refuses or fails. Cache failures never raise: the forecast is fetched instead.
    """
    lattice = snap_unique(points)
    needed = _needed_window(times)
    store = _Store()
    series = {
        point: cached for point, cached in store.read(lattice).items() if _fits(cached, needed)
    }
    missing = [point for point in lattice if point not in series]
    for batch in _chunks(missing, MAX_LOCATIONS_PER_REQUEST):
        fetched = _fetch(batch)
        store.write(fetched)
        series.update(fetched)
    return Forecast(series)


def _needed_window(times: Iterable[datetime]) -> tuple[datetime, datetime] | None:
    """The first and last hourly stamps a forecast must have for ``times``, with the hour
    either side that a missing value may fall back on. ``None`` if there are no times."""
    utc = [moment.astimezone(UTC) for moment in times]
    if not utc:
        return None
    earliest = min(utc).replace(minute=0, second=0, microsecond=0)
    latest = max(utc).replace(minute=0, second=0, microsecond=0)
    return earliest - timedelta(hours=1), latest + timedelta(hours=2)


def _fits(series: Series, needed: tuple[datetime, datetime] | None) -> bool:
    """Whether a cached forecast can serve a request needing the ``needed`` stamps.

    One that doesn't cover them is a miss, unless it is for today's window: a fresh fetch
    couldn't cover them either, and refetching on every request would only waste quota.
    """
    return needed is None or series.covers(*needed) or series.start == _window_start()


def _window_start() -> datetime:
    return timezone.now().astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def _read(values: Sequence[int], index: int, later_is_nearer: bool, scale: int) -> float | None:
    """The value at ``index`` hours into a series, or its neighbour's if that is missing."""
    neighbours = (1, -1) if later_is_nearer else (-1, 1)
    for offset in (0, *neighbours):
        position = index + offset
        if 0 <= position < len(values) and values[position] != _MISSING:
            return values[position] / scale
    return None


def _chunks[T](items: Sequence[T], size: int) -> Iterator[Sequence[T]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


# --- Open-Meteo -------------------------------------------------------------------------


def _fetch(points: Sequence[LatticePoint]) -> dict[LatticePoint, Series]:
    """Fetch ``points`` (at most ``MAX_LOCATIONS_PER_REQUEST``) in one request."""
    try:
        # A POST, because a thousand coordinate pairs overflow the URL of a GET.
        response = httpx.post(
            OPEN_METEO_URL,
            data={
                "latitude": ",".join(f"{point.lat:.2f}" for point in points),
                "longitude": ",".join(f"{point.lng:.2f}" for point in points),
                "hourly": HOURLY_VARIABLES,
                "wind_speed_unit": "mph",
                "precipitation_unit": "inch",
                "timezone": "GMT",
                "forecast_days": WINDOW_DAYS,
            },
            timeout=OPEN_METEO_TIMEOUT,
        )
        if response.status_code == 429:
            raise WeatherRateLimitedError(_retry_after_seconds(response))
        response.raise_for_status()
        results = response.json()
        if isinstance(results, dict):  # One location comes back bare, not in a list.
            results = [results]
        if len(results) != len(points):
            raise ValueError("Open-Meteo answered for a different number of locations")
        return {
            point: _parse_series(result["hourly"])
            for point, result in zip(points, results, strict=True)
        }
    except PROVIDER_ERRORS as error:
        logger.error("Open-Meteo failed (%s)", describe_error(error))
        raise WeatherUnavailableError() from None


def _parse_series(hourly: dict[str, list[Any]]) -> Series:
    start = datetime.fromisoformat(hourly["time"][0]).replace(tzinfo=UTC)
    rain = [
        None if rain is None or showers is None else rain + showers
        for rain, showers in zip(hourly["rain"], hourly["showers"], strict=True)
    ]
    series = Series(
        start=start,
        wind=_scaled(hourly["wind_speed_10m"], _WIND_SCALE),
        gusts=_scaled(hourly["wind_gusts_10m"], _WIND_SCALE),
        rain=_scaled(rain, _PRECIPITATION_SCALE),
        snow=_scaled(hourly["snowfall"], _PRECIPITATION_SCALE),
    )
    lengths = {len(hourly["time"]), len(series.wind), len(series.gusts), len(series.snow)}
    if len(lengths) != 1:
        raise ValueError("Open-Meteo's series differ in length")
    return series


def _scaled(values: Sequence[float | None], scale: int) -> tuple[int, ...]:
    return tuple(
        _MISSING if value is None else max(0, min(_MAX_STORED, round(value * scale)))
        for value in values
    )


def _retry_after_seconds(response: httpx.Response) -> int:
    """How long to wait: the provider's ``Retry-After`` (seconds or an HTTP date), else the
    time to the next full minute, which is when its per-minute limit resets."""
    header = response.headers.get("Retry-After", "").strip()
    try:
        if header.isdigit():
            return max(1, int(header))
        if header:
            wait = parsedate_to_datetime(header) - timezone.now()
            return max(1, math.ceil(wait.total_seconds()))
    except (TypeError, ValueError):
        pass
    return 60 - timezone.now().second


# --- The cache ----------------------------------------------------------------------------


class _Store:
    """The cache's view of lattice points' forecasts, for one ``load_forecast`` call.

    A cache that fails is skipped, not fatal: the first error is logged, and the rest of the
    call goes without the cache so a dead Redis costs one timeout, not one per batch.
    """

    def __init__(self) -> None:
        self._working = True

    def read(self, points: Sequence[LatticePoint]) -> dict[LatticePoint, Series]:
        found: dict[LatticePoint, Series] = {}
        for chunk in _chunks(points, CACHE_READ_CHUNK):
            try:
                hits = cache.get_many([_key(point) for point in chunk]) if self._working else {}
            except Exception as error:
                self._failed("read", error)
                break
            for point in chunk:
                encoded = hits.get(_key(point))
                if encoded is not None:
                    series = _decode(encoded)
                    if series is not None:
                        found[point] = series
        return found

    def write(self, entries: dict[LatticePoint, Series]) -> None:
        if not self._working:
            return
        for chunk in _chunks(list(entries), CACHE_WRITE_CHUNK):
            try:
                cache.set_many(
                    {_key(point): _encode(entries[point]) for point in chunk}, CACHE_SECONDS
                )
            except Exception as error:
                self._failed("write", error)
                return

    def _failed(self, action: str, error: Exception) -> None:
        # Not the exception itself: a Redis error message can carry the connection URL.
        logger.warning(
            "Weather cache %s failed (%s); using Open-Meteo", action, type(error).__name__
        )
        self._working = False


def _key(point: LatticePoint) -> str:
    return f"weather:{_CACHE_KEY_VERSION}:{point.north}:{point.east}"


# A cached entry: the window start (seconds since 1970, 8 bytes), the hours (2 bytes), then
# the wind, gust, rain and snow series as 16-bit integers; all compressed.
_HEADER = struct.Struct("<qH")


def _encode(series: Series) -> bytes:
    count = series.hours
    body = struct.pack(f"<{4 * count}h", *series.wind, *series.gusts, *series.rain, *series.snow)
    header = _HEADER.pack(int(series.start.timestamp()), count)
    return zlib.compress(header + body)


def _decode(encoded: bytes) -> Series | None:
    """The series in a cached entry, or ``None`` if it isn't a valid one (treated as a miss)."""
    try:
        raw = zlib.decompress(encoded)
        start, count = _HEADER.unpack_from(raw)
        values = struct.unpack_from(f"<{4 * count}h", raw, _HEADER.size)
    except (zlib.error, struct.error, TypeError):
        logger.warning("Ignoring an unreadable weather cache entry")
        return None
    return Series(
        start=datetime.fromtimestamp(start, UTC),
        wind=values[:count],
        gusts=values[count : 2 * count],
        rain=values[2 * count : 3 * count],
        snow=values[3 * count :],
    )
