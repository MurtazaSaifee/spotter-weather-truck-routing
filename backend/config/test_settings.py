"""Test settings: in-memory cache and a fake provider key, whatever the local .env holds."""

from .settings import *  # noqa: F403

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "OPTIONS": {"MAX_ENTRIES": 10_000},
    }
}
HERE_API_KEY = "test-here-key"
