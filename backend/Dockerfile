# syntax=docker/dockerfile:1

FROM ghcr.io/astral-sh/uv:0.13.1 AS uv

# Build stage: resolve the locked, production-only dependencies into a virtualenv.
FROM python:3.13-slim AS builder
COPY --from=uv /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
# The project is a virtual uv project (no build system), so only its dependencies are installed.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project

# Runtime stage: Python, the virtualenv and the application, with no build tooling.
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"
WORKDIR /app
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app
COPY --from=builder /app/.venv /app/.venv
COPY . .
RUN python -m compileall -q config api
USER app
EXPOSE 8080
CMD ["gunicorn", "--config", "gunicorn.conf.py", "config.wsgi"]
