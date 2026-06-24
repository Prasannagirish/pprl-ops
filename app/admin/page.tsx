import { AdminDashboard } from "@/components/dashboard/AdminDashboard";
import DashboardWave from "@/components/DashboardWave";
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
      <DashboardWave />
      <AppHeaderClientWrapper profile={profile} />
      <div className="page">
        <AdminDashboard
          initialTrips={trips}
          initialTeams={teams}
          auditLogs={auditLogs}
          initialDayZeroDate={dayZeroDate}
        />
      </div>
    </main>
  );
}
