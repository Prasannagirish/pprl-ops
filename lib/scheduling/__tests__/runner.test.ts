import { describe, expect, it, vi, beforeEach } from "vitest";

const { callSolverMock, getDurationMinutesMock } = vi.hoisted(() => ({
  callSolverMock: vi.fn(),
  getDurationMinutesMock: vi.fn()
}));

vi.mock("@/lib/scheduling/solverClient", () => ({ callSolver: callSolverMock }));
vi.mock("@/lib/scheduling/duration", () => ({ getDurationMinutes: getDurationMinutesMock }));
// createAdminClient reads `activeStub` lazily (only when actually called at
// runtime inside runner.ts), so tests can swap the stub per-case by
// reassigning activeStub — a static `vi.doMock` wouldn't affect the
// already-resolved static import in runner.ts.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => activeStub }));

type StubRow = Record<string, unknown>;

const DEFAULT_ROSTER: StubRow[] = [{ driver_id: "d1", cab_id: "c1" }];
const DEFAULT_TRIPS: StubRow[] = [
  {
    id: "t1",
    pickup_location: "Airport",
    drop_location: "Campus",
    pickup_time: "2026-08-20T09:00:00.000Z",
    drivers_required: 1
  }
];

/**
 * Builds a fresh Supabase stub matching runner.ts's exact query-chain shapes:
 * - schedule_runs: select().eq().order().limit() for the queue read,
 *   update().eq().eq() / update().eq().in() for status transitions (every
 *   update call is captured, in order, in `updates`).
 * - driver_daily_roster: select().eq().eq() (roster_date, available).
 * - trips: select().eq() (travel_date).
 * - driver_trip_assignments: select().eq().eq() (roster_date, locked) plus
 *   delete().eq().eq() (roster_date, locked=false) and upsert().
 */
function makeStub(overrides: { trips?: StubRow[]; locked?: StubRow[]; roster?: StubRow[] } = {}) {
  const trips = overrides.trips ?? DEFAULT_TRIPS;
  const locked = overrides.locked ?? [];
  const roster = overrides.roster ?? DEFAULT_ROSTER;
  const upsertedRows: unknown[] = [];
  const updates: Record<string, unknown>[] = [];
  const deleteCalls: unknown[] = [];

  const stub = {
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
            updates.push(payload);
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
              eq: async () => ({ data: roster, error: null })
            })
          })
        };
      }
      if (table === "trips") {
        return {
          select: () => ({
            eq: async () => ({ data: trips, error: null })
          })
        };
      }
      if (table === "driver_trip_assignments") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: locked, error: null })
            })
          }),
          delete: () => ({
            eq: (col: string, value: unknown) => ({
              eq: async (col2: string, value2: unknown) => {
                deleteCalls.push({ [col]: value, [col2]: value2 });
                return { error: null };
              }
            })
          }),
          upsert: async (rows: unknown) => {
            upsertedRows.push(...(rows as unknown[]));
            return { error: null };
          }
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }
  } as unknown as import("@supabase/supabase-js").SupabaseClient;

  return { stub, upsertedRows, updates, deleteCalls };
}

let activeStub: import("@supabase/supabase-js").SupabaseClient = makeStub().stub;

import { processQueuedScheduleRuns } from "@/lib/scheduling/runner";

