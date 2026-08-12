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
