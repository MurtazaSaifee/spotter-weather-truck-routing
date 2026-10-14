import copy
import json
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

import httpx
import pytest
import respx
from django.core.cache import cache

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def outbound_http():
    """Intercept all outbound httpx traffic; any request a test hasn't mocked fails."""
    with respx.mock(assert_all_called=False) as router:
        yield router


@pytest.fixture(autouse=True)
def _empty_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def load_fixture():
    """Load a recorded provider response by its path under tests/fixtures/.

    Every call returns a fresh object, so a test can edit it into a variant freely.
    """

    def load(name: str) -> Any:
        return json.loads((FIXTURES_DIR / name).read_text())

    return load


OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


class FakeOpenMeteo:
    """Open-Meteo, answering from a recorded response (tests/fixtures/weather/).

    The recording holds three lattice points, 192 hourly values each, from 2026-10-14T00:00
    GMT. Whatever locations a request asks for, every one gets the recording's series (the
    n-th location gets the n-th, wrapping), so a plan across any route has forecasts.
    ``edit`` rewrites a variable at given hours in all of them, for hand-checkable cases;
    ``route`` is the respx route, for answering with errors instead.
    """

    def __init__(self, router, recording: list[dict[str, Any]]):
        self.recording = recording
        self.route = router.post(OPEN_METEO_URL)
        self.answer_normally()

    def answer_normally(self) -> None:
        """Answer from the recording again, after a test made the route fail."""
        self.route.side_effect = self._answer

    def edit(self, variable: str, values: dict[str, float | None]) -> None:
        """Set ``variable`` at each ``{"2026-10-15T13:00": value}`` hour, at every location."""
        for location in self.recording:
            hourly = location["hourly"]
            for stamp, value in values.items():
                hourly[variable][hourly["time"].index(stamp)] = value

    @property
    def requests(self) -> list[dict[str, list[str]]]:
        """The form each request sent, as ``{field: [values]}``."""
        return [parse_qs(call.request.content.decode()) for call in self.route.calls]

    def locations_requested(self) -> list[int]:
        """How many locations each request asked for."""
        return [len(form["latitude"][0].split(",")) for form in self.requests]

    def _answer(self, request: httpx.Request) -> httpx.Response:
        form = parse_qs(request.content.decode())
        latitudes = form["latitude"][0].split(",")
        longitudes = form["longitude"][0].split(",")
        results = []
        for number, (lat, lng) in enumerate(zip(latitudes, longitudes, strict=True)):
            result = copy.deepcopy(self.recording[number % len(self.recording)])
            result["latitude"], result["longitude"] = float(lat), float(lng)
            results.append(result)
        return httpx.Response(200, json=results)


@pytest.fixture(autouse=True)
def open_meteo(outbound_http, load_fixture):
    """Every test sees fair recorded weather unless it changes the answer.

    Planning always asks Open-Meteo for the weather at its checkpoints, so tests that are not
    about weather would otherwise each have to mock it.
    """
    return FakeOpenMeteo(outbound_http, load_fixture("weather/open_meteo_three_points_8_days.json"))
