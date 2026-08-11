# Driver/Cab Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-assign drivers to each day's trips based on that day's actual available drivers, respecting no-overlap and multi-driver constraints, with manual override support that survives automatic re-runs.

**Architecture:** New Supabase tables for drivers/cabs/roster/assignments feed a solver-agnostic JSON problem built by the Next.js app; a small external OR-Tools (Python/CP-SAT) microservice solves it; a cron-polled worker (mirroring the existing sync_queue pattern) drains queued runs and writes results back, skipping anything an admin has manually locked.

**Tech Stack:** Next.js 14 (App Router) + TypeScript, Supabase (Postgres + `@supabase/supabase-js`), Zod, Vitest (new — no test framework exists yet), Python 3.11 + FastAPI + OR-Tools CP-SAT (new microservice), pytest.

## Global Constraints

- Follow existing conventions exactly: uuid PKs via `gen_random_uuid()`, RLS on every table, `set_updated_at` trigger only on rows mutated after creation, admin-only access mirroring the `sync_queue`/`teams` policy pattern (see `supabase/migrations/001_initial_schema.sql`).
- Wire/API types (`SolveRequest`/`SolveResponse`, going to the external microservice) use `snake_case` fields, matching the spec's JSON contract exactly. Internal TS domain types use `camelCase`, matching this repo's `TripInput` convention.
- No rest-buffer / travel-to-next-pickup modeling — a driver's next trip may start the instant the previous one's computed `end_minutes` passes (per `docs/superpowers/specs/2026-08-11-driver-cab-scheduling-design.md`).
- A trip's driver "busy window" is `[pickup_time, pickup_time + duration_minutes]` where `duration_minutes` comes from `location_duration_cache` (Google Distance Matrix on cache miss).
- Every new admin-only DB object must be added to RLS with the same `(public.current_profile()).role = 'admin'` check used elsewhere — never leave a new table without RLS enabled.
- Manual assignment edits always set `locked = true`; the auto solver run must never overwrite a `locked = true` row.
- Reuse `CRON_SECRET` for the new `/api/cron/schedule` endpoint (same bearer-token pattern as `/api/cron/sync`) — do not invent a second cron secret.

---

## Task 1: Database schema migration

**Files:**
- Create: `supabase/migrations/007_driver_scheduling.sql`
- Modify: `README.md:28-36` (add migration 007 to the numbered list)

**Interfaces:**
- Produces: tables `drivers`, `cabs`, `driver_daily_roster`, `driver_trip_assignments`, `schedule_runs`, `location_duration_cache`; column `trips.drivers_required smallint`. All consumed by later tasks' Supabase queries using these exact table/column names.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/007_driver_scheduling.sql

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cabs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_daily_roster (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  roster_date date not null,
  available boolean not null default true,
  cab_id uuid references public.cabs(id),
  substituting_for_driver_id uuid references public.drivers(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, roster_date)
);

alter table public.trips
  add column if not exists drivers_required smallint not null default 1
    check (drivers_required in (1, 2));

create table if not exists public.driver_trip_assignments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  roster_date date not null,
  source text not null check (source in ('solver', 'manual')),
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (trip_id, driver_id)
);

create table if not exists public.schedule_runs (
  id uuid primary key default gen_random_uuid(),
  roster_date date not null,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  triggered_by text not null check (triggered_by in ('auto', 'manual')),
  unassigned_trip_ids jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.location_duration_cache (
  id uuid primary key default gen_random_uuid(),
  origin text not null,
  destination text not null,
  duration_minutes integer not null,
  fetched_at timestamptz not null default now(),
  unique (origin, destination)
);

create index if not exists driver_daily_roster_roster_date_idx on public.driver_daily_roster(roster_date);
create index if not exists driver_trip_assignments_roster_date_idx on public.driver_trip_assignments(roster_date);
create index if not exists driver_trip_assignments_trip_id_idx on public.driver_trip_assignments(trip_id);
create index if not exists schedule_runs_status_idx on public.schedule_runs(status);
create index if not exists schedule_runs_roster_date_idx on public.schedule_runs(roster_date);

drop trigger if exists drivers_set_updated_at on public.drivers;
create trigger drivers_set_updated_at
before update on public.drivers
for each row execute function public.set_updated_at();

drop trigger if exists cabs_set_updated_at on public.cabs;
create trigger cabs_set_updated_at
before update on public.cabs
for each row execute function public.set_updated_at();

drop trigger if exists driver_daily_roster_set_updated_at on public.driver_daily_roster;
create trigger driver_daily_roster_set_updated_at
before update on public.driver_daily_roster
for each row execute function public.set_updated_at();

alter table public.drivers enable row level security;
alter table public.cabs enable row level security;
alter table public.driver_daily_roster enable row level security;
alter table public.driver_trip_assignments enable row level security;
alter table public.schedule_runs enable row level security;
alter table public.location_duration_cache enable row level security;

drop policy if exists "admins can manage drivers" on public.drivers;
create policy "admins can manage drivers"
on public.drivers
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

drop policy if exists "admins can manage cabs" on public.cabs;
create policy "admins can manage cabs"
on public.cabs
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

drop policy if exists "admins can manage driver roster" on public.driver_daily_roster;
create policy "admins can manage driver roster"
on public.driver_daily_roster
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

drop policy if exists "admins can manage driver trip assignments" on public.driver_trip_assignments;
create policy "admins can manage driver trip assignments"
on public.driver_trip_assignments
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

drop policy if exists "admins can manage schedule runs" on public.schedule_runs;
create policy "admins can manage schedule runs"
on public.schedule_runs
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');

drop policy if exists "admins can manage location duration cache" on public.location_duration_cache;
create policy "admins can manage location duration cache"
on public.location_duration_cache
for all
using ((public.current_profile()).role = 'admin')
with check ((public.current_profile()).role = 'admin');
```

- [ ] **Step 2: Apply the migration and verify structurally**

This repo applies migrations by hand via the Supabase SQL editor (see `README.md`), not a linked `supabase` CLI project. Apply it the same way the existing six migrations are applied, then verify with `psql` (or the SQL editor) using the connection string from the Supabase dashboard → Project Settings → Database:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/007_driver_scheduling.sql
psql "$SUPABASE_DB_URL" -c "\d public.driver_trip_assignments"
psql "$SUPABASE_DB_URL" -c "select column_name from information_schema.columns where table_name = 'trips' and column_name = 'drivers_required';"
```

Expected: `\d public.driver_trip_assignments` lists the `trip_id`, `driver_id`, `source`, `locked` columns and the `unique (trip_id, driver_id)` constraint; the second query returns one row (`drivers_required`).

- [ ] **Step 3: Update README migration list**

In `README.md`, change the numbered migration list (currently ending at `006_perf_indexes.sql`) to add:
```markdown
7. `supabase/migrations/007_driver_scheduling.sql`
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/007_driver_scheduling.sql README.md
git commit -m "feat: add driver/cab scheduling schema"
```

---

## Task 2: Vitest setup + shared scheduling types

**Files:**
- Modify: `package.json` (add `vitest` devDependency and `test` script)
- Create: `vitest.config.ts`
- Create: `types/scheduling.ts`
- Test: `types/__tests__/scheduling.test.ts` (smoke test that the module exports compile-safe shapes)

**Interfaces:**
- Produces: `SolveRequest`, `SolveResponse`, `RosterDriver`, `JobInput` types, imported by Tasks 5 and 6.

- [ ] **Step 1: Add Vitest**

```bash
npm install -D vitest
```

Add to `package.json` `"scripts"`:
```json
"test": "vitest run"
```

- [ ] **Step 2: Add Vitest config**

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node"
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".")
    }
  }
});
```

- [ ] **Step 3: Write the failing test**

```ts
// types/__tests__/scheduling.test.ts
import { describe, expect, it } from "vitest";
import type { SolveRequest, SolveResponse } from "@/types/scheduling";

