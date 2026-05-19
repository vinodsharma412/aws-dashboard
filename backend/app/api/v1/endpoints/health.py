"""Health check endpoint.

Returns a simple OK response used by load balancers and uptime monitors
to verify the API process is alive.
"""

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
def health_check() -> dict:
    """Return a liveness signal.

    Returns:
        JSON ``{"status": "ok"}`` with HTTP 200.
    """
    return {"status": "ok"}
