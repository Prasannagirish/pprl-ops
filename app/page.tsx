import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, RefreshCw, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function Home() {
  // Signed-in visitors skip the pitch and go straight back to work.
  // dashboard/page.tsx already has the admin-role fallback, so this
  // doesn't need to duplicate that check.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = createClient();
    const {
      data: { session }
    } = await supabase.auth.getSession();
    if (session?.user) redirect("/dashboard");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">PPRL</span>
          <div>
            <h1>PPRL Ops</h1>
            <p>Guest travel coordination</p>
          </div>
        </div>
        <nav>
          <Link className="button primary" href="/login">
            Log in
          </Link>
          <ThemeToggle />
        </nav>
      </header>

      {/* A banner in normal document flow, not a page-wide backdrop -- the
          copy below sits after it, not on top of it. */}
      <div className="ascii-banner" aria-hidden="true">
        {/* next/image runs SVGs through its optimizer, which strips the
            SMIL <animate> tags that make this type itself in -- a plain
            <img> is what keeps the animation intact. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ascii/pprl-hero.svg" alt="" width={948} height={745} />
      </div>

      <section className="hero">
        <div className="hero-copy">
          <span className="poc-badge">Pragyan · Guest travel ops</span>
          <h2>Guest travel, coordinated in one place.</h2>
          <p className="hint hero-sub">
            Track pickups, drops, and buffer times for every guest team — synced straight to
            Google Sheets, so nothing falls through the cracks.
          </p>
          <Link className="button primary" href="/login">
            Log in to PPRL Ops
          </Link>
        </div>
      </section>

      <section className="landing-features">
        <div className="panel">
          <div className="panel-body landing-feature">
            <Clock size={18} />
            <h3>Buffer calculations</h3>
            <p className="hint">
              Pickup and drop buffers are worked out automatically from each guest&apos;s flight
              time.
            </p>
          </div>
        </div>
        <div className="panel">
          <div className="panel-body landing-feature">
            <RefreshCw size={18} />
            <h3>Google Sheets sync</h3>
            <p className="hint">Every update reaches your team&apos;s sheet on its own, tab by tab, day by day.</p>
          </div>
        </div>
        <div className="panel">
          <div className="panel-body landing-feature">
            <Users size={18} />
            <h3>Team access codes</h3>
            <p className="hint">Give each team one shared code and PIN — no separate accounts to manage.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
