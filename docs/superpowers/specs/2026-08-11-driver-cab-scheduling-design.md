# Driver/Cab Scheduling — Design

Date: 2026-08-11
Status: Approved (pending implementation plan)

## Problem

PPRL Ops currently tracks `trips` (guest pickup/drop requests) but has no concept of drivers or cabs. The team needs to auto-assign drivers to each day's trips based on that day's actual available drivers (which changes daily, including ad-hoc substitutions), with hard constraints:

- A trip normally needs exactly 1 driver; some trips need exactly 2 (manually flagged).
- A driver can never be assigned to two trips whose time windows overlap.
- No artificial rest buffer is required beyond true non-overlap — back-to-back trips for the same driver are fine.
- If there aren't enough drivers to cover every trip, unassignable trips must be clearly surfaced, never silently dropped.
- The system should be built so any open-source scheduling/planning tool could sit behind it, via a strict, solver-agnostic schema — not something ad hoc to one library.

## Non-goals

- Pooling multiple guests/trips into a single shared cab run. One driver handles one trip at a time.
- Modeling travel time between the end of one trip and the start of the next (no rest-buffer / repositioning-time constraint) — out of scope for this iteration.
- Driver self-service availability. Roster is admin-entered.
- Route-duration accuracy beyond what Google Distance Matrix returns for the trip's existing `pickup_location`/`drop_location` text fields.

## Architecture

Two new pieces alongside the existing Next.js + Supabase app:

1. **Schema additions** in Supabase for drivers, cabs, daily rosters, and assignments.
2. **An external OR-Tools microservice** (Python, CP-SAT) that accepts a solver-agnostic JSON "scheduling problem" and returns an assignment. The Next.js app builds that JSON from Supabase data and calls the service over HTTP, authenticated with a shared secret (same pattern as `CRON_SECRET`).

Rationale for an external service: OR-Tools has no official JS/TS binding. The JSON contract between app and solver is intentionally solver-agnostic (drivers, jobs, time windows, hard constraints only) so a different open-source planner could be substituted later without touching the rest of the app.

Auto re-run trigger reuses the existing `sync_queue` pattern: any change to `trips` or `driver_daily_roster` for a date enqueues a `schedule_runs` row; a cron-polled worker (mirroring `/api/cron/sync`) drains the queue and invokes the solver. This keeps trip/roster edits fast (no synchronous solve on every write).

## Data model

New migration `007_driver_scheduling.sql`, following existing conventions (uuid PKs, RLS, `updated_at` triggers where rows are mutated after creation).

### `drivers`
People, not day-specific.
```
id uuid pk
full_name text not null
phone text
active boolean not null default true
created_at timestamptz not null default now()
```

### `cabs`
Vehicle inventory, separate pool from drivers (paired daily, not fixed 1:1).
```
id uuid pk
label text not null            -- e.g. plate number
active boolean not null default true
created_at timestamptz not null default now()
```

### `driver_daily_roster`
One row per driver per date: availability, that day's cab pairing, substitution note.
```
id uuid pk
driver_id uuid not null references drivers(id)
roster_date date not null
available boolean not null default true
cab_id uuid references cabs(id)
substituting_for_driver_id uuid references drivers(id)
notes text
created_at timestamptz not null default now()
unique (driver_id, roster_date)
```
A substitution is simply a new roster row for the substitute driver on that date (`substituting_for_driver_id` set for traceability). The absent driver has `available = false` or no row that date. This is informational only — it does not change solver logic beyond `available`.

### `trips` (alter)
```
alter table trips add column drivers_required smallint not null default 1
  check (drivers_required in (1, 2));
```

### `driver_trip_assignments`
Solver or manual output. One row per driver per trip (2 rows for a 2-driver trip).
```
id uuid pk
trip_id uuid not null references trips(id) on delete cascade
driver_id uuid not null references drivers(id)
roster_date date not null
source text not null check (source in ('solver', 'manual'))
locked boolean not null default false
created_at timestamptz not null default now()
unique (trip_id, driver_id)
```
`locked = true` is set automatically whenever an admin manually creates/edits an assignment, so an automatic re-run never overwrites a human decision. Application logic (not a DB constraint) enforces that a trip has at most `drivers_required` assignment rows at a time.

### `schedule_runs`
Audit trail and work queue for the solver.
```
id uuid pk
roster_date date not null
status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','SUCCEEDED','FAILED'))
triggered_by text not null check (triggered_by in ('auto','manual'))
unassigned_trip_ids jsonb not null default '[]'::jsonb
error_message text
created_at timestamptz not null default now()
completed_at timestamptz
```

### `location_duration_cache`
Cache of Google Distance Matrix lookups, keyed on normalized origin/destination text, so the same pickup/drop pair isn't re-fetched every run.
```
id uuid pk
origin text not null
destination text not null
duration_minutes integer not null
fetched_at timestamptz not null default now()
unique (origin, destination)
```

