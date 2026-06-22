"use client";

/**
 * TeamAccessPanel – Admin UI for managing team PIN access codes.
 *
 * For each operational team, the admin can:
 *  - Create / reset the shared PIN
 *  - Supply the shared Supabase Auth email for that team
 *  - Enable / disable the access code
 *
 * Once set, all POCs for that team can log in from the "Team access" tab
 * on the login page using Team Code + PIN — no individual accounts needed.
 */

import { useEffect, useState } from "react";
import { KeyRound, ToggleLeft, ToggleRight, RefreshCw } from "lucide-react";
import type { Team } from "@/types/trip";

type CodeRecord = {
  id: string;
  team_id: string;
  label: string;
  enabled: boolean;
  shared_email: string;
  teams?: { name: string } | null;
};

export function TeamAccessPanel({ teams }: { teams: Team[] }) {
  const [codes, setCodes] = useState<CodeRecord[]>([]);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ teamId: "", pin: "", confirmPin: "", sharedEmail: "", label: "Shared access" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/team-access")
      .then((r) => r.json())
      .then((d) => { if (d.codes) setCodes(d.codes); })
      .catch(() => {});
  }, []);

  const operationalTeams = teams.filter((t) => !t.is_admin_team);

  async function setCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.pin !== form.confirmPin) { setMessage("PINs do not match."); return; }
    if (form.pin.length < 4) { setMessage("PIN must be at least 4 characters."); return; }
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/team-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: form.teamId, pin: form.pin, sharedEmail: form.sharedEmail, label: form.label })
    });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setMessage(body.error || "Failed."); return; }
    setCodes((c) => {
      const exists = c.find((x) => x.team_id === form.teamId);
      return exists
        ? c.map((x) => (x.team_id === form.teamId ? body.code : x))
        : [...c, body.code];
    });
    setMessage("Access code saved. POCs can now log in with the team code + PIN.");
    setForm((f) => ({ ...f, pin: "", confirmPin: "" }));
  }

  async function toggleCode(teamId: string, enabled: boolean) {
    const res = await fetch("/api/team-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId, enabled: !enabled })
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setCodes((c) => c.map((x) => (x.team_id === teamId ? body.code : x)));
    else setMessage(body.error || "Failed.");
  }

  return (
    <section className="panel" style={{ marginTop: 18 }}>
      <div className="panel-header">
        <strong>
          <KeyRound size={15} style={{ verticalAlign: "middle", marginRight: 6 }} />
          Team Access Codes
        </strong>
        <span style={{ fontSize: 13, color: "var(--mist)" }}>
          All POCs share one PIN per team — no individual accounts needed.
        </span>
      </div>
      <div className="panel-body grid" style={{ gridTemplateColumns: "minmax(280px, 380px) 1fr", gap: 24, alignItems: "start" }}>
        {/* ── Set / reset code form ── */}
        <form className="grid" onSubmit={setCode}>
          <div className="field">
            <label htmlFor="acTeam">Team</label>
            <select id="acTeam" value={form.teamId} onChange={(e) => setForm((f) => ({ ...f, teamId: e.target.value }))} required>
              <option value="">Select team…</option>
              {operationalTeams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="acEmail">
              Shared Auth Email
              <span style={{ fontWeight: 400, marginLeft: 4, color: "var(--mist)" }}>(Supabase Auth user for this team)</span>
            </label>
            <input
              id="acEmail"
              type="email"
              placeholder="team-tc@pprl.internal"
              value={form.sharedEmail}
              onChange={(e) => setForm((f) => ({ ...f, sharedEmail: e.target.value }))}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="acPin">New PIN</label>
            <input
              id="acPin"
              type="password"
              placeholder="Min. 4 characters"
              value={form.pin}
              onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="acConfirm">Confirm PIN</label>
            <input
              id="acConfirm"
              type="password"
              placeholder="Re-enter PIN"
              value={form.confirmPin}
              onChange={(e) => setForm((f) => ({ ...f, confirmPin: e.target.value }))}
              required
            />
          </div>
          {message && <div className="notice">{message}</div>}
          <button className="button primary" type="submit" disabled={loading}>
            <RefreshCw size={15} />
            {loading ? "Saving…" : "Set / Reset PIN"}
          </button>
        </form>

        {/* ── Current codes table ── */}
        <div className="table-wrap">
          {codes.length === 0 ? (
            <p style={{ color: "var(--mist)", fontSize: 14 }}>No access codes set yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Shared email</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{operationalTeams.find((t) => t.id === c.team_id)?.name ?? c.team_id}</strong>
                    </td>
                    <td style={{ fontSize: 13, color: "var(--mist)" }}>{c.shared_email}</td>
                    <td>
                      <span className={`status ${c.enabled ? "synced" : "failed"}`}>
                        {c.enabled ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="button"
                        type="button"
                        style={{ fontSize: 13 }}
                        onClick={() => toggleCode(c.team_id, c.enabled)}
                      >
                        {c.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                        {c.enabled ? "Disable" : "Enable"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
