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
