Standalone OR-Tools CP-SAT microservice for driver/cab scheduling. Called
by the main Next.js app's cron worker (`lib/scheduling/solverClient.ts`) —
see `docs/superpowers/specs/2026-08-11-driver-cab-scheduling-design.md`.

## Run locally

    pip install -r requirements.txt
    export SCHEDULER_SERVICE_SECRET=dev-secret
    uvicorn main:app --reload --port 8000

## Deploy

Any host that runs a Python ASGI app works (Render, Fly.io, Cloud Run).
Set `SCHEDULER_SERVICE_SECRET` to the same value as the main app's
`SCHEDULER_SERVICE_SECRET` env var, and point the main app's
`SCHEDULER_SERVICE_URL` at this service's base URL (no trailing slash).

## Test

    pytest -v
