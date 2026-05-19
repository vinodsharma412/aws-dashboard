"""SQS-backed scraping job queue.

Architecture
------------
Replaces the previous in-memory ``queue.Queue()`` with Amazon SQS, giving
the queue durability across EC2 restarts and automatic dead-letter handling
for permanently failing tasks.

Flow::

    API endpoint (POST /scraping/jobs)
        │  enqueue(task_id)
        ▼
    SQS: nse-scraping-jobs-{stage}   (Standard, 300 s visibility timeout)
        │  Worker polls — 20 s long-poll (see app/worker.py)
        ▼
    EC2 Worker: processes task → DynamoDB update → delete_message()
        │  On failure: message becomes visible again after timeout
        │  After 3 receive attempts:
        ▼
    SQS DLQ: nse-scraping-jobs-{stage}-dlq   (14-day retention)
        │  CloudWatch Alarm: DLQ depth > 0
        ▼
    Lambda: nse-dlq-alert → SNS: nse-alerts → Email to admin

Local development fallback
--------------------------
When ``SQS_SCRAPING_JOBS_URL`` is empty (no .env value, no SSM param), the
module transparently uses an in-memory queue so the app runs offline without
any AWS resources.

Free-tier note
--------------
SQS Standard Queue: 1 million requests/month forever free.
With 20-second long-polling the worker makes ~3 requests/min = ~130k/month,
well within the free tier.  Short-polling (2 s) would reach 1.3M/month
— just over the limit — so long-polling is set by default.
"""

import json
import logging
import queue as _in_memory
import threading
from typing import Optional

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

from app.config import settings

logger = logging.getLogger(__name__)


# ── SQS client (lazy singleton) ───────────────────────────────────────────────

_sqs_client = None
_sqs_lock = threading.Lock()


def _get_sqs():
    """Return a cached SQS client, initialising on first call.

    Returns:
        boto3 SQS client, or ``None`` when credentials are absent or
        ``SQS_SCRAPING_JOBS_URL`` is empty (triggers local fallback).
    """
    global _sqs_client
    if _sqs_client is not None:
        return _sqs_client
    if not settings.SQS_SCRAPING_JOBS_URL:
        return None
    with _sqs_lock:
        if _sqs_client is None:
            try:
                _sqs_client = boto3.client("sqs", region_name=settings.AWS_REGION)
            except (NoCredentialsError, Exception) as exc:
                logger.warning("SQS init failed: %s — using local in-memory queue", exc)
    return _sqs_client


# ── In-memory fallback ────────────────────────────────────────────────────────

_local_queue: _in_memory.Queue = _in_memory.Queue()
"""Thread-safe fallback used when SQS is not configured."""


# ── Public API ────────────────────────────────────────────────────────────────

def enqueue(task_id: str) -> None:
    """Send a scraping task ID to the SQS queue.

    Message body: ``{"task_id": "<uuid>"}`` — the worker looks up the full
    task record from DynamoDB on receipt, so the SQS message stays small.

    Falls back silently to the local in-memory queue when SQS is unavailable.

    Args:
        task_id: UUID string of the ``scraping_tasks`` DynamoDB record.
    """
    sqs = _get_sqs()
    if sqs and settings.SQS_SCRAPING_JOBS_URL:
        try:
            sqs.send_message(
                QueueUrl=settings.SQS_SCRAPING_JOBS_URL,
                MessageBody=json.dumps({"task_id": task_id}),
            )
            logger.debug("Enqueued task %s → SQS", task_id)
            return
        except ClientError as exc:
            logger.error("SQS send failed for task %s: %s — falling back to local queue", task_id, exc)

    _local_queue.put(task_id)
    logger.debug("Enqueued task %s → local queue (SQS unavailable)", task_id)


def receive_messages(max_messages: int = 5, wait_seconds: int = 20) -> list:
    """Receive up to *max_messages* from the SQS queue.

    Uses long-polling (``WaitTimeSeconds=20``) to minimize empty receives
    and stay within the SQS free tier of 1 million requests/month.

    Args:
        max_messages: Maximum messages to receive in one call (1–10).
        wait_seconds: Long-poll wait time in seconds (0–20).

    Returns:
        List of dicts, each containing:
        - ``task_id`` (str): UUID to process.
        - ``receipt_handle`` (str | None): Pass to :func:`delete_message` after success.
        - ``receive_count`` (int): How many times this message has been received.
        Returns an empty list when no messages are available.
    """
    sqs = _get_sqs()
    if not sqs or not settings.SQS_SCRAPING_JOBS_URL:
        # Drain local in-memory queue
        results = []
        for _ in range(max_messages):
            try:
                task_id = _local_queue.get_nowait()
                results.append({"task_id": task_id, "receipt_handle": None, "receive_count": 1})
            except _in_memory.Empty:
                break
        return results

    try:
        resp = sqs.receive_message(
            QueueUrl=settings.SQS_SCRAPING_JOBS_URL,
            MaxNumberOfMessages=min(max_messages, 10),
            WaitTimeSeconds=wait_seconds,
            AttributeNames=["ApproximateReceiveCount"],
        )
        result = []
        for msg in resp.get("Messages", []):
            try:
                body = json.loads(msg["Body"])
                task_id = body.get("task_id", "")
            except (json.JSONDecodeError, KeyError):
                task_id = msg.get("Body", "")

            result.append({
                "task_id": task_id,
                "receipt_handle": msg["ReceiptHandle"],
                "receive_count": int(
                    msg.get("Attributes", {}).get("ApproximateReceiveCount", 1)
                ),
            })
        return result
    except ClientError as exc:
        logger.error("SQS receive_message failed: %s", exc)
        return []


def delete_message(receipt_handle: Optional[str]) -> None:
    """Delete a successfully processed message from the SQS queue.

    Must be called after a task completes without error.  If not called,
    SQS makes the message visible again after the visibility timeout (300 s)
    for retry.  After ``maxReceiveCount`` (3) failed attempts, SQS
    automatically moves the message to the Dead Letter Queue.

    Args:
        receipt_handle: The ``ReceiptHandle`` from :func:`receive_messages`.
            ``None`` silently no-ops (local queue fallback has no handle).
    """
    if not receipt_handle:
        return
    sqs = _get_sqs()
    if not sqs or not settings.SQS_SCRAPING_JOBS_URL:
        return
    try:
        sqs.delete_message(
            QueueUrl=settings.SQS_SCRAPING_JOBS_URL,
            ReceiptHandle=receipt_handle,
        )
    except ClientError as exc:
        logger.warning("SQS delete_message failed: %s", exc)


def get_queue_depth() -> Optional[int]:
    """Return the approximate number of visible messages in the queue.

    Used by the health endpoint and CloudWatch monitoring.

    Returns:
        Message count, or ``None`` on error.
    """
    sqs = _get_sqs()
    if not sqs or not settings.SQS_SCRAPING_JOBS_URL:
        return _local_queue.qsize()
    try:
        resp = sqs.get_queue_attributes(
            QueueUrl=settings.SQS_SCRAPING_JOBS_URL,
            AttributeNames=["ApproximateNumberOfMessages"],
        )
        return int(resp["Attributes"].get("ApproximateNumberOfMessages", 0))
    except ClientError:
        return None
