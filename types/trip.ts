export type UserRole = "admin" | "team";
export type Direction = "TO_CAMPUS" | "FROM_CAMPUS";
export type LocationType = "AIRPORT" | "RAILWAY" | "BUS_STAND" | "OTHER";
export type SyncStatus = "PENDING" | "SYNCED" | "FAILED";
export type QueueStatus = "PENDING" | "PROCESSING" | "SYNCED" | "FAILED";

export type Team = {
  id: string;
  name: string;
  disabled: boolean;
  is_admin_team: boolean;
  created_at: string;
};

export type Profile = {
  id: string;
  team_id: string | null;
  role: UserRole;
  full_name: string | null;
  email: string;
};

export type Trip = {
  id: string;
  team_id: string;
  guest_name: string;
  guest_designation: string | null;
  travel_date: string;
  direction: Direction;
  location_type: LocationType;
  pickup_location: string;
  drop_location: string;
  flight_time: string | null;
  pickup_time: string | null;
  drop_time: string | null;
  poc_name: string;
  poc_contact: string;
  guest_buffer_time: string;
  poc_buffer_time: string;
  corrected_drop_time: string | null;
  sync_status: SyncStatus;
  gsheet_row_id: number | null;
  created_at: string;
  updated_at: string;
  teams?: Pick<Team, "id" | "name"> | null;
};

export type TripInput = {
  teamId?: string;
  guestName: string;
  guestDesignation?: string;
  travelDate: string;
  direction: Direction;
  locationType: LocationType;
  pickupLocation: string;
  dropLocation: string;
  flightTime?: string | null;
  pickupTime?: string | null;
  dropTime?: string | null;
  pocName: string;
  pocContact: string;
};

export type CalculatedBuffers = {
  guestBuffer: Date;
  pocBuffer: Date;
  correctedDropTime?: Date;
};

export type EventConfig = {
  id: number;
  day_zero_date: string;
  updated_at: string;
};

export type AuditLog = {
  id: string;
  actor_id: string | null;
  team_id: string | null;
  trip_id: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
};
