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
