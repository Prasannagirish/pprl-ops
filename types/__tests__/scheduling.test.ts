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
