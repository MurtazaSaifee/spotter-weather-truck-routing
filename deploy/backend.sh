#!/usr/bin/env bash
# Build the backend image with Cloud Build and deploy it to Cloud Run.
#
# Reads HERE_API_KEY and REDIS_URL from backend/.env (override the path with ENV_FILE) and
# passes them to Cloud Run through a temporary mode-600 env-vars file, so they never appear
# on a command line or in the output. DJANGO_SECRET_KEY is regenerated on every deploy; the
# service signs nothing, so rotating it is harmless.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
vars_file="$work_dir/env.yaml"
(umask 077; : > "$vars_file")

# JSON strings are valid YAML scalars, so json.dumps quotes every value safely.
HERE_API_KEY="$(env_value HERE_API_KEY)" REDIS_URL="$(env_value REDIS_URL)" python3 - "$vars_file" <<'PY'
import json
import os
import secrets
import sys

values = {
    "HERE_API_KEY": os.environ["HERE_API_KEY"],
    "REDIS_URL": os.environ["REDIS_URL"],
    "DJANGO_SECRET_KEY": secrets.token_urlsafe(64),
    # Cloud Run serves every service on a *.run.app hostname (both URL formats).
    "DJANGO_ALLOWED_HOSTS": ".run.app",
}
with open(sys.argv[1], "w") as out:
    for key, value in values.items():
        out.write(f"{key}: {json.dumps(value)}\n")
PY

gc run deploy "$CLOUD_RUN_SERVICE" \
  --source="$REPO_ROOT/backend" \
  --project="$GCP_PROJECT" \
  --region="$GCP_REGION" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=3 \
  --cpu-boost \
  --memory=512Mi \
  --cpu=1 \
  --concurrency=8 \
  --timeout=60 \
  --env-vars-file="$vars_file"

echo "Deployed: $(service_url)"
