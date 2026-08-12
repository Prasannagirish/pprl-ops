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
