"""Amazon ASIN scraping job endpoints + SSE event streams.

REST endpoints:
    POST  /jobs              — create a new scraping job
    GET   /jobs              — list jobs (ADMIN/MANAGER see all; VIEWER sees own)
    GET   /jobs/{job_id}     — get a single job with task detail

SSE streams (text/event-stream):
    GET   /events            — live job list, updates on any state change
    GET   /jobs/{job_id}/events  — live single-job detail, closes when done

AWS difference vs. original:
    - No SQLAlchemy session. Jobs and tasks stored in DynamoDB via
      ``crud.scraping_dynamo``.
    - Primary keys are UUID strings, not integers.
    - SSE streams query DynamoDB directly (no SessionLocal pool needed).
    - SSE endpoints should be called via EC2 directly (not API Gateway) because
      API Gateway has a hard 29-second timeout that breaks long-running streams.
      Set REACT_APP_SSE_URL to the EC2 public URL in the React .env file.
"""

import asyncio
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from app.crud import scraping_dynamo
from app.dependencies import get_current_active_user
from app.schemas.scraping import JobCreate, JobOut
from app.services.scraping_queue import enqueue

#: Seconds between SSE polls while tasks are actively running or pending.
_SSE_ACTIVE_INTERVAL = 1

#: Seconds between SSE polls when all tasks are idle (saves DynamoDB RCUs).
_SSE_IDLE_INTERVAL = 5

router = APIRouter()


# ── Serialisation helpers ──────────────────────────────────────────────────────


def _task_to_dict(t: dict) -> dict:
    """Normalise a DynamoDB task item for JSON output.

    Args:
        t: Raw DynamoDB task dict with UUID string keys.

    Returns:
        Normalised dict with ``id`` mapped from ``task_id``.
    """
    return {
        "id": t.get("task_id"),
        "asin": t.get("asin"),
        "status": t.get("status"),
        "error": t.get("error"),
        "queued_at": t.get("queued_at"),
        "started_at": t.get("started_at"),
        "completed_at": t.get("completed_at"),
        "product": t.get("product"),
    }


def _job_to_dict(job: dict, tasks: Optional[list] = None) -> dict:
    """Normalise a DynamoDB job item for JSON output.

    When *tasks* is provided, counters are derived from the actual task rows
    to protect against counter drift after mid-flight crashes.

    Args:
        job: Raw DynamoDB job dict.
        tasks: Optional list of task dicts for this job.

    Returns:
        Normalised dict with ``id`` mapped from ``job_id`` and live counters.
    """
    if tasks is not None:
        pending   = sum(1 for t in tasks if t.get("status") == "pending")
        running   = sum(1 for t in tasks if t.get("status") == "running")
        completed = sum(1 for t in tasks if t.get("status") == "completed")
        failed    = sum(1 for t in tasks if t.get("status") == "failed")
    else:
        pending   = int(job.get("pending", 0))
        running   = int(job.get("running", 0))
        completed = int(job.get("completed", 0))
        failed    = int(job.get("failed", 0))

    return {
        "id":         job.get("job_id"),
        "user_id":    job.get("user_id"),
        "username":   job.get("username"),
        "total":      int(job.get("total", 0)),
        "pending":    pending,
        "running":    running,
        "completed":  completed,
        "failed":     failed,
        "created_at": job.get("created_at"),
        "tasks":      [_task_to_dict(t) for t in tasks] if tasks is not None else None,
    }


# ── REST endpoints ─────────────────────────────────────────────────────────────


@router.post("/jobs", response_model=JobOut, status_code=status.HTTP_201_CREATED)
def create_job(
    payload: JobCreate,
    current_user: dict = Depends(get_current_active_user),
) -> dict:
    """Create a new scraping job and enqueue all ASINs.

    Creates one ``ScrapingJob`` record and one ``ScrapingTask`` per ASIN in
    DynamoDB, then puts each task_id onto the in-process queue so the background
    Playwright worker picks them up immediately.

    Args:
        payload: ``JobCreate`` body with a validated list of ASIN strings.
        current_user: Authenticated user dict from DynamoDB.

    Returns:
        The created job serialised as ``JobOut``, including the full task list.
    """
    asins = payload.asins
    job = scraping_dynamo.create_job(
        user_id=current_user["user_id"],
        username=current_user.get("username", ""),
        total=len(asins),
    )

    tasks = [scraping_dynamo.create_task(job["job_id"], asin) for asin in asins]

    for task in tasks:
        enqueue(task["task_id"])

    return _job_to_dict(job, tasks=tasks)


