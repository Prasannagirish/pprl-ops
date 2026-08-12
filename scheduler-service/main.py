import os
from typing import List, Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from solver import solve

app = FastAPI(title="pprl-scheduler")


class SolveRequestDriver(BaseModel):
    id: str
    cab_id: Optional[str] = None


class SolveRequestJob(BaseModel):
    trip_id: str
    drivers_required: int
    start_minutes: int
    end_minutes: int
    locked_driver_ids: List[str] = []


class SolveRequestBody(BaseModel):
    date: str
    drivers: List[SolveRequestDriver]
    jobs: List[SolveRequestJob]


class SolveResponseAssignment(BaseModel):
    trip_id: str
    driver_id: str


class SolveResponseBody(BaseModel):
    assignments: List[SolveResponseAssignment]
    unassigned_trip_ids: List[str]


def _check_auth(authorization: str) -> None:
    secret = os.environ.get("SCHEDULER_SERVICE_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="SCHEDULER_SERVICE_SECRET is not configured")
    if authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.post("/solve", response_model=SolveResponseBody)
def solve_endpoint(payload: SolveRequestBody, authorization: str = Header(default="")):
    _check_auth(authorization)

    result = solve(
        payload.date,
        [driver.dict() for driver in payload.drivers],
        [job.dict() for job in payload.jobs],
    )
    return result


@app.get("/health")
def health():
    return {"status": "ok"}
