"""Django's Redis cache backend on an in-memory fake server, with its round trips counted."""

import fakeredis
import pytest
from django.core.cache.backends.redis import RedisCache
from redis.client import Pipeline

# One entry per round trip to the fake server: a single command, or a whole pipeline.
ROUND_TRIPS: list[str] = []
_SERVER = fakeredis.FakeServer()


class _CountingRedis(fakeredis.FakeRedis):
    """Fake Redis that notes each command sent on its own. Commands queued on a pipeline reach
    the server together, in ``Pipeline.execute``, which ``counting_round_trips`` notes."""

    def __init__(self, connection_pool=None):
        super().__init__(server=_SERVER)

    def execute_command(self, *args, **options):
        ROUND_TRIPS.append(str(args[0]).lower())
        return super().execute_command(*args, **options)


def fake_redis_server() -> fakeredis.FakeRedis:
    """A client for looking at what the cache stored."""
    return fakeredis.FakeRedis(server=_SERVER)


class FakeRedisCache(RedisCache):
    def __init__(self, server, params):
        super().__init__(server, params)
        self._cache._client = _CountingRedis


@pytest.fixture
def counting_round_trips(monkeypatch):
    """The list of round trips made to the fake Redis during the test."""
    fakeredis.FakeRedis(server=_SERVER).flushall()
    ROUND_TRIPS.clear()
    execute = Pipeline.execute

    def counted(self, *args, **kwargs):
        ROUND_TRIPS.append("pipeline")
        return execute(self, *args, **kwargs)

    monkeypatch.setattr(Pipeline, "execute", counted)
    return ROUND_TRIPS
