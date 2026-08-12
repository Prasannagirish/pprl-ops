/**
 * GET  /api/roster?date=YYYY-MM-DD  – list roster rows for a date (admin only)
 * POST /api/roster                  – upsert one driver's roster row for a
 *                                      date, then enqueue a schedule re-run
 *                                      for that date (admin only)
 *
 * Body: { driverId, rosterDate, available, cabId?, substitutingForDriverId?, notes? }
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/supabase/queries";
import { enqueueScheduleRun } from "@/lib/scheduling/queue";

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
  const { data, error } = await supabase
    .from("driver_daily_roster")
    .select("id, driver_id, roster_date, available, cab_id, substituting_for_driver_id, notes, drivers(full_name)")
    .eq("roster_date", date);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ roster: data });
}

export async function POST(request: Request) {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.driverId || !body?.rosterDate) {
    return NextResponse.json({ error: "driverId and rosterDate are required." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("driver_daily_roster")
    .upsert(
      {
        driver_id: body.driverId,
        roster_date: body.rosterDate,
        available: body.available !== false,
        cab_id: body.cabId || null,
        substituting_for_driver_id: body.substitutingForDriverId || null,
        notes: body.notes || null
      },
      { onConflict: "driver_id,roster_date" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await enqueueScheduleRun(supabase, body.rosterDate);

  return NextResponse.json({ roster: data }, { status: 201 });
}
