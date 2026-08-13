import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/supabase/auth";
import { buildTripPayload, enqueueTripSync, assertTeamWritable } from "@/lib/trips/persistence";
import { tripInputSchema } from "@/lib/validations/trip";
import { logAudit } from "@/lib/audit";
import { enqueueScheduleRun } from "@/lib/scheduling/queue";
import { createAdminClient } from "@/lib/supabase/admin";

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

    // Fetch the pre-update travel_date so a date change can re-enqueue a
    // run for the *old* date too — otherwise assignment rows tied to the
    // old date are never cleaned up or re-solved once this trip leaves it.
    const { data: existing } = await supabase.from("trips").select("travel_date").eq("id", params.id).maybeSingle();
    const previousTravelDate = existing?.travel_date as string | undefined;

    const { data: updated, error } = await supabase
      .from("trips")
      .update(payload)
      .eq("id", params.id)
      .select("id")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!updated) return NextResponse.json({ error: "Trip not found." }, { status: 404 });

    // schedule_runs is admin-only under RLS, so enqueue via the admin
    // client (same as POST) rather than the session-scoped one. A failed
    // enqueue must never fail the trip write, which already succeeded.
    const adminClient = createAdminClient();
    const datesToReschedule = new Set([payload.travel_date, ...(previousTravelDate ? [previousTravelDate] : [])]);

    await Promise.all([
      enqueueTripSync(supabase, params.id),
      ...Array.from(datesToReschedule).map((date) => enqueueScheduleRun(adminClient, date).catch(() => {})),
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
  enqueueScheduleRun(createAdminClient(), trip.travel_date).catch(() => {});

  return NextResponse.json({ id: params.id });
}
