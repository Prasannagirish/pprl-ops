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

let activeStub: import("@supabase/supabase-js").SupabaseClient = supabaseStub;

import { processQueuedScheduleRuns } from "@/lib/scheduling/runner";

describe("processQueuedScheduleRuns", () => {
  beforeEach(() => {
    callSolverMock.mockReset();
    getDurationMinutesMock.mockReset();
    upsertedRows = [];
    finalUpdate = null;
    activeStub = supabaseStub;
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
    activeStub = emptyStub;

    const result = await processQueuedScheduleRuns();
    expect(result.processed).toBe(0);
  });
});
