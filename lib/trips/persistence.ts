import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateBuffers } from "@/lib/calculations/buffers";
import type { Profile, TripInput } from "@/types/trip";

export function buildTripPayload(input: TripInput, profile: Profile) {
  const calculated = calculateBuffers(input);
  const teamId = profile.role === "admin" && input.teamId ? input.teamId : profile.team_id;

  if (!teamId) {
    throw new Error("A team is required to create a trip.");
  }

  return {
    team_id: teamId,
    guest_name: input.guestName,
    guest_designation: input.guestDesignation || null,
    travel_date: input.travelDate,
    direction: input.direction,
    location_type: input.locationType,
    pickup_location: input.pickupLocation,
    drop_location: input.dropLocation,
    flight_time: input.flightTime || null,
    pickup_time: input.pickupTime || null,
    drop_time: input.dropTime || calculated.correctedDropTime?.toISOString() || null,
    corrected_drop_time: calculated.correctedDropTime?.toISOString() || null,
    poc_name: input.pocName,
    poc_contact: input.pocContact,
    guest_buffer_time: calculated.guestBuffer.toISOString(),
    poc_buffer_time: calculated.pocBuffer.toISOString(),
    sync_status: "PENDING"
  };
}

export async function assertTeamWritable(supabase: SupabaseClient, teamId: string, role: Profile["role"]) {
  if (role === "admin") {
    return;
  }

  const { data, error } = await supabase.from("teams").select("disabled").eq("id", teamId).maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (data?.disabled) {
    throw new Error("Your team has been disabled by an admin. Contact an admin to resume logging trips.");
  }
}

export async function enqueueTripSync(supabase: SupabaseClient, tripId: string) {
  const { error } = await supabase.from("sync_queue").insert({
    trip_id: tripId,
    operation: "UPSERT",
    status: "PENDING"
  });

  if (error) {
    throw new Error(error.message);
  }
}
