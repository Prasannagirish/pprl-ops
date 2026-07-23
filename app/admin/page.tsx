import { AdminDashboard } from "@/components/dashboard/AdminDashboard";
import WaveBackground from "@/components/WaveBackground";
import { AppHeaderClientWrapper } from "@/components/dashboard/AppHeaderClientWrapper";
import { listAuditLogs, listTeams, listTrips, requireAdmin } from "@/lib/supabase/queries";
import { createAdminClient } from "@/lib/supabase/admin";

async function getEventConfig(): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("event_config")
      .select("day_zero_date")
      .eq("id", 1)
      .maybeSingle();
    return data?.day_zero_date ?? null;
  } catch {
    return null;
  }
}

export default async function AdminPage() {
  const { supabase, profile } = await requireAdmin();

  // Fetch all data in parallel — previously trips, teams, audit logs, and
  // event-config were fetched serially (3 awaited in page + 1 useEffect
  // waterfall after mount). Now it's one parallel round trip.
  const [trips, teams, auditLogs, dayZeroDate] = await Promise.all([
    listTrips(supabase),
    listTeams(supabase),
    listAuditLogs(supabase),
    getEventConfig()
  ]);

  return (
    <main className="shell">
      <WaveBackground position="fixed" gap={28} baseRadius={0.9} maxLift={5} waveSpeed={0.028} waveSigma={2.6} baseAlpha={0.04} alphaJitter={0.04} maxAlpha={0.38} opacity={0.7} />
      <AppHeaderClientWrapper profile={profile} />
      <div className="page">
        <AdminDashboard
          profile={profile}
          initialTrips={trips}
          initialTeams={teams}
          auditLogs={auditLogs}
          initialDayZeroDate={dayZeroDate}
        />
      </div>
    </main>
  );
}
