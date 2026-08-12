"""CP-SAT model for driver-to-trip assignment.

Each job (trip) needs exactly `drivers_required` distinct drivers assigned
to it, or is left uncovered. A driver can never be assigned to two jobs
whose [start_minutes, end_minutes) intervals overlap. Locked driver ids are
pinned before solving so a manual override always survives. The objective
maximizes the number of fully-covered jobs -- no priority weighting between
jobs in this version.
"""

from ortools.sat.python import cp_model


def solve(date: str, drivers: list[dict], jobs: list[dict]) -> dict:
    model = cp_model.CpModel()
    driver_ids = [d["id"] for d in drivers]

    assignment_vars: dict[tuple[str, str], "cp_model.IntVar"] = {}
    covered_vars: dict[str, "cp_model.IntVar"] = {}
    intervals_by_driver: dict[str, list] = {driver_id: [] for driver_id in driver_ids}

    for job in jobs:
        trip_id = job["trip_id"]
        locked_ids = set(job.get("locked_driver_ids", []))
        covered = model.NewBoolVar(f"covered_{trip_id}")
        covered_vars[trip_id] = covered

        job_assignment_vars = []
        duration = job["end_minutes"] - job["start_minutes"]

        for driver_id in driver_ids:
            var = model.NewBoolVar(f"x_{driver_id}_{trip_id}")
            assignment_vars[(driver_id, trip_id)] = var
            job_assignment_vars.append(var)

            if driver_id in locked_ids:
                model.Add(var == 1)

            interval = model.NewOptionalIntervalVar(
                job["start_minutes"], duration, job["end_minutes"], var, f"iv_{driver_id}_{trip_id}"
            )
            intervals_by_driver[driver_id].append(interval)

        model.Add(sum(job_assignment_vars) == job["drivers_required"] * covered)

    for intervals in intervals_by_driver.values():
        if intervals:
            model.AddNoOverlap(intervals)

    model.Maximize(sum(covered_vars.values()))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10
    status = solver.Solve(model)

    assignments = []
    unassigned_trip_ids = []

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for job in jobs:
            trip_id = job["trip_id"]
            if solver.Value(covered_vars[trip_id]):
                for driver_id in driver_ids:
                    if solver.Value(assignment_vars[(driver_id, trip_id)]):
                        assignments.append({"trip_id": trip_id, "driver_id": driver_id})
            else:
                unassigned_trip_ids.append(trip_id)
    else:
        unassigned_trip_ids = [job["trip_id"] for job in jobs]

    return {"assignments": assignments, "unassigned_trip_ids": unassigned_trip_ids}
