import type { JobInput, RosterDriver, SolveRequest } from "@/types/scheduling";

export function buildSolveRequest(date: string, drivers: RosterDriver[], jobs: JobInput[]): SolveRequest {
  return {
    date,
    drivers: drivers.map((driver) => ({ id: driver.driverId, cab_id: driver.cabId })),
    jobs: jobs.map((job) => ({
      trip_id: job.tripId,
      drivers_required: job.driversRequired,
      start_minutes: job.startMinutes,
      end_minutes: job.endMinutes,
      locked_driver_ids: job.lockedDriverIds
    }))
  };
}
