"""Gunicorn settings for the container, tuned through environment variables.

Cloud Run provides PORT. Raise WEB_CONCURRENCY and GUNICORN_THREADS together with the
instance's CPU allowance.
"""

import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8080')}"
workers = int(os.environ.get("WEB_CONCURRENCY", "1"))
# Threads let one worker serve many requests while they wait on the routing and weather APIs.
worker_class = "gthread"
threads = int(os.environ.get("GUNICORN_THREADS", "8"))
# Cloud Run enforces the request timeout itself, so gunicorn must not kill workers too.
timeout = 0

accesslog = "-"
errorlog = "-"

# The runtime control socket defaults to a path under $HOME, which the container user lacks,
# and a stateless container has no use for it.
control_socket_disable = True
