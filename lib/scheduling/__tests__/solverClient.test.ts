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
