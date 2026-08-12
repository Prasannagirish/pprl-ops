"use client";

import { useEffect, useState } from "react";
import { Users, RefreshCw } from "lucide-react";
import type { Cab, Driver } from "@/types/scheduling";

type RosterRow = {
  id: string;
  driver_id: string;
  roster_date: string;
  available: boolean;
  cab_id: string | null;
  substituting_for_driver_id: string | null;
  drivers?: { full_name: string } | null;
};

export function DriverRosterPanel({ drivers, cabs }: { drivers: Driver[]; cabs: Cab[] }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/roster?date=${date}`)
      .then((r) => r.json())
      .then((body) => setRoster(body.roster || []))
      .catch(() => setRoster([]));
  }, [date]);

  async function setAvailability(driverId: string, available: boolean, cabId: string | null) {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driverId, rosterDate: date, available, cabId })
    });
    const body = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setMessage(body.error || "Failed to save roster.");
      return;
    }
    setRoster((rows) => {
      const others = rows.filter((row) => row.driver_id !== driverId);
      return [...others, body.roster];
    });
    setMessage("Roster saved — schedule will refresh shortly.");
  }

  const rosterByDriver = new Map(roster.map((row) => [row.driver_id, row]));

  return (
    <section className="panel">
      <div className="panel-header">
        <strong>
          <Users size={15} className="icon-inline" />
          Driver Roster
        </strong>
        <span className="hint">Who's available, and which cab they have, for a given date.</span>
      </div>
      <div className="panel-body stack">
        <div className="field">
          <label htmlFor="rosterDate">Date</label>
          <input id="rosterDate" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        {message && <div className="notice">{message}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th>Available</th>
                <th>Cab</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((driver) => {
                const row = rosterByDriver.get(driver.id);
                const available = row ? row.available : false;
                const cabId = row?.cab_id ?? "";
                return (
                  <tr key={driver.id}>
                    <td>{driver.full_name}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={available}
                        disabled={loading}
                        onChange={(event) => setAvailability(driver.id, event.target.checked, cabId || null)}
                      />
                    </td>
                    <td>
                      <select
                        value={cabId}
                        disabled={loading || !available}
                        onChange={(event) => setAvailability(driver.id, true, event.target.value || null)}
                      >
                        <option value="">No cab</option>
                        {cabs.map((cab) => (
                          <option key={cab.id} value={cab.id}>
                            {cab.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button className="button" type="button" onClick={() => setDate((d) => d)} disabled={loading}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
    </section>
  );
}
