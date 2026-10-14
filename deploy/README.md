# Deployment

Production runs on three services, deployed from a developer machine (no CI deploys):

| Piece | Where | Script |
| --- | --- | --- |
| API | Google Cloud Run, project `spotter-truck-routing`, `us-central1` | `backend.sh` |
| Keep-warm ping | Cloud Scheduler job hitting `/api/health` every 10 minutes | `scheduler.sh` |
| Frontend | Vercel (Hobby) project `spotter` at https://spotter.murtazasaifee.com | `frontend.sh` |
| DNS | One CNAME in the existing Route 53 zone | `dns.sh` |

The browser only talks to the Vercel origin. `frontend/vercel.json` rewrites `/api/*` to the Cloud Run
URL, so the API needs no CORS configuration.

## Prerequisites

- `gcloud` with a configuration named `spotter` (account, project `spotter-truck-routing`, region
  `us-central1`). Cloud Run, Artifact Registry, Cloud Build and Cloud Scheduler APIs enabled.
  Override the configuration name with `GCLOUD_CONFIG`.
- `npx vercel login` done once. The scripts pin `vercel@64.0.2`.
- `aws` CLI with access to the Route 53 hosted zone (only for `dns.sh`).
- `backend/.env` containing `HERE_API_KEY` and `REDIS_URL` (see `backend/.env.example`; Upstash gives a
  `rediss://` TLS URL). Point `ENV_FILE` at another file to use it instead.

## Deploy

```sh
deploy/backend.sh      # build with Cloud Build (the local Docker is arm64, Cloud Run needs amd64) and deploy
deploy/frontend.sh     # link, deploy to production, attach the domain
deploy/dns.sh          # first time only: CNAME spotter.murtazasaifee.com -> Vercel
deploy/scheduler.sh    # first time only (re-running updates the job)
```

Order for a fresh setup: `backend.sh`, put the printed Cloud Run URL into `frontend/vercel.json`,
then `frontend.sh`, `dns.sh`, `scheduler.sh`. Every script is safe to re-run.

## Secrets

`backend.sh` reads the two secrets from `backend/.env` and passes them to Cloud Run as environment
variables through a temporary mode-600 `--env-vars-file`, deleted on exit. They never reach a command
line, the terminal output, git or the frontend bundle. `DJANGO_SECRET_KEY` is generated fresh on each
deploy (nothing in the service is signed). `DJANGO_ALLOWED_HOSTS` is `.run.app`.

## Cloud Run settings

Unauthenticated access, minimum instances 0 (scale to zero), maximum 3, startup CPU boost, 1 vCPU,
512 MiB, concurrency 8 (matches the 8 gunicorn threads in `backend/gunicorn.conf.py`), request timeout 60 s.

## Teardown

After the hiring decision: `gcloud scheduler jobs delete spotter-api-keepwarm --location=us-central1`,
then delete the Cloud Run service `spotter-api`, the Vercel project, and the CNAME.
