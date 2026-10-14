import json
from pathlib import Path
from typing import Any

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
