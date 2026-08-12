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
      // Recording the failure is best-effort: if this update itself throws
      // (e.g. a network-level failure, not just a Supabase {error} result),
      // it must not stop the loop from processing the remaining dates.
      try {
        await supabase
          .from("schedule_runs")
          .update({ status: "FAILED", error_message: message, completed_at: new Date().toISOString() })
          .eq("roster_date", date)
          .in("status", ["QUEUED", "RUNNING"]);
      } catch {
        // Swallow — the original scheduling failure is already captured below.
      }
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
