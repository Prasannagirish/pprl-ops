import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/supabase/auth";
import { logAudit } from "@/lib/audit";

async function requireAdmin() {
  const ctx = await getAuthContext();
  return ctx?.profile.role === "admin" ? ctx : null;
}

export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("event_config").select("day_zero_date").eq("id", 1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ dayZeroDate: data?.day_zero_date ?? null });
}

export async function PATCH(request: Request) {
  const [bodyResult, ctx] = await Promise.all([
    request.json().catch(() => null),
    requireAdmin()
  ]);

  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const dayZeroDate = bodyResult?.dayZeroDate;
  if (typeof dayZeroDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dayZeroDate)) {
    return NextResponse.json({ error: "dayZeroDate must be an ISO date (YYYY-MM-DD)." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("event_config").upsert({ id: 1, day_zero_date: dayZeroDate }, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Re-queue any trips that were permanently FAILED solely because Day 0
  // hadn't been configured yet. Now that it's set they should sync cleanly
  // on the next worker run, so reset them to PENDING rather than leaving
  // them stuck in a terminal state.
  const DAY_ZERO_ERROR_FRAGMENT = "Day 0 hasn";
  const { data: stalledItems } = await admin
    .from("sync_queue")
    .select("id, trip_id")
    .eq("status", "FAILED")
    .like("error_message", `%${DAY_ZERO_ERROR_FRAGMENT}%`);

  if (stalledItems && stalledItems.length > 0) {
    const queueIds = stalledItems.map((r) => r.id);
    const tripIds  = stalledItems.map((r) => r.trip_id);
    await Promise.all([
      admin
        .from("sync_queue")
        .update({ status: "PENDING", attempts: 0, error_message: null, run_after: new Date().toISOString() })
        .in("id", queueIds),
      admin.from("trips").update({ sync_status: "PENDING" }).in("id", tripIds)
    ]);
  }

  logAudit({ actorId: ctx.userId, action: "event_config.day_zero_date_updated", metadata: { dayZeroDate } });

  return NextResponse.json({ dayZeroDate });
}