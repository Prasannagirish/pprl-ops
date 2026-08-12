/**
 * GET  /api/drivers  – list drivers and cabs (admin only)
 * POST /api/drivers  – create a driver (admin only)
 *
 * Cabs are seeded/managed the same way as drivers but through the same
 * route with a `type` field, since both are simple named resources with
 * no extra behavior of their own.
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

export async function GET() {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = createAdminClient();
  const [drivers, cabs] = await Promise.all([
    supabase.from("drivers").select("id, full_name, phone, active").order("full_name"),
    supabase.from("cabs").select("id, label, active").order("label")
  ]);

  if (drivers.error) return NextResponse.json({ error: drivers.error.message }, { status: 400 });
  if (cabs.error) return NextResponse.json({ error: cabs.error.message }, { status: 400 });

  return NextResponse.json({ drivers: drivers.data, cabs: cabs.data });
}

export async function POST(request: Request) {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.fullName) {
    return NextResponse.json({ error: "fullName is required." }, { status: 400 });
  }

  const supabase = createAdminClient();

  if (body.kind === "cab") {
    const { data, error } = await supabase.from("cabs").insert({ label: body.fullName }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ cab: data }, { status: 201 });
  }

  const { data, error } = await supabase
    .from("drivers")
    .insert({ full_name: body.fullName, phone: body.phone || null })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ driver: data }, { status: 201 });
}
