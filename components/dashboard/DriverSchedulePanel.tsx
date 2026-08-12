"use client";

import { useEffect, useState } from "react";
import { CalendarClock, AlertTriangle } from "lucide-react";
import type { Driver } from "@/types/scheduling";

type TripRow = {
  id: string;
  guest_name: string;
  direction: string;
  pickup_time: string | null;
  drop_time: string | null;
  drivers_required: number;
};

type AssignmentRow = {
  id: string;
  trip_id: string;
  driver_id: string;
  source: "solver" | "manual";
  locked: boolean;
  drivers?: { full_name: string } | null;
};

type LatestRun = {
  id: string;
  status: string;
  unassigned_trip_ids: string[];
  error_message: string | null;
} | null;

export function DriverSchedulePanel({ drivers }: { drivers: Driver[] }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [latestRun, setLatestRun] = useState<LatestRun>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`/api/assignments?date=${date}`)
      .then((r) => r.json())
      .then((body) => {
        setTrips(body.trips || []);
        setAssignments(body.assignments || []);
        setLatestRun(body.latestRun || null);
      })
      .catch(() => {
        setTrips([]);
        setAssignments([]);
        setLatestRun(null);
      });
  }, [date]);

  async function reassign(tripId: string, driverIds: string[]) {
    setMessage("");
    const response = await fetch("/api/assignments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId, rosterDate: date, driverIds })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error || "Failed to reassign.");
      return;
    }
    setAssignments((rows) => [...rows.filter((row) => row.trip_id !== tripId), ...body.assignments]);
  }

  const assignmentsByTrip = new Map<string, AssignmentRow[]>();
  for (const assignment of assignments) {
    const list = assignmentsByTrip.get(assignment.trip_id) || [];
    list.push(assignment);
    assignmentsByTrip.set(assignment.trip_id, list);
  }

  const unassignedIds = new Set(latestRun?.unassigned_trip_ids || []);

  return (
    <section className="panel">
      <div className="panel-header">
        <strong>
          <CalendarClock size={15} className="icon-inline" />
          Driver Schedule
        </strong>
        <span className="hint">Solver-assigned by default; edits here are locked and survive re-runs.</span>
      </div>
      <div className="panel-body stack">
        <div className="field">
          <label htmlFor="scheduleDate">Date</label>
          <input id="scheduleDate" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        {unassignedIds.size > 0 && (
          <div className="notice">
            <AlertTriangle size={14} className="icon-inline" />
            {unassignedIds.size} trip(s) could not be fully staffed with today's roster.
          </div>
        )}
        {latestRun?.status === "FAILED" && (
          <div className="notice">Last schedule run failed: {latestRun.error_message}</div>
        )}
        {message && <div className="notice">{message}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Guest</th>
                <th>Direction</th>
                <th>Drivers needed</th>
                <th>Assigned</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((trip) => {
                const tripAssignments = assignmentsByTrip.get(trip.id) || [];
                const isUnassigned = unassignedIds.has(trip.id);
                return (
                  <tr key={trip.id}>
                    <td>{trip.guest_name}</td>
                    <td>{trip.direction}</td>
                    <td>{trip.drivers_required}</td>
                    <td>
                      <select
                        multiple
                        value={tripAssignments.map((a) => a.driver_id)}
                        onChange={(event) => {
                          const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
                          reassign(trip.id, selected);
                        }}
                      >
                        {drivers.map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.full_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {isUnassigned ? (
                        <span className="status failed">Unassigned</span>
                      ) : tripAssignments.some((a) => a.locked) ? (
                        <span className="status">Manual</span>
                      ) : tripAssignments.length > 0 ? (
                        <span className="status synced">Solver</span>
                      ) : (
                        <span className="hint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
