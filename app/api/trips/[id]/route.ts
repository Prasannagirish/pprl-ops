import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/supabase/auth";
import { buildTripPayload, enqueueTripSync, assertTeamWritable } from "@/lib/trips/persistence";
import { tripInputSchema } from "@/lib/validations/trip";
import { logAudit } from "@/lib/audit";
import { enqueueScheduleRun } from "@/lib/scheduling/queue";

type Params = { params: { id: string } };

export async function PUT(request: Request, { params }: Params) {
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

    const { data: updated, error } = await supabase
      .from("trips")
      .update(payload)
      .eq("id", params.id)
      .select("id")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!updated) return NextResponse.json({ error: "Trip not found." }, { status: 404 });

    await Promise.all([
      enqueueTripSync(supabase, params.id),
      enqueueScheduleRun(supabase, payload.travel_date),
      logAudit({ actorId: ctx.userId, teamId: payload.team_id, tripId: params.id, action: "trip.updated", metadata: { guestName: payload.guest_name } })
    ]);

    return NextResponse.json({ id: params.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update trip";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch the trip to get audit metadata, then delete in parallel where possible
  const { data: trip } = await supabase
    .from("trips")
    .select("team_id, guest_name, travel_date")
    .eq("id", params.id)
    .maybeSingle();

  if (!trip) return NextResponse.json({ error: "Trip not found." }, { status: 404 });

  const { error } = await supabase.from("trips").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Fire audit log and schedule re-run without awaiting — deletion is already done
  logAudit({ actorId: user.id, teamId: trip.team_id, tripId: params.id, action: "trip.deleted", metadata: { guestName: trip.guest_name } });
  enqueueScheduleRun(supabase, trip.travel_date).catch(() => {});

  return NextResponse.json({ id: params.id });
}
