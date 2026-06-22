"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { AnalyticsCards } from "@/components/dashboard/AnalyticsCards";
import { TripForm } from "@/components/forms/TripForm";
import { TripTable } from "@/components/tables/TripTable";
import { useTripsRealtime } from "@/lib/supabase/useTripsRealtime";
import type { Profile, Team, Trip } from "@/types/trip";

type TeamDashboardProps = {
  profile: Profile;
  initialTrips: Trip[];
  teams: Team[];
};

export function TeamDashboard({ profile, initialTrips, teams }: TeamDashboardProps) {
  const [trips, setTrips] = useState(initialTrips);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Trip | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useTripsRealtime(teams, {
    onInsert: (trip) => setTrips((current) => (current.some((item) => item.id === trip.id) ? current : [...current, trip])),
    onUpdate: (trip) => setTrips((current) => current.map((item) => (item.id === trip.id ? trip : item))),
    onDelete: (id) => setTrips((current) => current.filter((item) => item.id !== id))
  });

  const filteredTrips = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return trips;
    }

    return trips.filter((trip) =>
      [
        trip.guest_name,
        trip.guest_designation,
        trip.pickup_location,
        trip.drop_location,
        trip.poc_name,
        trip.sync_status
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [query, trips]);

  function closeModal() {
    setIsCreating(false);
    setEditing(null);
  }

  return (
    <>
      <section className="toolbar">
        <div>
          <h2>Team Trips</h2>
          <p>Create, edit, and track your team travel movements.</p>
        </div>
        <button className="button primary" onClick={() => setIsCreating(true)} type="button">
          <Plus size={16} />
          New Trip
        </button>
      </section>

      <AnalyticsCards trips={trips} />

      <section className="panel">
        <div className="panel-header">
          <div className="field" style={{ minWidth: 260 }}>
            <label htmlFor="search">
              <Search size={14} /> Search Trips
            </label>
            <input id="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Guest, route, POC, status" />
          </div>
        </div>
        <TripTable
          trips={filteredTrips}
          onEdit={setEditing}
          onDeleted={(id) => setTrips((current) => current.filter((trip) => trip.id !== id))}
        />
      </section>

      {isCreating || editing ? (
        <div className="modal-backdrop">
          <section className="panel modal">
            <div className="panel-header">
              <strong>{editing ? "Edit Trip" : "Create Trip"}</strong>
            </div>
            <div className="panel-body">
              <TripForm
                teams={teams}
                role={profile.role}
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
