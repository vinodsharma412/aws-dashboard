"""Standalone scraping worker — SQS-backed, DynamoDB state.

How it works
------------
1.  On startup the worker resets any tasks stuck in ``running`` status from a
    previous crash (``_recover``).
2.  The main loop calls ``scraping_queue.receive_messages()`` with a 20-second
    long-poll, which blocks until messages arrive or the wait expires.
3.  Each SQS message body is ``{"task_id": "<uuid>"}``.  The worker fetches
    full task details from DynamoDB, runs the Playwright scrape, then:
    - **Success**: updates DynamoDB status to ``completed``, **deletes** the
      SQS message so it is not retried.
    - **Failure**: updates DynamoDB status to ``failed``, does **not** delete
      the message.  SQS makes it visible again after 300 s.  After 3 attempts
      it goes to the Dead Letter Queue (DLQ), which triggers an SNS email alert.
4.  At most ``MAX_CONCURRENT`` scrapes run simultaneously (semaphore-controlled
    ThreadPoolExecutor).

Running
-------
Via systemd::

    sudo systemctl start nse-worker

Directly::

    STAGE=prod python -m app.worker

Local dev (no SQS)::

    STAGE=dev python -m app.worker
    # Uses in-memory queue fallback — tasks submitted via API are processed here.
"""

import atexit
import logging
import os
import signal
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("nse.worker")

PID_FILE = BACKEND_DIR / "worker.pid"

#: Maximum Playwright scrapes running at the same time.
MAX_CONCURRENT: int = 2

_semaphore = threading.Semaphore(MAX_CONCURRENT)
_executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENT + 1, thread_name_prefix="scraper")
_in_progress: set = set()
_lock = threading.Lock()
_stop = threading.Event()


# ── Singleton guard ───────────────────────────────────────────────────────────

def _acquire_singleton() -> bool:
    """Prevent more than one worker process from running simultaneously.

    Writes the current PID to ``worker.pid``.  If the file already contains
    a live PID, the function returns ``False`` and the caller should exit.

    Returns:
        ``True`` if this process successfully claimed the singleton lock.
    """
    if PID_FILE.exists():
        try:
            old_pid = int(PID_FILE.read_text().strip())
            os.kill(old_pid, 0)  # raises ProcessLookupError if dead
            logger.warning("Worker already running (PID=%d). Exiting.", old_pid)
            return False
        except (ValueError, ProcessLookupError, PermissionError):
            pass  # stale PID file — safe to overwrite
    PID_FILE.write_text(str(os.getpid()))
    atexit.register(lambda: PID_FILE.unlink(missing_ok=True))
    return True


# ── Recovery: reset stuck tasks ──────────────────────────────────────────────

def _recover() -> None:
    """Reset tasks stuck in ``running`` status from a previous crash.

    On a clean shutdown tasks are either ``completed`` or ``failed``.
    If the worker was killed mid-scrape, those tasks remain ``running``
    forever.  This function resets them to ``pending`` so they re-enter
    the queue on the next poll cycle.
    """
    from boto3.dynamodb.conditions import Key
    from app.db.dynamo import dynamo_tasks
    from app.crud.scraping_dynamo import update_task_status, increment_job_counter

    resp = dynamo_tasks.query(
        IndexName="status-index",
        KeyConditionExpression=Key("status").eq("running"),
    )
    stuck = resp.get("Items", [])
    for t in stuck:
        update_task_status(t["task_id"], "pending")
        increment_job_counter(t["job_id"], "running", -1)
        increment_job_counter(t["job_id"], "pending", 1)
    if stuck:
        logger.info("Recovered %d stuck tasks → pending", len(stuck))


# ── Task processor ────────────────────────────────────────────────────────────

