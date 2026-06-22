import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/supabase/auth";
import { buildTripPayload, enqueueTripSync, assertTeamWritable } from "@/lib/trips/persistence";
import { tripInputSchema } from "@/lib/validations/trip";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("trips")
    .select(
      "id, team_id, guest_name, guest_designation, travel_date, direction, location_type, pickup_location, drop_location, flight_time, pickup_time, drop_time, poc_name, poc_contact, guest_buffer_time, poc_buffer_time, corrected_drop_time, sync_status, gsheet_row_id, created_at, updated_at, teams(id, name)"
    )
    .order("travel_date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ trips: data });
}

export async function POST(request: Request) {
  // Parse body and authenticate in parallel
  const [bodyResult, ctx] = await Promise.all([
    request.json().catch(() => null),
    getAuthContext()
  ]);

  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = tripInputSchema.safeParse(bodyResult);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });

  try {
    const supabase = createClient();
    const payload = buildTripPayload(parsed.data, ctx.profile);

    await assertTeamWritable(supabase, payload.team_id, ctx.profile.role);

    const { data, error } = await supabase.from("trips").insert(payload).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // Enqueue sync and log audit in parallel — neither blocks the response
    await Promise.all([
      enqueueTripSync(supabase, data.id),
      logAudit({ actorId: ctx.userId, teamId: payload.team_id, tripId: data.id, action: "trip.created", metadata: { guestName: payload.guest_name } })
    ]);

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create trip";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
