#!/usr/bin/env bash
# Deploy the frontend to Vercel production from this machine (no Git integration).
#
# Links frontend/ to the `spotter` Vercel project (created on first run), deploys, and makes
# sure the custom domain is attached. Vercel builds in its cloud with `npm run build`; the
# /api/* rewrite to Cloud Run lives in frontend/vercel.json. The frontend holds no secrets.
# Requires a logged-in CLI (`npx vercel login`).
set -euo pipefail

PROJECT="spotter"
DOMAIN="spotter.murtazasaifee.com"
VERCEL=(npx --yes vercel@64.0.2)

cd "$(dirname "${BASH_SOURCE[0]}")/../frontend"

"${VERCEL[@]}" link --yes --project "$PROJECT"
"${VERCEL[@]}" deploy --prod --yes

# Adding an attached domain a second time is harmless; keep going if it already exists.
"${VERCEL[@]}" domains add "$DOMAIN" "$PROJECT" || true
