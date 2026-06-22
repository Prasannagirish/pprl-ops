"use client";

import { useMemo, useState } from "react";
import { Download, Plus, RefreshCcw, ToggleLeft, ToggleRight } from "lucide-react";
import { AnalyticsCards } from "@/components/dashboard/AnalyticsCards";
import { TeamAccessPanel } from "@/components/dashboard/TeamAccessPanel";
import { TripForm } from "@/components/forms/TripForm";
import { TripTable } from "@/components/tables/TripTable";
import { useTripsRealtime } from "@/lib/supabase/useTripsRealtime";
import type { AuditLog, Direction, LocationType, SyncStatus, Team, Trip } from "@/types/trip";

type AdminDashboardProps = {
  initialTrips: Trip[];
  initialTeams: Team[];
  auditLogs: AuditLog[];
  initialDayZeroDate: string | null;
};

type Filters = {
  teamId: string;
  direction: "" | Direction;
  locationType: "" | LocationType;
  syncStatus: "" | SyncStatus;
  from: string;
  to: string;
};

const emptyFilters: Filters = {
  teamId: "",
  direction: "",
  locationType: "",
  syncStatus: "",
  from: "",
  to: ""
};

export function AdminDashboard({ initialTrips, initialTeams, auditLogs, initialDayZeroDate }: AdminDashboardProps) {
  const [trips, setTrips] = useState(initialTrips);
  const [teams, setTeams] = useState(initialTeams);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [editing, setEditing] = useState<Trip | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [message, setMessage] = useState("");
  const [dayZeroDate, setDayZeroDate] = useState(initialDayZeroDate || "");
  const [dayZeroInput, setDayZeroInput] = useState(initialDayZeroDate || "");
  const [dayZeroMessage, setDayZeroMessage] = useState("");

  async function saveDayZeroDate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDayZeroMessage("");
    const response = await fetch("/api/event-config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dayZeroDate: dayZeroInput })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setDayZeroMessage(typeof body.error === "string" ? body.error : "Unable to save Day 0 date.");
      return;
    }
    setDayZeroDate(body.dayZeroDate);
    setDayZeroMessage("Saved. Trips will segregate into Day -1 through Day 3 tabs on next sync.");
  }

  const filteredTrips = useMemo(() => {
    return trips.filter((trip) => {
      if (filters.teamId && trip.team_id !== filters.teamId) return false;
      if (filters.direction && trip.direction !== filters.direction) return false;
      if (filters.locationType && trip.location_type !== filters.locationType) return false;
      if (filters.syncStatus && trip.sync_status !== filters.syncStatus) return false;
      if (filters.from && trip.travel_date < filters.from) return false;
      if (filters.to && trip.travel_date > filters.to) return false;
      return true;
    });
  }, [filters, trips]);

  const operationalTeams = useMemo(() => teams.filter((team) => !team.is_admin_team), [teams]);
  const adminTeams = useMemo(() => teams.filter((team) => team.is_admin_team), [teams]);

  useTripsRealtime(teams, {
    onInsert: (trip) => setTrips((current) => (current.some((item) => item.id === trip.id) ? current : [...current, trip])),
    onUpdate: (trip) => setTrips((current) => current.map((item) => (item.id === trip.id ? trip : item))),
    onDelete: (id) => setTrips((current) => current.filter((item) => item.id !== id))
  });

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function closeModal() {
    setIsCreating(false);
    setEditing(null);
  }

  async function createTeam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: teamName })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(typeof body.error === "string" ? body.error : "Unable to create team.");
      return;
    }
    setTeams((current) => [...current, body.team].sort((a, b) => a.name.localeCompare(b.name)));
    setTeamName("");
    setMessage("Team created.");
  }

  async function forceSync() {
    setMessage("Syncing pending rows.");
    const response = await fetch("/api/sync", { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(typeof body.error === "string" ? body.error : "Sync failed.");
      return;
    }

    // Re-fetch trips immediately so sync_status reflects what the worker
    // just wrote. Realtime propagates the same changes eventually, but the
    // admin pressed Force Sync and expects the table to update right now --
    // not whenever the CDC broadcast happens to arrive.
    const tripsRes = await fetch("/api/trips");
    if (tripsRes.ok) {
      const tripsBody = await tripsRes.json().catch(() => ({}));
      if (Array.isArray(tripsBody.trips)) {
        setTrips(tripsBody.trips);
      }
    }

    setMessage(`Processed ${body.processed || 0} queue items.`);
  }

  async function toggleTeam(team: Team) {
    setMessage("");
    const response = await fetch(`/api/teams/${team.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: !team.disabled })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(typeof body.error === "string" ? body.error : "Unable to update team.");
      return;
    }
    setTeams((current) => current.map((item) => (item.id === team.id ? body.team : item)));
  }

  function exportCsv() {
    const header = [
      "Team",
      "Guest Name",
      "Designation",
      "Travel Date",
      "Direction",
      "Location Type",
      "Pickup Location",
      "Drop Location",
      "POC Name",
      "POC Contact",
      "Status"
    ];
    const rows = filteredTrips.map((trip) => [
      trip.teams?.name || trip.team_id,
      trip.guest_name,
      trip.guest_designation || "",
      trip.travel_date,
      trip.direction,
      trip.location_type,
      trip.pickup_location,
      trip.drop_location,
      trip.poc_name,
      trip.poc_contact,
      trip.sync_status
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "pprl-ops-trips.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <section className="toolbar">
        <div>
          <h2>PPRL Admin Dashboard</h2>
          <p>Global operations, analytics, team management, and sync control.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="button" onClick={exportCsv} type="button">
            <Download size={16} />
            Export CSV
          </button>
          <button className="button" onClick={forceSync} type="button">
            <RefreshCcw size={16} />
            Force Sync
          </button>
          <button className="button primary" onClick={() => setIsCreating(true)} type="button">
            <Plus size={16} />
            New Trip
          </button>
        </div>
      </section>

      <AnalyticsCards trips={trips} />

      <section className="grid" style={{ gridTemplateColumns: "minmax(260px, 360px) 1fr", alignItems: "start" }}>
        <aside className="panel">
          <div className="panel-header">
            <strong>Admin Actions</strong>
          </div>
          <div className="panel-body grid">
            <form className="grid" onSubmit={saveDayZeroDate}>
              <div className="field">
                <label htmlFor="dayZeroDate">Pragyan Day 0 date</label>
                <input
                  id="dayZeroDate"
                  type="date"
                  value={dayZeroInput}
                  onChange={(event) => setDayZeroInput(event.target.value)}
                  required
                />
              </div>
              <button className="button primary" type="submit">
                Save Day 0
              </button>
              <p style={{ fontSize: 13, opacity: 0.7 }}>
                {dayZeroDate
                  ? `Currently set to ${dayZeroDate}. Trips on this date sync to "Day 0", the next day to "Day 1", and so on through Day 3.`
                  : "Not set yet -- sync will fail until this is saved."}
              </p>
              {dayZeroMessage ? <div className="notice">{dayZeroMessage}</div> : null}
            </form>
            <form className="grid" onSubmit={createTeam}>
              <div className="field">
                <label htmlFor="teamName">Create Team</label>
                <input id="teamName" value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Team A" />
              </div>
              <button className="button primary" type="submit">
                <Plus size={16} />
                Create Team
              </button>
            </form>
            <div className="grid">
              {operationalTeams.map((team) => (
                <button className="button" key={team.id} onClick={() => toggleTeam(team)} type="button">
                  {team.disabled ? <ToggleLeft size={16} /> : <ToggleRight size={16} />}
                  {team.disabled ? `Enable ${team.name}` : `Disable ${team.name}`}
                </button>
              ))}
            </div>
            {adminTeams.length ? (
              <p style={{ fontSize: 13, opacity: 0.7 }}>
                Admin team{adminTeams.length > 1 ? "s" : ""}: {adminTeams.map((team) => team.name).join(", ")} (global
                access, not shown in trip filters).
              </p>
            ) : null}
            {message ? <div className="notice">{message}</div> : null}
          </div>
        </aside>

        <section className="panel">
          <div className="panel-header">
            <div className="filters">
              <div className="field">
                <label htmlFor="filterTeam">Team</label>
                <select id="filterTeam" value={filters.teamId} onChange={(event) => setFilter("teamId", event.target.value)}>
                  <option value="">All Teams</option>
                  {operationalTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="filterFrom">From</label>
                <input id="filterFrom" type="date" value={filters.from} onChange={(event) => setFilter("from", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="filterTo">To</label>
                <input id="filterTo" type="date" value={filters.to} onChange={(event) => setFilter("to", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="filterLocation">Location Type</label>
                <select
                  id="filterLocation"
                  value={filters.locationType}
                  onChange={(event) => setFilter("locationType", event.target.value as Filters["locationType"])}
                >
                  <option value="">All</option>
                  <option value="AIRPORT">Airport</option>
                  <option value="RAILWAY">Railway</option>
                  <option value="BUS_STAND">Bus Stand</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="filterDirection">Direction</label>
                <select
                  id="filterDirection"
                  value={filters.direction}
                  onChange={(event) => setFilter("direction", event.target.value as Filters["direction"])}
                >
                  <option value="">All</option>
                  <option value="TO_CAMPUS">To Campus</option>
                  <option value="FROM_CAMPUS">From Campus</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="filterSync">Sync Status</label>
                <select
                  id="filterSync"
                  value={filters.syncStatus}
                  onChange={(event) => setFilter("syncStatus", event.target.value as Filters["syncStatus"])}
                >
                  <option value="">All</option>
                  <option value="PENDING">Pending</option>
                  <option value="SYNCED">Synced</option>
                  <option value="FAILED">Failed</option>
                </select>
              </div>
            </div>
          </div>
          <TripTable
            trips={filteredTrips}
            onEdit={setEditing}
            onDeleted={(id) => setTrips((current) => current.filter((trip) => trip.id !== id))}
          />
        </section>
      </section>

      <TeamAccessPanel teams={teams} />

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel-header">
          <strong>Audit Logs</strong>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Team</th>
                <th>Trip</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td>{new Date(log.created_at).toLocaleString("en-IN")}</td>
                  <td>{log.action}</td>
                  <td>{log.team_id || ""}</td>
                  <td>{log.trip_id || ""}</td>
                  <td>{JSON.stringify(log.metadata)}</td>
                </tr>
              ))}
              {!auditLogs.length ? (
                <tr>
                  <td colSpan={5}>No audit events yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {isCreating || editing ? (
        <div className="modal-backdrop">
          <section className="panel modal">
            <div className="panel-header">
              <strong>{editing ? "Edit Trip" : "Create Trip"}</strong>
            </div>
            <div className="panel-body">
              <TripForm
                teams={operationalTeams}
                role="admin"
                initialTrip={editing}
                onCancel={closeModal}
                onSaved={closeModal}
              />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}