A trip's driver "busy window" for overlap checking is `[pickup_time, pickup_time + duration_minutes]`, where `duration_minutes` comes from this cache (populated from Distance Matrix using the trip's existing `pickup_location`/`drop_location` text on first use).

RLS: all six objects (5 tables + the `trips.drivers_required` column) admin-only, consistent with `teams`/`sync_queue` — teams have no visibility into driver ops.

## Solver contract

`POST /solve` (Next.js → OR-Tools microservice), authenticated via `SCHEDULER_SERVICE_SECRET` bearer token.

**Request:**
```json
{
  "date": "2026-08-20",
  "drivers": [
    { "id": "uuid", "cab_id": "uuid" }
  ],
  "jobs": [
    {
      "trip_id": "uuid",
      "drivers_required": 1,
      "start_minutes": 540,
      "end_minutes": 585,
      "locked_driver_ids": []
    }
  ]
}
```
- `drivers` — only drivers with `available = true` for `date`.
- `start_minutes`/`end_minutes` — minutes since midnight for `date`, derived from `pickup_time` + cached route duration.
- `locked_driver_ids` — any manually-locked assignments for that job; the solver keeps these fixed and only fills remaining slots (if `drivers_required` > number of locked ids).

**Response:**
```json
{
  "assignments": [ { "trip_id": "uuid", "driver_id": "uuid" } ],
  "unassigned_trip_ids": ["uuid"]
}
```

**Model (CP-SAT):**
- Boolean variable `x[driver][job]` for every available driver × job pair.
- `covered[job]` boolean, 1 if the job is fully staffed.
- Constraint: `sum(x[d][job] for d in drivers) == drivers_required[job] * covered[job]`.
- Constraint: for each driver, assigned jobs' `[start_minutes, end_minutes)` intervals must not overlap (standard OR-Tools `NoOverlap` / interval-var constraint).
- Constraint: for each `locked_driver_id`, `x[driver][job] = 1` is fixed.
- Objective: maximize `sum(covered[job])`. All jobs weighted equally — no date/priority tiering in this iteration.

Jobs where `covered = false` populate `unassigned_trip_ids`.

## Workflow & admin UI

New admin section, **"Driver Scheduling"**, scoped per date:

1. **Roster panel** — lists `drivers`, toggles available/unavailable for the selected date, assigns a `cab_id`, optional "substituting for" note. Saving upserts `driver_daily_roster` rows and enqueues a `schedule_runs` row (`status='QUEUED'`, `triggered_by='auto'`).
2. **Schedule panel** — table of the date's trips with assigned driver(s), a status badge (solver-assigned / manually locked / unassigned), and an inline reassign control.
3. **Unassigned banner** — persistent, visible banner whenever the latest `schedule_runs.unassigned_trip_ids` for the date is non-empty, listing the affected trips.

**Trigger flow:**
- Any insert/update to `trips` or `driver_daily_roster` for a date enqueues a `schedule_runs` row.
- `GET/POST /api/cron/schedule` (bearer-secret pattern matching `/api/cron/sync`) is polled on a schedule (e.g. every minute via the same GitHub Actions approach as sync) and drains `QUEUED` runs: builds the solver JSON (including current locked assignments and cached/fetched route durations), calls the OR-Tools service, writes non-locked results into `driver_trip_assignments`, updates the run's status and `unassigned_trip_ids`.
- Manual reassignment from the UI writes directly to `driver_trip_assignments` with `source='manual', locked=true` — immediate, no queue wait — so it's never clobbered by a subsequent auto re-run.

**New config** (join `lib/env.ts` / README env var list):
- `GOOGLE_MAPS_API_KEY` — Distance Matrix API.
- `SCHEDULER_SERVICE_URL`, `SCHEDULER_SERVICE_SECRET` — OR-Tools microservice.

## Error handling

- Distance Matrix failures for a given pickup/drop pair: the affected trip is excluded from that solver run (treated as unassignable, added to `unassigned_trip_ids` with the reason surfaced in `schedule_runs.error_message`) rather than failing the whole run.
- Solver service unreachable/errors: `schedule_runs.status = 'FAILED'`, `error_message` set, existing assignments untouched; admin dashboard surfaces failed runs so it isn't a silent no-op.
- Locked assignments always win — if a locked driver becomes unavailable after being locked (e.g. admin later marks them out for the day), that's surfaced as a data-integrity warning in the UI rather than auto-resolved, since it was a deliberate human override.

## Testing

- Solver unit tests (Python, in the microservice repo): overlap constraint correctness, 2-driver job coverage, locked-assignment fixing, maximize-coverage under driver scarcity.
- Next.js integration tests: building the solver JSON from Supabase fixtures (roster + trips) produces the expected request shape; writing solver responses back respects `locked` rows (never overwritten).
- Manual QA: exercise the roster → auto-schedule → manual override → re-run flow end to end against a seeded date with more trips than drivers, confirming the unassigned banner appears and locked overrides survive a re-run.
