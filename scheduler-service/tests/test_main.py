import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["SCHEDULER_SERVICE_SECRET"] = "test-secret"

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_rejects_missing_auth():
    response = client.post("/solve", json={"date": "2026-08-20", "drivers": [], "jobs": []})
    assert response.status_code == 401


def test_accepts_valid_auth_and_solves():
    response = client.post(
        "/solve",
        json={"date": "2026-08-20", "drivers": [], "jobs": []},
        headers={"Authorization": "Bearer test-secret"},
    )
    assert response.status_code == 200
    assert response.json() == {"assignments": [], "unassigned_trip_ids": []}
