import { AppHeaderClientWrapper } from "@/components/dashboard/AppHeaderClientWrapper";
import { TeamDashboard } from "@/components/dashboard/TeamDashboard";
import { listTeams, listTrips, requireSession } from "@/lib/supabase/queries";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const { supabase, profile } = await requireSession();

  if (profile.role === "admin") redirect("/admin");

  // Fetch trips and teams in parallel
  const [trips, teams] = await Promise.all([listTrips(supabase), listTeams(supabase)]);

  return (
    <main className="shell">
      <AppHeaderClientWrapper profile={profile} />
      <div className="page">
        <TeamDashboard profile={profile} initialTrips={trips} teams={teams} />
      </div>
    </main>
  );
}
