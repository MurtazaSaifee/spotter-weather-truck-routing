"""The single error format: every API error responds with ``{code, message, details?}``.

DRF errors are translated by ``exception_handler``. Errors raised outside DRF views
(unknown URLs, middleware failures) go through the Django handlers at the bottom.
"""

import logging
from typing import Any

from django.http import Http404, HttpRequest, JsonResponse
from rest_framework import exceptions
from rest_framework.response import Response

logger = logging.getLogger(__name__)

INTERNAL_ERROR_MESSAGE = "Something went wrong on our side. Please try again."


class ApiError(Exception):
    """An error the API reports on purpose. Subclasses set the status, code and message."""

    status_code = 500
    code = "internal_error"
    message = INTERNAL_ERROR_MESSAGE

    def __init__(self, message: str | None = None, details: dict[str, Any] | None = None):
        super().__init__(message or self.message)
        if message is not None:
            self.message = message
        self.details = details


def error_body(code: str, message: str, details: Any = None) -> dict[str, Any]:
    body: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        body["details"] = details
    return body


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response:
    """DRF ``EXCEPTION_HANDLER``: translate any exception raised in a view."""
    if isinstance(exc, ApiError):
        return Response(
            error_body(exc.code, exc.message, exc.details),
            status=exc.status_code,
            headers=_retry_after_header(exc),
        )
    if isinstance(exc, Http404):
        exc = exceptions.NotFound()
    if isinstance(exc, exceptions.ValidationError):
        fields = exc.detail if isinstance(exc.detail, dict) else {"non_field_errors": exc.detail}
        return Response(
            error_body("validation_error", _first_message(fields), {"fields": fields}),
            status=exc.status_code,
        )
    if isinstance(exc, exceptions.ParseError):
        return Response(error_body("validation_error", str(exc.detail)), status=exc.status_code)
    if isinstance(exc, exceptions.APIException):
        return Response(error_body(exc.default_code, str(exc.detail)), status=exc.status_code)

    logger.exception("Unhandled error in %s", type(context.get("view")).__name__)
    return Response(error_body("internal_error", INTERNAL_ERROR_MESSAGE), status=500)


def _retry_after_header(exc: ApiError) -> dict[str, str]:
    """The standard ``Retry-After`` (whole seconds) for an error that says how long to wait."""
    seconds = (exc.details or {}).get("retry_after_seconds")
    return {"Retry-After": str(seconds)} if isinstance(seconds, int) else {}


def _first_message(errors: Any, path: str = "") -> str:
    """The first leaf message, prefixed with its field path, e.g. ``origin.lat: ...``."""
    if isinstance(errors, dict):
        field, nested = next(iter(errors.items()))
        prefix = path if field == "non_field_errors" else f"{path}.{field}".lstrip(".")
        return _first_message(nested, prefix)
    if isinstance(errors, list) and errors:
        return _first_message(errors[0], path)
    return f"{path}: {errors}" if path else str(errors)


def bad_request(request: HttpRequest, exception: Exception | None = None) -> JsonResponse:
    return JsonResponse(
        error_body("bad_request", "The request could not be understood."), status=400
    )


def permission_denied(request: HttpRequest, exception: Exception | None = None) -> JsonResponse:
    return JsonResponse(error_body("permission_denied", "This request is not allowed."), status=403)


def not_found(request: HttpRequest, exception: Exception | None = None) -> JsonResponse:
    return JsonResponse(error_body("not_found", "No API endpoint at this address."), status=404)


def server_error(request: HttpRequest) -> JsonResponse:
    return JsonResponse(error_body("internal_error", INTERNAL_ERROR_MESSAGE), status=500)