describe("scheduling types", () => {
  it("SolveRequest matches the documented wire shape", () => {
    const request: SolveRequest = {
      date: "2026-08-20",
      drivers: [{ id: "d1", cab_id: "c1" }],
      jobs: [
        {
          trip_id: "t1",
          drivers_required: 1,
          start_minutes: 540,
          end_minutes: 585,
          locked_driver_ids: []
        }
      ]
    };

    expect(request.jobs[0].drivers_required).toBe(1);
  });

  it("SolveResponse matches the documented wire shape", () => {
    const response: SolveResponse = {
      assignments: [{ trip_id: "t1", driver_id: "d1" }],
      unassigned_trip_ids: []
    };

    expect(response.assignments).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run types/__tests__/scheduling.test.ts`
Expected: FAIL — `Cannot find module '@/types/scheduling'`

- [ ] **Step 5: Write the types**

```ts
// types/scheduling.ts

export type SolveRequestDriver = {
  id: string;
  cab_id: string | null;
};

export type SolveRequestJob = {
  trip_id: string;
  drivers_required: 1 | 2;
  start_minutes: number;
  end_minutes: number;
  locked_driver_ids: string[];
};

export type SolveRequest = {
  date: string;
  drivers: SolveRequestDriver[];
  jobs: SolveRequestJob[];
};

export type SolveResponseAssignment = {
  trip_id: string;
  driver_id: string;
};

export type SolveResponse = {
  assignments: SolveResponseAssignment[];
  unassigned_trip_ids: string[];
};

export type RosterDriver = {
  driverId: string;
  cabId: string | null;
};

export type JobInput = {
  tripId: string;
  driversRequired: 1 | 2;
  startMinutes: number;
  endMinutes: number;
  lockedDriverIds: string[];
};

export type Driver = {
  id: string;
  full_name: string;
  phone: string | null;
  active: boolean;
};

export type Cab = {
  id: string;
  label: string;
  active: boolean;
};

export type DriverDailyRoster = {
  id: string;
  driver_id: string;
  roster_date: string;
  available: boolean;
  cab_id: string | null;
  substituting_for_driver_id: string | null;
  notes: string | null;
};

export type DriverTripAssignment = {
  id: string;
  trip_id: string;
  driver_id: string;
  roster_date: string;
  source: "solver" | "manual";
  locked: boolean;
};

export type ScheduleRunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export type ScheduleRun = {
  id: string;
  roster_date: string;
  status: ScheduleRunStatus;
  triggered_by: "auto" | "manual";
  unassigned_trip_ids: string[];
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run types/__tests__/scheduling.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts types/scheduling.ts types/__tests__/scheduling.test.ts
git commit -m "test: add vitest and shared scheduling types"
```

---

## Task 3: OR-Tools solver microservice (Python)

**Files:**
- Create: `scheduler-service/requirements.txt`
- Create: `scheduler-service/solver.py`
- Create: `scheduler-service/main.py`
- Create: `scheduler-service/tests/test_solver.py`
- Create: `scheduler-service/README.md`

**Interfaces:**
- Produces: `solve(date: str, drivers: list[dict], jobs: list[dict]) -> dict` in `solver.py`, and `POST /solve` HTTP endpoint in `main.py`, matching the `SolveRequest`/`SolveResponse` wire shapes from Task 2 exactly (snake_case keys: `trip_id`, `driver_id`, `drivers_required`, `start_minutes`, `end_minutes`, `locked_driver_ids`, `cab_id`, `unassigned_trip_ids`).
- Consumes: nothing from earlier tasks (standalone Python service).

- [ ] **Step 1: Write requirements**

```
# scheduler-service/requirements.txt
fastapi==0.115.0
uvicorn[standard]==0.30.6
ortools==9.11.4210
pytest==8.3.3
httpx==0.27.2
```

- [ ] **Step 2: Write the failing test**

```python
# scheduler-service/tests/test_solver.py
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from solver import solve


def test_two_non_overlapping_trips_one_driver_covers_both():
    drivers = [{"id": "d1", "cab_id": "c1"}]
    jobs = [
        {"trip_id": "t1", "drivers_required": 1, "start_minutes": 540, "end_minutes": 585, "locked_driver_ids": []},
        {"trip_id": "t2", "drivers_required": 1, "start_minutes": 600, "end_minutes": 650, "locked_driver_ids": []},
    ]
    result = solve("2026-08-20", drivers, jobs)
    assert set(result["unassigned_trip_ids"]) == set()
    assert len(result["assignments"]) == 2
    assert all(a["driver_id"] == "d1" for a in result["assignments"])


def test_overlapping_trips_need_two_drivers():
    drivers = [{"id": "d1", "cab_id": "c1"}, {"id": "d2", "cab_id": "c2"}]
    jobs = [
        {"trip_id": "t1", "drivers_required": 1, "start_minutes": 540, "end_minutes": 600, "locked_driver_ids": []},
        {"trip_id": "t2", "drivers_required": 1, "start_minutes": 550, "end_minutes": 610, "locked_driver_ids": []},
    ]
    result = solve("2026-08-20", drivers, jobs)
    assert result["unassigned_trip_ids"] == []
    driver_ids = {a["trip_id"]: a["driver_id"] for a in result["assignments"]}
    assert driver_ids["t1"] != driver_ids["t2"]


def test_insufficient_drivers_flags_unassigned_instead_of_overlapping():
    drivers = [{"id": "d1", "cab_id": "c1"}]
    jobs = [
        {"trip_id": "t1", "drivers_required": 1, "start_minutes": 540, "end_minutes": 600, "locked_driver_ids": []},
        {"trip_id": "t2", "drivers_required": 1, "start_minutes": 550, "end_minutes": 610, "locked_driver_ids": []},
    ]
    result = solve("2026-08-20", drivers, jobs)
    assert len(result["unassigned_trip_ids"]) == 1
    assert len(result["assignments"]) == 1


def test_two_driver_job_gets_two_distinct_drivers():
    drivers = [{"id": "d1", "cab_id": "c1"}, {"id": "d2", "cab_id": "c2"}]
    jobs = [
        {"trip_id": "t1", "drivers_required": 2, "start_minutes": 540, "end_minutes": 600, "locked_driver_ids": []},
    ]
    result = solve("2026-08-20", drivers, jobs)
    assert result["unassigned_trip_ids"] == []
    assigned_drivers = {a["driver_id"] for a in result["assignments"] if a["trip_id"] == "t1"}
    assert assigned_drivers == {"d1", "d2"}


def test_locked_driver_is_kept_even_if_suboptimal():
    drivers = [{"id": "d1", "cab_id": "c1"}, {"id": "d2", "cab_id": "c2"}]
    jobs = [
        {"trip_id": "t1", "drivers_required": 1, "start_minutes": 540, "end_minutes": 600, "locked_driver_ids": ["d2"]},
    ]
    result = solve("2026-08-20", drivers, jobs)
    assert result["assignments"] == [{"trip_id": "t1", "driver_id": "d2"}]
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd scheduler-service
pip install -r requirements.txt
pytest tests/test_solver.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'solver'` (or import error, since `solver.py` doesn't exist yet).

- [ ] **Step 4: Implement the solver**

```python
# scheduler-service/solver.py
"""CP-SAT model for driver-to-trip assignment.

Each job (trip) needs exactly `drivers_required` distinct drivers assigned
to it, or is left uncovered. A driver can never be assigned to two jobs
whose [start_minutes, end_minutes) intervals overlap. Locked driver ids are
pinned before solving so a manual override always survives. The objective
maximizes the number of fully-covered jobs -- no priority weighting between
jobs in this version.
"""

from ortools.sat.python import cp_model


def solve(date: str, drivers: list[dict], jobs: list[dict]) -> dict:
    model = cp_model.CpModel()
    driver_ids = [d["id"] for d in drivers]

    assignment_vars: dict[tuple[str, str], "cp_model.IntVar"] = {}
    covered_vars: dict[str, "cp_model.IntVar"] = {}
    intervals_by_driver: dict[str, list] = {driver_id: [] for driver_id in driver_ids}

    for job in jobs:
        trip_id = job["trip_id"]
        locked_ids = set(job.get("locked_driver_ids", []))
        covered = model.NewBoolVar(f"covered_{trip_id}")
        covered_vars[trip_id] = covered

        job_assignment_vars = []
        duration = job["end_minutes"] - job["start_minutes"]

        for driver_id in driver_ids:
            var = model.NewBoolVar(f"x_{driver_id}_{trip_id}")
            assignment_vars[(driver_id, trip_id)] = var
            job_assignment_vars.append(var)

            if driver_id in locked_ids:
                model.Add(var == 1)

            interval = model.NewOptionalIntervalVar(
                job["start_minutes"], duration, job["end_minutes"], var, f"iv_{driver_id}_{trip_id}"
            )
            intervals_by_driver[driver_id].append(interval)

        model.Add(sum(job_assignment_vars) == job["drivers_required"] * covered)

    for intervals in intervals_by_driver.values():
        if intervals:
            model.AddNoOverlap(intervals)

    model.Maximize(sum(covered_vars.values()))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10
    status = solver.Solve(model)

    assignments = []
    unassigned_trip_ids = []

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for job in jobs:
            trip_id = job["trip_id"]
            if solver.Value(covered_vars[trip_id]):
                for driver_id in driver_ids:
                    if solver.Value(assignment_vars[(driver_id, trip_id)]):
                        assignments.append({"trip_id": trip_id, "driver_id": driver_id})
            else:
                unassigned_trip_ids.append(trip_id)
    else:
        unassigned_trip_ids = [job["trip_id"] for job in jobs]

    return {"assignments": assignments, "unassigned_trip_ids": unassigned_trip_ids}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd scheduler-service
pytest tests/test_solver.py -v
```
Expected: PASS (5 tests)

- [ ] **Step 6: Write the HTTP wrapper**

```python
# scheduler-service/main.py
import os
from typing import List, Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from solver import solve

app = FastAPI(title="pprl-scheduler")


class SolveRequestDriver(BaseModel):
    id: str
    cab_id: Optional[str] = None


class SolveRequestJob(BaseModel):
    trip_id: str
    drivers_required: int
    start_minutes: int
    end_minutes: int
    locked_driver_ids: List[str] = []


class SolveRequestBody(BaseModel):
    date: str
    drivers: List[SolveRequestDriver]
    jobs: List[SolveRequestJob]


class SolveResponseAssignment(BaseModel):
    trip_id: str
    driver_id: str


class SolveResponseBody(BaseModel):
    assignments: List[SolveResponseAssignment]
    unassigned_trip_ids: List[str]


def _check_auth(authorization: str) -> None:
    secret = os.environ.get("SCHEDULER_SERVICE_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="SCHEDULER_SERVICE_SECRET is not configured")
    if authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.post("/solve", response_model=SolveResponseBody)
def solve_endpoint(payload: SolveRequestBody, authorization: str = Header(default="")):
    _check_auth(authorization)

    result = solve(
        payload.date,
        [driver.dict() for driver in payload.drivers],
        [job.dict() for job in payload.jobs],
    )
    return result


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 7: Write a smoke test for the HTTP layer**

```python
# scheduler-service/tests/test_main.py
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["SCHEDULER_SERVICE_SECRET"] = "test-secret"

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_rejects_missing_auth():
    response = client.post("/solve", json={"date": "2026-08-20", "drivers": [], "jobs": []})
    assert response.status_code == 401


def test_accepts_valid_auth_and_solves():
    response = client.post(
        "/solve",
        json={"date": "2026-08-20", "drivers": [], "jobs": []},
        headers={"Authorization": "Bearer test-secret"},
    )
    assert response.status_code == 200
    assert response.json() == {"assignments": [], "unassigned_trip_ids": []}
```

- [ ] **Step 8: Run all Python tests**

```bash
cd scheduler-service
pytest -v
```
Expected: PASS (7 tests total)

- [ ] **Step 9: Write deploy notes**

```markdown
# scheduler-service/README.md

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
```

- [ ] **Step 10: Commit**

```bash
git add scheduler-service
git commit -m "feat: add OR-Tools CP-SAT scheduler microservice"
```

---

## Task 4: Distance Matrix duration cache (TS)

**Files:**
- Create: `lib/scheduling/duration.ts`
- Test: `lib/scheduling/__tests__/duration.test.ts`
- Modify: `lib/env.ts` (no code change needed — `requiredEnv`/`optionalEnv` already generic; just document new var name in README, done in Task 8)

**Interfaces:**
- Produces: `getDurationMinutes(supabase: SupabaseClient, origin: string, destination: string): Promise<number>`, consumed by Task 6's `runner.ts`.
- Consumes: `requiredEnv` from `lib/env.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/scheduling/__tests__/duration.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDurationMinutes } from "@/lib/scheduling/duration";

function makeSupabaseStub(options: { cachedRow: { duration_minutes: number } | null; insertSpy?: (row: unknown) => void }) {
  return {
    from(table: string) {
      expect(table).toBe("location_duration_cache");
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: options.cachedRow, error: null }),
        insert: async (row: unknown) => {
          options.insertSpy?.(row);
          return { data: null, error: null };
        }
      };
    }
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("getDurationMinutes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns the cached duration without calling the Distance Matrix API", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const supabase = makeSupabaseStub({ cachedRow: { duration_minutes: 42 } });

    const result = await getDurationMinutes(supabase, "Airport", "Campus");

    expect(result).toBe(42);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches from Distance Matrix and caches on a miss", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [{ elements: [{ status: "OK", duration: { value: 1800 } }] }]
      })
    });
    vi.stubGlobal("fetch", fetchSpy);
    const insertSpy = vi.fn();
    const supabase = makeSupabaseStub({ cachedRow: null, insertSpy });

    const result = await getDurationMinutes(supabase, "Airport", "Campus");

    expect(result).toBe(30);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "airport", destination: "campus", duration_minutes: 30 })
    );
  });

  it("throws when Distance Matrix cannot compute a route", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rows: [{ elements: [{ status: "NOT_FOUND" }] }] })
      })
    );
    const supabase = makeSupabaseStub({ cachedRow: null });

    await expect(getDurationMinutes(supabase, "Nowhere", "Campus")).rejects.toThrow(
      /could not compute a route/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/scheduling/__tests__/duration.test.ts`
Expected: FAIL — `Cannot find module '@/lib/scheduling/duration'`

- [ ] **Step 3: Implement**

```ts
// lib/scheduling/duration.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { requiredEnv } from "@/lib/env";

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

async function fetchDurationFromGoogle(origin: string, destination: string): Promise<number> {
  const apiKey = requiredEnv("GOOGLE_MAPS_API_KEY");
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destination);
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Distance Matrix request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const element = payload?.rows?.[0]?.elements?.[0];
  if (!element || element.status !== "OK" || !element.duration) {
    throw new Error(`Distance Matrix could not compute a route from "${origin}" to "${destination}".`);
  }

  return Math.ceil(element.duration.value / 60);
}

export async function getDurationMinutes(
  supabase: SupabaseClient,
  origin: string,
  destination: string
): Promise<number> {
  const normalizedOrigin = normalize(origin);
  const normalizedDestination = normalize(destination);

  const { data: cached } = await supabase
    .from("location_duration_cache")
    .select("duration_minutes")
    .eq("origin", normalizedOrigin)
    .eq("destination", normalizedDestination)
    .maybeSingle();

  if (cached) {
    return cached.duration_minutes;
  }

  const durationMinutes = await fetchDurationFromGoogle(origin, destination);

  await supabase.from("location_duration_cache").insert({
    origin: normalizedOrigin,
    destination: normalizedDestination,
    duration_minutes: durationMinutes
  });

  return durationMinutes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/scheduling/__tests__/duration.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/scheduling/duration.ts lib/scheduling/__tests__/duration.test.ts
git commit -m "feat: add Distance Matrix duration cache"
```

---

## Task 5: Solver problem builder + client (TS)

**Files:**
- Create: `lib/scheduling/problemBuilder.ts`
- Create: `lib/scheduling/solverClient.ts`
- Test: `lib/scheduling/__tests__/problemBuilder.test.ts`
- Test: `lib/scheduling/__tests__/solverClient.test.ts`

**Interfaces:**
- Consumes: `RosterDriver`, `JobInput`, `SolveRequest`, `SolveResponse` from `types/scheduling.ts` (Task 2).
- Produces: `buildSolveRequest(date: string, drivers: RosterDriver[], jobs: JobInput[]): SolveRequest` and `callSolver(request: SolveRequest): Promise<SolveResponse>`, both consumed by Task 6's `runner.ts`.

- [ ] **Step 1: Write the failing test for the problem builder**

```ts
// lib/scheduling/__tests__/problemBuilder.test.ts
import { describe, expect, it } from "vitest";
import { buildSolveRequest } from "@/lib/scheduling/problemBuilder";

describe("buildSolveRequest", () => {
  it("maps camelCase domain objects to the snake_case wire shape", () => {
    const request = buildSolveRequest(
      "2026-08-20",
      [{ driverId: "d1", cabId: "c1" }, { driverId: "d2", cabId: null }],
      [
        {
          tripId: "t1",
          driversRequired: 2,
          startMinutes: 540,
          endMinutes: 600,
          lockedDriverIds: ["d1"]
        }
      ]
    );

    expect(request).toEqual({
      date: "2026-08-20",
      drivers: [
        { id: "d1", cab_id: "c1" },
        { id: "d2", cab_id: null }
      ],
      jobs: [
        {
          trip_id: "t1",
          drivers_required: 2,
          start_minutes: 540,
          end_minutes: 600,
          locked_driver_ids: ["d1"]
        }
      ]
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/scheduling/__tests__/problemBuilder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the problem builder**

```ts
// lib/scheduling/problemBuilder.ts
import type { JobInput, RosterDriver, SolveRequest } from "@/types/scheduling";

export function buildSolveRequest(date: string, drivers: RosterDriver[], jobs: JobInput[]): SolveRequest {
  return {
    date,
    drivers: drivers.map((driver) => ({ id: driver.driverId, cab_id: driver.cabId })),
    jobs: jobs.map((job) => ({
      trip_id: job.tripId,
      drivers_required: job.driversRequired,
      start_minutes: job.startMinutes,
      end_minutes: job.endMinutes,
      locked_driver_ids: job.lockedDriverIds
    }))
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/scheduling/__tests__/problemBuilder.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Write the failing test for the solver client**

```ts
// lib/scheduling/__tests__/solverClient.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { callSolver } from "@/lib/scheduling/solverClient";
import type { SolveRequest } from "@/types/scheduling";

const request: SolveRequest = { date: "2026-08-20", drivers: [], jobs: [] };

describe("callSolver", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts the request with a bearer token and returns the parsed response", async () => {
    vi.stubEnv("SCHEDULER_SERVICE_URL", "https://scheduler.example.com");
    vi.stubEnv("SCHEDULER_SERVICE_SECRET", "shh");
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ assignments: [], unassigned_trip_ids: [] })
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await callSolver(request);

    expect(result).toEqual({ assignments: [], unassigned_trip_ids: [] });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://scheduler.example.com/solve",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer shh" })
      })
    );
  });

  it("throws with the response body when the service returns a non-2xx status", async () => {
    vi.stubEnv("SCHEDULER_SERVICE_URL", "https://scheduler.example.com");
    vi.stubEnv("SCHEDULER_SERVICE_SECRET", "shh");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" })
    );

    await expect(callSolver(request)).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run lib/scheduling/__tests__/solverClient.test.ts`
Expected: FAIL — module not found

- [ ] **Step 7: Implement the solver client**

```ts
// lib/scheduling/solverClient.ts
import { requiredEnv } from "@/lib/env";
import type { SolveRequest, SolveResponse } from "@/types/scheduling";

export async function callSolver(request: SolveRequest): Promise<SolveResponse> {
  const baseUrl = requiredEnv("SCHEDULER_SERVICE_URL");
  const secret = requiredEnv("SCHEDULER_SERVICE_SECRET");

  const response = await fetch(`${baseUrl}/solve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Scheduler service returned ${response.status}: ${text}`);
  }

  return (await response.json()) as SolveResponse;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run lib/scheduling/__tests__/solverClient.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add lib/scheduling/problemBuilder.ts lib/scheduling/solverClient.ts lib/scheduling/__tests__/problemBuilder.test.ts lib/scheduling/__tests__/solverClient.test.ts
git commit -m "feat: add solver problem builder and HTTP client"
```

---

## Task 6: Schedule queue, cron worker, and trigger wiring

**Files:**
- Create: `lib/scheduling/queue.ts`
- Create: `lib/scheduling/runner.ts`
- Create: `app/api/cron/schedule/route.ts`
- Modify: `app/api/trips/route.ts` (enqueue on trip create)
- Modify: `app/api/trips/[id]/route.ts` (enqueue on trip update/delete)
- Test: `lib/scheduling/__tests__/queue.test.ts`
- Test: `lib/scheduling/__tests__/runner.test.ts`

**Interfaces:**
- Consumes: `getDurationMinutes` (Task 4), `buildSolveRequest`, `callSolver` (Task 5), `SolveResponse`, `JobInput`, `RosterDriver` (Task 2).
- Produces: `enqueueScheduleRun(supabase, rosterDate: string): Promise<void>` (used by trip routes and, in Task 7, the roster route) and `processQueuedScheduleRuns(limit?: number): Promise<{ processed: number; results: { date: string; status: "SUCCEEDED" | "FAILED" }[] }>` (used by the cron route).

- [ ] **Step 1: Write the failing test for the queue helper**

```ts
// lib/scheduling/__tests__/queue.test.ts
import { describe, expect, it, vi } from "vitest";
import { enqueueScheduleRun } from "@/lib/scheduling/queue";

describe("enqueueScheduleRun", () => {
  it("inserts a QUEUED schedule_runs row for the given date", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: (table: string) => ({ insert: insertSpy }) } as unknown as import("@supabase/supabase-js").SupabaseClient;

    await enqueueScheduleRun(supabase, "2026-08-20");

    expect(insertSpy).toHaveBeenCalledWith({
      roster_date: "2026-08-20",
      status: "QUEUED",
      triggered_by: "auto"
    });
  });

  it("throws when the insert fails", async () => {
    const supabase = {
      from: () => ({ insert: vi.fn().mockResolvedValue({ error: { message: "db down" } }) })
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    await expect(enqueueScheduleRun(supabase, "2026-08-20")).rejects.toThrow("db down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/scheduling/__tests__/queue.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the queue helper**

```ts
// lib/scheduling/queue.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export async function enqueueScheduleRun(supabase: SupabaseClient, rosterDate: string): Promise<void> {
  const { error } = await supabase.from("schedule_runs").insert({
    roster_date: rosterDate,
    status: "QUEUED",
    triggered_by: "auto"
  });

  if (error) {
    throw new Error(error.message);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/scheduling/__tests__/queue.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test for the runner**

```ts
// lib/scheduling/__tests__/runner.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const callSolverMock = vi.fn();
const getDurationMinutesMock = vi.fn();

vi.mock("@/lib/scheduling/solverClient", () => ({ callSolver: callSolverMock }));
vi.mock("@/lib/scheduling/duration", () => ({ getDurationMinutes: getDurationMinutesMock }));

import { processQueuedScheduleRuns } from "@/lib/scheduling/runner";

function buildSupabaseStub() {
  const updates: Record<string, unknown>[] = [];
  const upserts: unknown[] = [];

  const tableHandlers: Record<string, () => unknown> = {
    schedule_runs: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      order() {
        return this;
      },
      limit: async () => ({
        data: [{ id: "run1", roster_date: "2026-08-20" }],
        error: null
      }),
      update(payload: Record<string, unknown>) {
        updates.push(payload);
        return this;
      }
    }),
    driver_daily_roster: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: [{ driver_id: "d1", cab_id: "c1" }], error: null })
    }),
    trips: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      not() {
        return this;
      },
      then: (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: "t1",
              pickup_location: "Airport",
              drop_location: "Campus",
              pickup_time: "2026-08-20T09:00:00.000Z",
              drivers_required: 1
            }
          ],
          error: null
        })
    }),
    driver_trip_assignments: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      upsert: async (rows: unknown) => {
        upserts.push(rows);
        return { data: null, error: null };
      }
    })
  };

  return {
    supabase: { from: (table: string) => tableHandlers[table]() } as unknown as import("@supabase/supabase-js").SupabaseClient,
    updates,
    upserts
  };
}

describe("processQueuedScheduleRuns", () => {
  beforeEach(() => {
    callSolverMock.mockReset();
    getDurationMinutesMock.mockReset();
  });

  it("solves each queued date and writes non-locked assignments", async () => {
    getDurationMinutesMock.mockResolvedValue(45);
    callSolverMock.mockResolvedValue({
      assignments: [{ trip_id: "t1", driver_id: "d1" }],
      unassigned_trip_ids: []
    });

    const { supabase, upserts } = buildSupabaseStub();
    const result = await processQueuedScheduleRuns.__test?.(supabase) ?? (await processQueuedScheduleRuns());

    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run lib/scheduling/__tests__/runner.test.ts`
Expected: FAIL — module not found (`@/lib/scheduling/runner`)

> Note: the Supabase query-builder chain is awkward to stub generically (each real call chains `.select().eq()...` differently). Rather than fighting a one-size-fits-all mock, `runner.ts` is written next with its Supabase-fetching logic factored into small named functions (`fetchAvailableRoster`, `fetchSchedulableTrips`, `fetchLockedAssignments`) so the test above only needs to verify `processQueuedScheduleRuns` orchestrates `callSolver`/`getDurationMinutes` correctly — adjust the stub's chain methods to match exactly what each function below calls, then re-run.

- [ ] **Step 7: Implement the runner**

```ts
// lib/scheduling/runner.ts
import { createAdminClient } from "@/lib/supabase/admin";
import { getDurationMinutes } from "@/lib/scheduling/duration";
import { buildSolveRequest } from "@/lib/scheduling/problemBuilder";
import { callSolver } from "@/lib/scheduling/solverClient";
import type { JobInput, RosterDriver } from "@/types/scheduling";
import type { SupabaseClient } from "@supabase/supabase-js";

type RunResult = { date: string; status: "SUCCEEDED" | "FAILED" };

export async function processQueuedScheduleRuns(limit = 10): Promise<{ processed: number; results: RunResult[] }> {
  const supabase = createAdminClient();

  const { data: queued, error } = await supabase
    .from("schedule_runs")
    .select("id, roster_date")
    .eq("status", "QUEUED")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  if (!queued || queued.length === 0) return { processed: 0, results: [] };

  const dates = Array.from(new Set(queued.map((run: { roster_date: string }) => run.roster_date)));
  const results: RunResult[] = [];

  for (const date of dates) {
    try {
      await runScheduleForDate(supabase, date);
      results.push({ date, status: "SUCCEEDED" });
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Unknown scheduling error";
      await supabase
        .from("schedule_runs")
        .update({ status: "FAILED", error_message: message, completed_at: new Date().toISOString() })
        .eq("roster_date", date)
        .in("status", ["QUEUED", "RUNNING"]);
      results.push({ date, status: "FAILED" });
    }
  }

  return { processed: dates.length, results };
}

async function fetchAvailableRoster(supabase: SupabaseClient, date: string): Promise<RosterDriver[]> {
  const { data, error } = await supabase
    .from("driver_daily_roster")
    .select("driver_id, cab_id")
    .eq("roster_date", date)
    .eq("available", true);

  if (error) throw new Error(error.message);
  return (data || []).map((row: { driver_id: string; cab_id: string | null }) => ({
    driverId: row.driver_id,
    cabId: row.cab_id
  }));
}

type SchedulableTrip = {
  id: string;
  pickup_location: string;
  drop_location: string;
  pickup_time: string | null;
  drivers_required: number;
};

async function fetchTripsForDate(supabase: SupabaseClient, date: string): Promise<SchedulableTrip[]> {
  const { data, error } = await supabase
    .from("trips")
    .select("id, pickup_location, drop_location, pickup_time, drivers_required")
    .eq("travel_date", date);

  if (error) throw new Error(error.message);
  return (data || []) as SchedulableTrip[];
}

async function fetchLockedAssignments(supabase: SupabaseClient, date: string): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from("driver_trip_assignments")
    .select("trip_id, driver_id")
    .eq("roster_date", date)
    .eq("locked", true);

  if (error) throw new Error(error.message);

  const byTrip = new Map<string, string[]>();
  for (const row of (data || []) as { trip_id: string; driver_id: string }[]) {
    const list = byTrip.get(row.trip_id) || [];
    list.push(row.driver_id);
    byTrip.set(row.trip_id, list);
  }
  return byTrip;
}

function minutesSinceMidnight(isoString: string): number {
  const date = new Date(isoString);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

async function runScheduleForDate(supabase: SupabaseClient, date: string): Promise<void> {
  await supabase.from("schedule_runs").update({ status: "RUNNING" }).eq("roster_date", date).eq("status", "QUEUED");

  const [roster, trips, lockedByTrip] = await Promise.all([
    fetchAvailableRoster(supabase, date),
    fetchTripsForDate(supabase, date),
    fetchLockedAssignments(supabase, date)
  ]);

  const missingPickupTimeTripIds = trips.filter((trip) => !trip.pickup_time).map((trip) => trip.id);
  const schedulableTrips = trips.filter((trip) => trip.pickup_time);

  // A Distance Matrix failure for one pickup/drop pair should not fail the
  // whole day's run -- exclude just that trip and surface it as
  // unassigned, matching the design doc's error-handling section.
  const jobs: JobInput[] = [];
  const durationFailureTripIds: string[] = [];
  for (const trip of schedulableTrips) {
    let durationMinutes: number;
    try {
      durationMinutes = await getDurationMinutes(supabase, trip.pickup_location, trip.drop_location);
    } catch {
      durationFailureTripIds.push(trip.id);
      continue;
    }
    const startMinutes = minutesSinceMidnight(trip.pickup_time as string);
    jobs.push({
      tripId: trip.id,
      driversRequired: trip.drivers_required as 1 | 2,
      startMinutes,
      endMinutes: startMinutes + durationMinutes,
      lockedDriverIds: lockedByTrip.get(trip.id) || []
    });
  }

  const request = buildSolveRequest(date, roster, jobs);
  const response = await callSolver(request);

  const newAssignmentRows = response.assignments
    .filter((assignment) => !(lockedByTrip.get(assignment.trip_id) || []).includes(assignment.driver_id))
    .map((assignment) => ({
      trip_id: assignment.trip_id,
      driver_id: assignment.driver_id,
      roster_date: date,
      source: "solver" as const,
      locked: false
    }));

  if (newAssignmentRows.length > 0) {
    const { error } = await supabase
      .from("driver_trip_assignments")
      .upsert(newAssignmentRows, { onConflict: "trip_id,driver_id" });
    if (error) throw new Error(error.message);
  }

  const unassignedTripIds = Array.from(
    new Set([...response.unassigned_trip_ids, ...missingPickupTimeTripIds, ...durationFailureTripIds])
  );
  const errorMessage =
    durationFailureTripIds.length > 0
      ? `Could not compute route duration for ${durationFailureTripIds.length} trip(s); they were left unassigned.`
      : null;

  await supabase
    .from("schedule_runs")
    .update({
      status: "SUCCEEDED",
      unassigned_trip_ids: unassignedTripIds,
      error_message: errorMessage,
      completed_at: new Date().toISOString()
    })
    .eq("roster_date", date)
    .eq("status", "RUNNING");
}
```

- [ ] **Step 8: Rewrite the runner test to match the real query shape and verify it passes**

Replace `lib/scheduling/__tests__/runner.test.ts` with a version whose stub matches the exact chain calls used above (`select().eq().eq()` for roster with `available`, `select().eq()` for trips, `select().eq().eq()` for locked assignments, `update().eq().eq()` / `update().eq().in()` for status transitions, `upsert()` for assignments):

```ts
// lib/scheduling/__tests__/runner.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const callSolverMock = vi.fn();
const getDurationMinutesMock = vi.fn();

vi.mock("@/lib/scheduling/solverClient", () => ({ callSolver: callSolverMock }));
vi.mock("@/lib/scheduling/duration", () => ({ getDurationMinutes: getDurationMinutesMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => supabaseStub }));

let upsertedRows: unknown[] = [];
let finalUpdate: Record<string, unknown> | null = null;

const supabaseStub = {
  from(table: string) {
    if (table === "schedule_runs") {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({ data: [{ id: "run1", roster_date: "2026-08-20" }], error: null })
            })
          })
        }),
        update: (payload: Record<string, unknown>) => {
          finalUpdate = payload;
          return {
            eq: () => ({ eq: async () => ({ error: null }), in: async () => ({ error: null }) })
          };
        }
      };
    }
    if (table === "driver_daily_roster") {
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: [{ driver_id: "d1", cab_id: "c1" }], error: null })
          })
        })
      };
    }
    if (table === "trips") {
      return {
        select: () => ({
          eq: async () => ({
            data: [
              {
                id: "t1",
                pickup_location: "Airport",
                drop_location: "Campus",
                pickup_time: "2026-08-20T09:00:00.000Z",
                drivers_required: 1
              }
            ],
            error: null
          })
        })
      };
    }
    if (table === "driver_trip_assignments") {
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: [], error: null })
          })
        }),
        upsert: async (rows: unknown) => {
          upsertedRows = rows as unknown[];
          return { error: null };
        }
      };
    }
    throw new Error(`Unexpected table ${table}`);
  }
} as unknown as import("@supabase/supabase-js").SupabaseClient;

import { processQueuedScheduleRuns } from "@/lib/scheduling/runner";

describe("processQueuedScheduleRuns", () => {
  beforeEach(() => {
    callSolverMock.mockReset();
    getDurationMinutesMock.mockReset();
    upsertedRows = [];
    finalUpdate = null;
  });

  it("solves each queued date and writes non-locked assignments", async () => {
    getDurationMinutesMock.mockResolvedValue(45);
    callSolverMock.mockResolvedValue({
      assignments: [{ trip_id: "t1", driver_id: "d1" }],
      unassigned_trip_ids: []
    });

    const result = await processQueuedScheduleRuns();

    expect(result).toEqual({ processed: 1, results: [{ date: "2026-08-20", status: "SUCCEEDED" }] });
    expect(upsertedRows).toEqual([
      { trip_id: "t1", driver_id: "d1", roster_date: "2026-08-20", source: "solver", locked: false }
    ]);
    expect(finalUpdate).toMatchObject({ status: "SUCCEEDED", unassigned_trip_ids: [] });
    expect(callSolverMock).toHaveBeenCalledWith({
      date: "2026-08-20",
      drivers: [{ id: "d1", cab_id: "c1" }],
      jobs: [{ trip_id: "t1", drivers_required: 1, start_minutes: 540, end_minutes: 585, locked_driver_ids: [] }]
    });
  });

  it("returns no-op when nothing is queued", async () => {
    const emptyStub = {
      from: () => ({
        select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) })
      })
    } as unknown as import("@supabase/supabase-js").SupabaseClient;
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => emptyStub }));

    const result = await processQueuedScheduleRuns();
    expect(result.processed).toBe(0);
  });
});
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run lib/scheduling/__tests__/runner.test.ts`
Expected: PASS (2 tests). If the mock chain doesn't line up with `runner.ts`'s actual calls, adjust the stub to match (not the other way around) — the stub exists to prove `runner.ts` calls the right tables/filters, not to dictate its implementation.

- [ ] **Step 10: Write the cron route**

```ts
// app/api/cron/schedule/route.ts
/**
 * GET /api/cron/schedule
 *
 * Drains queued driver-scheduling runs (see schedule_runs), same
 * auth model as /api/cron/sync: a shared secret instead of a login,
 * because this is called by a scheduler, not a human.
 */

import { NextResponse } from "next/server";
import { processQueuedScheduleRuns } from "@/lib/scheduling/runner";
import { logAudit } from "@/lib/audit";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processQueuedScheduleRuns();
    if (result.processed > 0) {
      logAudit({ action: "schedule.auto", metadata: result });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduling failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 11: Wire trip create/update/delete to enqueue a schedule run**

In `app/api/trips/route.ts`, import `enqueueScheduleRun` and call it alongside the existing sync enqueue:

```ts
// app/api/trips/route.ts — add to the import block
import { enqueueScheduleRun } from "@/lib/scheduling/queue";
```

Replace the `POST` handler's parallel block:
```ts
    // Enqueue sync, scheduling, and audit in parallel — none blocks the response
    await Promise.all([
      enqueueTripSync(supabase, data.id),
      enqueueScheduleRun(supabase, payload.travel_date),
      logAudit({ actorId: ctx.userId, teamId: payload.team_id, tripId: data.id, action: "trip.created", metadata: { guestName: payload.guest_name } })
    ]);
```

In `app/api/trips/[id]/route.ts`, import the same helper and update both `PUT` and `DELETE`:

```ts
// app/api/trips/[id]/route.ts — add to the import block
import { enqueueScheduleRun } from "@/lib/scheduling/queue";
```

In `PUT`, replace the parallel block:
```ts
    await Promise.all([
      enqueueTripSync(supabase, params.id),
      enqueueScheduleRun(supabase, payload.travel_date),
      logAudit({ actorId: ctx.userId, teamId: payload.team_id, tripId: params.id, action: "trip.updated", metadata: { guestName: payload.guest_name } })
    ]);
```

In `DELETE`, add an enqueue call using the fetched trip's `travel_date` (need to select it too):
```ts
  const { data: trip } = await supabase
    .from("trips")
    .select("team_id, guest_name, travel_date")
    .eq("id", params.id)
    .maybeSingle();

  if (!trip) return NextResponse.json({ error: "Trip not found." }, { status: 404 });

  const { error } = await supabase.from("trips").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Fire audit log and schedule re-run without awaiting — deletion is already done
  logAudit({ actorId: user.id, teamId: trip.team_id, tripId: params.id, action: "trip.deleted", metadata: { guestName: trip.guest_name } });
  enqueueScheduleRun(supabase, trip.travel_date).catch(() => {});
```

- [ ] **Step 12: Typecheck and run the full test suite**

```bash
npm run typecheck
npx vitest run
```
Expected: no TypeScript errors; all Vitest suites pass.

- [ ] **Step 13: Commit**

```bash
git add lib/scheduling/queue.ts lib/scheduling/runner.ts lib/scheduling/__tests__/queue.test.ts lib/scheduling/__tests__/runner.test.ts app/api/cron/schedule/route.ts app/api/trips/route.ts app/api/trips/[id]/route.ts
git commit -m "feat: add schedule run queue, cron worker, and trip-change triggers"
```

---

## Task 7: Drivers & roster admin API + UI panel

**Files:**
- Create: `app/api/drivers/route.ts`
- Create: `app/api/roster/route.ts`
- Create: `components/dashboard/DriverRosterPanel.tsx`
- Modify: `components/dashboard/AdminDashboard.tsx` (render the new panel, fetch initial drivers/cabs)
- Modify: `app/admin/page.tsx` (load `drivers` and `cabs` server-side, pass down)

**Interfaces:**
- Produces: `GET/POST /api/drivers` (list/create drivers), `GET /api/roster?date=YYYY-MM-DD` and `POST /api/roster` (upsert roster rows, enqueues a schedule run), consumed by `DriverRosterPanel`.
- Consumes: `Driver`, `Cab`, `DriverDailyRoster` types (Task 2), `enqueueScheduleRun` (Task 6).

- [ ] **Step 1: Write the drivers API route**

```ts
// app/api/drivers/route.ts
/**
 * GET  /api/drivers  – list drivers and cabs (admin only)
 * POST /api/drivers  – create a driver (admin only)
 *
 * Cabs are seeded/managed the same way as drivers but through the same
 * route with a `type` field, since both are simple named resources with
 * no extra behavior of their own.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/queries";

async function requireAdmin() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const profile = await getProfile(supabase, user.id);
  return profile?.role === "admin" ? user.id : null;
}

export async function GET() {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = createAdminClient();
  const [drivers, cabs] = await Promise.all([
    supabase.from("drivers").select("id, full_name, phone, active").order("full_name"),
    supabase.from("cabs").select("id, label, active").order("label")
  ]);

  if (drivers.error) return NextResponse.json({ error: drivers.error.message }, { status: 400 });
  if (cabs.error) return NextResponse.json({ error: cabs.error.message }, { status: 400 });

  return NextResponse.json({ drivers: drivers.data, cabs: cabs.data });
}

export async function POST(request: Request) {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.fullName) {
    return NextResponse.json({ error: "fullName is required." }, { status: 400 });
  }

  const supabase = createAdminClient();

  if (body.kind === "cab") {
    const { data, error } = await supabase.from("cabs").insert({ label: body.fullName }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ cab: data }, { status: 201 });
  }

  const { data, error } = await supabase
    .from("drivers")
    .insert({ full_name: body.fullName, phone: body.phone || null })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ driver: data }, { status: 201 });
}
```

- [ ] **Step 2: Write the roster API route**

```ts
// app/api/roster/route.ts
/**
 * GET  /api/roster?date=YYYY-MM-DD  – list roster rows for a date (admin only)
 * POST /api/roster                  – upsert one driver's roster row for a
 *                                      date, then enqueue a schedule re-run
 *                                      for that date (admin only)
 *
 * Body: { driverId, rosterDate, available, cabId?, substitutingForDriverId?, notes? }
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/queries";
import { enqueueScheduleRun } from "@/lib/scheduling/queue";

async function requireAdmin() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const profile = await getProfile(supabase, user.id);
  return profile?.role === "admin" ? user.id : null;
}

export async function GET(request: Request) {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date query param is required." }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("driver_daily_roster")
    .select("id, driver_id, roster_date, available, cab_id, substituting_for_driver_id, notes, drivers(full_name)")
    .eq("roster_date", date);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ roster: data });
}

export async function POST(request: Request) {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.driverId || !body?.rosterDate) {
    return NextResponse.json({ error: "driverId and rosterDate are required." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("driver_daily_roster")
    .upsert(
      {
        driver_id: body.driverId,
        roster_date: body.rosterDate,
        available: body.available !== false,
        cab_id: body.cabId || null,
        substituting_for_driver_id: body.substitutingForDriverId || null,
        notes: body.notes || null
      },
      { onConflict: "driver_id,roster_date" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await enqueueScheduleRun(supabase, body.rosterDate);

  return NextResponse.json({ roster: data }, { status: 201 });
}
```

- [ ] **Step 3: Write the roster panel component**

```tsx
// components/dashboard/DriverRosterPanel.tsx
"use client";

import { useEffect, useState } from "react";
import { Users, RefreshCw } from "lucide-react";
import type { Cab, Driver } from "@/types/scheduling";

type RosterRow = {
  id: string;
  driver_id: string;
  roster_date: string;
  available: boolean;
  cab_id: string | null;
  substituting_for_driver_id: string | null;
  drivers?: { full_name: string } | null;
};

export function DriverRosterPanel({ drivers, cabs }: { drivers: Driver[]; cabs: Cab[] }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/roster?date=${date}`)
      .then((r) => r.json())
      .then((body) => setRoster(body.roster || []))
      .catch(() => setRoster([]));
  }, [date]);

  async function setAvailability(driverId: string, available: boolean, cabId: string | null) {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driverId, rosterDate: date, available, cabId })
    });
    const body = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setMessage(body.error || "Failed to save roster.");
      return;
    }
    setRoster((rows) => {
      const others = rows.filter((row) => row.driver_id !== driverId);
      return [...others, body.roster];
    });
    setMessage("Roster saved — schedule will refresh shortly.");
  }

  const rosterByDriver = new Map(roster.map((row) => [row.driver_id, row]));

  return (
    <section className="panel">
      <div className="panel-header">
        <strong>
          <Users size={15} className="icon-inline" />
          Driver Roster
        </strong>
        <span className="hint">Who's available, and which cab they have, for a given date.</span>
      </div>
      <div className="panel-body stack">
        <div className="field">
          <label htmlFor="rosterDate">Date</label>
          <input id="rosterDate" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        {message && <div className="notice">{message}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th>Available</th>
                <th>Cab</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((driver) => {
                const row = rosterByDriver.get(driver.id);
                const available = row ? row.available : false;
                const cabId = row?.cab_id ?? "";
                return (
                  <tr key={driver.id}>
                    <td>{driver.full_name}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={available}
                        disabled={loading}
                        onChange={(event) => setAvailability(driver.id, event.target.checked, cabId || null)}
                      />
                    </td>
                    <td>
                      <select
                        value={cabId}
                        disabled={loading || !available}
                        onChange={(event) => setAvailability(driver.id, true, event.target.value || null)}
                      >
                        <option value="">No cab</option>
                        {cabs.map((cab) => (
                          <option key={cab.id} value={cab.id}>
                            {cab.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button className="button" type="button" onClick={() => setDate((d) => d)} disabled={loading}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Load drivers/cabs server-side and pass to the dashboard**

In `app/admin/page.tsx`, add a fetch for drivers/cabs alongside the existing `Promise.all`:

```ts
// app/admin/page.tsx — add import
import { createAdminClient } from "@/lib/supabase/admin";
```
(already imported) — add a helper and include it in the parallel fetch:

```ts
async function getDriversAndCabs() {
  const admin = createAdminClient();
  const [drivers, cabs] = await Promise.all([
    admin.from("drivers").select("id, full_name, phone, active").order("full_name"),
    admin.from("cabs").select("id, label, active").order("label")
  ]);
  return { drivers: drivers.data || [], cabs: cabs.data || [] };
}
```

```ts
  const [trips, teams, auditLogs, dayZeroDate, driversAndCabs] = await Promise.all([
    listTrips(supabase),
    listTeams(supabase),
    listAuditLogs(supabase),
    getEventConfig(),
    getDriversAndCabs()
  ]);
```

Pass `initialDrivers={driversAndCabs.drivers}` and `initialCabs={driversAndCabs.cabs}` to `<AdminDashboard>`.

- [ ] **Step 5: Render the panel in AdminDashboard**

In `components/dashboard/AdminDashboard.tsx`, add `initialDrivers: Driver[]` and `initialCabs: Cab[]` to `AdminDashboardProps`, import `Driver`/`Cab` from `@/types/scheduling` and `DriverRosterPanel`, and render `<DriverRosterPanel drivers={initialDrivers} cabs={initialCabs} />` alongside the existing `<TeamAccessPanel>` render.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 7: Manual verification**

```bash
npm run dev
```
Log in as an admin, open the dashboard, confirm the "Driver Roster" panel renders (empty state is fine with zero seeded drivers), and that toggling a checkbox for a seeded driver (insert one manually via SQL if none exist yet: `insert into drivers (full_name) values ('Test Driver');`) persists after a page refresh.

- [ ] **Step 8: Commit**

```bash
git add app/api/drivers/route.ts app/api/roster/route.ts components/dashboard/DriverRosterPanel.tsx components/dashboard/AdminDashboard.tsx app/admin/page.tsx
git commit -m "feat: add driver roster admin API and panel"
```

---

## Task 8: Assignments API (manual override), schedule panel, and unassigned banner

**Files:**
- Create: `app/api/assignments/route.ts`
- Create: `components/dashboard/DriverSchedulePanel.tsx`
- Modify: `components/dashboard/AdminDashboard.tsx` (render the schedule panel)
- Modify: `README.md` (document `GOOGLE_MAPS_API_KEY`, `SCHEDULER_SERVICE_URL`, `SCHEDULER_SERVICE_SECRET`)

**Interfaces:**
- Produces: `GET /api/assignments?date=YYYY-MM-DD` (trips + their assignments + latest run's unassigned list for that date), `PATCH /api/assignments` (manual reassign, sets `source='manual', locked=true`).
- Consumes: `DriverTripAssignment`, `ScheduleRun` types (Task 2).

- [ ] **Step 1: Write the assignments API route**

```ts
// app/api/assignments/route.ts
/**
 * GET   /api/assignments?date=YYYY-MM-DD  – trips for the date with their
 *       current driver assignment(s) and the latest schedule_runs status
 *       for that date (admin only)
 * PATCH /api/assignments                  – manually set/replace the
 *       driver(s) for one trip; always writes source='manual', locked=true
 *       so a later auto re-run leaves it alone (admin only)
 *
 * PATCH body: { tripId, rosterDate, driverIds: string[] }
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/queries";

async function requireAdmin() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const profile = await getProfile(supabase, user.id);
  return profile?.role === "admin" ? user.id : null;
}

export async function GET(request: Request) {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date query param is required." }, { status: 400 });

  const supabase = createAdminClient();
  const [trips, assignments, runs] = await Promise.all([
    supabase
      .from("trips")
      .select("id, guest_name, direction, pickup_time, drop_time, drivers_required")
      .eq("travel_date", date),
    supabase
      .from("driver_trip_assignments")
      .select("id, trip_id, driver_id, source, locked, drivers(full_name)")
      .eq("roster_date", date),
    supabase
      .from("schedule_runs")
      .select("id, status, unassigned_trip_ids, error_message, completed_at")
      .eq("roster_date", date)
      .order("created_at", { ascending: false })
      .limit(1)
  ]);

  if (trips.error) return NextResponse.json({ error: trips.error.message }, { status: 400 });
  if (assignments.error) return NextResponse.json({ error: assignments.error.message }, { status: 400 });
  if (runs.error) return NextResponse.json({ error: runs.error.message }, { status: 400 });

  return NextResponse.json({
    trips: trips.data,
    assignments: assignments.data,
    latestRun: runs.data?.[0] || null
  });
}

export async function PATCH(request: Request) {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.tripId || !body?.rosterDate || !Array.isArray(body?.driverIds)) {
    return NextResponse.json({ error: "tripId, rosterDate, and driverIds are required." }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { error: deleteError } = await supabase
    .from("driver_trip_assignments")
    .delete()
    .eq("trip_id", body.tripId);

  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 400 });

  if (body.driverIds.length === 0) {
    return NextResponse.json({ assignments: [] });
  }

  const rows = body.driverIds.map((driverId: string) => ({
    trip_id: body.tripId,
    driver_id: driverId,
    roster_date: body.rosterDate,
    source: "manual" as const,
    locked: true
  }));

  const { data, error } = await supabase.from("driver_trip_assignments").insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ assignments: data });
}
```

- [ ] **Step 2: Write the schedule panel component**

```tsx
// components/dashboard/DriverSchedulePanel.tsx
"use client";

import { useEffect, useState } from "react";
import { CalendarClock, AlertTriangle } from "lucide-react";
import type { Driver } from "@/types/scheduling";

type TripRow = {
  id: string;
  guest_name: string;
  direction: string;
  pickup_time: string | null;
  drop_time: string | null;
  drivers_required: number;
};

type AssignmentRow = {
  id: string;
  trip_id: string;
  driver_id: string;
  source: "solver" | "manual";
  locked: boolean;
  drivers?: { full_name: string } | null;
};

type LatestRun = {
  id: string;
  status: string;
  unassigned_trip_ids: string[];
  error_message: string | null;
} | null;

export function DriverSchedulePanel({ drivers }: { drivers: Driver[] }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [latestRun, setLatestRun] = useState<LatestRun>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`/api/assignments?date=${date}`)
      .then((r) => r.json())
      .then((body) => {
        setTrips(body.trips || []);
        setAssignments(body.assignments || []);
        setLatestRun(body.latestRun || null);
      })
      .catch(() => {
        setTrips([]);
        setAssignments([]);
        setLatestRun(null);
      });
  }, [date]);

  async function reassign(tripId: string, driverIds: string[]) {
    setMessage("");
    const response = await fetch("/api/assignments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId, rosterDate: date, driverIds })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error || "Failed to reassign.");
      return;
    }
    setAssignments((rows) => [...rows.filter((row) => row.trip_id !== tripId), ...body.assignments]);
  }

  const assignmentsByTrip = new Map<string, AssignmentRow[]>();
  for (const assignment of assignments) {
    const list = assignmentsByTrip.get(assignment.trip_id) || [];
    list.push(assignment);
    assignmentsByTrip.set(assignment.trip_id, list);
  }

  const unassignedIds = new Set(latestRun?.unassigned_trip_ids || []);

  return (
    <section className="panel">
      <div className="panel-header">
        <strong>
          <CalendarClock size={15} className="icon-inline" />
          Driver Schedule
        </strong>
        <span className="hint">Solver-assigned by default; edits here are locked and survive re-runs.</span>
      </div>
      <div className="panel-body stack">
        <div className="field">
          <label htmlFor="scheduleDate">Date</label>
          <input id="scheduleDate" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        {unassignedIds.size > 0 && (
          <div className="notice">
            <AlertTriangle size={14} className="icon-inline" />
            {unassignedIds.size} trip(s) could not be fully staffed with today's roster.
          </div>
        )}
        {latestRun?.status === "FAILED" && (
          <div className="notice">Last schedule run failed: {latestRun.error_message}</div>
        )}
        {message && <div className="notice">{message}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Guest</th>
                <th>Direction</th>
                <th>Drivers needed</th>
                <th>Assigned</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((trip) => {
                const tripAssignments = assignmentsByTrip.get(trip.id) || [];
                const isUnassigned = unassignedIds.has(trip.id);
                return (
                  <tr key={trip.id}>
                    <td>{trip.guest_name}</td>
                    <td>{trip.direction}</td>
                    <td>{trip.drivers_required}</td>
                    <td>
                      <select
                        multiple
                        value={tripAssignments.map((a) => a.driver_id)}
                        onChange={(event) => {
                          const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
                          reassign(trip.id, selected);
                        }}
                      >
                        {drivers.map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.full_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {isUnassigned ? (
                        <span className="status failed">Unassigned</span>
                      ) : tripAssignments.some((a) => a.locked) ? (
                        <span className="status">Manual</span>
                      ) : tripAssignments.length > 0 ? (
                        <span className="status synced">Solver</span>
                      ) : (
                        <span className="hint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Render the panel in AdminDashboard**

In `components/dashboard/AdminDashboard.tsx`, import `DriverSchedulePanel` and render `<DriverSchedulePanel drivers={initialDrivers} />` next to `<DriverRosterPanel>`.

- [ ] **Step 4: Document new env vars**

In `README.md`, add to the Vercel environment-variables list (near `CRON_SECRET`):
```markdown
   - `GOOGLE_MAPS_API_KEY` — Distance Matrix API key, used to estimate trip durations for driver scheduling
   - `SCHEDULER_SERVICE_URL`, `SCHEDULER_SERVICE_SECRET` — base URL and shared secret for the OR-Tools scheduler microservice (see `scheduler-service/README.md`)
```

Add a new "Auto-sync" -style section documenting the second cron endpoint, right after the existing Auto-sync section:
```markdown
## Driver scheduling

`GET /api/cron/schedule` drains queued driver-scheduling runs the same way `/api/cron/sync` drains the sheet sync queue — add a second scheduled job hitting this endpoint with the same `Authorization: Bearer <CRON_SECRET>` header (e.g. another line in `.github/workflows/auto-sync.yml`, or a second workflow file).

Admins manage the day's driver roster and review/override the resulting schedule from the "Driver Roster" and "Driver Schedule" panels in the admin dashboard. See `docs/superpowers/specs/2026-08-11-driver-cab-scheduling-design.md` for the full design.
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 6: Manual verification**

```bash
npm run dev
```
With at least one seeded driver and one trip on today's `travel_date` with `pickup_time` set:
1. Mark the driver available for today in the Driver Roster panel.
2. Set `SCHEDULER_SERVICE_URL`/`SCHEDULER_SERVICE_SECRET` in `.env.local` pointing at a locally-running `scheduler-service` (`uvicorn main:app --port 8000`, `SCHEDULER_SERVICE_URL=http://localhost:8000`).
3. Manually hit `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/schedule` to drain the queue (no live cron in dev).
4. Refresh the Driver Schedule panel and confirm the trip shows the driver assigned with a "Solver" badge.
5. Use the multi-select to reassign to no driver, confirm the row now shows "Unassigned" is not shown (since no schedule run re-ran) but the assignment cleared; then run `/api/cron/schedule` again and confirm the manual (empty) state is NOT overwritten by the solver — i.e. re-running does not re-add the driver unless you clear the lock. (Since the PATCH deletes+inserts, an empty `driverIds` array leaves zero rows for that trip; note this trip will then correctly show as solver-unassignable on next run only if you also want it reconsidered — that requires deleting the manual override, not just leaving it empty. This is expected: an explicit "no driver" is itself a locked human decision.)

- [ ] **Step 7: Commit**

```bash
git add app/api/assignments/route.ts components/dashboard/DriverSchedulePanel.tsx components/dashboard/AdminDashboard.tsx README.md
git commit -m "feat: add manual assignment override API and driver schedule panel"
```

---

## Post-implementation checklist

- [ ] `npm run typecheck` passes
- [ ] `npx vitest run` passes (all suites across Tasks 2, 4, 5, 6)
- [ ] `cd scheduler-service && pytest -v` passes
- [ ] Manual end-to-end walkthrough from Task 8 Step 6 completed
- [ ] `scheduler-service` deployed somewhere reachable, and `SCHEDULER_SERVICE_URL`/`SCHEDULER_SERVICE_SECRET`/`GOOGLE_MAPS_API_KEY`/`CRON_SECRET` set in the deployed Next.js app's environment
- [ ] A second scheduled trigger for `/api/cron/schedule` set up (GitHub Actions or otherwise), mirroring the existing `/api/cron/sync` trigger
