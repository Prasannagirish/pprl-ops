"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type Tab = "personal" | "team";

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("personal");

  // ── Personal login state ─────────────────────────────────────
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // ── Team access state ────────────────────────────────────────
  const [teamCode, setTeamCode] = useState("");
  const [pin, setPin] = useState("");
  const [pocName, setPocName] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "missing-profile") setError("Profile not found.");
    if (params.get("error") === "missing-env")
      setError("Add Supabase values to .env.local, then restart the dev server.");
  }, []);

  // ── Personal login ────────────────────────────────────────────
  async function onPersonalSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) { setError(authError.message); return; }
    router.replace("/dashboard");
    router.refresh();
  }

  // ── Team access login ─────────────────────────────────────────
  async function onTeamSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pocName.trim()) { setError("Please enter your name so the team knows who added each trip."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/team-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamCode: teamCode.trim().toUpperCase(), pin, pocName: pocName.trim() })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Invalid team code or PIN.");
        setLoading(false);
        return;
      }
      // Team login returns a Supabase session via signInWithPassword on the
      // shared team auth user — set it in the browser client.
      const supabase = createClient();
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token
      });
      if (sessionError) { setError(sessionError.message); setLoading(false); return; }
      // Store the POC label in sessionStorage so the header can show it.
      sessionStorage.setItem("poc_label", pocName.trim());
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="panel login-panel">
        <div className="panel-body">
          <div className="brand" style={{ marginBottom: 28 }}>
            <span className="brand-mark">PPRL</span>
            <div>
              <h1>PPRL Ops</h1>
              <p>Secure team operations console</p>
            </div>
          </div>

          {/* ── Tabs ── */}
          <div className="login-tabs">
            <button
              className={`login-tab${tab === "personal" ? " active" : ""}`}
              type="button"
              onClick={() => { setTab("personal"); setError(""); }}
            >
              Personal login
            </button>
            <button
              className={`login-tab${tab === "team" ? " active" : ""}`}
              type="button"
              onClick={() => { setTab("team"); setError(""); }}
            >
              Team access
            </button>
          </div>

          {/* ── Personal login ── */}
          {tab === "personal" && (
            <form className="grid" onSubmit={onPersonalSubmit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  autoComplete="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  autoComplete="current-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && <div className="error">{error}</div>}
              <button className="button primary" disabled={loading} type="submit">
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}

          {/* ── Team access ── */}
          {tab === "team" && (
            <form className="grid" onSubmit={onTeamSubmit}>
              <p style={{ margin: 0, fontSize: 13, color: "#5f6d64" }}>
                All POCs of a team share one access code + PIN. No personal account needed.
              </p>
              <div className="field">
                <label htmlFor="teamCode">Team Code</label>
                <input
                  id="teamCode"
                  placeholder="e.g. TC"
                  value={teamCode}
                  onChange={(e) => setTeamCode(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="pin">Team PIN</label>
                <input
                  id="pin"
                  type="password"
                  placeholder="Set by admin"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="pocName">Your Name (POC)</label>
                <input
                  id="pocName"
                  placeholder="e.g. Devansh"
                  value={pocName}
                  onChange={(e) => setPocName(e.target.value)}
                  required
                />
              </div>
              {error && <div className="error">{error}</div>}
              <button className="button primary" disabled={loading} type="submit">
                {loading ? "Verifying…" : "Access Team Dashboard"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
