"""Scraping job and task CRUD operations against DynamoDB.

Replaces the SQLAlchemy ``ScrapingJob`` / ``ScrapingTask`` ORM queries from the
original project.  All items are plain dicts; primary keys are UUID strings.

DynamoDB access patterns:
    create_job          →  PutItem on nse_scraping_jobs
    get_job             →  GetItem (job_id PK)
    list_jobs           →  Scan (admin) or Query user-jobs-index GSI (viewer)
    create_task         →  PutItem on nse_scraping_tasks
    get_tasks_for_job   →  Query job-tasks-index GSI
    update_task_status  →  UpdateItem on nse_scraping_tasks
    get_task            →  GetItem (task_id PK)
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from boto3.dynamodb.conditions import Key

from app.db.dynamo import dynamo_jobs, dynamo_tasks


# ── Jobs ───────────────────────────────────────────────────────────────────────


def create_job(user_id: str, username: str, total: int) -> dict:
    """Create a new scraping job record in DynamoDB.

    Args:
        user_id: UUID string of the user who created the job.
        username: Username stored denormalised for fast serialisation.
        total: Total number of ASINs in the job.

    Returns:
        The newly created job dict.
    """
    job = {
        "job_id": str(uuid.uuid4()),
        "user_id": user_id,
        "username": username,
        "total": total,
        "pending": total,
        "running": 0,
        "completed": 0,
        "failed": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    dynamo_jobs.put_item(Item=job)
    return job


def get_job(job_id: str) -> Optional[dict]:
    """Fetch a job by primary key.

    Args:
        job_id: UUID string primary key.

    Returns:
        Job dict or ``None`` if not found.
    """
    resp = dynamo_jobs.get_item(Key={"job_id": job_id})
    return resp.get("Item")


def list_jobs_for_user(user_id: str) -> list[dict]:
    """Return all jobs owned by *user_id* via GSI.

    Args:
        user_id: UUID string of the owning user.

    Returns:
        List of job dicts, most recent first.
    """
    resp = dynamo_jobs.query(
        IndexName="user-jobs-index",
        KeyConditionExpression=Key("user_id").eq(user_id),
    )
    items = resp.get("Items", [])
    return sorted(items, key=lambda j: j.get("created_at", ""), reverse=True)


def list_all_jobs() -> list[dict]:
    """Scan all jobs (admin / manager view).

    Returns:
        List of all job dicts, most recent first.
    """
    resp = dynamo_jobs.scan()
    items = resp.get("Items", [])
    return sorted(items, key=lambda j: j.get("created_at", ""), reverse=True)


def increment_job_counter(job_id: str, field: str, delta: int = 1) -> None:
    """Atomically increment or decrement a job counter field.

    Used by the worker to move a task from ``pending`` → ``running`` →
    ``completed`` / ``failed`` without a read-modify-write race.

    Args:
        job_id: UUID string of the parent job.
        field: One of ``"pending"``, ``"running"``, ``"completed"``, ``"failed"``.
        delta: Amount to add (use ``-1`` to decrement).
    """
    dynamo_jobs.update_item(
        Key={"job_id": job_id},
        UpdateExpression="ADD #f :d",
        ExpressionAttributeNames={"#f": field},
        ExpressionAttributeValues={":d": delta},
    )


# ── Tasks ──────────────────────────────────────────────────────────────────────


def create_task(job_id: str, asin: str) -> dict:
    """Create a single scraping task record in DynamoDB.

    Args:
        job_id: UUID string of the parent job.
        asin: 10-character Amazon ASIN.

    Returns:
        The newly created task dict (status: ``"pending"``).
    """
    task = {
        "task_id": str(uuid.uuid4()),
        "job_id": job_id,
        "asin": asin,
        "status": "pending",
        "error": None,
        "queued_at": datetime.now(timezone.utc).isoformat(),
        "started_at": None,
        "completed_at": None,
        "product": None,
    }
    dynamo_tasks.put_item(Item=task)
    return task


def get_task(task_id: str) -> Optional[dict]:
    """Fetch a task by primary key.

    Args:
        task_id: UUID string primary key.

    Returns:
        Task dict or ``None`` if not found.
    """
    resp = dynamo_tasks.get_item(Key={"task_id": task_id})
    return resp.get("Item")


def get_tasks_for_job(job_id: str) -> list[dict]:
    """Return all tasks belonging to *job_id* via GSI.

    Args:
        job_id: UUID string of the parent job.

    Returns:
        List of task dicts ordered by ``queued_at``.
    """
    resp = dynamo_tasks.query(
        IndexName="job-tasks-index",
        KeyConditionExpression=Key("job_id").eq(job_id),
    )
    items = resp.get("Items", [])
    return sorted(items, key=lambda t: t.get("queued_at", ""))


def update_task_status(
    task_id: str,
    status: str,
    error: Optional[str] = None,
    product: Optional[dict] = None,
) -> None:
    """Update a task's status, timestamps, and scraped product data.

    Args:
        task_id: UUID string primary key.
        status: New status value (``"running"``, ``"completed"``, ``"failed"``).
        error: Error message if status is ``"failed"``.
        product: Scraped product data dict if status is ``"completed"``.
    """
    now = datetime.now(timezone.utc).isoformat()
    updates: dict = {"#s": "status"}
    values: dict = {":s": status}

    if status == "running":
        updates["#sa"] = "started_at"
        values[":sa"] = now
        expr = "SET #s = :s, #sa = :sa"
    elif status in ("completed", "failed"):
        updates["#ca"] = "completed_at"
        values[":ca"] = now
        if error is not None:
            updates["#e"] = "error"
            values[":e"] = error
            expr = "SET #s = :s, #ca = :ca, #e = :e"
        elif product is not None:
            updates["#p"] = "product"
            values[":p"] = product
            expr = "SET #s = :s, #ca = :ca, #p = :p"
        else:
            expr = "SET #s = :s, #ca = :ca"
    else:
        expr = "SET #s = :s"

    dynamo_tasks.update_item(
        Key={"task_id": task_id},
        UpdateExpression=expr,
        ExpressionAttributeNames=updates,
        ExpressionAttributeValues=values,
    )
