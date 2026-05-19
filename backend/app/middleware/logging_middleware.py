"""HTTP request/response logging middleware.

Logs method, path, status code, and latency for every request.
Attaches a unique request ID so correlated log lines can be found in
CloudWatch Logs Insights with a single query.
"""

import time
import uuid

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logging import get_logger

logger = get_logger(__name__)


class LoggingMiddleware(BaseHTTPMiddleware):
    """Log every HTTP request and its response status/latency."""

    async def dispatch(self, request: Request, call_next) -> Response:
        """Process the request, log it, and forward the response.

        Args:
            request: Incoming HTTP request.
            call_next: Next middleware or route handler in the chain.

        Returns:
            The HTTP response from the route handler.
        """
        request_id = uuid.uuid4().hex[:8]
        start = time.time()
        response = await call_next(request)
        elapsed_ms = round((time.time() - start) * 1000)
        logger.info(
            "%s %s %s %dms [%s]",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            request_id,
        )
        response.headers["X-Request-ID"] = request_id
        return response
