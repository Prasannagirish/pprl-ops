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
