import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { AuditLog, Profile, Team, Trip } from "@/types/trip";

export async function getProfile(supabase: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, team_id, role, full_name, email")
    .eq("id", userId)
    .single();

  if (error) return null;
  return data as Profile;
}

export async function requireSession() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    redirect("/login?error=missing-env");
  }

  const supabase = createClient();

  // middleware.ts already called getUser() for this request, which hits
  // Supabase's Auth server to validate the JWT and refreshes the cookie if
  // needed. That's the expensive, network round-trip call. By the time we
  // get here the cookie is already verified, so getSession() (a local JWT
  // decode, no network call) is enough -- calling getUser() again here was
  // paying for the same verification twice on every single page load.
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.user) redirect("/login");

  const profile = await getProfile(supabase, session.user.id);
  if (!profile) redirect("/login?error=missing-profile");

  return { supabase, user: session.user, profile };
}

export async function requireAdmin() {
  const session = await requireSession();
  if (session.profile.role !== "admin") redirect("/dashboard");
  return session;
}

const TRIP_SELECT =
  "id, team_id, guest_name, guest_designation, travel_date, direction, location_type, pickup_location, drop_location, flight_time, pickup_time, drop_time, poc_name, poc_contact, guest_buffer_time, poc_buffer_time, corrected_drop_time, sync_status, gsheet_row_id, created_at, updated_at, teams(id, name)";

function normaliseTrips(data: unknown[]): Trip[] {
  return data.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      ...r,
      teams: Array.isArray(r.teams) ? r.teams[0] ?? null : r.teams ?? null
    } as unknown as Trip;
  });
}

export async function listTrips(supabase: SupabaseClient): Promise<Trip[]> {
  const { data, error } = await supabase
    .from("trips")
    .select(TRIP_SELECT)
    .order("travel_date", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return normaliseTrips(data || []);
}

export async function listTeams(supabase: SupabaseClient): Promise<Team[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, disabled, is_admin_team, created_at")
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []) as Team[];
}

export async function listAuditLogs(supabase: SupabaseClient): Promise<AuditLog[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, actor_id, team_id, trip_id, action, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return (data || []) as AuditLog[];
}
