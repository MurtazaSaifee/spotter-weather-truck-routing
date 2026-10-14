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
