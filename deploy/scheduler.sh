#!/usr/bin/env bash
# Keep the Cloud Run service warm: a Cloud Scheduler job pings the health endpoint every 10
# minutes. Creates the job, or updates it when it already exists. A free-tier job.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

JOB="spotter-api-keepwarm"
SCHEDULE="*/10 * * * *"
uri="$(service_url)/api/health"

if gc scheduler jobs describe "$JOB" --location="$GCP_REGION" >/dev/null 2>&1; then
  verb="update"
else
  verb="create"
fi

gc scheduler jobs "$verb" http "$JOB" \
  --location="$GCP_REGION" \
  --schedule="$SCHEDULE" \
  --time-zone="Etc/UTC" \
  --uri="$uri" \
  --http-method=GET \
  --attempt-deadline=60s \
  --description="Keeps the spotter-api Cloud Run service warm (remove after the hiring decision)."

echo "Scheduler job $JOB ($SCHEDULE) pings $uri"