@router.get("/jobs", response_model=List[JobOut])
def list_jobs(current_user: dict = Depends(get_current_active_user)) -> List[dict]:
    """List scraping jobs visible to the current user.

    ADMIN and MANAGER see all jobs; VIEWER sees only their own.

    Args:
        current_user: Authenticated user dict determining visibility scope.

    Returns:
        List of jobs serialised as ``JobOut`` (without task detail).
    """
    if current_user.get("role") == "viewer":
        jobs = scraping_dynamo.list_jobs_for_user(current_user["user_id"])
    else:
        jobs = scraping_dynamo.list_all_jobs()

    return [_job_to_dict(j) for j in jobs]


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(
    job_id: str,
    current_user: dict = Depends(get_current_active_user),
) -> dict:
    """Retrieve a single scraping job with full task detail.

    Args:
        job_id: UUID string primary key of the job.
        current_user: Used for ownership check when role is VIEWER.

    Returns:
        Job serialised as ``JobOut`` including all tasks and scraped product data.

    Raises:
        HTTPException 404: If the job does not exist.
        HTTPException 403: If a VIEWER requests a job they do not own.
    """
    job = scraping_dynamo.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if (
        current_user.get("role") == "viewer"
        and job.get("user_id") != current_user["user_id"]
    ):
        raise HTTPException(status_code=403, detail="Access denied.")

    tasks = scraping_dynamo.get_tasks_for_job(job_id)
    return _job_to_dict(job, tasks=tasks)


# ── SSE streams ────────────────────────────────────────────────────────────────


@router.get("/events")
async def jobs_event_stream(
    current_user: dict = Depends(get_current_active_user),
) -> StreamingResponse:
    """SSE stream emitting the full job list whenever state changes.

    Polls DynamoDB every ``_SSE_ACTIVE_INTERVAL`` seconds while any job has
    pending/running tasks, and every ``_SSE_IDLE_INTERVAL`` seconds when idle.
    Only sends an SSE frame when the payload differs from the last send.

    Note: This endpoint must be called directly on EC2 (via ``SSE_URL``), not
    through API Gateway which enforces a 29-second integration timeout.

    Args:
        current_user: Used to scope visibility (VIEWER sees own jobs only).

    Returns:
        ``StreamingResponse`` with ``Content-Type: text/event-stream``.
    """
    user_id   = current_user["user_id"]
    user_role = current_user.get("role", "viewer")

    def fetch() -> str:
        if user_role == "viewer":
            jobs = scraping_dynamo.list_jobs_for_user(user_id)
        else:
            jobs = scraping_dynamo.list_all_jobs()
        return json.dumps([_job_to_dict(j) for j in jobs])

    async def generate():
        last = None
        while True:
            try:
                payload = await asyncio.to_thread(fetch)
            except Exception:  # noqa: BLE001
                await asyncio.sleep(2)
                continue

            if payload != last:
                yield f"data: {payload}\n\n"
                last = payload

            has_active = any(
                j.get("pending", 0) > 0 or j.get("running", 0) > 0
                for j in json.loads(payload)
            )
            await asyncio.sleep(
                _SSE_ACTIVE_INTERVAL if has_active else _SSE_IDLE_INTERVAL
            )

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/jobs/{job_id}/events")
async def job_event_stream(
    job_id: str,
    current_user: dict = Depends(get_current_active_user),
) -> StreamingResponse:
    """SSE stream for a single job — closes automatically when all tasks finish.

    Polls DynamoDB every ``_SSE_ACTIVE_INTERVAL`` seconds and sends the current
    job state only when it differs from the previous frame.  The generator exits
    (closing the stream) once ``pending == 0`` and ``running == 0``.

    Note: Call via ``SSE_URL`` (direct EC2), not through API Gateway.

    Args:
        job_id: UUID string of the job to stream.
        current_user: Used for VIEWER ownership enforcement.

    Returns:
        ``StreamingResponse`` with ``Content-Type: text/event-stream``.
    """
    user_id   = current_user["user_id"]
    user_role = current_user.get("role", "viewer")

    def fetch():
        job = scraping_dynamo.get_job(job_id)
        if not job:
            return None, False
        if user_role == "viewer" and job.get("user_id") != user_id:
            return None, False
        tasks = scraping_dynamo.get_tasks_for_job(job_id)
        data = _job_to_dict(job, tasks=tasks)
        done = data["pending"] == 0 and data["running"] == 0
        return json.dumps(data), done

    async def generate():
        last = None
        while True:
            try:
                payload, done = await asyncio.to_thread(fetch)
            except Exception:  # noqa: BLE001
                await asyncio.sleep(1)
                continue

            if payload is None:
                yield f"data: {json.dumps({'error': 'not_found'})}\n\n"
                break

            if payload != last:
                yield f"data: {payload}\n\n"
                last = payload

            if done:
                break

            await asyncio.sleep(_SSE_ACTIVE_INTERVAL)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