def _process_task(task_id: str) -> bool:
    """Fetch a task from DynamoDB, run the scrape, and update status.

    Args:
        task_id: UUID of the ``scraping_tasks`` DynamoDB record.

    Returns:
        ``True`` on success (caller should delete the SQS message).
        ``False`` on failure (caller should NOT delete — SQS will retry).
    """
    from app.crud.scraping_dynamo import get_task, update_task_status, increment_job_counter
    from app.services.scraper import scrape_amazon_asin

    task = get_task(task_id)
    if not task:
        logger.warning("task_id=%s not found in DynamoDB — discarding", task_id)
        return True  # delete the orphaned SQS message

    if task.get("status") != "pending":
        logger.debug("task_id=%s status=%s — skipping", task_id, task.get("status"))
        return True  # already processed; delete message to avoid duplicate work

    job_id = task["job_id"]
    asin = task["asin"]

    update_task_status(task_id, "running")
    increment_job_counter(job_id, "pending", -1)
    increment_job_counter(job_id, "running", 1)

    try:
        data = scrape_amazon_asin(asin)
        update_task_status(task_id, "completed", product=data)
        increment_job_counter(job_id, "running", -1)
        increment_job_counter(job_id, "completed", 1)
        logger.info("DONE  task=%s asin=%s title=%r", task_id, asin, (data.get("title") or "")[:60])
        return True  # success — caller should delete the SQS message

    except Exception as exc:
        logger.error("FAIL  task=%s asin=%s error=%s", task_id, asin, exc)
        update_task_status(task_id, "failed", error=str(exc)[:500])
        increment_job_counter(job_id, "running", -1)
        increment_job_counter(job_id, "failed", 1)
        return False  # failure — do NOT delete; SQS will retry, then DLQ

    finally:
        with _lock:
            _in_progress.discard(task_id)


def _run_with_semaphore(task_id: str, receipt_handle) -> None:
    """Run ``_process_task`` under the concurrency semaphore.

    Acquires the semaphore before starting and releases it when done.
    Deletes the SQS message only on success.

    Args:
        task_id: UUID to process.
        receipt_handle: SQS receipt handle (``None`` for local queue).
    """
    from app.services.scraping_queue import delete_message

    with _semaphore:
        success = _process_task(task_id)
        if success:
            delete_message(receipt_handle)


# ── Main poll loop ────────────────────────────────────────────────────────────

def _poll_loop() -> None:
    """Main worker loop — poll SQS and dispatch tasks to the thread pool.

    Uses 20-second long-polling to minimize SQS API calls.  When SQS is
    not configured (local dev), the SQS client returns immediately from the
    local in-memory queue.

    Stops when ``_stop`` event is set (SIGTERM / SIGINT).
    """
    from app.services.scraping_queue import receive_messages

    logger.info(
        "Poll loop started | stage=%s | max_concurrent=%d",
        os.environ.get("STAGE", "dev"),
        MAX_CONCURRENT,
    )

    while not _stop.is_set():
        try:
            # Long-poll: blocks up to 20 s if queue is empty
            messages = receive_messages(max_messages=MAX_CONCURRENT, wait_seconds=20)

            for msg in messages:
                task_id = msg["task_id"]
                receipt_handle = msg["receipt_handle"]

                with _lock:
                    if task_id in _in_progress:
                        continue
                    if len(_in_progress) >= MAX_CONCURRENT:
                        break
                    _in_progress.add(task_id)

                _executor.submit(_run_with_semaphore, task_id, receipt_handle)

        except Exception as exc:
            logger.error("Poll loop error: %s", exc)
            _stop.wait(5)  # brief backoff before next attempt

    logger.info("Poll loop stopped.")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    """Worker entry point.  Called by ``python -m app.worker`` and systemd."""
    signal.signal(signal.SIGTERM, lambda *_: _stop.set())
    signal.signal(signal.SIGINT, lambda *_: _stop.set())

    if not _acquire_singleton():
        sys.exit(0)

    logger.info(
        "Scraping worker PID=%d starting | stage=%s",
        os.getpid(),
        os.environ.get("STAGE", "dev"),
    )
    _recover()
    _poll_loop()
    logger.info("Scraping worker PID=%d exiting cleanly.", os.getpid())


if __name__ == "__main__":
    main()
