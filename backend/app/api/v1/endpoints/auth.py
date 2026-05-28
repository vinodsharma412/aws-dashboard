"""Authentication endpoints.

Provides the OAuth2 password-grant token endpoint consumed by the frontend
login form and the OpenAPI "Authorize" button.

In the AWS version there is no database session dependency — DynamoDB is
accessed directly via ``login_user`` → ``crud.user_dynamo.get_by_username``.
"""

import datetime
import threading

from fastapi import APIRouter, Depends, Request
from fastapi.security import OAuth2PasswordRequestForm

from app.config import settings
from app.schemas.auth import Token
from app.services.auth_service import login_user

router = APIRouter()


def _sns_prod_login_alert(username: str, ip: str) -> None:
    """Publish a prod-login SNS notification in a background thread."""
    arn = settings.SNS_ALERTS_ARN
    if not arn:
        return
    try:
        import boto3
        sns = boto3.client("sns", region_name=settings.AWS_REGION)
        when = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
        sns.publish(
            TopicArn=arn,
            Subject="[NSE PROD] User login alert",
            Message=(
                f"A user logged in to the PRODUCTION environment.\n\n"
                f"  Username : {username}\n"
                f"  IP       : {ip}\n"
                f"  Time     : {when}\n\n"
                f"If this was not you, revoke the JWT secret immediately:\n"
                f"  AWS SSM → /nse/prod/jwt-secret"
            ),
        )
    except Exception:
        pass  # never block a login because of a notification failure


@router.post("/token", response_model=Token)
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends()) -> Token:
    """Exchange username + password for a JWT access token.

    The request body must be ``application/x-www-form-urlencoded`` (OAuth2
    convention), not JSON.  The frontend sends it via ``URLSearchParams``.

    Args:
        request:   FastAPI request (used to read the client IP for prod alerts).
        form_data: Username and password parsed from the form body by FastAPI.

    Returns:
        A ``Token`` schema with ``access_token`` (JWT) and ``token_type``
        (always ``"bearer"``).

    Raises:
        HTTPException 401: If credentials are invalid.
        HTTPException 400: If the user account is inactive.
    """
    token = login_user(form_data.username, form_data.password)

    if settings.STAGE == "prod":
        client_ip = (
            request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else "unknown")
        )
        threading.Thread(
            target=_sns_prod_login_alert,
            args=(form_data.username, client_ip),
            daemon=True,
        ).start()

    return {"access_token": token, "token_type": "bearer"}
