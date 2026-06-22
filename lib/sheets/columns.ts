import { formatDate, formatTime, toComparableDate } from "@/lib/sheets/time";
import type { Trip } from "@/types/trip";

// Drop Time is intentionally not a column here. It's still stored and used
// for buffer calculations (lib/calculations/buffers.ts), but it's an
// internal scheduling input, not something the ops team needs to read off
// the sheet -- Flight Time / Pickup Time / the buffers already say what
// they need to know.
export const SHEET_HEADERS = [
  "Team",
  "Guest Name",
  "Designation",
  "Travel Date",
  "Direction",
  "Location Type",
  "Pickup Location",
  "Drop Location",
  "Flight Time",
  "Pickup Time",
  "Guest Buffer",
  "POC Buffer",
  "POC Name",
  "POC Contact",
  "Status"
];

export function tripToSheetRow(trip: Trip): string[] {
  return [
    trip.teams?.name || trip.team_id,
    trip.guest_name,
    trip.guest_designation || "",
    formatDate(trip.travel_date),
    trip.direction,
    trip.location_type,
    trip.pickup_location,
    trip.drop_location,
    formatTime(trip.flight_time),
    formatTime(trip.pickup_time),
    formatTime(trip.guest_buffer_time),
    formatTime(trip.poc_buffer_time),
    trip.poc_name,
    trip.poc_contact,
    trip.sync_status
  ];
}

/**
 * The one timestamp that actually matters for "when does this trip
 * happen", picked according to what's actually populated for that trip
 * type (see lib/validations/trip.ts for why these are mutually exclusive
 * in practice):
 *   - Airport trips (either direction): flight_time
 *   - Non-airport, arriving (TO_CAMPUS): pickup_time
 *   - Non-airport, departing (FROM_CAMPUS): drop_time, falling back to
 *     corrected_drop_time if drop_time was derived rather than entered
 *
 * This is sort-only -- it never gets displayed as its own column.
 */
export function getEffectiveSortTime(trip: Trip): Date | null {
  return (
    toComparableDate(trip.flight_time) ||
    toComparableDate(trip.pickup_time) ||
    toComparableDate(trip.drop_time) ||
    toComparableDate(trip.corrected_drop_time)
  );
}

/**
 * Sorts a single day's trips chronologically by their effective time.
 * Trips with no usable time at all (shouldn't normally happen given
 * validation, but data can be messy) sort to the bottom rather than
 * vanishing or crashing the sync.
 */
export function sortTripsByTime(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => {
    const timeA = getEffectiveSortTime(a);
    const timeB = getEffectiveSortTime(b);

    if (!timeA && !timeB) return a.guest_name.localeCompare(b.guest_name);
    if (!timeA) return 1;
    if (!timeB) return -1;

    return timeA.getTime() - timeB.getTime();
  });
}
