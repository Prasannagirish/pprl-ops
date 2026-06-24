import { formatDate, formatTime, toComparableDate } from "@/lib/sheets/time";
import type { Trip } from "@/types/trip";

// Drop Time is intentionally not a column here. It's still stored and used
// for buffer calculations (lib/calculations/buffers.ts), but it's an
// internal scheduling input, not something the ops team needs to read off
// the sheet -- Flight/Train/Bus Time / Pickup Time / the buffers already
// say what they need to know.
export const SHEET_HEADERS = [
  "Team",
  "Guest Name",
  "Designation",
  "Travel Date",
  "Direction",
  "Location Type",
  "Pickup Location",
  "Drop Location",
  "Flight/Train/Bus Time",
  "Pickup Time",
  "Guest Buffer",
  "POC Buffer",
  "POC Name",
  "POC Contact",
  "Status"
];

/**
 * The guest's own travel time -- arrival time if they're heading
 * TO_CAMPUS, departure time if they're heading FROM_CAMPUS. Airport trips
 * always have this in flight_time. Non-airport trips don't have a
 * dedicated column for it (see lib/validations/trip.ts), so this falls
 * back to whichever raw input was actually collected for that direction:
 * pickup_time for arrivals, drop_time for departures.
 */
function getGuestTravelTime(trip: Trip): string | null {
  if (trip.flight_time) return trip.flight_time;
  return trip.direction === "TO_CAMPUS" ? trip.pickup_time : trip.drop_time;
}

/**
 * What ops actually needs to read as "Pickup Time":
 *   - TO_CAMPUS: the guest is arriving, so pickup time = their travel
 *     time (same value as the Flight/Train/Bus Time column) -- that's
 *     the moment they need to be picked up.
 *   - FROM_CAMPUS: the guest is departing, so pickup time = the guest
 *     buffer time -- the moment the POC needs to pick the guest up from
 *     their location to start the journey to the airport/station on time.
 */
function getDisplayPickupTime(trip: Trip): string | null {
  return trip.direction === "TO_CAMPUS" ? getGuestTravelTime(trip) : trip.guest_buffer_time;
}

export function tripToSheetRow(trip: Trip, statusOverride?: string): string[] {
  return [
    trip.teams?.name || trip.team_id,
    trip.guest_name,
    trip.guest_designation || "",
    formatDate(trip.travel_date),
    trip.direction,
    trip.location_type,
    trip.pickup_location,
    trip.drop_location,
    formatTime(getGuestTravelTime(trip)),
    formatTime(getDisplayPickupTime(trip)),
    formatTime(trip.guest_buffer_time),
    formatTime(trip.poc_buffer_time),
    trip.poc_name,
    trip.poc_contact,
    statusOverride ?? trip.sync_status
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
