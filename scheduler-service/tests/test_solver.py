import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from solver import solve


def test_two_non_overlapping_trips_one_driver_covers_both():
    drivers = [{"id": "d1", "cab_id": "c1"}]
    jobs = [
        {"trip_id": "t1", "drivers_required": 1, "start_minutes": 540, "end_minutes": 585, "locked_driver_ids": []},
        {"trip_id": "t2", "drivers_required": 1, "start_minutes": 600, "end_minutes": 650, "locked_driver_ids": []},
    ]
    result = solve("2026-08-20", drivers, jobs)
    assert set(result["unassigned_trip_ids"]) == set()
    assert len(result["assignments"]) == 2
    assert all(a["driver_id"] == "d1" for a in result["assignments"])


def test_overlapping_trips_need_two_drivers():
    drivers = [{"id": "d1", "cab_id": "c1"}, {"id": "d2", "cab_id": "c2"}]
    jobs = [
        {"trip_id": "t1", "drivers_required": 1, "start_minutes": 540, "end_minutes": 600, "locked_driver_ids": []},
        {"trip_id": "t2", "drivers_required": 1, "start_minutes": 550, "end_minutes": 610, "locked_driver_ids": []},
    ]
    result = solve("2026-08-20", drivers, jobs)
    assert result["unassigned_trip_ids"] == []
    driver_ids = {a["trip_id"]: a["driver_id"] for a in result["assignments"]}
    assert driver_ids["t1"] != driver_ids["t2"]


def test_insufficient_drivers_flags_unassigned_instead_of_overlapping():
    drivers = [{"id": "d1", "cab_id": "c1"}]
    jobs = [
        {"trip_id": "t1", "drivers_required": 1, "start_minutes": 540, "end_minutes": 600, "locked_driver_ids": []},
        {"trip_id": "t2", "drivers_required": 1, "start_minutes": 550, "end_minutes": 610, "locked_driver_ids": []},
    ]
    result = solve("2026-08-20", drivers, jobs)
    assert len(result["unassigned_trip_ids"]) == 1
    assert len(result["assignments"]) == 1


def test_two_driver_job_gets_two_distinct_drivers():
    drivers = [{"id": "d1", "cab_id": "c1"}, {"id": "d2", "cab_id": "c2"}]
    jobs = [
        {"trip_id": "t1", "drivers_required": 2, "start_minutes": 540, "end_minutes": 600, "locked_driver_ids": []},
    ]
    result = solve("2026-08-20", drivers, jobs)
    assert result["unassigned_trip_ids"] == []
    assigned_drivers = {a["driver_id"] for a in result["assignments"] if a["trip_id"] == "t1"}
    assert assigned_drivers == {"d1", "d2"}


def test_locked_driver_is_kept_even_if_suboptimal():
    drivers = [{"id": "d1", "cab_id": "c1"}, {"id": "d2", "cab_id": "c2"}]
    jobs = [
        {"trip_id": "t1", "drivers_required": 1, "start_minutes": 540, "end_minutes": 600, "locked_driver_ids": ["d2"]},
    ]
    result = solve("2026-08-20", drivers, jobs)
    assert result["assignments"] == [{"trip_id": "t1", "driver_id": "d2"}]
