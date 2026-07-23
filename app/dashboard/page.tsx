import { AppHeaderClientWrapper } from "@/components/dashboard/AppHeaderClientWrapper";
import WaveBackground from "@/components/WaveBackground";
import { TeamDashboard } from "@/components/dashboard/TeamDashboard";
import { listTeams, listTrips, requireSession } from "@/lib/supabase/queries";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const { supabase, profile } = await requireSession();

  // Defensive fallback only -- normal logins now route admins straight to
  // /admin from login/page.tsx before ever navigating here. This still
  // catches an admin landing on /dashboard directly (bookmark, typed URL,
  // back button) without bouncing through a half-rendered loading state.
  if (profile.role === "admin") redirect("/admin");

  // Fetch trips and teams in parallel
  const [trips, teams] = await Promise.all([listTrips(supabase), listTeams(supabase)]);

  return (
    <main className="shell">
      <WaveBackground position="fixed" gap={28} baseRadius={0.9} maxLift={5} waveSpeed={0.028} waveSigma={2.6} baseAlpha={0.04} alphaJitter={0.04} maxAlpha={0.38} opacity={0.7} />
      <AppHeaderClientWrapper profile={profile} />
      <div className="page">
        <TeamDashboard profile={profile} initialTrips={trips} teams={teams} />
      </div>
    </main>
  );
}