describe("processQueuedScheduleRuns", () => {
  beforeEach(() => {
    callSolverMock.mockReset();
    getDurationMinutesMock.mockReset();
  });

  it("solves each queued date and writes non-locked assignments", async () => {
    const { stub, upsertedRows, updates, deleteCalls } = makeStub();
    activeStub = stub;

    getDurationMinutesMock.mockResolvedValue(45);
    callSolverMock.mockResolvedValue({
      assignments: [{ trip_id: "t1", driver_id: "d1" }],
      unassigned_trip_ids: []
    });

    const result = await processQueuedScheduleRuns();

    expect(result).toEqual({ processed: 1, results: [{ date: "2026-08-20", status: "SUCCEEDED" }] });
    // Stale non-locked rows for the date are cleared before the fresh
    // solver solution is written, so a reassignment never leaves a ghost
    // row from a previous run behind.
    expect(deleteCalls).toEqual([{ roster_date: "2026-08-20", locked: false }]);
    expect(upsertedRows).toEqual([
      { trip_id: "t1", driver_id: "d1", roster_date: "2026-08-20", source: "solver", locked: false }
    ]);
    expect(updates[updates.length - 1]).toMatchObject({ status: "SUCCEEDED", unassigned_trip_ids: [] });
    expect(callSolverMock).toHaveBeenCalledWith({
      date: "2026-08-20",
      drivers: [{ id: "d1", cab_id: "c1" }],
      // 2026-08-20T09:00:00Z is 14:30 IST (870 min), not 09:00 (540 min) --
      // see the dedicated timezone test below for why this matters.
      jobs: [{ trip_id: "t1", drivers_required: 1, start_minutes: 870, end_minutes: 915, locked_driver_ids: [] }]
    });
  });

  it("computes start/end minutes from local (Asia/Kolkata) wall-clock time, not UTC", async () => {
    // 2026-08-20T09:00:00Z is 14:30 IST -- using getUTCHours()/getUTCMinutes()
    // would have wrongly produced 540 (09:00) instead of 870 (14:30).
    const trips: StubRow[] = [
      {
        id: "t1",
        pickup_location: "Airport",
        drop_location: "Campus",
        pickup_time: "2026-08-20T09:00:00.000Z",
        drivers_required: 1
      }
    ];
    const { stub } = makeStub({ trips });
    activeStub = stub;

    getDurationMinutesMock.mockResolvedValue(45);
    callSolverMock.mockResolvedValue({ assignments: [], unassigned_trip_ids: [] });

    await processQueuedScheduleRuns();

    expect(callSolverMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobs: [expect.objectContaining({ start_minutes: 870, end_minutes: 915 })]
      })
    );
  });

  it("returns no-op when nothing is queued", async () => {
    const emptyStub = {
      from: () => ({
        select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) })
      })
    } as unknown as import("@supabase/supabase-js").SupabaseClient;
    activeStub = emptyStub;

    const result = await processQueuedScheduleRuns();
    expect(result.processed).toBe(0);
  });

  it("filters a solver-returned assignment that matches an existing locked (trip_id, driver_id) pair out of the upsert", async () => {
    const { stub, upsertedRows } = makeStub({
      locked: [{ trip_id: "t1", driver_id: "d1" }]
    });
    activeStub = stub;

    getDurationMinutesMock.mockResolvedValue(45);
    callSolverMock.mockResolvedValue({
      assignments: [{ trip_id: "t1", driver_id: "d1" }],
      unassigned_trip_ids: []
    });

    await processQueuedScheduleRuns();

    // The solver returned the same (t1, d1) pair that's already locked --
    // it must not be re-upserted.
    expect(upsertedRows).toEqual([]);
    // The lock must still have been communicated to the solver request.
    expect(callSolverMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobs: [expect.objectContaining({ trip_id: "t1", locked_driver_ids: ["d1"] })]
      })
    );
  });

  it("excludes a trip with a null pickup_time from the job list and reports it unassigned", async () => {
    const tripWithoutPickupTime: StubRow = {
      id: "t1",
      pickup_location: "Airport",
      drop_location: "Campus",
      pickup_time: null,
      drivers_required: 1
    };
    const { stub, updates } = makeStub({ trips: [tripWithoutPickupTime] });
    activeStub = stub;

    callSolverMock.mockResolvedValue({ assignments: [], unassigned_trip_ids: [] });

    const result = await processQueuedScheduleRuns();

    expect(getDurationMinutesMock).not.toHaveBeenCalled();
    expect(callSolverMock).toHaveBeenCalledWith(expect.objectContaining({ jobs: [] }));
    expect(result.results).toEqual([{ date: "2026-08-20", status: "SUCCEEDED" }]);
    expect(updates[updates.length - 1]).toMatchObject({
      status: "SUCCEEDED",
      unassigned_trip_ids: ["t1"]
    });
  });

  it("isolates a duration-lookup failure to just that trip, leaving the rest of the day's schedule intact", async () => {
    const trips: StubRow[] = [
      {
        id: "t1",
        pickup_location: "Airport",
        drop_location: "Campus",
        pickup_time: "2026-08-20T09:00:00.000Z",
        drivers_required: 1
      },
      {
        id: "t2",
        pickup_location: "Campus",
        drop_location: "Downtown",
        pickup_time: "2026-08-20T10:00:00.000Z",
        drivers_required: 1
      }
    ];
    const { stub, updates } = makeStub({ trips });
    activeStub = stub;

    getDurationMinutesMock.mockImplementation(async (_supabase: unknown, origin: string) => {
      if (origin === "Campus") throw new Error("Distance Matrix could not compute a route");
      return 45;
    });
    callSolverMock.mockResolvedValue({
      assignments: [{ trip_id: "t1", driver_id: "d1" }],
      unassigned_trip_ids: []
    });

    const result = await processQueuedScheduleRuns();

    expect(callSolverMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobs: [expect.objectContaining({ trip_id: "t1" })]
      })
    );
    expect(result.results).toEqual([{ date: "2026-08-20", status: "SUCCEEDED" }]);
    expect(updates[updates.length - 1]).toMatchObject({
      status: "SUCCEEDED",
      unassigned_trip_ids: ["t2"]
    });
  });

  it("keeps processing remaining queued dates even when writing the FAILED status itself throws", async () => {
    const updates: Record<string, unknown>[] = [];
    let tripsCallCount = 0;

    const stub = {
      from(table: string) {
        if (table === "schedule_runs") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [
                      { id: "run1", roster_date: "2026-08-20" },
                      { id: "run2", roster_date: "2026-08-21" }
                    ],
                    error: null
                  })
                })
              })
            }),
            update: (payload: Record<string, unknown>) => {
              updates.push(payload);
              const maybeThrow = (dateArg: string) => {
                if (payload.status === "FAILED" && dateArg === "2026-08-20") {
                  // Simulate a network-level failure while recording the
                  // failure itself -- this must not abort the batch.
                  throw new Error("network failure writing status");
                }
                return { error: null };
              };
              return {
                eq: (_col: string, dateArg: string) => ({
                  eq: async () => maybeThrow(dateArg),
                  in: async () => maybeThrow(dateArg)
                })
              };
            }
          };
        }
        if (table === "driver_daily_roster") {
          return { select: () => ({ eq: () => ({ eq: async () => ({ data: DEFAULT_ROSTER, error: null }) }) }) };
        }
        if (table === "trips") {
          return {
            select: () => ({
              eq: async () => {
                tripsCallCount += 1;
                // First date's trip fetch fails outright, forcing
                // runScheduleForDate to throw and hit the catch block.
                if (tripsCallCount === 1) {
                  return { data: null, error: { message: "trips fetch boom" } };
                }
                return { data: DEFAULT_TRIPS, error: null };
              }
            })
          };
        }
        if (table === "driver_trip_assignments") {
          return {
            select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }),
            delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
            upsert: async () => ({ error: null })
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    activeStub = stub;
    getDurationMinutesMock.mockResolvedValue(45);
    callSolverMock.mockResolvedValue({ assignments: [], unassigned_trip_ids: [] });

    const result = await processQueuedScheduleRuns();

    expect(result.processed).toBe(2);
    expect(result.results).toEqual([
      { date: "2026-08-20", status: "FAILED" },
      { date: "2026-08-21", status: "SUCCEEDED" }
    ]);
  });
});
