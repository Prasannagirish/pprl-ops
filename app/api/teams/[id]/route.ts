import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthContext } from "@/lib/supabase/auth";
import { logAudit } from "@/lib/audit";

type Params = { params: { id: string } };

export async function PATCH(request: Request, { params }: Params) {
  const [bodyResult, ctx] = await Promise.all([
    request.json().catch(() => null),
    getAuthContext()
  ]);

  if (!ctx || ctx.profile.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data: existing, error: fetchError } = await supabase
    .from("teams")
    .select("is_admin_team")
    .eq("id", params.id)
    .maybeSingle();

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 400 });
  if (!existing) return NextResponse.json({ error: "Team not found." }, { status: 404 });
  if (existing.is_admin_team) return NextResponse.json({ error: "The PPRL admin team cannot be disabled." }, { status: 400 });

  const { data, error } = await supabase
    .from("teams")
    .update({ disabled: Boolean(bodyResult?.disabled) })
    .eq("id", params.id)
    .select("id, name, disabled, is_admin_team, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  logAudit({ actorId: ctx.userId, teamId: data.id, action: data.disabled ? "team.disabled" : "team.enabled", metadata: { name: data.name } });

  return NextResponse.json({ team: data });
}
