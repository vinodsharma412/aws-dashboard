"""FastAPI application factory — AWS / DynamoDB edition.

Differences from the original PostgreSQL version:
- No SQLAlchemy engine or ``Base.metadata.create_all`` — DynamoDB tables are
  managed by ``infrastructure/dynamodb/create_tables.py``.
- No ORM model imports (no ``app.models.*``).
- The scraping worker subprocess is still spawned on startup so that stock
  data fetching and Playwright scraping work the same way on EC2.
- Avatar images are served from S3 (public URL), not from a local ``/static``
  mount — so ``StaticFiles`` is removed.

CORS policy:
  ``allow_origins=["*"]`` is acceptable here because the S3 frontend URL is
  not a secret. In production, replace with the exact CloudFront or S3 URL.
"""

import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.config import settings
from app.middleware.logging_middleware import LoggingMiddleware

_WORKER_SCRIPT = Path(__file__).resolve().parent / "worker.py"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Manage startup and shutdown tasks.

    On startup:
    - Spawns the Playwright scraping worker as a separate OS process.

    On shutdown (``finally`` block):
    - Sends ``SIGTERM`` to the worker.

    The worker is launched via ``shell=True`` so that debugpy (the VS Code
    debugger) does not intercept and instrument the child process.
    """
    worker = None
    if _WORKER_SCRIPT.exists():
        worker = subprocess.Popen(
            [sys.executable, str(_WORKER_SCRIPT)],
            start_new_session=True,
        )
    try:
        yield
    finally:
        if worker:
            worker.terminate()


_root_path = "" if settings.STAGE == "prod" else f"/{settings.STAGE}"

app = FastAPI(
    title=settings.APP_NAME,
    debug=settings.DEBUG,
    lifespan=lifespan,
    root_path=_root_path,
)

app.add_middleware(LoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")
