import Link from "next/link";
import { redirect } from "next/navigation";
import { CarFront, Clock, RefreshCw, Users } from "lucide-react";
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
        <nav className="nav-apple">
          <div className="nav-apple-brand">
            <span className="brand-mark">PPRL</span>
            PPRL Ops
          </div>
          <div className="nav-apple-links">
            <a href="#overview">Overview</a>
            <a href="#features">Features</a>
            <a href="#scheduling">Scheduling</a>
            <a href="#teams">Teams</a>
          </div>
          <div className="nav-apple-actions">
            <ThemeToggle />
            <Link className="button pill primary" href="/login">
              Log in
            </Link>
          </div>
        </nav>
      </header>

      <section className="hero" id="overview">
        <div className="hero-copy">
          <span className="poc-badge">Pragyan · Guest travel ops</span>
          <h2>Guest travel.
            Coordinated in one place.</h2>
          <p className="hero-sub">
            Track pickups, drops, and buffer times for every guest team — synced straight to
            Google Sheets, so nothing falls through the cracks.
          </p>
          <div className="hero-cta-row">
            <Link className="button pill primary" href="/login">
              Log in to PPRL Ops
            </Link>
            <a className="button pill ghost" href="#features">
              Learn more
            </a>
          </div>
        </div>

        {/* A banner in normal document flow, not a page-wide backdrop --
            the sections below sit after it, not on top of it. */}
        <div className="ascii-banner" aria-hidden="true">
          {/* next/image runs SVGs through its optimizer, which strips the
              SMIL <animate> tags that make this type itself in -- a plain
              <img> is what keeps the animation intact. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ascii/pprl-hero.svg" alt="" width={948} height={745} />
        </div>
      </section>

      <section className="product-section tone-b" id="features">
        <div className="product-section-inner">
          <p className="product-eyebrow">Buffer calculations</p>
          <h3>Never miscalculate a pickup window again.</h3>
          <p>
            Pickup and drop buffers are worked out automatically from each guest&apos;s flight or
            train time — no spreadsheet math, no guesswork.
          </p>
          <div className="product-visual">
            <Clock size={56} strokeWidth={1.25} />
          </div>
        </div>
      </section>

      <section className="product-section tone-a">
        <div className="product-section-inner">
          <p className="product-eyebrow">Google Sheets sync</p>
          <h3>Always synced. Never re-entered.</h3>
          <p>
            Every update reaches your team&apos;s sheet on its own — tab by tab, day by day —
            so the sheet you already share with volunteers stays the source of truth.
          </p>
          <div className="product-visual">
            <RefreshCw size={56} strokeWidth={1.25} />
          </div>
        </div>
      </section>

      <section className="product-section tone-b" id="scheduling">
        <div className="product-section-inner">
          <p className="product-eyebrow">Driver &amp; cab scheduling</p>
          <h3>Every trip, matched to a driver automatically.</h3>
          <p>
            A solver assigns drivers and cabs to each day&apos;s trips from the roster you keep,
            with manual override whenever a human call beats the algorithm.
          </p>
          <div className="product-visual">
            <CarFront size={56} strokeWidth={1.25} />
          </div>
        </div>
      </section>

      <section className="product-section tone-a" id="teams">
        <div className="product-section-inner">
          <p className="product-eyebrow">Team access codes</p>
          <h3>One code per team. Zero accounts to manage.</h3>
          <p>
            Give each guest-facing team one shared code and PIN — every POC can log in without a
            personal account to create or reset.
          </p>
          <div className="product-visual">
            <Users size={56} strokeWidth={1.25} />
          </div>
        </div>
      </section>

      <section className="cta-band">
        <h3>Ready to coordinate travel for Pragyan?</h3>
        <div className="hero-cta-row">
          <Link className="button pill primary" href="/login">
            Log in to PPRL Ops
          </Link>
        </div>
      </section>

      <footer className="site-footer">
        <div className="footer-sitemap">
          <div className="footer-col">
            <h4>Product</h4>
            <ul>
              <li><a href="#overview">Overview</a></li>
              <li><a href="#features">Buffer calculations</a></li>
              <li><a href="#features">Sheets sync</a></li>
              <li><a href="#scheduling">Driver scheduling</a></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>Teams</h4>
            <ul>
              <li><a href="#teams">Access codes</a></li>
              <li><a href="/login">Team log in</a></li>
              <li><a href="/login">Admin log in</a></li>
            </ul>
          </div>
          <div className="footer-col">
            <h4>About</h4>
            <ul>
              <li><a href="#overview">Pragyan</a></li>
              <li><a href="#overview">Guest travel ops</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-legal">
          <span>
            Made with <span className="footer-heart">❤️</span> by PPRL
          </span>
          <span>PPRL Ops — internal tool for Pragyan guest logistics.</span>
        </div>
      </footer>
    </main>
  );
}
