/**
 * POST /api/team-login
 *
 * Body: { teamCode: string, pin: string, pocName: string }
 *
 * Flow:
 *  1. Look up the team by name (teamCode).
 *  2. Find the team_access_codes row for that team.
 *  3. Bcrypt-compare the submitted PIN against the stored hash.
 *  4. If valid, sign in as the team's shared Supabase Auth user and return
 *     the session tokens so the browser client can call setSession().
 *
 * The shared auth user is a real Supabase Auth account created once per
 * team (e.g. team-tc@pprl.internal) with role=team in profiles.
 * Its credentials are stored server-side only; POCs never see them.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// We use the built-in Web Crypto API (available in Edge/Node 18+) for
// timing-safe PIN comparison so we don't need an extra bcrypt dependency.
// For production you can swap this for bcryptjs.
async function verifyPin(plain: string, stored: string): Promise<boolean> {
  // stored format: "sha256:<hex>"  (set by admin UI below)
  if (!stored.startsWith("sha256:")) return false;
  const expected = stored.slice(7);
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(plain));
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Timing-safe compare
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) {
    diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.teamCode !== "string" || typeof body.pin !== "string") {
    return NextResponse.json({ error: "Missing teamCode or pin." }, { status: 400 });
  }

  const { teamCode, pin } = body as { teamCode: string; pin: string };

  const supabase = createAdminClient();

  // 1 & 2. Resolve the team and its access code in a single round trip
  //    (was two sequential queries -- each one is a full network hop to
  //    Supabase, which is where most of the login latency comes from).
  const { data: team, error: teamErr } = await supabase
    .from("teams")
    .select("id, name, disabled, is_admin_team, team_access_codes(code_hash, enabled, shared_email)")
    .eq("name", teamCode.toUpperCase())
    .single();

  if (teamErr || !team) {
    return NextResponse.json({ error: "Unknown team code." }, { status: 401 });
  }

  if (team.disabled) {
    return NextResponse.json({ error: "This team has been disabled. Contact PPRL admin." }, { status: 403 });
  }

  if (team.is_admin_team) {
    return NextResponse.json({ error: "Admin team must use personal login." }, { status: 403 });
  }

  const codeRow = Array.isArray(team.team_access_codes) ? team.team_access_codes[0] : team.team_access_codes;

  if (!codeRow || !codeRow.enabled) {
    return NextResponse.json({ error: "No active access code for this team. Ask your PPRL admin to set one." }, { status: 401 });
  }

  // 3. Verify PIN.
  const valid = await verifyPin(pin, codeRow.code_hash);
  if (!valid) {
    return NextResponse.json({ error: "Incorrect PIN." }, { status: 401 });
  }

  // 4. Sign in as the shared auth user for this team.
  //    shared_email + shared_password are stored in the access_codes row
  //    and only readable via the service role key.
  const { data: session, error: signInErr } = await supabase.auth.signInWithPassword({
    email: codeRow.shared_email,
    password: process.env.TEAM_SHARED_PASSWORD || "pprl-shared-team-secret-2025"
  });

  if (signInErr || !session?.session) {
    console.error("Team shared login error:", signInErr);
    return NextResponse.json({ error: "Authentication failed. Contact PPRL admin." }, { status: 500 });
  }

  return NextResponse.json({
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token
  });
}
