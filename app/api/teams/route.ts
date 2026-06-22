import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/lib/supabase/auth";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("teams")
    .select("id, name, disabled, is_admin_team, created_at")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const response = NextResponse.json({ teams: data });
  // Teams list changes rarely — cache for 30s on the client
  response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
  return response;
}

export async function POST(request: Request) {
  const [bodyResult, ctx] = await Promise.all([
    request.json().catch(() => null),
    getAuthContext()
  ]);

  if (!ctx || ctx.profile.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const name = typeof bodyResult?.name === "string" ? bodyResult.name.trim().toUpperCase() : "";
  if (!name) return NextResponse.json({ error: "Team name is required." }, { status: 400 });

  const supabase = createClient();
  const { data, error } = await supabase.from("teams").insert({ name }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  logAudit({ actorId: ctx.userId, action: "team.created", metadata: { name } });
  return NextResponse.json({ team: data }, { status: 201 });
}
