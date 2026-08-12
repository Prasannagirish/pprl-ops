"""CP-SAT model for driver-to-trip assignment.

Each job (trip) needs exactly `drivers_required` distinct drivers assigned
to it, or is left uncovered. A driver can never be assigned to two jobs
whose [start_minutes, end_minutes) intervals overlap. Locked driver ids are
pinned before solving so a manual override always survives. The objective
maximizes the number of fully-covered jobs -- no priority weighting between
jobs in this version.
"""

from ortools.sat.python import cp_model


def _overlaps(a: dict, b: dict) -> bool:
    return not (a["end_minutes"] <= b["start_minutes"] or b["end_minutes"] <= a["start_minutes"])


def _find_locked_conflict_trip_ids(jobs: list[dict]) -> set[str]:
    """Find jobs that must be excluded from the model because a locked driver
    is pinned to two of that driver's jobs whose time windows overlap. Such a
    conflict makes the CP-SAT model infeasible; detecting it up front lets us
    drop only the offending jobs instead of losing the whole day's schedule.
    """
    jobs_by_locked_driver: dict[str, list[dict]] = {}
    for job in jobs:
        for driver_id in job.get("locked_driver_ids", []):
            jobs_by_locked_driver.setdefault(driver_id, []).append(job)

    conflicted_trip_ids: set[str] = set()
    for locked_jobs in jobs_by_locked_driver.values():
        for i in range(len(locked_jobs)):
            for j in range(i + 1, len(locked_jobs)):
                if _overlaps(locked_jobs[i], locked_jobs[j]):
                    conflicted_trip_ids.add(locked_jobs[i]["trip_id"])
                    conflicted_trip_ids.add(locked_jobs[j]["trip_id"])

    return conflicted_trip_ids


def solve(date: str, drivers: list[dict], jobs: list[dict]) -> dict:
    conflicted_trip_ids = _find_locked_conflict_trip_ids(jobs)
    solvable_jobs = [job for job in jobs if job["trip_id"] not in conflicted_trip_ids]

    model = cp_model.CpModel()
    driver_ids = [d["id"] for d in drivers]

    assignment_vars: dict[tuple[str, str], "cp_model.IntVar"] = {}
    covered_vars: dict[str, "cp_model.IntVar"] = {}
    intervals_by_driver: dict[str, list] = {driver_id: [] for driver_id in driver_ids}

    for job in solvable_jobs:
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
    unassigned_trip_ids = list(conflicted_trip_ids)

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for job in solvable_jobs:
            trip_id = job["trip_id"]
            if solver.Value(covered_vars[trip_id]):
                for driver_id in driver_ids:
                    if solver.Value(assignment_vars[(driver_id, trip_id)]):
                        assignments.append({"trip_id": trip_id, "driver_id": driver_id})
            else:
                unassigned_trip_ids.append(trip_id)
    else:
        unassigned_trip_ids.extend(job["trip_id"] for job in solvable_jobs)

    return {"assignments": assignments, "unassigned_trip_ids": unassigned_trip_ids}
