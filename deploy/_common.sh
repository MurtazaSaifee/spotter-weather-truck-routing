# Shared settings for the deploy scripts. Source this file; do not run it.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GCLOUD_CONFIG="${GCLOUD_CONFIG:-spotter}"
GCP_PROJECT="spotter-truck-routing"
GCP_REGION="us-central1"
CLOUD_RUN_SERVICE="spotter-api"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/backend/.env}"

gc() { gcloud --configuration="$GCLOUD_CONFIG" "$@"; }

# Print the value of one key from the env file (surrounding quotes removed).
# Callers must capture the output rather than echo it: the values are secrets.
env_value() {
  python3 - "$ENV_FILE" "$1" <<'PY'
import sys

path, key = sys.argv[1:3]
for line in open(path):
    line = line.strip()
    if line.startswith(key + "="):
        value = line.split("=", 1)[1].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        print(value)
        break
else:
    sys.exit(f"{key} is not set in {path}")
PY
}

service_url() {
  gc run services describe "$CLOUD_RUN_SERVICE" --region="$GCP_REGION" --format='value(status.url)'
}
