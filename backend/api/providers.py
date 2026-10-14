"""What the provider adapters (places, routing, weather) share about a provider failing."""

import httpx

# A provider "fails" when the request errors or times out, or when its answer isn't the shape
# the adapter parses.
PROVIDER_ERRORS = (httpx.HTTPError, ValueError, KeyError, TypeError)


def describe_error(error: Exception) -> str:
    """``error`` as it is safe to log: its HTTP status or its type, never its message. httpx puts
    the request URL in a message, and with it the API key."""
    if isinstance(error, httpx.HTTPStatusError):
        return f"HTTP {error.response.status_code}"
    return type(error).__name__
