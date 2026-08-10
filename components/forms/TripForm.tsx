"use client";

import { useMemo, useState } from "react";
import { Save, X } from "lucide-react";
import { calculateBuffers } from "@/lib/calculations/buffers";
import { formatDateTime } from "@/lib/sheets/time";
import type { Direction, LocationType, Team, Trip, TripInput } from "@/types/trip";

type TripFormProps = {
  teams: Team[];
  role: "admin" | "team";
  initialTrip?: Trip | null;
  onSaved: () => void;
  onCancel: () => void;
};

function toLocalInput(value?: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function TripForm({ teams, role, initialTrip, onSaved, onCancel }: TripFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    teamId: initialTrip?.team_id || teams[0]?.id || "",
    guestName: initialTrip?.guest_name || "",
    guestDesignation: initialTrip?.guest_designation || "",
    travelDate: initialTrip?.travel_date || new Date().toISOString().slice(0, 10),
    direction: (initialTrip?.direction || "TO_CAMPUS") as Direction,
    locationType: (initialTrip?.location_type || "AIRPORT") as LocationType,
    pickupLocation: initialTrip?.pickup_location || "",
    dropLocation: initialTrip?.drop_location || "",
    flightTime: toLocalInput(initialTrip?.flight_time),
    pickupTime: toLocalInput(initialTrip?.pickup_time),
    dropTime: toLocalInput(initialTrip?.drop_time),
    pocName: initialTrip?.poc_name || "",
    pocContact: initialTrip?.poc_contact || ""
  });

  const payload: TripInput = useMemo(
    () => ({
      teamId: form.teamId || undefined,
      guestName: form.guestName,
      guestDesignation: form.guestDesignation,
      travelDate: form.travelDate,
      direction: form.direction,
      locationType: form.locationType,
      pickupLocation: form.pickupLocation,
      dropLocation: form.dropLocation,
      flightTime: fromLocalInput(form.flightTime),
      pickupTime: fromLocalInput(form.pickupTime),
      dropTime: fromLocalInput(form.dropTime),
      pocName: form.pocName,
      pocContact: form.pocContact
    }),
    [form]
  );

  const preview = useMemo(() => {
    try {
      return calculateBuffers(payload);
    } catch {
      return null;
    }
  }, [payload]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    const endpoint = initialTrip ? `/api/trips/${initialTrip.id}` : "/api/trips";
    const response = await fetch(endpoint, {
      method: initialTrip ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    setSubmitting(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Please check the trip details.");
      return;
    }

    onSaved();
  }

  const isAirport = form.locationType === "AIRPORT";

  return (
    <form className="grid" onSubmit={onSubmit}>
      <div className="form-grid">
        {role === "admin" ? (
          <div className="field">
            <label htmlFor="teamId">Team</label>
            <select id="teamId" value={form.teamId} onChange={(event) => update("teamId", event.target.value)}>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="guestName">Guest Name</label>
          <input id="guestName" value={form.guestName} onChange={(event) => update("guestName", event.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="guestDesignation">Designation</label>
          <input
            id="guestDesignation"
            value={form.guestDesignation}
            onChange={(event) => update("guestDesignation", event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="travelDate">Travel Date</label>
          <input
            id="travelDate"
            type="date"
            value={form.travelDate}
            onChange={(event) => update("travelDate", event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="direction">Direction</label>
          <select id="direction" value={form.direction} onChange={(event) => update("direction", event.target.value as Direction)}>
            <option value="TO_CAMPUS">To Campus</option>
            <option value="FROM_CAMPUS">From Campus</option>
            <option value="TO_HOTEL">To Hotel</option>
            <option value="FROM_HOTEL">From Hotel</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="locationType">Pickup Location Type</label>
          <select
            id="locationType"
            value={form.locationType}
            onChange={(event) => update("locationType", event.target.value as LocationType)}
          >
            <option value="AIRPORT">Airport</option>
            <option value="RAILWAY">Railway</option>
            <option value="BUS_STAND">Bus Stand</option>
            <option value="HOTEL">Hotel</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="pickupLocation">Pickup Location</label>
          <input
            id="pickupLocation"
            value={form.pickupLocation}
            onChange={(event) => update("pickupLocation", event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="dropLocation">Drop Location</label>
          <input id="dropLocation" value={form.dropLocation} onChange={(event) => update("dropLocation", event.target.value)} required />
        </div>
        {isAirport ? (
          <div className="field">
            <label htmlFor="flightTime">{form.direction === "TO_CAMPUS" ? "Flight Arrival Time" : "Flight Departure Time"}</label>
            <input
              id="flightTime"
              type="datetime-local"
              value={form.flightTime}
              onChange={(event) => update("flightTime", event.target.value)}
              required
            />
          </div>
        ) : (
          <div className="field">
            <label htmlFor={form.direction === "TO_CAMPUS" ? "pickupTime" : "dropTime"}>
              {form.direction === "TO_CAMPUS" ? "Pickup Time" : "Drop Time"}
            </label>
            <input
              id={form.direction === "TO_CAMPUS" ? "pickupTime" : "dropTime"}
              type="datetime-local"
              value={form.direction === "TO_CAMPUS" ? form.pickupTime : form.dropTime}
              onChange={(event) =>
                form.direction === "TO_CAMPUS" ? update("pickupTime", event.target.value) : update("dropTime", event.target.value)
              }
              required
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="pocName">POC Name</label>
          <input id="pocName" value={form.pocName} onChange={(event) => update("pocName", event.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="pocContact">POC Contact</label>
          <input id="pocContact" value={form.pocContact} onChange={(event) => update("pocContact", event.target.value)} required />
        </div>
      </div>

      {preview ? (
        <div className="notice">
          Guest buffer: {formatDateTime(preview.guestBuffer.toISOString())} | POC buffer:{" "}
          {formatDateTime(preview.pocBuffer.toISOString())}
          {preview.correctedDropTime ? ` | Corrected drop: ${formatDateTime(preview.correctedDropTime.toISOString())}` : ""}
        </div>
      ) : null}

      {error ? <div className="error">{error}</div> : null}

      <div className="form-actions">
        <button className="button" onClick={onCancel} type="button">
          <X size={16} />
          Cancel
        </button>
        <button className="button primary" disabled={submitting} type="submit">
          <Save size={16} />
          {submitting ? "Saving" : "Save Trip"}
        </button>
      </div>
    </form>
  );
}
