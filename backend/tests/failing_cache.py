"""A cache backend whose batch operations fail, as Redis does when it is unreachable."""

from django.core.cache.backends.locmem import LocMemCache


class BatchFailingCache(LocMemCache):
    """In-memory, except ``get_many`` and ``set_many`` raise a connection error.

    The weather adapter reads and writes only in batches; single gets and sets work, so a
    plan's routes (which are cached by ``routing``) are unaffected.
    """

    def get_many(self, keys, version=None):
        raise ConnectionError("cache unreachable")

    def set_many(self, data, timeout=None, version=None):
        raise ConnectionError("cache unreachable")


class DeadCache(LocMemCache):
    """Every operation raises a connection error, as with Redis switched off.

    Nothing the app does with the cache survives it: not the rate limits, the cached routes
    or the cached forecasts.
    """

    def _unreachable(self, *args, **kwargs):
        raise ConnectionError("cache unreachable")

    get = set = add = incr = touch = delete = get_many = set_many = _unreachable
