/**
 * GET  /api/team-access        – list all access code records (admin only)
 * POST /api/team-access        – set/update PIN + shared email for a team (admin only)
 *
 * Body: { teamId: string, pin: string, sharedEmail: string, label?: string }
 *
 * "sharedEmail" is the email of the dedicated Supabase Auth user for that
 * team. The admin creates it once in the Supabase dashboard (e.g.
 * team-tc@pprl.internal) with role=team in profiles, then registers it
 * here. From then on, all POCs access it via PIN — no one needs to know
 * the email or password.
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

async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(pin));
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

export async function GET() {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("team_access_codes")
    .select("id, team_id, label, enabled, shared_email, created_at, updated_at, teams(name)")
    .order("created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ codes: data });
}

export async function POST(request: Request) {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.teamId || !body?.pin || !body?.sharedEmail) {
    return NextResponse.json({ error: "teamId, pin, and sharedEmail are required." }, { status: 400 });
  }

  const codeHash = await hashPin(body.pin);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("team_access_codes")
    .upsert(
      {
        team_id: body.teamId,
        code_hash: codeHash,
        shared_email: body.sharedEmail,
        label: body.label || "Shared access",
        enabled: true
      },
      { onConflict: "team_id" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ code: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.teamId) return NextResponse.json({ error: "teamId is required." }, { status: 400 });

  const supabase = createAdminClient();
  const updates: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
  if (body.pin) updates.code_hash = await hashPin(body.pin);

  const { data, error } = await supabase
    .from("team_access_codes")
    .update(updates)
    .eq("team_id", body.teamId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ code: data });
}
