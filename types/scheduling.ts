export type SolveRequestDriver = {
  id: string;
  cab_id: string | null;
};

export type SolveRequestJob = {
  trip_id: string;
  drivers_required: 1 | 2;
  start_minutes: number;
  end_minutes: number;
  locked_driver_ids: string[];
};

export type SolveRequest = {
  date: string;
  drivers: SolveRequestDriver[];
  jobs: SolveRequestJob[];
};

export type SolveResponseAssignment = {
  trip_id: string;
  driver_id: string;
};

export type SolveResponse = {
  assignments: SolveResponseAssignment[];
  unassigned_trip_ids: string[];
};

export type RosterDriver = {
  driverId: string;
  cabId: string | null;
};

export type JobInput = {
  tripId: string;
  driversRequired: 1 | 2;
  startMinutes: number;
  endMinutes: number;
  lockedDriverIds: string[];
};

export type Driver = {
  id: string;
  full_name: string;
  phone: string | null;
  active: boolean;
};

export type Cab = {
  id: string;
  label: string;
  active: boolean;
};

export type DriverDailyRoster = {
  id: string;
  driver_id: string;
  roster_date: string;
  available: boolean;
  cab_id: string | null;
  substituting_for_driver_id: string | null;
  notes: string | null;
};

export type DriverTripAssignment = {
  id: string;
  trip_id: string;
  driver_id: string;
  roster_date: string;
  source: "solver" | "manual";
  locked: boolean;
};

export type ScheduleRunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export type ScheduleRun = {
  id: string;
  roster_date: string;
  status: ScheduleRunStatus;
  triggered_by: "auto" | "manual";
  unassigned_trip_ids: string[];
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};
