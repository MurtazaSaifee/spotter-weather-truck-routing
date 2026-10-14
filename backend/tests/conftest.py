import pytest
import respx
from django.core.cache import cache


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
