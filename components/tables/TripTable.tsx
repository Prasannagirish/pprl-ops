"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { StatusBadge } from "@/components/tables/StatusBadge";
import { formatDateTime } from "@/lib/sheets/time";
import type { Trip } from "@/types/trip";

type TripTableProps = {
  trips: Trip[];
  onEdit?: (trip: Trip) => void;
  onDeleted?: (id: string) => void;
};

export function TripTable({ trips, onEdit, onDeleted }: TripTableProps) {
  const [pendingDelete, setPendingDelete] = useState<Trip | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const response = await fetch(`/api/trips/${pendingDelete.id}`, { method: "DELETE" });
    setDeleting(false);
    if (response.ok) {
      onDeleted?.(pendingDelete.id);
    }
    setPendingDelete(null);
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Guest</th>
            <th>Team</th>
            <th>Travel</th>
            <th>Route</th>
            <th>Flight / Base</th>
            <th>Guest Buffer</th>
            <th>POC</th>
            <th>Sync</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {trips.map((trip) => (
            <tr key={trip.id}>
              <td>
                <strong>{trip.guest_name}</strong>
                <br />
                <span>{trip.guest_designation || "Guest"}</span>
              </td>
              <td>{trip.teams?.name || trip.team_id}</td>
              <td>
                {trip.travel_date}
                <br />
                <span>{trip.direction.replace("_", " ")}</span>
              </td>
              <td>
                <strong>{trip.location_type.replace("_", " ")}</strong>
                <br />
                {trip.pickup_location} to {trip.drop_location}
              </td>
              <td>
                {trip.location_type === "AIRPORT"
                  ? formatDateTime(trip.flight_time)
                  : formatDateTime(trip.direction === "TO_CAMPUS" ? trip.pickup_time : trip.drop_time)}
              </td>
              <td>
                {formatDateTime(trip.guest_buffer_time)}
                <br />
                <span>{formatDateTime(trip.poc_buffer_time)}</span>
              </td>
              <td>
                <strong>{trip.poc_name}</strong>
                <br />
                {trip.poc_contact}
              </td>
              <td>
                <StatusBadge status={trip.sync_status} />
              </td>
              <td>
                <div className="row-actions">
                  {onEdit ? (
                    <button className="button" onClick={() => onEdit(trip)} title="Edit trip" type="button">
                      <Pencil size={16} />
                    </button>
                  ) : null}
                  {onDeleted ? (
                    <button className="button danger" onClick={() => setPendingDelete(trip)} title="Delete trip" type="button">
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
          {!trips.length ? (
            <tr>
              <td colSpan={9}>No trips match the current view.</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this trip?"
        description={pendingDelete ? `${pendingDelete.guest_name}'s trip on ${pendingDelete.travel_date} will be removed permanently.` : undefined}
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        danger
        confirmDisabled={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
