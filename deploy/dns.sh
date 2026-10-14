#!/usr/bin/env bash
# Point spotter.murtazasaifee.com at Vercel with one CNAME in the existing Route 53 zone.
#
# Usage: deploy/dns.sh [cname-target]
# Without an argument it asks Vercel for the project's recommended target. UPSERT makes a
# re-run a no-op. Only this one record is touched.
set -euo pipefail

DOMAIN="spotter.murtazasaifee.com"
HOSTED_ZONE_ID="Z028409618H4TX1N5AW72"
VERCEL=(npx --yes vercel@64.0.2)

target="${1:-}"
if [[ -z "$target" ]]; then
  cd "$(dirname "${BASH_SOURCE[0]}")/../frontend"
  target="$("${VERCEL[@]}" api "/v6/domains/$DOMAIN/config" |
    python3 -c 'import json, sys; print(json.load(sys.stdin)["recommendedCNAME"][0]["value"])')"
fi

change_batch="$(python3 - "$DOMAIN" "$target" <<'PY'
import json
import sys

name, target = sys.argv[1:3]
print(json.dumps({
    "Comment": "spotter frontend on Vercel",
    "Changes": [{
        "Action": "UPSERT",
        "ResourceRecordSet": {
            "Name": name,
            "Type": "CNAME",
            "TTL": 300,
            "ResourceRecords": [{"Value": target}],
        },
    }],
}))
PY
)"

aws route53 change-resource-record-sets \
  --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch "$change_batch"
echo "CNAME $DOMAIN -> $target"
